import { config, validateConfig } from "./config.js";
import { OrderWatcher } from "./watcher.js";
import { OrderExecutor } from "./executor.js";
import { SettlementMonitor } from "./settler.js";
import { PricingEngine } from "./pricing.js";
import { ethers } from "ethers";

async function main() {
  console.log("=== IntentBridge Filler Service ===");
  console.log();

  // Validate config
  validateConfig();

  // Initialize components
  const watcher = new OrderWatcher();
  const executor = new OrderExecutor();
  const settler = new SettlementMonitor();
  const pricing = new PricingEngine();

  // Log filler info
  const balance = await executor.getBalance();
  console.log(`Filler address: ${executor.getAddress()}`);
  console.log(`USDC balance:   ${ethers.formatUnits(balance, 6)} USDC`);
  console.log();

  // Register order handler
  watcher.onOrder(async (order) => {
    const currentBalance = await executor.getBalance();

    // Evaluate profitability
    const decision = pricing.evaluate(order, currentBalance);
    console.log(`[Pricing] ${decision.reason}`);

    if (!decision.shouldFill) {
      console.log(`[Main] Skipping order ${order.orderId}`);
      return;
    }

    // Fill the order
    const txHash = await executor.fillOrder(order);
    if (txHash) {
      console.log(`[Main] Successfully filled order ${order.orderId}`);
      console.log(`  Expected profit: ${ethers.formatUnits(decision.expectedProfit, 6)} USDC`);
    }
  });

  // Start services
  await watcher.start();
  await settler.start();

  console.log();
  console.log("Filler service running. Press Ctrl+C to stop.");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await watcher.stop();
    await settler.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
