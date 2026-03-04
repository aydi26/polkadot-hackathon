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

  constructor() {
    // TODO: For hackathon, watching EVM events on the source chain
    // In production: use @polkadot/api for Asset Hub substrate events
    this.provider = new ethers.JsonRpcProvider(config.rpcAssetHub);
    this.gateway = new ethers.Contract(config.intentGatewayAddress, GATEWAY_ABI, this.provider);
  }

  onOrder(handler: OrderHandler): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    console.log("[Watcher] Listening for OrderPlaced events...");

    // Listen for new events
    this.gateway.on("OrderPlaced", async (orderId, user, token, amount, destChain, destAddress, feeOffer, deadline) => {
      const order: OrderEvent = {
        orderId,
        user,
        token,
        amount,
        destChain,
        destAddress,
        feeOffer,
        deadline,
      };

      console.log(`[Watcher] New order detected: ${orderId}`);
      console.log(`  User: ${user}, Amount: ${ethers.formatUnits(amount, 6)} USDC, Fee: ${ethers.formatUnits(feeOffer, 6)} USDC`);

      for (const handler of this.handlers) {
        try {
          await handler(order);
        } catch (err) {
          console.error(`[Watcher] Handler error for order ${orderId}:`, err);
        }
      }
    });
  }

  async getActiveOrders(): Promise<string[]> {
    return await this.gateway.getActiveOrders();
  }

  async getOrder(orderId: string) {
    return await this.gateway.getOrder(orderId);
  }

  async stop(): Promise<void> {
    this.gateway.removeAllListeners();
    console.log("[Watcher] Stopped.");
  }
}
