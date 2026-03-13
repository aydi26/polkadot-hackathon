// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITEEVerifier} from "../interfaces/ITEEVerifier.sol";

/// @title TEEVerifier - Verification of TEE attestations from Phala Network
/// @notice Verifies that a trusted enclave has attested to the existence of an escrow lock
///         on the source chain, enabling fast settlement (~5-10s) without waiting for ZK BEEFY (~6-8min).
///
/// @dev Production flow with Phala Network:
///
///      1. **Enclave Setup**: A Phat Contract runs inside Phala's SGX/TDX Secure Worker.
///         The enclave generates a signing keypair; the public key is registered on-chain
///         after verifying the enclave's Remote Attestation (RA) quote.
///
///      2. **RA-TLS Verification**: Before trusting an enclave, the contract admin verifies:
///         - Intel/AMD attestation report (signed by IAS/DCAP)
///         - Enclave measurement (MRENCLAVE) matches the expected code hash
///         - The signing key was generated inside the measured enclave
///
///      3. **Attestation Request**: After filling an order, the filler calls the Phat Contract
///         via HTTP. The enclave:
///         a. Reads the source chain (via light client or RPC) to verify the escrow lock exists
///         b. Checks that orderId, filler, amount match the on-chain escrow state
///         c. Signs a TEEAttestation struct with the enclave key
///
///      4. **On-chain Verification**: The filler submits the attestation + signature to
///         IntentSettler.verifyTEESettlement(). This contract ecrecovers the signer and
///         checks it's a trusted enclave.
///
///      5. **Security Model**: Trust is in the TEE hardware + Phala's enclave management.
///         If the TEE is compromised, the ZK BEEFY fallback still protects the protocol.
///         The attestation timeout prevents stale attestations from being replayed.
///
///      Reference: Phala Network Phat Contract — https://docs.phala.network/
contract TEEVerifier is ITEEVerifier {
    // ──────────────────────────── State ────────────────────────────

    /// @notice Mapping of trusted enclave signing addresses
    /// @dev In production: set after verifying Remote Attestation quote
    mapping(address => bool) public trustedEnclaves;

    /// @notice Maximum age of an attestation in seconds (default: 300s = 5min)
    uint256 public attestationTimeout;

    /// @notice Replay protection: tracks used attestation hashes
    mapping(bytes32 => bool) public usedAttestations;

    /// @notice Admin address for enclave management
    address public admin;

    // ──────────────────────────── Events ────────────────────────────

    event EnclaveAdded(address indexed enclave);
    event EnclaveRemoved(address indexed enclave);
    event AttestationVerified(bytes32 indexed orderId, address indexed signer);

    // ──────────────────────────── Constructor ────────────────────────────

    constructor() {
        admin = msg.sender;
        attestationTimeout = 300; // 5 minutes
    }

    // ──────────────────────────── Core ────────────────────────────

    /// @inheritdoc ITEEVerifier
    /// @dev Hackathon placeholder — verifies ECDSA signature against trusted enclave set.
    ///
    ///      Production implementation would additionally:
    ///      1. Verify the RA quote is fresh (not just the attestation timestamp)
    ///      2. Check enclave measurement against a whitelist of known code hashes
    ///      3. Verify the attestation includes a valid chain state proof
    function verifyAttestation(TEEAttestation calldata attestation, bytes calldata signature)
        external
        override
        returns (bool valid)
    {
        // 1. Compute attestation hash for replay protection
        bytes32 attestationHash = keccak256(abi.encode(
            attestation.orderId,
            attestation.filler,
            attestation.amount,
            attestation.escrowContract,
            attestation.escrowChainId,
            attestation.timestamp
        ));

        // 2. Check replay
        require(!usedAttestations[attestationHash], "Attestation already used");

        // 3. Check timestamp freshness
        require(block.timestamp <= attestation.timestamp + attestationTimeout, "Attestation expired");

        // 4. Recover signer from signature
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            attestationHash
        ));

        require(signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;

        address signer = ecrecover(ethSignedHash, v, r, s);
        require(signer != address(0), "Invalid signature");

        // 5. Check signer is a trusted enclave
        require(trustedEnclaves[signer], "Signer not trusted enclave");

        // 6. Mark attestation as used (replay protection)
        usedAttestations[attestationHash] = true;

        emit AttestationVerified(attestation.orderId, signer);

        return true;
    }

    // ──────────────────────────── Admin ────────────────────────────

    /// @notice Add a trusted enclave signing address
    /// @dev In production: only called after verifying the enclave's RA quote
    function addTrustedEnclave(address enclave) external {
        require(msg.sender == admin, "Only admin");
        require(enclave != address(0), "Zero address");
        trustedEnclaves[enclave] = true;
        emit EnclaveAdded(enclave);
    }

    /// @notice Remove a trusted enclave
    function removeTrustedEnclave(address enclave) external {
        require(msg.sender == admin, "Only admin");
        trustedEnclaves[enclave] = false;
        emit EnclaveRemoved(enclave);
    }

    /// @notice Update the attestation timeout
    function setAttestationTimeout(uint256 _timeout) external {
        require(msg.sender == admin, "Only admin");
        attestationTimeout = _timeout;
    }
}
