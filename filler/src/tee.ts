import { ethers } from "ethers";

/// TEE Attestation struct matching the Solidity ITEEVerifier.TEEAttestation
export interface TEEAttestation {
  orderId: string;
  filler: string;
  amount: bigint;
  escrowContract: string;
  escrowChainId: number;
  timestamp: number;
}

export interface TEEAttestationResult {
  encodedAttestation: string;
  signature: string;
}

/**
 * TEEClient — Handles TEE attestation requests for fast settlement (~5-10s).
 *
 * In production: sends an HTTP POST to a Phala Phat Contract which:
 * 1. Reads the source chain to verify the escrow lock
 * 2. Signs an attestation inside the SGX enclave
 * 3. Returns the attestation + signature
 *
 * In mock mode (hackathon): signs locally with TEE_PRIVATE_KEY.
 */
export class TEEClient {
  private teeEndpoint?: string;
  private mockSigner?: ethers.Wallet;

  constructor(teeEndpoint?: string, teePrivateKey?: string) {
    this.teeEndpoint = teeEndpoint;

    if (!teeEndpoint && teePrivateKey) {
      // Mock mode: sign locally
      this.mockSigner = new ethers.Wallet(teePrivateKey);
      console.log(`[TEE] Mock mode enabled. Enclave signer: ${this.mockSigner.address}`);
    } else if (teeEndpoint) {
      console.log(`[TEE] Production mode. Endpoint: ${teeEndpoint}`);
    } else {
      console.warn("[TEE] No TEE endpoint or private key configured. TEE settlement disabled.");
    }
  }

  get isEnabled(): boolean {
    return !!(this.mockSigner || this.teeEndpoint);
  }

  get signerAddress(): string | undefined {
    return this.mockSigner?.address;
  }

  async requestAttestation(
    orderId: string,
    filler: string,
    amount: bigint,
    escrowContract: string,
    escrowChainId: number
  ): Promise<TEEAttestationResult> {
    const timestamp = Math.floor(Date.now() / 1000);

    const attestation: TEEAttestation = {
      orderId,
      filler,
      amount,
      escrowContract,
      escrowChainId,
      timestamp,
    };

    if (this.mockSigner) {
      return this._mockAttestation(attestation);
    }

    if (this.teeEndpoint) {
      return this._productionAttestation(attestation);
    }

    throw new Error("TEE client not configured");
  }

  /** Mock mode: ABI-encode and sign locally */
  private async _mockAttestation(att: TEEAttestation): Promise<TEEAttestationResult> {
    // ABI encode the attestation hash (must match Solidity keccak256(abi.encode(...)))
    const attestationHash = ethers.solidityPackedKeccak256(
      ["bytes32", "address", "uint256", "address", "uint256", "uint256"],
      [att.orderId, att.filler, att.amount, att.escrowContract, att.escrowChainId, att.timestamp]
    );

    // Sign with EIP-191 prefix (matches \x19Ethereum Signed Message:\n32 in Solidity)
    const signature = await this.mockSigner!.signMessage(ethers.getBytes(attestationHash));

    // ABI encode the full attestation struct for passing to the contract
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encodedAttestation = abiCoder.encode(
      ["tuple(bytes32,address,uint256,address,uint256,uint256)"],
      [[att.orderId, att.filler, att.amount, att.escrowContract, att.escrowChainId, att.timestamp]]
    );

    console.log(`[TEE] Mock attestation signed for order ${att.orderId.slice(0, 10)}...`);
    return { encodedAttestation, signature };
  }

  /** Production mode: HTTP POST to Phala Phat Contract */
  private async _productionAttestation(att: TEEAttestation): Promise<TEEAttestationResult> {
    const response = await fetch(this.teeEndpoint!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: att.orderId,
        filler: att.filler,
        amount: att.amount.toString(),
        escrowContract: att.escrowContract,
        escrowChainId: att.escrowChainId,
        timestamp: att.timestamp,
      }),
    });

    if (!response.ok) {
      throw new Error(`TEE attestation request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { encodedAttestation: string; signature: string };
    return result;
  }
}
