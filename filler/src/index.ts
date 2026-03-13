import { config, validateConfig, getSupportedDestChains } from "./config.js";
import { OrderWatcher } from "./watcher.js";
import { OrderExecutor } from "./executor.js";
import { SettlementMonitor } from "./settler.js";
import { PricingEngine } from "./pricing.js";
import { FillerState, FillStatus } from "./state.js";
import { CrossChainRelay } from "./relay.js";
import { ethers } from "ethers";

async function main() {
  console.log("=== IntentBridge Filler Service (Multi-Destination) ===");
  console.log();

  // Validate config
  validateConfig();

  // Initialize state tracker
  const state = new FillerState();

  // Initialize source chain components
  const watcher = new OrderWatcher();
  const pricing = new PricingEngine();

  // Build per-chain component maps
  const executors = new Map<number, OrderExecutor>();
  const relays = new Map<number, CrossChainRelay>();
  const settlers = new Map<number, SettlementMonitor>();

  const destChains = getSupportedDestChains();
  console.log(`Configured destination chains: ${destChains.join(", ")}`);
  console.log();

  for (const chainId of destChains) {
    const destConfig = config.destinations[chainId];
    executors.set(chainId, new OrderExecutor(destConfig));
    relays.set(chainId, new CrossChainRelay(state, destConfig));
    settlers.set(chainId, new SettlementMonitor(state, destConfig));
  }

  // Log filler info per chain
  for (const chainId of destChains) {
    const executor = executors.get(chainId)!;
    const destConfig = config.destinations[chainId];
    const balance = await executor.getBalance();
    console.log(`[${destConfig.name} (${chainId})]`);
    console.log(`  Filler address: ${executor.getAddress()}`);
    console.log(`  USDC balance:   ${ethers.formatUnits(balance, 6)} USDC`);
    console.log(`  Settler:        ${destConfig.intentSettlerAddress}`);
    console.log(`  Mode:           ${destConfig.settlementMode}`);
  }
  console.log();
  console.log(`Source chain:   ${config.rpcSource}`);
  console.log(`Auto-settle:    ${config.autoSettleDelayMs}ms delay`);
  console.log();

  // Register order handler — routes by destChain
  watcher.onOrder(async (order) => {
    const executor = executors.get(order.destChain);
    if (!executor) {
      console.log(`[Main] No executor for dest chain ${order.destChain}, skipping order ${order.orderId}`);
      return;
    }

    // Track the order
    state.track(order.orderId, order.amount, order.feeOffer, order.destChain);

    const currentBalance = await executor.getBalance();

    // Evaluate profitability
    const decision = pricing.evaluate(order, currentBalance);
    console.log(`[Pricing] ${decision.reason}`);

    if (!decision.shouldFill) {
      console.log(`[Main] Skipping order ${order.orderId}`);
      state.markFailed(order.orderId, decision.reason);
      return;
    }

    // Fill the order with retry
    state.updateStatus(order.orderId, FillStatus.FILLING);
    console.log(`[Main] Routing order to ${executor.getChainName()} (chain ${order.destChain})`);
    const txHash = await executor.fillWithRetry(order);
    if (txHash) {
      state.markFilled(order.orderId, txHash);
      console.log(`[Main] Successfully filled order ${order.orderId}`);
      console.log(`  Expected profit: ${ethers.formatUnits(decision.expectedProfit, 6)} USDC`);
    } else {
      state.markFailed(order.orderId, "Fill failed after retries");
    }
  });

  // Start all services
  await watcher.start();
  for (const settler of settlers.values()) await settler.start();
  for (const relay of relays.values()) await relay.start();

  // Periodic stats logging
  setInterval(() => {
    const stats = state.getStats();
    if (stats.total > 0) {
      console.log(`[Stats] Total: ${stats.total} | Filled: ${stats.filled} | Settled: ${stats.settled} | Released: ${stats.released} | Failed: ${stats.failed}`);
    }
  }, 30000);

  console.log();
  console.log("Filler service running. Press Ctrl+C to stop.");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    const stats = state.getStats();
    console.log(`Final stats: ${JSON.stringify(stats)}`);
    await watcher.stop();
    for (const settler of settlers.values()) await settler.stop();
    for (const relay of relays.values()) await relay.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
