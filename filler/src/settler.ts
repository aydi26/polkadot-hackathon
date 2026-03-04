import { ethers } from "ethers";
import { config } from "./config.js";

// IntentSettler ABI (settlement functions)
const SETTLER_ABI = [
  "function verifySettlement(bytes32 orderId, bytes proof) external",
  "function getPendingSettlements() view returns (bytes32[])",
  "function getFill(bytes32 orderId) view returns (tuple(bytes32 orderId, address filler, address recipient, address token, uint256 amount, uint256 fillTimestamp, bool settled))",
  "event SettlementVerified(bytes32 indexed orderId, address indexed filler, bytes32 proofHash)",
];

export class SettlementMonitor {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private settler: ethers.Contract;
  private monitoring = false;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.rpcHyperEvm);
    this.wallet = new ethers.Wallet(config.fillerPrivateKey, this.provider);
    this.settler = new ethers.Contract(config.intentSettlerAddress, SETTLER_ABI, this.wallet);
  }

  async start(): Promise<void> {
    this.monitoring = true;
    console.log("[Settler] Monitoring pending settlements...");

    // Listen for settlement events
    this.settler.on("SettlementVerified", (orderId, filler, proofHash) => {
      console.log(`[Settler] Settlement verified for order ${orderId}`);
      console.log(`  Filler: ${filler}, Proof: ${proofHash}`);
    });

    // Periodically check pending settlements
    this.pollPendingSettlements();
  }

  private async pollPendingSettlements(): Promise<void> {
    while (this.monitoring) {
      try {
        const pending: string[] = await this.settler.getPendingSettlements();
        if (pending.length > 0) {
          console.log(`[Settler] ${pending.length} pending settlement(s)`);

          for (const orderId of pending) {
            const fill = await this.settler.getFill(orderId);
            const elapsed = Date.now() / 1000 - Number(fill.fillTimestamp);
            console.log(`  Order ${orderId}: filled ${Math.round(elapsed)}s ago, waiting for ZK proof...`);

            // TODO: Check if Hyperbridge has produced the ZK proof
            // For hackathon: auto-settle after a timeout (simulating ZK proof arrival)
          }
        }
      } catch (err) {
        console.error("[Settler] Poll error:", err);
      }

      await sleep(config.pollInterval * 5); // Check every 10s
    }
  }

  async stop(): Promise<void> {
    this.monitoring = false;
    this.settler.removeAllListeners();
    console.log("[Settler] Stopped.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
