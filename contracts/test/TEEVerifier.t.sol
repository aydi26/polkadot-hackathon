// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TEEVerifier} from "../src/settlement/TEEVerifier.sol";
import {ITEEVerifier} from "../src/interfaces/ITEEVerifier.sol";

contract TEEVerifierTest is Test {
    TEEVerifier public verifier;

    address public admin = makeAddr("admin");
    uint256 public enclaveKey = 0xBEEF;
    address public enclaveSigner;

    function setUp() public {
        enclaveSigner = vm.addr(enclaveKey);
        vm.prank(admin);
        verifier = new TEEVerifier();
        vm.prank(admin);
        verifier.addTrustedEnclave(enclaveSigner);
    }

    // ──────────────────── Helpers ────────────────────

    function _makeAttestation(bytes32 orderId, address filler, uint256 amount)
        internal
        view
        returns (ITEEVerifier.TEEAttestation memory)
    {
        return _makeAttestationWithQuoteHash(orderId, filler, amount, bytes32(0));
    }

    function _makeAttestationWithQuoteHash(bytes32 orderId, address filler, uint256 amount, bytes32 tdxQuoteHash)
        internal
        view
        returns (ITEEVerifier.TEEAttestation memory)
    {
        return ITEEVerifier.TEEAttestation({
            orderId: orderId,
            filler: filler,
            amount: amount,
            escrowContract: address(0x1234),
            escrowChainId: 420420417,
            timestamp: block.timestamp,
            tdxQuoteHash: tdxQuoteHash
        });
    }

    function _signAttestation(ITEEVerifier.TEEAttestation memory att, uint256 privateKey)
        internal
        pure
        returns (bytes memory)
    {
        bytes32 attestationHash = keccak256(abi.encode(
            att.orderId, att.filler, att.amount,
            att.escrowContract, att.escrowChainId, att.timestamp,
            att.tdxQuoteHash
        ));
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", attestationHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }

    // ──────────────────── Enclave Management ────────────────────

    function test_addTrustedEnclave() public {
        address newEnclave = makeAddr("newEnclave");
        vm.prank(admin);
        verifier.addTrustedEnclave(newEnclave);
        assertTrue(verifier.trustedEnclaves(newEnclave));
    }

    function test_removeTrustedEnclave() public {
        vm.prank(admin);
        verifier.removeTrustedEnclave(enclaveSigner);
        assertFalse(verifier.trustedEnclaves(enclaveSigner));
    }

    function test_addEnclave_onlyAdmin() public {
        vm.prank(makeAddr("nobody"));
        vm.expectRevert("Only admin");
        verifier.addTrustedEnclave(makeAddr("enc"));
    }

    function test_removeEnclave_onlyAdmin() public {
        vm.prank(makeAddr("nobody"));
        vm.expectRevert("Only admin");
        verifier.removeTrustedEnclave(enclaveSigner);
    }

    function test_addEnclave_rejectZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert("Zero address");
        verifier.addTrustedEnclave(address(0));
    }

    function test_setAttestationTimeout() public {
        vm.prank(admin);
        verifier.setAttestationTimeout(600);
        assertEq(verifier.attestationTimeout(), 600);
    }

    function test_setAttestationTimeout_onlyAdmin() public {
        vm.prank(makeAddr("nobody"));
        vm.expectRevert("Only admin");
        verifier.setAttestationTimeout(600);
    }

    // ──────────────────── Valid Attestation ────────────────────

    function test_validAttestation() public {
        bytes32 orderId = keccak256("order1");
        ITEEVerifier.TEEAttestation memory att = _makeAttestation(orderId, makeAddr("bob"), 500e6);
        bytes memory sig = _signAttestation(att, enclaveKey);

        bool valid = verifier.verifyAttestation(att, sig);
        assertTrue(valid);
    }

    function test_validAttestationWithTDXQuoteHash() public {
        bytes32 orderId = keccak256("order1");
        bytes32 quoteHash = keccak256("fake-tdx-quote-data");
        ITEEVerifier.TEEAttestation memory att = _makeAttestationWithQuoteHash(orderId, makeAddr("bob"), 500e6, quoteHash);
        bytes memory sig = _signAttestation(att, enclaveKey);

        bool valid = verifier.verifyAttestation(att, sig);
        assertTrue(valid);
    }

    // ──────────────────── Verify With Quote ────────────────────

    function test_verifyAttestationWithQuote() public {
        bytes memory tdxQuote = hex"deadbeef0123456789abcdef";
        bytes32 quoteHash = keccak256(tdxQuote);

        bytes32 orderId = keccak256("order1");
        ITEEVerifier.TEEAttestation memory att = _makeAttestationWithQuoteHash(orderId, makeAddr("bob"), 500e6, quoteHash);
        bytes memory sig = _signAttestation(att, enclaveKey);

        bool valid = verifier.verifyAttestationWithQuote(att, sig, tdxQuote);
        assertTrue(valid);
    }

    function test_tdxQuoteHashMismatch() public {
        bytes memory tdxQuote = hex"deadbeef";
        bytes32 wrongHash = keccak256("wrong-data");

        bytes32 orderId = keccak256("order1");
        ITEEVerifier.TEEAttestation memory att = _makeAttestationWithQuoteHash(orderId, makeAddr("bob"), 500e6, wrongHash);
        bytes memory sig = _signAttestation(att, enclaveKey);

        vm.expectRevert("TDX quote hash mismatch");
        verifier.verifyAttestationWithQuote(att, sig, tdxQuote);
    }

    function test_TDXQuoteRecordedEvent() public {
        bytes memory tdxQuote = hex"cafebabe";
        bytes32 quoteHash = keccak256(tdxQuote);
        bytes32 orderId = keccak256("order1");

        ITEEVerifier.TEEAttestation memory att = _makeAttestationWithQuoteHash(orderId, makeAddr("bob"), 500e6, quoteHash);
        bytes memory sig = _signAttestation(att, enclaveKey);

        vm.expectEmit(true, false, false, true);
        emit TEEVerifier.TDXQuoteRecorded(orderId, quoteHash);
        verifier.verifyAttestationWithQuote(att, sig, tdxQuote);
    }

    // ──────────────────── Replay Protection ────────────────────

    function test_replayProtection() public {
        bytes32 orderId = keccak256("order1");
        ITEEVerifier.TEEAttestation memory att = _makeAttestation(orderId, makeAddr("bob"), 500e6);
        bytes memory sig = _signAttestation(att, enclaveKey);

        verifier.verifyAttestation(att, sig);

        vm.expectRevert("Attestation already used");
        verifier.verifyAttestation(att, sig);
    }

    // ──────────────────── Timeout ────────────────────

    function test_expiredAttestation() public {
        bytes32 orderId = keccak256("order1");
        ITEEVerifier.TEEAttestation memory att = _makeAttestation(orderId, makeAddr("bob"), 500e6);
        bytes memory sig = _signAttestation(att, enclaveKey);

        // Warp past timeout
        vm.warp(block.timestamp + 301);

        vm.expectRevert("Attestation expired");
        verifier.verifyAttestation(att, sig);
    }

    // ──────────────────── Invalid Signer ────────────────────

    function test_untrustedSigner() public {
        uint256 badKey = 0xDEAD;
        bytes32 orderId = keccak256("order1");
        ITEEVerifier.TEEAttestation memory att = _makeAttestation(orderId, makeAddr("bob"), 500e6);
        bytes memory sig = _signAttestation(att, badKey);

        vm.expectRevert("Signer not trusted enclave");
        verifier.verifyAttestation(att, sig);
    }

    function test_invalidSignatureLength() public {
        bytes32 orderId = keccak256("order1");
        ITEEVerifier.TEEAttestation memory att = _makeAttestation(orderId, makeAddr("bob"), 500e6);

        vm.expectRevert("Invalid signature length");
        verifier.verifyAttestation(att, hex"0011");
    }
}
