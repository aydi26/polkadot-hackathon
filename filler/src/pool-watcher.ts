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

/**
 * PoolWatcher — Watches PrivacyDeposit events and auto-triggers withdraw when time-lock expires.
 *
 * The TEE filler decrypts the secret from the encrypted blob, waits for the time-lock,
 * then calls withdraw() on the PrivacyPool. This creates the private order on IntentGateway
 * with msg.sender = PrivacyPool (not the user), breaking the on-chain identity link.
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

            // Read the release time from contract
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

        // 2. Check pending deposits — trigger withdraw if ready
        for (const [hash, dep] of this.pendingDeposits) {
          const success = await this.triggerWithdraw(dep);
          if (success) {
            this.pendingDeposits.delete(hash);
            this.processedDeposits.add(hash);
          }
        }
      } catch (err) {
        console.error("[PoolWatcher] Poll error:", err);
      }

      await sleep(5000); // Poll every 5s
    }
  }

  private async triggerWithdraw(dep: PendingDeposit): Promise<boolean> {
    const tag = `[PoolWatcher]`;
    try {
      // Check on-chain readiness
      const ready = await this.pool.isReady(dep.commitmentHash);
      if (!ready) {
        return false; // not ready yet, will retry next poll
      }

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
    console.log("[PoolWatcher] Stopped.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
