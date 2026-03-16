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
  "function markOrderFilled(bytes32 orderId) external",
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

  constructor(state: FillerState, destConfig: DestChainConfig, teeClient?: TEEClient, sourceWallet?: ethers.Signer) {
    this.state = state;
    this.destConfig = destConfig;
    this.teeClient = teeClient;

    // Destination chain (where fills happen)
    this.destProvider = new ethers.JsonRpcProvider(destConfig.rpc);
    // Use TEE-derived wallet if available (anonymous intermediary)
    const teeWallet = teeClient?.getFillerWallet(this.destProvider);
    this.destWallet = teeWallet || new ethers.Wallet(config.fillerPrivateKey, this.destProvider);
    this.settler = new ethers.Contract(destConfig.intentSettlerAddress, SETTLER_ABI, this.destWallet);

    // Source chain (where escrow lives) — use shared NonceManager if provided
    if (sourceWallet) {
      this.sourceWallet = sourceWallet as ethers.Wallet;
      this.sourceProvider = sourceWallet.provider as ethers.JsonRpcProvider;
    } else {
      this.sourceProvider = new ethers.JsonRpcProvider(config.rpcSource);
      this.sourceWallet = new ethers.Wallet(config.fillerPrivateKey, this.sourceProvider);
    }
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

  /** Auto-settlement loop: polls filled orders from state and releases escrow on source */
  private async autoSettleLoop(): Promise<void> {
    while (this.monitoring) {
      try {
        // Find orders that have been filled (HL bridge done) but not yet settled
        const filledOrders = this.state.getByStatus(FillStatus.FILLED);
        for (const record of filledOrders) {
          if (this.settledOrders.has(record.orderId)) continue;

          const elapsed = Date.now() - (record.filledAt || 0);
          const delay = this.teeClient?.isEnabled ? config.teeAutoSettleDelayMs : config.autoSettleDelayMs;

          if (elapsed >= delay) {
            await this.autoSettleTEE(record.orderId);
          }
        }
      } catch (err) {
        console.error(`[Settler:${this.destConfig.chainId}] Poll error:`, err);
      }

      await sleep(15000);
    }
  }

  /** TEE settlement: mark order filled + release escrow on source chain */
  private async autoSettleTEE(sourceOrderId: string): Promise<void> {
    const tag = `[Settler:${this.destConfig.chainId}:TEE]`;
    const fillerAddress = this.destWallet.address;

    console.log(`${tag} Auto-settling ${sourceOrderId.slice(0, 10)}... via TEE (${config.teeMode})`);
    this.state.updateStatus(sourceOrderId, FillStatus.SETTLING, { settlementMethod: "tee" });

    try {
      // Step 1/3: Check source chain order status and mark as filled if needed
      console.log(`${tag}   Step 1/3: Checking source chain order status...`);
      const order = await this.gateway.getOrder(sourceOrderId);
      const status = Number(order.status);

      if (status === 3) {
        console.log(`${tag}   Order already settled on source chain, skipping.`);
        this.settledOrders.add(sourceOrderId);
        this.state.markSettled(sourceOrderId, "already-settled");
        this.state.markReleased(sourceOrderId, "already-settled");
        return;
      }

      if (status === 1) {
        console.log(`${tag}   Order is Pending, calling markOrderFilled...`);
        const markTx = await this.gateway.markOrderFilled(sourceOrderId);
        const markReceipt = await markTx.wait();
        console.log(`${tag}   markOrderFilled TX: ${markReceipt.hash}`);
      } else if (status === 2) {
        console.log(`${tag}   Order already marked as Filled.`);
      } else {
        console.error(`${tag}   Unexpected order status: ${status}, cannot settle.`);
        this.state.markFailed(sourceOrderId, `Unexpected order status: ${status}`);
        return;
      }

      // Step 2/3: Request TEE attestation for source chain
      console.log(`${tag}   Step 2/3: Requesting TEE attestation (sourceOrderId)...`);
      const sourceAtt = await this.teeClient!.requestAttestation(
        sourceOrderId, fillerAddress, 0n, config.intentGatewayAddress, 420420417
      );

      // Step 3/3: Release escrow on source chain
      console.log(`${tag}   Step 3/3: releaseEscrow on source...`);
      const releaseTx = await this.gateway.releaseEscrow(sourceOrderId, fillerAddress, sourceAtt.encodedAttestation);
      const releaseReceipt = await releaseTx.wait();
      console.log(`${tag}   Escrow released! TX: ${releaseReceipt.hash}`);

      this.state.markSettled(sourceOrderId, releaseReceipt.hash);
      this.state.markReleased(sourceOrderId, releaseReceipt.hash);
      this.settledOrders.add(sourceOrderId);

      console.log(`${tag} === Order ${sourceOrderId.slice(0, 10)}... fully settled via TEE (${config.teeMode}) ===`);
    } catch (err) {
      console.error(`${tag} Settlement failed for ${sourceOrderId.slice(0, 10)}...:`, err);
      this.state.markFailed(sourceOrderId, String(err));
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
