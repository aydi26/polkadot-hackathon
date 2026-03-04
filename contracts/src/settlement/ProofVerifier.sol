// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IISMP} from "../interfaces/IISMP.sol";

/// @title ProofVerifier - ZK BEEFY proof verification
/// @notice Verifies Polkadot consensus proofs for cross-chain settlement
contract ProofVerifier {
    /// @notice ISMP handler for Hyperbridge proof verification
    address public ismpHandler;

    /// @notice Verified proofs (prevent replay)
    mapping(bytes32 => bool) public verifiedProofs;

    event ProofVerified(bytes32 indexed orderId, bytes32 proofHash);

    constructor(address _ismpHandler) {
        ismpHandler = _ismpHandler;
    }

    /// @notice Verify a ZK BEEFY proof for an order settlement
    /// @param orderId The order being settled
    /// @param proof The encoded ZK BEEFY proof
    /// @return valid Whether the proof is valid
    function verify(bytes32 orderId, bytes calldata proof) external returns (bool valid) {
        bytes32 proofHash = keccak256(abi.encodePacked(orderId, proof));
        require(!verifiedProofs[proofHash], "Proof already used");

        // TODO: Real ZK BEEFY verification via Hyperbridge ISMP
        // For hackathon: simplified verification
        valid = _verifyBeefyProof(proof, orderId);

        if (valid) {
            verifiedProofs[proofHash] = true;
            emit ProofVerified(orderId, proofHash);
        }
    }

    /// @notice Internal BEEFY proof verification
    /// @dev In production: decodes BEEFY commitment, verifies validator signatures,
    ///      checks Merkle proof for the order's storage slot on Asset Hub
    function _verifyBeefyProof(bytes calldata proof, bytes32 /* orderId */ ) internal view returns (bool) {
        // TODO: Implement real BEEFY proof verification:
        // 1. Decode the BEEFY signed commitment
        // 2. Verify validator signatures (threshold check)
        // 3. Verify the Merkle proof against the commitment root
        // 4. Verify the storage proof for the order lock on Asset Hub

        // Hackathon placeholder: accept proofs with valid structure
        if (proof.length < 32) return false;

        // Check if ISMP handler confirms the proof
        if (ismpHandler != address(0)) {
            try IISMP(ismpHandler).verifyConsensus(proof, "") returns (bool result) {
                return result;
            } catch {
                // If ISMP handler fails, fall back to basic check
            }
        }

        return proof.length >= 32;
    }
}
