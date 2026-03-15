// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITEEVerifier - Interface for TEE-based attestation verification
/// @notice Verifies attestations produced by a Trusted Execution Environment (Phala dstack)
/// @dev The TEE filler runs inside a dstack CVM (Confidential VM on Intel TDX).
///      The filler's wallet is derived deterministically via dstack SDK's getKey(),
///      acting as an anonymous intermediary for Hyperliquid deposits.
///
///      Flow:
///      1. Filler derives wallet inside TEE via dstack getKey("velora/filler/wallet")
///      2. Filler fills orders using the TEE-derived wallet (anonymous intermediary)
///      3. Filler generates TDX attestation quote via dstack getQuote()
///      4. Filler signs attestation with TEE-derived key + submits TDX quote
///      5. TEEVerifier checks ECDSA signature against trusted enclaves
///      6. TDX quote is recorded on-chain for off-chain auditability
interface ITEEVerifier {
    /// @notice Attestation produced by a trusted enclave
    /// @param orderId The order being attested
    /// @param filler The filler who filled the order
    /// @param amount The escrowed amount on the source chain
    /// @param escrowContract The IntentGateway address on the source chain
    /// @param escrowChainId The source chain ID
    /// @param timestamp When the attestation was produced
    /// @param tdxQuoteHash keccak256 of the TDX attestation quote (bytes32(0) if mock mode)
    struct TEEAttestation {
        bytes32 orderId;
        address filler;
        uint256 amount;
        address escrowContract;
        uint256 escrowChainId;
        uint256 timestamp;
        bytes32 tdxQuoteHash;
    }

    /// @notice Verify a TEE attestation signature
    /// @param attestation The attestation data
    /// @param signature ECDSA signature from the enclave key
    /// @return valid Whether the attestation is valid
    function verifyAttestation(TEEAttestation calldata attestation, bytes calldata signature)
        external
        returns (bool valid);

    /// @notice Verify a TEE attestation with full TDX quote for on-chain recording
    /// @param attestation The attestation data (tdxQuoteHash must match keccak256(tdxQuote))
    /// @param signature ECDSA signature from the enclave key
    /// @param tdxQuote Raw TDX attestation quote bytes from dstack getQuote()
    /// @return valid Whether the attestation is valid
    function verifyAttestationWithQuote(
        TEEAttestation calldata attestation,
        bytes calldata signature,
        bytes calldata tdxQuote
    ) external returns (bool valid);
}
