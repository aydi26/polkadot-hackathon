import { ethers } from "ethers";
import { config, type DestChainConfig } from "./config.js";
import { FillerState, FillStatus } from "./state.js";
import { TEEClient } from "./tee.js";

// IntentSettler ABI (destination chain)
const SETTLER_ABI = [
  "function verifySettlement(bytes32 orderId, bytes proof) external",
  "function verifyTEESettlement(bytes32 orderId, bytes teeAttestation, bytes signature) external",
  "function getPendingSettlements() view returns (bytes32[])",
  "function getFill(bytes32 orderId) view returns (tuple(bytes32 orderId, address filler, address recipient, address token, uint256 amount, uint256 fillTimestamp, bool settled))",
  "event SettlementVerified(bytes32 indexed orderId, address indexed filler, bytes32 proofHash)",
  "event TEESettlementVerified(bytes32 indexed orderId, address indexed filler, address enclaveSigner)",
];

// IntentGateway ABI (source chain)
const GATEWAY_ABI = [
  "function releaseEscrow(bytes32 orderId, address fillerAddress, bytes proof) external",
  "function getOrder(bytes32 orderId) view returns (tuple(bytes32 orderId, address user, address token, uint256 amount, uint32 destChain, address destAddress, uint256 feeOffer, uint256 deadline, uint256 createdAt, uint8 status))",
];

export class SettlementMonitor {
  private destProvider: ethers.JsonRpcProvider;
  private destWallet: ethers.Wallet;
  private settler: ethers.Contract;

  private sourceProvider: ethers.JsonRpcProvider;
  private sourceWallet: ethers.Wallet;
  private gateway: ethers.Contract;

  private monitoring = false;
  private state: FillerState;
  private destConfig: DestChainConfig;
  private settledOrders: Set<string> = new Set();
  private teeClient?: TEEClient;

  constructor(state: FillerState, destConfig: DestChainConfig) {
    this.state = state;
    this.destConfig = destConfig;

    // Destination chain (where fills happen)
    this.destProvider = new ethers.JsonRpcProvider(destConfig.rpc);
    this.destWallet = new ethers.Wallet(config.fillerPrivateKey, this.destProvider);
    this.settler = new ethers.Contract(destConfig.intentSettlerAddress, SETTLER_ABI, this.destWallet);

    // Source chain (where escrow lives)
    this.sourceProvider = new ethers.JsonRpcProvider(config.rpcSource);
    this.sourceWallet = new ethers.Wallet(config.fillerPrivateKey, this.sourceProvider);
    this.gateway = new ethers.Contract(config.intentGatewayAddress, GATEWAY_ABI, this.sourceWallet);

    // TEE client (if enabled for this destination)
    if (destConfig.teeEnabled) {
      this.teeClient = new TEEClient(undefined, config.teePrivateKey);
    }
  }

  async start(): Promise<void> {
    this.monitoring = true;
    const settleDelay = this.teeClient?.isEnabled ? config.teeAutoSettleDelayMs : config.autoSettleDelayMs;
    const mode = this.teeClient?.isEnabled ? "TEE (Phala)" : "BEEFY";
    console.log(`[Settler:${this.destConfig.chainId}] Monitoring pending settlements for ${this.destConfig.name}...`);
    console.log(`[Settler:${this.destConfig.chainId}] Settlement mode: ${mode}, delay: ${settleDelay}ms`);

    // Listen for settlement events
    this.settler.on("SettlementVerified", (orderId: string, filler: string, proofHash: string) => {
      console.log(`[Settler:${this.destConfig.chainId}] Settlement verified: ${orderId}`);
      this.state.markSettled(orderId, proofHash);
      this.settledOrders.add(orderId);
    });

    // Start the auto-settlement loop
    this.autoSettleLoop();
  }

  /** Auto-settlement loop: polls pending fills and auto-settles after delay */
  private async autoSettleLoop(): Promise<void> {
    while (this.monitoring) {
      try {
        const pending: string[] = await this.settler.getPendingSettlements();
        if (pending.length > 0) {
          console.log(`[Settler:${this.destConfig.chainId}] ${pending.length} pending settlement(s)`);

          for (const orderId of pending) {
            if (this.settledOrders.has(orderId)) continue;

            const fill = await this.settler.getFill(orderId);
            const elapsed = Date.now() / 1000 - Number(fill.fillTimestamp);

            const delay = this.teeClient?.isEnabled ? config.teeAutoSettleDelayMs : config.autoSettleDelayMs;
            if (elapsed * 1000 >= delay) {
              await this.autoSettle(orderId, fill.filler);
            } else {
              const remaining = Math.round(delay / 1000 - elapsed);
              console.log(`  Order ${orderId.slice(0, 10)}...: settling in ${remaining}s`);
            }
          }
        }
      } catch (err) {
        console.error(`[Settler:${this.destConfig.chainId}] Poll error:`, err);
      }

      await sleep(config.pollInterval * 3); // Check every ~6s
    }
  }

  /** Execute auto-settlement: branch between TEE (fast) and BEEFY (fallback) */
  private async autoSettle(orderId: string, fillerAddress: string): Promise<void> {
    if (this.teeClient?.isEnabled) {
      await this.autoSettleTEE(orderId, fillerAddress);
    } else {
      await this.autoSettleBEEFY(orderId, fillerAddress);
    }
  }

  /** TEE fast path: request attestation from Phala enclave, verify on-chain (~5-10s) */
  private async autoSettleTEE(orderId: string, fillerAddress: string): Promise<void> {
    const tag = `[Settler:${this.destConfig.chainId}:TEE]`;
    console.log(`${tag} Auto-settling order ${orderId.slice(0, 10)}... via TEE`);
    this.state.updateStatus(orderId, FillStatus.SETTLING, { settlementMethod: "tee" });

    try {
      // Step 1: Request TEE attestation
      console.log(`${tag}   Step 1/3: Requesting TEE attestation...`);
      const { encodedAttestation, signature } = await this.teeClient!.requestAttestation(
        orderId,
        fillerAddress,
        0n, // amount — read from fill in production
        config.intentGatewayAddress,
        420420417 // Polkadot Hub Testnet chain ID
      );

      // Step 2: Verify TEE settlement on destination chain
      console.log(`${tag}   Step 2/3: verifyTEESettlement on destination...`);
      const settleTx = await this.settler.verifyTEESettlement(orderId, encodedAttestation, signature);
      const settleReceipt = await settleTx.wait();
      console.log(`${tag}   TEE settlement verified! TX: ${settleReceipt.hash}`);
      this.state.markSettled(orderId, settleReceipt.hash);
      this.settledOrders.add(orderId);

      // Step 3: Release escrow on source chain
      console.log(`${tag}   Step 3/3: releaseEscrow on source...`);
      const releaseTx = await this.gateway.releaseEscrow(orderId, fillerAddress, encodedAttestation);
      const releaseReceipt = await releaseTx.wait();
      console.log(`${tag}   Escrow released! TX: ${releaseReceipt.hash}`);
      this.state.markReleased(orderId, releaseReceipt.hash);

      console.log(`${tag} === Order ${orderId.slice(0, 10)}... fully settled via TEE ===`);
    } catch (err) {
      console.error(`${tag} TEE settle failed for ${orderId.slice(0, 10)}..., falling back to BEEFY:`, err);
      // Fallback to BEEFY if TEE fails
      await this.autoSettleBEEFY(orderId, fillerAddress);
    }
  }

  /** BEEFY fallback: dummy proof settlement (~6-8min in production) */
  private async autoSettleBEEFY(orderId: string, fillerAddress: string): Promise<void> {
    const tag = `[Settler:${this.destConfig.chainId}:BEEFY]`;
    console.log(`${tag} Auto-settling order ${orderId.slice(0, 10)}... via BEEFY`);
    this.state.updateStatus(orderId, FillStatus.SETTLING, { settlementMethod: "beefy" });

    // Dummy proof (hackathon placeholder -- in production this is the ZK BEEFY proof)
    const dummyProof = ethers.solidityPacked(["bytes32"], [ethers.id("settlement-proof")]);

    try {
      // Step 1: Verify settlement on destination chain
      console.log(`${tag}   Step 1/2: verifySettlement on destination...`);
      const settleTx = await this.settler.verifySettlement(orderId, dummyProof);
      const settleReceipt = await settleTx.wait();
      console.log(`${tag}   Settlement verified! TX: ${settleReceipt.hash}`);
      this.state.markSettled(orderId, settleReceipt.hash);
      this.settledOrders.add(orderId);

      // Step 2: Release escrow on source chain
      console.log(`${tag}   Step 2/2: releaseEscrow on source...`);
      const releaseTx = await this.gateway.releaseEscrow(orderId, fillerAddress, dummyProof);
      const releaseReceipt = await releaseTx.wait();
      console.log(`${tag}   Escrow released! TX: ${releaseReceipt.hash}`);
      this.state.markReleased(orderId, releaseReceipt.hash);

      console.log(`${tag} === Order ${orderId.slice(0, 10)}... fully settled via BEEFY ===`);
    } catch (err) {
      console.error(`${tag} Auto-settle failed for ${orderId.slice(0, 10)}...:`, err);
      this.state.markFailed(orderId, String(err));
    }
  }

  async stop(): Promise<void> {
    this.monitoring = false;
    this.settler.removeAllListeners();
    console.log(`[Settler:${this.destConfig.chainId}] Stopped.`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
