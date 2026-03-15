import { ethers } from "ethers";
import { config } from "./config.js";

// IntentGateway ABI (events only)
const GATEWAY_ABI = [
  "event OrderPlaced(bytes32 indexed orderId, address indexed user, address token, uint256 amount, uint32 destChain, address destAddress, uint256 feeOffer, uint256 deadline)",
  "event PrivateOrderPlaced(bytes32 indexed orderId, address indexed user, address token, uint256 amount, uint32 destChain, bytes encryptedDest, uint256 feeOffer, uint256 deadline)",
  "function getActiveOrders() view returns (bytes32[])",
  "function getOrder(bytes32 orderId) view returns (tuple(bytes32 orderId, address user, address token, uint256 amount, uint32 destChain, address destAddress, uint256 feeOffer, uint256 deadline, uint256 createdAt, uint8 status))",
];

export interface OrderEvent {
  orderId: string;
  user: string;
  token: string;
  amount: bigint;
  destChain: number;
  destAddress: string; // plaintext for public orders, empty for private
  feeOffer: bigint;
  deadline: bigint;
  isPrivate: boolean;
  encryptedDest?: string; // hex ECIES ciphertext (private orders only)
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
    this.provider = new ethers.JsonRpcProvider(config.rpcSource);
    this.gateway = new ethers.Contract(config.intentGatewayAddress, GATEWAY_ABI, this.provider);
  }

  onOrder(handler: OrderHandler): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    console.log("[Watcher] Listening for OrderPlaced + PrivateOrderPlaced events (polling mode)...");

    this.lastBlock = await this.provider.getBlockNumber();
    console.log(`[Watcher] Starting from block ${this.lastBlock}`);

    this.pollTimer = setInterval(() => this.poll(), 4000);
    await this.poll();
  }

  private async poll(): Promise<void> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      if (currentBlock <= this.lastBlock) return;

      // Query public orders
      const publicEvents = await this.gateway.queryFilter("OrderPlaced", this.lastBlock + 1, currentBlock);
      for (const event of publicEvents) {
        await this.handlePublicOrder(event as ethers.EventLog);
      }

      // Query private orders
      const privateEvents = await this.gateway.queryFilter("PrivateOrderPlaced", this.lastBlock + 1, currentBlock);
      for (const event of privateEvents) {
        await this.handlePrivateOrder(event as ethers.EventLog);
      }

      this.lastBlock = currentBlock;
    } catch (err) {
      console.error("[Watcher] Poll error:", err);
    }
  }

  private async handlePublicOrder(log: ethers.EventLog): Promise<void> {
    const orderId = log.args[0] as string;
    if (this.seenOrders.has(orderId)) return;
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
      isPrivate: false,
    };

    console.log(`[Watcher] Public order: ${orderId}`);
    console.log(`  User: ${order.user}, Amount: ${ethers.formatUnits(order.amount, 6)} USDC, Fee: ${ethers.formatUnits(order.feeOffer, 6)} USDC`);

    await this.dispatch(order);
  }

  private async handlePrivateOrder(log: ethers.EventLog): Promise<void> {
    const orderId = log.args[0] as string;
    if (this.seenOrders.has(orderId)) return;
    this.seenOrders.add(orderId);

    const order: OrderEvent = {
      orderId,
      user: log.args[1] as string,
      token: log.args[2] as string,
      amount: log.args[3] as bigint,
      destChain: Number(log.args[4]),
      destAddress: "", // unknown until TEE decrypts
      feeOffer: log.args[6] as bigint,
      deadline: log.args[7] as bigint,
      isPrivate: true,
      encryptedDest: log.args[5] as string,
    };

    console.log(`[Watcher] Private order: ${orderId}`);
    console.log(`  User: ${order.user}, Amount: ${ethers.formatUnits(order.amount, 6)} USDC (dest encrypted)`);

    await this.dispatch(order);
  }

  private async dispatch(order: OrderEvent): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(order);
      } catch (err) {
        console.error(`[Watcher] Handler error for order ${order.orderId}:`, err);
      }
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
