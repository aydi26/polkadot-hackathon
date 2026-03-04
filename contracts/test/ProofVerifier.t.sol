// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ProofVerifier} from "../src/settlement/ProofVerifier.sol";

contract ProofVerifierTest is Test {
    ProofVerifier public verifier;

    function setUp() public {
        // Use address(0) to skip ISMP call in hackathon mode
        verifier = new ProofVerifier(address(0));
    }

    function test_verify_validProof() public {
        bytes32 orderId = keccak256("order-1");
        bytes memory proof = abi.encodePacked(bytes32(uint256(42)));

        bool valid = verifier.verify(orderId, proof);
        assertTrue(valid);
    }

    function test_verify_emitsEvent() public {
        bytes32 orderId = keccak256("order-1");
        bytes memory proof = abi.encodePacked(bytes32(uint256(42)));

        bytes32 proofHash = keccak256(abi.encodePacked(orderId, proof));

        vm.expectEmit(true, false, false, true);
        emit ProofVerifier.ProofVerified(orderId, proofHash);
        verifier.verify(orderId, proof);
    }

    function test_verify_revert_replayAttack() public {
        bytes32 orderId = keccak256("order-1");
        bytes memory proof = abi.encodePacked(bytes32(uint256(42)));

        verifier.verify(orderId, proof);

        vm.expectRevert("Proof already used");
        verifier.verify(orderId, proof);
    }

    function test_verify_invalidProof_tooShort() public {
        bytes32 orderId = keccak256("order-1");
        bytes memory proof = abi.encodePacked(uint8(1)); // < 32 bytes

        bool valid = verifier.verify(orderId, proof);
        assertFalse(valid);
    }

    function test_verify_differentOrdersSameProof() public {
        bytes32 orderId1 = keccak256("order-1");
        bytes32 orderId2 = keccak256("order-2");
        bytes memory proof = abi.encodePacked(bytes32(uint256(42)));

        bool valid1 = verifier.verify(orderId1, proof);
        assertTrue(valid1);

        // Different orderId = different proofHash, so no replay
        bool valid2 = verifier.verify(orderId2, proof);
        assertTrue(valid2);
    }
}
