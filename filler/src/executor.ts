import { ethers } from "ethers";
import { config, type DestChainConfig } from "./config.js";
import type { OrderEvent } from "./watcher.js";
import type { TEEClient } from "./tee.js";

// ERC20 ABI
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

// Hyperliquid Testnet
const HL_BRIDGE_ADDRESS = "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89";
const HL_TESTNET_API = "https://api.hyperliquid-testnet.xyz";

export interface FillResult {
  txHash: string;
  fillId: string;
  freshWalletAddress?: string;
  hlTransferSuccess?: boolean;
}

export class OrderExecutor {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private usdc: ethers.Contract;
  private destConfig: DestChainConfig;
  private teeClient?: TEEClient;

  constructor(destConfig: DestChainConfig, injectedWallet?: ethers.Wallet, teeClient?: TEEClient) {
    this.destConfig = destConfig;
    this.teeClient = teeClient;
    this.provider = new ethers.JsonRpcProvider(destConfig.rpc);
    this.wallet = injectedWallet
      ? injectedWallet.connect(this.provider)
      : new ethers.Wallet(config.fillerPrivateKey, this.provider);
    this.usdc = new ethers.Contract(destConfig.usdcAddress, ERC20_ABI, this.wallet);
  }

  async fillOrder(order: OrderEvent): Promise<FillResult | null> {
    try {
      let recipient = order.destAddress;
      let fillId = order.orderId;

      // Private order: decrypt destAddress + generate unlinkable fillId
      if (order.isPrivate && this.teeClient && order.encryptedDest) {
        recipient = await this.teeClient.decryptDestAddress(order.encryptedDest);
        fillId = this.teeClient.computeFillId(order.orderId);
        console.log(`[Executor:${this.destConfig.chainId}] Private order: decrypted dest inside TEE, fillId: ${fillId.slice(0, 10)}...`);
      }

      // Check balance
      const balance: bigint = await this.usdc.balanceOf(this.wallet.address);
      if (balance < order.amount) {
        console.log(`[Executor:${this.destConfig.chainId}] Insufficient balance: ${ethers.formatUnits(balance, 6)} < ${ethers.formatUnits(order.amount, 6)} USDC`);
        return null;
      }

      const tag = `[Executor:${this.destConfig.chainId}]`;

      // === Step 1: Generate fresh single-use wallet inside TEE ===
      const freshWallet = ethers.Wallet.createRandom().connect(this.provider);
      console.log(`${tag} [1/6] Fresh wallet generated: ${freshWallet.address} (single-use)`);

      // === Step 2: Fund fresh wallet with USDC ===
      console.log(`${tag} [2/6] Transferring ${ethers.formatUnits(order.amount, 6)} USDC to fresh wallet...`);
      const transferTx = await this.usdc.transfer(freshWallet.address, order.amount);
      await transferTx.wait();

      // === Step 3: Fund fresh wallet with ETH for gas ===
      console.log(`${tag} [3/6] Funding fresh wallet with ETH for gas...`);
      const gasEth = ethers.parseEther("0.0005");
      const gasEthTx = await this.wallet.sendTransaction({ to: freshWallet.address, value: gasEth });
      await gasEthTx.wait();

      // === Step 4: Fresh wallet bridges USDC to Hyperliquid ===
      const freshUsdc = new ethers.Contract(this.destConfig.usdcAddress, ERC20_ABI, freshWallet);
      console.log(`${tag} [4/6] Bridging ${ethers.formatUnits(order.amount, 6)} USDC to Hyperliquid...`);
      const bridgeTx = await freshUsdc.transfer(HL_BRIDGE_ADDRESS, order.amount);
      const bridgeReceipt = await bridgeTx.wait();
      console.log(`${tag}   Bridge TX: ${bridgeReceipt.hash}`);

      // === Step 5: Wait for HL to credit the fresh wallet ===
      const amountUsd = parseFloat(ethers.formatUnits(order.amount, 6));
      console.log(`${tag} [5/6] Waiting for HL credit ($${amountUsd})...`);
      await this.waitForHLCredit(freshWallet.address, amountUsd);

      // === Step 6: usdSend from fresh wallet to destination on HL ===
      console.log(`${tag} [6/6] Sending $${amountUsd} USDC to ${recipient} on Hyperliquid...`);
      const hlResult = await this.hlUsdSend(freshWallet, recipient, amountUsd);
      console.log(`${tag}   HL API response:`, JSON.stringify(hlResult));

      if (hlResult.status === "err" || hlResult.status !== "ok") {
        console.error(`${tag} usdSend failed or unexpected response:`, JSON.stringify(hlResult));
        return null;
      }

      // === Step 7: Verify destination actually received funds on HL ===
      console.log(`${tag} [7/7] Verifying ${recipient} received $${amountUsd} on HL...`);
      const verified = await this.verifyHLDelivery(recipient, amountUsd);
      if (!verified) {
        console.error(`${tag} CRITICAL: usdSend returned ok but destination ${recipient} did NOT receive funds!`);
        return null;
      }
      console.log(`${tag}   Delivery verified!`);

      console.log(`${tag} === Order filled! Fresh wallet: ${freshWallet.address} → HL dest: ${recipient} ===`);
      return {
        txHash: bridgeReceipt.hash,
        fillId,
        freshWalletAddress: freshWallet.address,
        hlTransferSuccess: true,
      };
    } catch (err) {
      console.error(`[Executor:${this.destConfig.chainId}] Failed to fill order ${order.orderId}:`, err);
      return null;
    }
  }

  /** Sign and send a usdSend action on Hyperliquid testnet (EIP-712) */
  private async hlUsdSend(wallet: ethers.HDNodeWallet, destination: string, amountUsd: number): Promise<any> {
    const timestamp = Date.now();

    const domain = {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: 421614,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    };

    const types = {
      "HyperliquidTransaction:UsdSend": [
        { name: "hyperliquidChain", type: "string" },
        { name: "destination", type: "string" },
        { name: "amount", type: "string" },
        { name: "time", type: "uint64" },
      ],
    };

    const message = {
      hyperliquidChain: "Testnet",
      destination,
      amount: amountUsd.toString(),
      time: timestamp,
    };

    const signature = await wallet.signTypedData(domain, types, message);
    const { r, s, v } = ethers.Signature.from(signature);

    const payload = {
      action: {
        type: "usdSend",
        hyperliquidChain: "Testnet",
        signatureChainId: "0x66eee",
        destination,
        amount: amountUsd.toString(),
        time: timestamp,
      },
      nonce: timestamp,
      signature: { r, s, v },
    };

    const response = await fetch(`${HL_TESTNET_API}/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    return await response.json();
  }

  /** Poll HL testnet to check if a wallet has been credited after bridge */
  private async waitForHLCredit(address: string, expectedAmount: number, maxRetries = 40): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${HL_TESTNET_API}/info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "clearinghouseState", user: address }),
        });
        const data = await response.json();
        const balance = parseFloat(data?.marginSummary?.accountValue || "0");

        if (balance >= expectedAmount) {
          console.log(`[Executor:${this.destConfig.chainId}]   HL credited! Balance: $${balance}`);
          return;
        }
        console.log(`[Executor:${this.destConfig.chainId}]   Attempt ${i + 1}/${maxRetries}: balance=$${balance}, waiting...`);
      } catch {
        console.log(`[Executor:${this.destConfig.chainId}]   Attempt ${i + 1}/${maxRetries}: error polling HL`);
      }
      await sleep(5000);
    }
    throw new Error(`HL bridge credit timeout after ${maxRetries * 5}s`);
  }

  /** Verify that the destination address actually received funds on HL after usdSend */
  private async verifyHLDelivery(destination: string, expectedAmount: number, maxRetries = 10): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${HL_TESTNET_API}/info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "clearinghouseState", user: destination }),
        });
        const data = await response.json();
        const balance = parseFloat(data?.marginSummary?.accountValue || "0");

        if (balance >= expectedAmount) {
          return true;
        }
        console.log(`[Executor:${this.destConfig.chainId}]   Verify attempt ${i + 1}/${maxRetries}: dest balance=$${balance}, expected>=$${expectedAmount}`);
      } catch {
        console.log(`[Executor:${this.destConfig.chainId}]   Verify attempt ${i + 1}/${maxRetries}: error polling HL`);
      }
      await sleep(3000);
    }
    return false;
  }

  /** Fill with exponential backoff retry */
  async fillWithRetry(order: OrderEvent): Promise<FillResult | null> {
    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      const result = await this.fillOrder(order);
      if (result) return result;

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
