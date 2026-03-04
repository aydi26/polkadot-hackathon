import { ethers } from "ethers";
import { config } from "./config.js";
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

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.rpcHyperEvm);
    this.wallet = new ethers.Wallet(config.fillerPrivateKey, this.provider);
    this.settler = new ethers.Contract(config.intentSettlerAddress, SETTLER_ABI, this.wallet);
    this.usdc = new ethers.Contract(config.usdcAddress, ERC20_ABI, this.wallet);
  }

  async fillOrder(order: OrderEvent): Promise<string | null> {
    try {
      // Check balance
      const balance: bigint = await this.usdc.balanceOf(this.wallet.address);
      if (balance < order.amount) {
        console.log(`[Executor] Insufficient balance: ${ethers.formatUnits(balance, 6)} < ${ethers.formatUnits(order.amount, 6)} USDC`);
        return null;
      }

      // Check allowance
      const allowance: bigint = await this.usdc.allowance(this.wallet.address, config.intentSettlerAddress);
      if (allowance < order.amount) {
        console.log("[Executor] Approving USDC spend...");
        const approveTx = await this.usdc.approve(config.intentSettlerAddress, ethers.MaxUint256);
        await approveTx.wait();
        console.log("[Executor] USDC approved.");
      }

      // Execute fill
      console.log(`[Executor] Filling order ${order.orderId}...`);
      const tx = await this.settler.fillOrder(
        order.orderId,
        order.destAddress,
        config.usdcAddress,
        order.amount
      );
      const receipt = await tx.wait();

      console.log(`[Executor] Order filled! TX: ${receipt.hash}`);
      return receipt.hash;
    } catch (err) {
      console.error(`[Executor] Failed to fill order ${order.orderId}:`, err);
      return null;
    }
  }

  async getBalance(): Promise<bigint> {
    return await this.usdc.balanceOf(this.wallet.address);
  }

  getAddress(): string {
    return this.wallet.address;
  }
}
