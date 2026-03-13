// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITEEVerifier - Interface for TEE-based attestation verification
/// @notice Verifies attestations produced by a Trusted Execution Environment (Phala Network)
/// @dev In production: the TEE enclave runs inside Phala's Secure Worker (SGX/TDX),
///      produces a Remote Attestation (RA) quote that proves:
///      1. The enclave code hash matches a known measurement
///      2. The attestation was signed by a key generated inside the enclave
///      3. The enclave observed the escrow lock on-chain before signing
///
///      Flow: Filler requests attestation → Phat Contract verifies escrow on source chain
///      → enclave signs attestation → filler submits to IntentSettler → TEEVerifier checks signature
interface ITEEVerifier {
    /// @notice Attestation produced by a trusted enclave
    /// @param orderId The order being attested
    /// @param filler The filler who filled the order
    /// @param amount The escrowed amount on the source chain
    /// @param escrowContract The IntentGateway address on the source chain
    /// @param escrowChainId The source chain ID
    /// @param timestamp When the attestation was produced
    struct TEEAttestation {
        bytes32 orderId;
        address filler;
        uint256 amount;
        address escrowContract;
        uint256 escrowChainId;
        uint256 timestamp;
    }

    /// @notice Verify a TEE attestation signature
    /// @param attestation The attestation data
    /// @param signature ECDSA signature from the enclave key
    /// @return valid Whether the attestation is valid
    function verifyAttestation(TEEAttestation calldata attestation, bytes calldata signature)
        external
        returns (bool valid);
}
