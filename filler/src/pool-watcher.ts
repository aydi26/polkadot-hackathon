import { ethers } from "ethers";
import { config } from "./config.js";
import { TEEClient } from "./tee.js";

const PRIVACY_POOL_ABI = [
  "event PrivacyDeposit(bytes32 indexed commitmentHash, uint256 amount, uint256 delaySeconds, bytes encryptedSecret)",
  "function withdraw(bytes32 secret, uint256 feeOffer, uint256 deadline) external",
  "function isReady(bytes32 commitmentHash) view returns (bool)",
  "function deposits(bytes32) view returns (uint256 amount, bytes encryptedDest, bytes encryptedSecret, uint256 releaseTime, bool withdrawn)",
];

interface PendingDeposit {
  commitmentHash: string;
  amount: bigint;
  encryptedSecret: string;
  releaseTime: number;
}

// Batching config — withdrawals are grouped to break 1:1 timing correlation
const BATCH_WINDOW_MS = Number(process.env.POOL_BATCH_WINDOW_MS || "10000"); // 10s default
const MIN_BATCH_DELAY_MS = Number(process.env.POOL_MIN_DELAY_MS || "5000"); // minimum 5s random delay

/**
 * PoolWatcher — Watches PrivacyDeposit events and auto-triggers withdraw in batches.
 *
 * Privacy improvement: instead of withdrawing each deposit immediately when the time-lock
 * expires, ready deposits are queued and flushed together after a batch window.
 * This breaks the 1:1 timing correlation between deposit and withdrawal.
 */
export class PoolWatcher {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private pool: ethers.Contract;
  private teeClient: TEEClient;
  private running = false;
  private lastBlock: number = 0;
  private pendingDeposits: Map<string, PendingDeposit> = new Map();
  private processedDeposits: Set<string> = new Set();

  // Batch queue: ready deposits waiting to be withdrawn together
  private batchQueue: PendingDeposit[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(teeClient: TEEClient, privacyPoolAddress: string) {
    this.teeClient = teeClient;
    this.provider = new ethers.JsonRpcProvider(config.rpcSource);
    this.wallet = new ethers.Wallet(config.fillerPrivateKey, this.provider);
    this.pool = new ethers.Contract(privacyPoolAddress, PRIVACY_POOL_ABI, this.wallet);
  }

  async start(): Promise<void> {
    this.running = true;
    this.lastBlock = await this.provider.getBlockNumber();
    console.log(`[PoolWatcher] Watching PrivacyDeposit events on ${this.pool.target}`);
    console.log(`[PoolWatcher] Batch window: ${BATCH_WINDOW_MS}ms, min delay: ${MIN_BATCH_DELAY_MS}ms`);
    console.log(`[PoolWatcher] Starting from block ${this.lastBlock}`);
    this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        // 1. Poll for new PrivacyDeposit events
        const currentBlock = await this.provider.getBlockNumber();
        if (currentBlock > this.lastBlock) {
          const events = await this.pool.queryFilter("PrivacyDeposit", this.lastBlock + 1, currentBlock);
          for (const event of events) {
            const log = event as ethers.EventLog;
            const commitmentHash = log.args[0] as string;
            if (this.processedDeposits.has(commitmentHash) || this.pendingDeposits.has(commitmentHash)) continue;

            const amount = log.args[1] as bigint;
            const delaySeconds = Number(log.args[2]);
            const encryptedSecret = log.args[3] as string;

            console.log(`[PoolWatcher] New deposit detected: ${commitmentHash.slice(0, 10)}... (${ethers.formatUnits(amount, 6)} USDC, delay: ${delaySeconds}s)`);

            const deposit = await this.pool.deposits(commitmentHash);
            const releaseTime = Number(deposit.releaseTime);

            this.pendingDeposits.set(commitmentHash, {
              commitmentHash,
              amount,
              encryptedSecret,
              releaseTime,
            });
          }
          this.lastBlock = currentBlock;
        }

        // 2. Check pending deposits — move ready ones to batch queue
        for (const [hash, dep] of this.pendingDeposits) {
          const ready = await this.pool.isReady(dep.commitmentHash);
          if (ready) {
            console.log(`[PoolWatcher] Deposit ${hash.slice(0, 10)}... is ready, adding to batch queue`);
            this.batchQueue.push(dep);
            this.pendingDeposits.delete(hash);

            // Start batch timer on first ready deposit
            if (!this.batchTimer) {
              const delay = BATCH_WINDOW_MS + Math.floor(Math.random() * MIN_BATCH_DELAY_MS);
              console.log(`[PoolWatcher] Batch timer started (${delay}ms)`);
              this.batchTimer = setTimeout(() => this.flushBatch(), delay);
            }
          }
        }
      } catch (err) {
        console.error("[PoolWatcher] Poll error:", err);
      }

      await sleep(5000); // Poll every 5s
    }
  }

  /** Flush all queued deposits — withdraw them in rapid succession (same block window) */
  private async flushBatch(): Promise<void> {
    this.batchTimer = null;
    const batch = [...this.batchQueue];
    this.batchQueue = [];

    if (batch.length === 0) return;

    console.log(`[PoolWatcher] Flushing batch of ${batch.length} withdrawal(s)...`);

    for (const dep of batch) {
      const success = await this.triggerWithdraw(dep);
      if (success) {
        this.processedDeposits.add(dep.commitmentHash);
      } else {
        // Re-queue failed withdrawals
        this.pendingDeposits.set(dep.commitmentHash, dep);
      }
    }

    console.log(`[PoolWatcher] Batch flush complete.`);
  }

  private async triggerWithdraw(dep: PendingDeposit): Promise<boolean> {
    const tag = `[PoolWatcher]`;
    try {
      // Decrypt the secret inside TEE
      console.log(`${tag} Decrypting secret for ${dep.commitmentHash.slice(0, 10)}...`);
      const secret = await this.teeClient.decryptSecret(dep.encryptedSecret);

      // Calculate fee (10 bps of amount)
      const feeOffer = dep.amount / 1000n; // 0.1%
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      // Trigger withdraw — PrivacyPool creates the order on IntentGateway
      console.log(`${tag} Triggering withdraw for ${dep.commitmentHash.slice(0, 10)}...`);
      const tx = await this.pool.withdraw(secret, feeOffer, deadline);
      const receipt = await tx.wait();
      console.log(`${tag} Withdraw triggered! TX: ${receipt.hash}`);
      console.log(`${tag}   → PrivacyPool created order on IntentGateway (user = pool, not depositor)`);
      return true;
    } catch (err) {
      console.error(`${tag} Failed to withdraw ${dep.commitmentHash.slice(0, 10)}...:`, err);
      return false;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      // Flush remaining batch on shutdown
      await this.flushBatch();
    }
    console.log("[PoolWatcher] Stopped.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
