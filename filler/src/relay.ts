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

  constructor(state: FillerState, destConfig: DestChainConfig) {
    this.state = state;
    this.destConfig = destConfig;

    // Destination chain (listen for fills)
    this.destProvider = new ethers.JsonRpcProvider(destConfig.rpc);
    this.settler = new ethers.Contract(destConfig.intentSettlerAddress, SETTLER_ABI, this.destProvider);

    // Source chain (relay fill confirmation)
    this.sourceProvider = new ethers.JsonRpcProvider(config.rpcSource);
    this.sourceWallet = new ethers.Wallet(config.fillerPrivateKey, this.sourceProvider);
    this.gateway = new ethers.Contract(config.intentGatewayAddress, GATEWAY_ABI, this.sourceWallet);
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[Relay:${this.destConfig.chainId}] Cross-chain relay started for ${this.destConfig.name}`);
    console.log(`[Relay:${this.destConfig.chainId}] Watching for OrderFilled events...`);

    this.settler.on(
      "OrderFilled",
      async (orderId: string, filler: string, recipient: string, token: string, amount: bigint) => {
        if (this.relayedOrders.has(orderId)) return;
        this.relayedOrders.add(orderId);

        console.log(`[Relay:${this.destConfig.chainId}] OrderFilled detected: ${orderId.slice(0, 10)}...`);
        console.log(`[Relay:${this.destConfig.chainId}]   Filler: ${filler}, Amount: ${ethers.formatUnits(amount, 6)} USDC`);

        await this.relayFillConfirmation(orderId);
      }
    );
  }

  /** Relay FILL_CONFIRMATION: call markOrderFilled on source chain */
  private async relayFillConfirmation(orderId: string): Promise<void> {
    try {
      // Check if order is still Pending on source chain (status = 1)
      const order = await this.gateway.getOrder(orderId);
      if (Number(order.status) !== 1) {
        console.log(`[Relay:${this.destConfig.chainId}] Order ${orderId.slice(0, 10)}... already status=${order.status}, skipping`);
        return;
      }

      console.log(`[Relay:${this.destConfig.chainId}] Relaying FILL_CONFIRMATION to source chain...`);
      const tx = await this.gateway.markOrderFilled(orderId);
      const receipt = await tx.wait();
      console.log(`[Relay:${this.destConfig.chainId}] markOrderFilled TX: ${receipt.hash}`);
      console.log(`[Relay:${this.destConfig.chainId}] Order ${orderId.slice(0, 10)}... now Filled on source chain`);
    } catch (err) {
      console.error(`[Relay:${this.destConfig.chainId}] Failed to relay for ${orderId.slice(0, 10)}...:`, err);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.settler.removeAllListeners();
    console.log(`[Relay:${this.destConfig.chainId}] Stopped.`);
  }
}
