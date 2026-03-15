// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITEEVerifier} from "../interfaces/ITEEVerifier.sol";

/// @title TEEVerifier - Verification of TEE attestations from Phala dstack
/// @notice Verifies that a trusted enclave has attested to the existence of an escrow lock
///         on the source chain, enabling fast settlement (~5-10s) without waiting for ZK BEEFY (~6-8min).
///
/// @dev Production flow with Phala dstack:
///
///      1. **dstack CVM**: The filler service runs inside a Confidential VM (Intel TDX).
///         The wallet is derived deterministically via dstack SDK getKey("velora/filler/wallet").
///         This TEE-derived wallet acts as an anonymous intermediary for deposits.
///
///      2. **Key Derivation**: dstack KMS derives secp256k1 keys bound to the app identity
///         (app-id + compose-hash). Same path always gives the same key. The derived address
///         is registered as a trusted enclave on this contract.
///
///      3. **TDX Attestation**: After filling an order, the filler calls dstack SDK getQuote()
///         to generate a TDX attestation quote proving genuine hardware execution.
///         The quote's RTMR3 contains app-id, compose-hash, key-provider measurements.
///
///      4. **On-chain Verification**: The filler submits attestation + signature + TDX quote.
///         This contract verifies the ECDSA signature against trusted enclaves and records
///         the TDX quote hash on-chain for off-chain auditability.
///
///      5. **Anonymous Deposits**: The TEE wallet aggregates fills from multiple users.
///         On-chain, deposits to Hyperliquid come from the TEE wallet — no link to users'
///         source chain addresses. The TDX attestation proves correct execution.
///
///      Reference: Phala dstack — https://github.com/Phala-Network/dstack
contract TEEVerifier is ITEEVerifier {
    // ──────────────────────────── State ────────────────────────────

    /// @notice Mapping of trusted enclave signing addresses
    /// @dev Set after verifying the dstack-derived wallet address
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
    event TDXQuoteRecorded(bytes32 indexed orderId, bytes32 tdxQuoteHash);

    // ──────────────────────────── Constructor ────────────────────────────

    constructor() {
        admin = msg.sender;
        attestationTimeout = 300; // 5 minutes
    }

    // ──────────────────────────── Core ────────────────────────────

    /// @inheritdoc ITEEVerifier
    function verifyAttestation(TEEAttestation calldata attestation, bytes calldata signature)
        external
        override
        returns (bool valid)
    {
        return _verifyAttestation(attestation, signature);
    }

    /// @inheritdoc ITEEVerifier
    function verifyAttestationWithQuote(
        TEEAttestation calldata attestation,
        bytes calldata signature,
        bytes calldata tdxQuote
    ) external override returns (bool valid) {
        // Verify TDX quote hash matches
        require(
            attestation.tdxQuoteHash == keccak256(tdxQuote),
            "TDX quote hash mismatch"
        );

        valid = _verifyAttestation(attestation, signature);

        // Record TDX quote on-chain (emitted as event for off-chain verification)
        emit TDXQuoteRecorded(attestation.orderId, attestation.tdxQuoteHash);
    }

    /// @dev Internal attestation verification logic shared by both entry points
    function _verifyAttestation(TEEAttestation calldata attestation, bytes calldata signature)
        internal
        returns (bool valid)
    {
        // 1. Compute attestation hash (includes tdxQuoteHash)
        bytes32 attestationHash = keccak256(abi.encode(
            attestation.orderId,
            attestation.filler,
            attestation.amount,
            attestation.escrowContract,
            attestation.escrowChainId,
            attestation.timestamp,
            attestation.tdxQuoteHash
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
    /// @dev In production: the dstack-derived wallet address is registered here
    ///      after the admin verifies the CVM's TDX quote off-chain
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
