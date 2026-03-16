import { config, validateConfig, getSupportedDestChains } from "./config.js";
import { OrderWatcher } from "./watcher.js";
import { OrderExecutor } from "./executor.js";
import { SettlementMonitor } from "./settler.js";
import { PricingEngine } from "./pricing.js";
import { FillerState, FillStatus } from "./state.js";
import { CrossChainRelay } from "./relay.js";
import { TEEClient } from "./tee.js";
import { PoolWatcher } from "./pool-watcher.js";
import { startAPI } from "./api.js";
import { ethers } from "ethers";

async function main() {
  console.log("=== Velora Filler Service (Multi-Destination) ===");
  console.log();

  // Validate config
  validateConfig();

  // Initialize TEE client (derives anonymous wallet in dstack/simulator mode)
  const teeClient = await TEEClient.create(config.teeMode, {
    endpoint: config.teeEndpoint || undefined,
    privateKey: config.teePrivateKey || undefined,
  });

  // Get the TEE-derived wallet (anonymous intermediary for fills)
  const teeWallet = teeClient.getFillerWallet() || undefined;

  if (teeWallet) {
    console.log();
    console.log(`TEE Mode:       ${config.teeMode}`);
    console.log(`TEE Wallet:     ${teeWallet.address} (anonymous intermediary)`);
    if (config.teeMode === "dstack") {
      console.log(`TEE Transport:  Unix socket (/var/run/dstack.sock)`);
    } else if (config.teeMode === "simulator") {
      console.log(`TEE Transport:  HTTP (${config.teeEndpoint})`);
    }
  }

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
  console.log();
  console.log(`Configured destination chains: ${destChains.join(", ")}`);
  console.log();

  for (const chainId of destChains) {
    const destConfig = config.destinations[chainId];
    // Inject TEE wallet + TEE client (for ECIES decryption + fillId generation)
    executors.set(chainId, new OrderExecutor(destConfig, teeWallet, teeClient.isEnabled ? teeClient : undefined));
    relays.set(chainId, new CrossChainRelay(state, destConfig));
    // Pass TEE client to settler for attestation generation
    settlers.set(chainId, new SettlementMonitor(state, destConfig, teeClient.isEnabled ? teeClient : undefined));
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

    // Track the order + pre-compute fillId for private orders (before fill TX, so relay can find it)
    state.track(order.orderId, order.amount, order.feeOffer, order.destChain, order.isPrivate);
    if (order.isPrivate && teeClient.isEnabled) {
      state.updateFillId(order.orderId, teeClient.computeFillId(order.orderId));
    }

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
    const result = await executor.fillWithRetry(order);
    if (result) {
      state.markFilled(order.orderId, result.txHash);
      state.updateFillId(order.orderId, result.fillId);
      if (result.freshWalletAddress) {
        state.updateStatus(order.orderId, FillStatus.FILLED, { freshWalletAddress: result.freshWalletAddress });
      }
      console.log(`[Main] Successfully filled order ${order.orderId}`);
      console.log(`  Expected profit: ${ethers.formatUnits(decision.expectedProfit, 6)} USDC`);
      if (order.isPrivate) console.log(`  Privacy: fillId ${result.fillId.slice(0, 10)}... (unlinkable)`);
      if (result.freshWalletAddress) console.log(`  Fresh wallet: ${result.freshWalletAddress} (single-use, discarded)`);
    } else {
      state.markFailed(order.orderId, "Fill failed after retries");
    }
  });

  // Start all services
  await watcher.start();
  for (const settler of settlers.values()) await settler.start();
  for (const relay of relays.values()) await relay.start();

  // Start filler API (exposes fill data for frontend)
  const apiPort = Number(process.env.FILLER_API_PORT || "3001");
  startAPI(state, apiPort);

  // Start PrivacyPool watcher (auto-triggers withdraw when time-lock expires)
  if (config.privacyPoolAddress && teeClient.isEnabled) {
    const poolWatcher = new PoolWatcher(teeClient, config.privacyPoolAddress);
    await poolWatcher.start();
  }

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
