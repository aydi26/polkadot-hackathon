import { ethers } from "ethers";
import { config, type DestChainConfig } from "./config.js";
import { FillerState, FillStatus } from "./state.js";

/**
 * CrossChainRelay — Simulates ISMP cross-chain message relay for hackathon demo.
 *
 * In production, Hyperbridge relayers deliver ISMP messages between chains.
 * For testnet demo, this bot watches for OrderFilled events on the destination chain
 * and calls markOrderFilled() on the source chain gateway, simulating the
 * FILL_CONFIRMATION ISMP message that would be delivered by Hyperbridge.
 *
 * Flow:
 *   1. Filler calls fillOrder() on destination chain (IntentSettler)
 *   2. This relay detects the OrderFilled event
 *   3. Relay calls markOrderFilled() on source chain (IntentGateway)
 *   4. Order status changes from Pending -> Filled
 *   5. Now releaseEscrow() can be called by the auto-settler
 */

// IntentSettler ABI (destination — listen for fills)
const SETTLER_ABI = [
  "event OrderFilled(bytes32 indexed orderId, address indexed filler, address indexed recipient, address token, uint256 amount, uint256 fillTimestamp)",
];

// IntentGateway ABI (source — mark order filled)
const GATEWAY_ABI = [
  "function markOrderFilled(bytes32 orderId) external",
  "function getOrder(bytes32 orderId) view returns (tuple(bytes32 orderId, address user, address token, uint256 amount, uint32 destChain, address destAddress, uint256 feeOffer, uint256 deadline, uint256 createdAt, uint8 status))",
];

export class CrossChainRelay {
  private destProvider: ethers.JsonRpcProvider;
  private settler: ethers.Contract;

  private sourceProvider: ethers.JsonRpcProvider;
  private sourceWallet: ethers.Wallet;
  private gateway: ethers.Contract;

  private state: FillerState;
  private destConfig: DestChainConfig;
  private relayedOrders: Set<string> = new Set();
  private running = false;
  private lastBlock: number = 0;

  constructor(state: FillerState, destConfig: DestChainConfig, sourceWallet?: ethers.Signer) {
    this.state = state;
    this.destConfig = destConfig;

    // Destination chain (listen for fills)
    this.destProvider = new ethers.JsonRpcProvider(destConfig.rpc);
    this.settler = new ethers.Contract(destConfig.intentSettlerAddress, SETTLER_ABI, this.destProvider);

    // Source chain (relay fill confirmation) — use shared NonceManager if provided
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
    this.running = true;
    console.log(`[Relay:${this.destConfig.chainId}] Cross-chain relay started for ${this.destConfig.name}`);
    console.log(`[Relay:${this.destConfig.chainId}] Watching for OrderFilled events (polling)...`);

    this.lastBlock = await this.destProvider.getBlockNumber();
    this.pollLoop();
  }

  /** Poll for OrderFilled events instead of using .on() to avoid RPC rate-limit crashes */
  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const currentBlock = await this.destProvider.getBlockNumber();
        if (currentBlock > this.lastBlock) {
          const events = await this.settler.queryFilter("OrderFilled", this.lastBlock + 1, currentBlock);

          for (const event of events) {
            const log = event as ethers.EventLog;
            const orderId = log.args[0] as string;

            if (this.relayedOrders.has(orderId)) continue;
            this.relayedOrders.add(orderId);

            const filler = log.args[1] as string;
            const amount = log.args[4] as bigint;

            console.log(`[Relay:${this.destConfig.chainId}] OrderFilled detected: ${orderId.slice(0, 10)}...`);
            console.log(`[Relay:${this.destConfig.chainId}]   Filler: ${filler}, Amount: ${ethers.formatUnits(amount, 6)} USDC`);

            await this.relayFillConfirmation(orderId);
          }

          this.lastBlock = currentBlock;
        }
      } catch (err) {
        console.error(`[Relay:${this.destConfig.chainId}] Poll error:`, err);
      }

      await sleep(10000); // Poll every 10s to avoid rate limits
    }
  }

  /** Relay FILL_CONFIRMATION: map fillId → sourceOrderId, call markOrderFilled on source */
  private async relayFillConfirmation(fillId: string): Promise<void> {
    try {
      // For private orders, fillId != sourceOrderId. Look up the mapping from state.
      const record = this.state.findByFillId(fillId);
      const sourceOrderId = record?.orderId || fillId; // fallback for public orders

      // Check if order is still Pending on source chain (status = 1)
      const order = await this.gateway.getOrder(sourceOrderId);
      if (Number(order.status) !== 1) {
        console.log(`[Relay:${this.destConfig.chainId}] Order ${sourceOrderId.slice(0, 10)}... already status=${order.status}, skipping`);
        return;
      }

      console.log(`[Relay:${this.destConfig.chainId}] Relaying FILL_CONFIRMATION to source chain (sourceOrderId: ${sourceOrderId.slice(0, 10)}...)...`);
      const tx = await this.gateway.markOrderFilled(sourceOrderId);
      const receipt = await tx.wait();
      console.log(`[Relay:${this.destConfig.chainId}] markOrderFilled TX: ${receipt.hash}`);
    } catch (err) {
      console.error(`[Relay:${this.destConfig.chainId}] Failed to relay for ${fillId.slice(0, 10)}...:`, err);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log(`[Relay:${this.destConfig.chainId}] Stopped.`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
