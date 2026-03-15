import { ethers } from "ethers";
import type { TappdClient as TappdClientType } from "@phala/dstack-sdk";

/// TEE operational modes
export type TEEMode = "dstack" | "simulator" | "mock";

/// TEE Attestation struct matching the Solidity ITEEVerifier.TEEAttestation
export interface TEEAttestation {
  orderId: string;
  filler: string;
  amount: bigint;
  escrowContract: string;
  escrowChainId: number;
  timestamp: number;
  tdxQuoteHash: string;
}

export interface TEEAttestationResult {
  encodedAttestation: string;
  signature: string;
  tdxQuote?: string;
}

interface TEEClientOptions {
  endpoint?: string;
  privateKey?: string;
}

/**
 * TEEClient — Handles TEE attestation, ECIES encryption, and fillId generation via Phala dstack.
 *
 * Three modes: "dstack" (production CVM), "simulator" (local dev), "mock" (backward compat).
 *
 * Privacy features:
 * - ECIES encryption key: decrypts private order destAddress inside TEE
 * - fillId secret: generates unlinkable fill IDs for destination chain
 */
export class TEEClient {
  private mode: TEEMode;
  private tappdClient: TappdClientType | null = null;
  private wallet: ethers.Wallet | null = null;

  // Privacy keys
  private _encryptionPrivateKey: Uint8Array | null = null;
  private _encryptionPublicKey: string | null = null; // hex compressed 33 bytes
  private _fillIdSecret: Uint8Array | null = null;

  private constructor(mode: TEEMode) {
    this.mode = mode;
  }

  static async create(mode: TEEMode, opts: TEEClientOptions = {}): Promise<TEEClient> {
    const client = new TEEClient(mode);

    if (mode === "dstack" || mode === "simulator") {
      const { TappdClient } = await import("@phala/dstack-sdk");
      const endpoint = mode === "simulator" ? (opts.endpoint || "http://localhost:8090") : undefined;
      client.tappdClient = new TappdClient(endpoint);

      // Derive wallet key
      const keyResult = await client.tappdClient.deriveKey("velora/filler/wallet");
      const privateKeyHex = "0x" + Buffer.from(keyResult.asUint8Array(32)).toString("hex");
      client.wallet = new ethers.Wallet(privateKeyHex);

      // Derive encryption key (separate path for ECIES)
      const encKeyResult = await client.tappdClient.deriveKey("velora/filler/encryption");
      client._encryptionPrivateKey = encKeyResult.asUint8Array(32);
      const encKeyHex = "0x" + Buffer.from(client._encryptionPrivateKey).toString("hex");
      client._encryptionPublicKey = ethers.SigningKey.computePublicKey(encKeyHex, true); // compressed 33 bytes

      // Derive fillId secret
      const fillSecretResult = await client.tappdClient.deriveKey("velora/filler/fillid-secret");
      client._fillIdSecret = fillSecretResult.asUint8Array(32);

      console.log(`[TEE] ${mode} mode. Wallet: ${client.wallet.address}`);
      console.log(`[TEE] Encryption pubkey: ${client._encryptionPublicKey}`);
    } else {
      // Mock mode
      if (opts.privateKey) {
        client.wallet = new ethers.Wallet(opts.privateKey);

        // Derive mock encryption key from private key
        const encKeyHex = ethers.keccak256(ethers.toUtf8Bytes("velora-mock-encryption-" + opts.privateKey));
        client._encryptionPrivateKey = ethers.getBytes(encKeyHex);
        client._encryptionPublicKey = ethers.SigningKey.computePublicKey(encKeyHex, true);

        // Derive mock fillId secret
        client._fillIdSecret = ethers.getBytes(
          ethers.keccak256(ethers.toUtf8Bytes("velora-mock-fillid-" + opts.privateKey))
        );

        console.log(`[TEE] Mock mode. Signer: ${client.wallet.address}`);
        console.log(`[TEE] Encryption pubkey: ${client._encryptionPublicKey}`);
      } else {
        console.warn("[TEE] Mock mode but no TEE_PRIVATE_KEY. TEE settlement disabled.");
      }
    }

    return client;
  }

  get isEnabled(): boolean {
    return !!this.wallet;
  }

  get signerAddress(): string | undefined {
    return this.wallet?.address;
  }

  get encryptionPubKeyHex(): string | undefined {
    return this._encryptionPublicKey || undefined;
  }

  getFillerWallet(provider?: ethers.Provider): ethers.Wallet | null {
    if (!this.wallet) return null;
    return provider ? this.wallet.connect(provider) : this.wallet;
  }

  // ──────────────────── Privacy: ECIES Decryption ────────────────────

  /** Decrypt ECIES-encrypted destAddress inside TEE */
  async decryptDestAddress(encryptedDestHex: string): Promise<string> {
    if (!this._encryptionPrivateKey) throw new Error("Encryption key not initialized");
    const encBytes = Buffer.from(encryptedDestHex.startsWith("0x") ? encryptedDestHex.slice(2) : encryptedDestHex, "hex");

    // Raw 20-byte address (fallback — frontend sent unencrypted)
    if (encBytes.length === 20) {
      console.log("[TEE] Dest is raw 20 bytes (not ECIES-encrypted), using directly");
      return ethers.getAddress("0x" + encBytes.toString("hex"));
    }

    const { decrypt } = await import("eciesjs");
    const privKeyHex = Buffer.from(this._encryptionPrivateKey).toString("hex");
    const plaintext = decrypt(privKeyHex, encBytes);
    return ethers.getAddress("0x" + Buffer.from(plaintext).toString("hex"));
  }

  /** Decrypt ECIES-encrypted secret (for triggering PrivacyPool withdraw) */
  async decryptSecret(encryptedSecretHex: string): Promise<string> {
    if (!this._encryptionPrivateKey) throw new Error("Encryption key not initialized");
    const encBytes = Buffer.from(encryptedSecretHex.startsWith("0x") ? encryptedSecretHex.slice(2) : encryptedSecretHex, "hex");

    // Raw 32-byte secret (fallback — frontend sent unencrypted)
    if (encBytes.length === 32) {
      console.log("[TEE] Secret is raw 32 bytes (not ECIES-encrypted), using directly");
      return "0x" + encBytes.toString("hex");
    }

    const { decrypt } = await import("eciesjs");
    const privKeyHex = Buffer.from(this._encryptionPrivateKey).toString("hex");
    const plaintext = decrypt(privKeyHex, encBytes);
    return "0x" + Buffer.from(plaintext).toString("hex");
  }

  // ──────────────────── Privacy: Unlinkable fillId ────────────────────

  /** Compute fillId from sourceOrderId — deterministic but unlinkable without TEE secret */
  computeFillId(sourceOrderId: string): string {
    if (!this._fillIdSecret) throw new Error("FillId secret not initialized");
    return ethers.solidityPackedKeccak256(
      ["bytes32", "bytes32"],
      [sourceOrderId, "0x" + Buffer.from(this._fillIdSecret).toString("hex")]
    );
  }

  // ──────────────────── Attestation ────────────────────

  async requestAttestation(
    orderId: string,
    filler: string,
    amount: bigint,
    escrowContract: string,
    escrowChainId: number
  ): Promise<TEEAttestationResult> {
    const timestamp = Math.floor(Date.now() / 1000);

    if ((this.mode === "dstack" || this.mode === "simulator") && this.tappdClient) {
      return this._dstackAttestation(orderId, filler, amount, escrowContract, escrowChainId, timestamp);
    }

    if (this.wallet) {
      return this._mockAttestation(orderId, filler, amount, escrowContract, escrowChainId, timestamp);
    }

    throw new Error("TEE client not configured");
  }

  private async _dstackAttestation(
    orderId: string, filler: string, amount: bigint,
    escrowContract: string, escrowChainId: number, timestamp: number
  ): Promise<TEEAttestationResult> {
    const preHash = ethers.solidityPackedKeccak256(
      ["bytes32", "address", "uint256", "address", "uint256", "uint256"],
      [orderId, filler, amount, escrowContract, escrowChainId, timestamp]
    );

    let tdxQuote: string | undefined;
    let tdxQuoteHash: string;
    try {
      const reportData = ethers.getBytes(preHash);
      const quoteResult = await this.tappdClient!.tdxQuote(reportData, "raw");
      tdxQuote = quoteResult.quote;
      tdxQuoteHash = ethers.keccak256(tdxQuote);
    } catch (err) {
      console.warn(`[TEE] TDX quote generation failed, using zero hash:`, err);
      tdxQuoteHash = ethers.ZeroHash;
    }

    const coder = ethers.AbiCoder.defaultAbiCoder();
    const attestationHash = ethers.keccak256(coder.encode(
      ["bytes32", "address", "uint256", "address", "uint256", "uint256", "bytes32"],
      [orderId, filler, amount, escrowContract, escrowChainId, timestamp, tdxQuoteHash]
    ));

    const signature = await this.wallet!.signMessage(ethers.getBytes(attestationHash));

    const encodedAttestation = coder.encode(
      ["tuple(bytes32,address,uint256,address,uint256,uint256,bytes32)"],
      [[orderId, filler, amount, escrowContract, escrowChainId, timestamp, tdxQuoteHash]]
    );

    console.log(`[TEE] dstack attestation for ${orderId.slice(0, 10)}... (quote: ${tdxQuote ? "yes" : "no"})`);
    return { encodedAttestation, signature, tdxQuote };
  }

  private async _mockAttestation(
    orderId: string, filler: string, amount: bigint,
    escrowContract: string, escrowChainId: number, timestamp: number
  ): Promise<TEEAttestationResult> {
    const tdxQuoteHash = ethers.ZeroHash;

    const coder = ethers.AbiCoder.defaultAbiCoder();
    const attestationHash = ethers.keccak256(coder.encode(
      ["bytes32", "address", "uint256", "address", "uint256", "uint256", "bytes32"],
      [orderId, filler, amount, escrowContract, escrowChainId, timestamp, tdxQuoteHash]
    ));

    const signature = await this.wallet!.signMessage(ethers.getBytes(attestationHash));

    const encodedAttestation = coder.encode(
      ["tuple(bytes32,address,uint256,address,uint256,uint256,bytes32)"],
      [[orderId, filler, amount, escrowContract, escrowChainId, timestamp, tdxQuoteHash]]
    );

    console.log(`[TEE] Mock attestation for ${orderId.slice(0, 10)}...`);
    return { encodedAttestation, signature };
  }
}
