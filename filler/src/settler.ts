import { ethers } from "ethers";
import { config, type DestChainConfig } from "./config.js";
import { FillerState, FillStatus } from "./state.js";
import { TEEClient } from "./tee.js";

// IntentSettler ABI (destination chain)
const SETTLER_ABI = [
  "function verifySettlement(bytes32 orderId, bytes proof) external",
  "function verifyTEESettlement(bytes32 orderId, bytes teeAttestation, bytes signature) external",
  "function verifyTEESettlementWithQuote(bytes32 orderId, bytes teeAttestation, bytes signature, bytes tdxQuote) external",
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

  constructor(state: FillerState, destConfig: DestChainConfig, teeClient?: TEEClient) {
    this.state = state;
    this.destConfig = destConfig;
    this.teeClient = teeClient;

    // Destination chain (where fills happen)
    this.destProvider = new ethers.JsonRpcProvider(destConfig.rpc);
    // Use TEE-derived wallet if available (anonymous intermediary)
    const teeWallet = teeClient?.getFillerWallet(this.destProvider);
    this.destWallet = teeWallet || new ethers.Wallet(config.fillerPrivateKey, this.destProvider);
    this.settler = new ethers.Contract(destConfig.intentSettlerAddress, SETTLER_ABI, this.destWallet);

    // Source chain (where escrow lives)
    this.sourceProvider = new ethers.JsonRpcProvider(config.rpcSource);
    this.sourceWallet = new ethers.Wallet(config.fillerPrivateKey, this.sourceProvider);
    this.gateway = new ethers.Contract(config.intentGatewayAddress, GATEWAY_ABI, this.sourceWallet);
  }

  async start(): Promise<void> {
    this.monitoring = true;
    const settleDelay = this.teeClient?.isEnabled ? config.teeAutoSettleDelayMs : config.autoSettleDelayMs;
    const mode = this.teeClient?.isEnabled ? `TEE (Phala dstack, ${config.teeMode})` : "BEEFY";
    console.log(`[Settler:${this.destConfig.chainId}] Monitoring pending settlements for ${this.destConfig.name}...`);
    console.log(`[Settler:${this.destConfig.chainId}] Settlement mode: ${mode}, delay: ${settleDelay}ms`);

    // Start the auto-settlement loop (polling-based to avoid RPC rate-limit crashes)
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

      await sleep(15000); // Check every 15s to avoid RPC rate limits
    }
  }

  /** Execute auto-settlement via TEE */
  private async autoSettle(orderId: string, fillerAddress: string): Promise<void> {
    await this.autoSettleTEE(orderId, fillerAddress);
  }

  /** TEE fast path: dual attestation for privacy (fillId on dest, sourceOrderId on source) */
  private async autoSettleTEE(fillId: string, fillerAddress: string): Promise<void> {
    const tag = `[Settler:${this.destConfig.chainId}:TEE]`;

    // Look up sourceOrderId from state (for private orders, fillId != sourceOrderId)
    const record = this.state.findByFillId(fillId);
    const sourceOrderId = record?.orderId || fillId; // fallback for public orders

    console.log(`${tag} Auto-settling fillId ${fillId.slice(0, 10)}... via TEE (${config.teeMode})`);
    this.state.updateStatus(sourceOrderId, FillStatus.SETTLING, { settlementMethod: "tee" });

    try {
      // Step 1: Request DESTINATION attestation (uses fillId — unlinkable)
      console.log(`${tag}   Step 1/4: Requesting dest TEE attestation (fillId)...`);
      const destAtt = await this.teeClient!.requestAttestation(
        fillId, fillerAddress, 0n, config.intentGatewayAddress, 420420417
      );

      // Step 2: Verify TEE settlement on destination using fillId
      console.log(`${tag}   Step 2/4: verifyTEESettlement on destination...`);
      let settleTx;
      if (destAtt.tdxQuote) {
        settleTx = await this.settler.verifyTEESettlementWithQuote(fillId, destAtt.encodedAttestation, destAtt.signature, destAtt.tdxQuote);
      } else {
        settleTx = await this.settler.verifyTEESettlement(fillId, destAtt.encodedAttestation, destAtt.signature);
      }
      const settleReceipt = await settleTx.wait();
      console.log(`${tag}   TEE settlement verified! TX: ${settleReceipt.hash}`);
      this.state.markSettled(sourceOrderId, settleReceipt.hash);
      this.settledOrders.add(fillId);
    } catch (err) {
      console.error(`${tag} TEE dest settlement failed for ${fillId.slice(0, 10)}...:`, err);
      this.state.markFailed(sourceOrderId, String(err));
      return;
    }

    // Step 3-4: Release escrow on source (separate try/catch — don't re-settle dest on failure)
    try {
      console.log(`${tag}   Step 3/4: Requesting source TEE attestation (sourceOrderId)...`);
      const sourceAtt = await this.teeClient!.requestAttestation(
        sourceOrderId, fillerAddress, 0n, config.intentGatewayAddress, 420420417
      );

      console.log(`${tag}   Step 4/4: releaseEscrow on source...`);
      const releaseTx = await this.gateway.releaseEscrow(sourceOrderId, fillerAddress, sourceAtt.encodedAttestation);
      const releaseReceipt = await releaseTx.wait();
      console.log(`${tag}   Escrow released! TX: ${releaseReceipt.hash}`);
      this.state.markReleased(sourceOrderId, releaseReceipt.hash);

      console.log(`${tag} === Order ${sourceOrderId.slice(0, 10)}... fully settled via TEE (${config.teeMode}) ===`);
    } catch (err) {
      console.error(`${tag} Escrow release failed for ${sourceOrderId.slice(0, 10)}... (dest already settled, will retry):`, err);
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
