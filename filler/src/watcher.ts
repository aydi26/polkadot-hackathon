import { ethers } from "ethers";
import { config } from "./config.js";

// IntentGateway ABI (events only)
const GATEWAY_ABI = [
  "event OrderPlaced(bytes32 indexed orderId, address indexed user, address token, uint256 amount, uint32 destChain, address destAddress, uint256 feeOffer, uint256 deadline)",
  "function getActiveOrders() view returns (bytes32[])",
  "function getOrder(bytes32 orderId) view returns (tuple(bytes32 orderId, address user, address token, uint256 amount, uint32 destChain, address destAddress, uint256 feeOffer, uint256 deadline, uint256 createdAt, uint8 status))",
];

export interface OrderEvent {
  orderId: string;
  user: string;
  token: string;
  amount: bigint;
  destChain: number;
  destAddress: string;
  feeOffer: bigint;
  deadline: bigint;
}

export type OrderHandler = (order: OrderEvent) => Promise<void>;

export class OrderWatcher {
  private provider: ethers.JsonRpcProvider;
  private gateway: ethers.Contract;
  private handlers: OrderHandler[] = [];
  private lastBlock: number = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seenOrders: Set<string> = new Set();

  constructor() {
    // Watches EVM events on the source chain
    this.provider = new ethers.JsonRpcProvider(config.rpcSource);
    this.gateway = new ethers.Contract(config.intentGatewayAddress, GATEWAY_ABI, this.provider);
  }

  onOrder(handler: OrderHandler): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    console.log("[Watcher] Listening for OrderPlaced events (polling mode)...");

    // Start from current block
    this.lastBlock = await this.provider.getBlockNumber();
    console.log(`[Watcher] Starting from block ${this.lastBlock}`);

    // Poll every 4 seconds
    this.pollTimer = setInterval(() => this.poll(), 4000);
    // Also poll immediately
    await this.poll();
  }

  private async poll(): Promise<void> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      if (currentBlock <= this.lastBlock) return;

      const events = await this.gateway.queryFilter(
        "OrderPlaced",
        this.lastBlock + 1,
        currentBlock
      );

      for (const event of events) {
        const log = event as ethers.EventLog;
        const orderId = log.args[0] as string;

        // Skip already-seen orders
        if (this.seenOrders.has(orderId)) continue;
        this.seenOrders.add(orderId);

        const order: OrderEvent = {
          orderId,
          user: log.args[1] as string,
          token: log.args[2] as string,
          amount: log.args[3] as bigint,
          destChain: Number(log.args[4]),
          destAddress: log.args[5] as string,
          feeOffer: log.args[6] as bigint,
          deadline: log.args[7] as bigint,
        };

        console.log(`[Watcher] New order detected: ${orderId}`);
        console.log(`  User: ${order.user}, Amount: ${ethers.formatUnits(order.amount, 6)} USDC, Fee: ${ethers.formatUnits(order.feeOffer, 6)} USDC`);

        for (const handler of this.handlers) {
          try {
            await handler(order);
          } catch (err) {
            console.error(`[Watcher] Handler error for order ${orderId}:`, err);
          }
        }
      }

      this.lastBlock = currentBlock;
    } catch (err) {
      console.error("[Watcher] Poll error:", err);
    }
  }

  async getActiveOrders(): Promise<string[]> {
    return await this.gateway.getActiveOrders();
  }

  async getOrder(orderId: string) {
    return await this.gateway.getOrder(orderId);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.gateway.removeAllListeners();
    console.log("[Watcher] Stopped.");
  }
}
