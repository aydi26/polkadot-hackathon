import { ethers } from "ethers";
import { config, type DestChainConfig } from "./config.js";
import type { OrderEvent } from "./watcher.js";

// IntentSettler ABI
const SETTLER_ABI = [
  "function fillOrder(bytes32 orderId, address recipient, address token, uint256 amount) external",
  "function getFill(bytes32 orderId) view returns (tuple(bytes32 orderId, address filler, address recipient, address token, uint256 amount, uint256 fillTimestamp, bool settled))",
];

// ERC20 ABI
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

export class OrderExecutor {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private settler: ethers.Contract;
  private usdc: ethers.Contract;
  private destConfig: DestChainConfig;

  constructor(destConfig: DestChainConfig) {
    this.destConfig = destConfig;
    this.provider = new ethers.JsonRpcProvider(destConfig.rpc);
    this.wallet = new ethers.Wallet(config.fillerPrivateKey, this.provider);
    this.settler = new ethers.Contract(destConfig.intentSettlerAddress, SETTLER_ABI, this.wallet);
    this.usdc = new ethers.Contract(destConfig.usdcAddress, ERC20_ABI, this.wallet);
  }

  async fillOrder(order: OrderEvent): Promise<string | null> {
    try {
      // Check balance
      const balance: bigint = await this.usdc.balanceOf(this.wallet.address);
      if (balance < order.amount) {
        console.log(`[Executor:${this.destConfig.chainId}] Insufficient balance: ${ethers.formatUnits(balance, 6)} < ${ethers.formatUnits(order.amount, 6)} USDC`);
        return null;
      }

      // Check allowance
      const allowance: bigint = await this.usdc.allowance(this.wallet.address, this.destConfig.intentSettlerAddress);
      if (allowance < order.amount) {
        console.log(`[Executor:${this.destConfig.chainId}] Approving USDC spend...`);
        const approveTx = await this.usdc.approve(this.destConfig.intentSettlerAddress, ethers.MaxUint256);
        await approveTx.wait();
        console.log(`[Executor:${this.destConfig.chainId}] USDC approved.`);
      }

      // Execute fill
      console.log(`[Executor:${this.destConfig.chainId}] Filling order ${order.orderId}...`);
      const tx = await this.settler.fillOrder(
        order.orderId,
        order.destAddress,
        this.destConfig.usdcAddress,
        order.amount
      );
      const receipt = await tx.wait();

      console.log(`[Executor:${this.destConfig.chainId}] Order filled! TX: ${receipt.hash}`);
      return receipt.hash;
    } catch (err) {
      console.error(`[Executor:${this.destConfig.chainId}] Failed to fill order ${order.orderId}:`, err);
      return null;
    }
  }

  /** Fill with exponential backoff retry */
  async fillWithRetry(order: OrderEvent): Promise<string | null> {
    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      const txHash = await this.fillOrder(order);
      if (txHash) return txHash;

      if (attempt < config.maxRetries - 1) {
        const delay = config.retryDelayMs * Math.pow(2, attempt);
        console.log(`[Executor:${this.destConfig.chainId}] Retry ${attempt + 1}/${config.maxRetries} in ${delay}ms...`);
        await sleep(delay);
      }
    }
    console.error(`[Executor:${this.destConfig.chainId}] All ${config.maxRetries} retries failed for order ${order.orderId}`);
    return null;
  }

  async getBalance(): Promise<bigint> {
    return await this.usdc.balanceOf(this.wallet.address);
  }

  getAddress(): string {
    return this.wallet.address;
  }

  getChainId(): number {
    return this.destConfig.chainId;
  }

  getChainName(): string {
    return this.destConfig.name;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
