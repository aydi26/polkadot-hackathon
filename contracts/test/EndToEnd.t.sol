// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntentGateway} from "../src/source/IntentGateway.sol";
import {IntentSettler} from "../src/destination/IntentSettler.sol";
import {FillerRegistry} from "../src/destination/FillerRegistry.sol";
import {ISMPHandler} from "../src/settlement/ISMPHandler.sol";
import {ProofVerifier} from "../src/settlement/ProofVerifier.sol";
import {BEEFYVerifier} from "../src/settlement/BEEFYVerifier.sol";
import {TEEVerifier} from "../src/settlement/TEEVerifier.sol";
import {ITEEVerifier} from "../src/interfaces/ITEEVerifier.sol";
import {MockIsmpHost} from "./mocks/MockIsmpHost.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {OrderLib} from "../src/libs/OrderLib.sol";
import {Constants} from "../src/libs/Constants.sol";
import {MessageType} from "../src/interfaces/IISMPBridge.sol";

/// @title EndToEnd - Full system tests simulating both flows
contract EndToEndTest is Test {
    // Source chain contracts
    IntentGateway public gateway;

    // Destination chain contracts
    IntentSettler public settler;
    FillerRegistry public registry;
    ISMPHandler public ismpHandler;
    ProofVerifier public proofVerifier;
    BEEFYVerifier public beefyVerifier;

    // Mock ISMP for cross-chain simulation
    MockIsmpHost public ismpHost;

    // Tokens
    MockERC20 public usdcSource; // USDC on source
    MockERC20 public usdcDest; // USDC on destination

    // Actors
    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob"); // filler
    address public charlie = makeAddr("charlie"); // second filler

    uint32 public constant DEST_CHAIN = Constants.HYPEREVM_CHAIN_ID;

    function setUp() public {
        usdcSource = new MockERC20("USDC Source", "USDC", 6);
        usdcDest = new MockERC20("USDC Dest", "USDC", 6);
        ismpHost = new MockIsmpHost();

        // Deploy source chain
        gateway = new IntentGateway(owner, address(ismpHost));

        // Deploy destination chain
        ismpHandler = new ISMPHandler(owner);
        beefyVerifier = new BEEFYVerifier(2);
        proofVerifier = new ProofVerifier(address(ismpHandler));
        settler = new IntentSettler(owner, address(ismpHost));
        registry = new FillerRegistry(owner, address(usdcDest));

        // Configure
        vm.startPrank(owner);
        gateway.addSupportedToken(address(usdcSource));
        settler.addSupportedToken(address(usdcDest));
        settler.setFillerRegistry(address(registry));
        registry.setIntentSettler(address(settler));
        ismpHandler.setAuthorizedDispatcher(address(settler), true);
        vm.stopPrank();

        // Fund actors
        usdcSource.mint(alice, 10_000e6);
        usdcDest.mint(bob, 100_000e6);
        usdcDest.mint(charlie, 100_000e6);

        vm.prank(alice);
        usdcSource.approve(address(gateway), type(uint256).max);
        vm.prank(bob);
        usdcDest.approve(address(settler), type(uint256).max);
        vm.prank(bob);
        usdcDest.approve(address(registry), type(uint256).max);
        vm.prank(charlie);
        usdcDest.approve(address(settler), type(uint256).max);
    }

    /// @notice INSTANT FLOW: Complete order lifecycle with filler
    function test_e2e_instantFlow() public {
        uint256 amount = 500e6; // 500 USDC
        uint256 fee = 2.5e6; // 0.5% fee
        uint256 deadline = block.timestamp + 2 hours;

        // 1. Register filler
        vm.prank(bob);
        registry.register(1000e6);

        // 2. Alice creates order on source chain
        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdcSource), amount, DEST_CHAIN, alice, fee, deadline);

        // Verify: Alice's USDC locked in gateway
        assertEq(usdcSource.balanceOf(address(gateway)), amount);
        assertEq(usdcSource.balanceOf(alice), 10_000e6 - amount);

        // 3. Bob (filler) fills order on destination chain (~2s in production)
        vm.prank(bob);
        settler.fillOrder(orderId, alice, address(usdcDest), amount);

        // Verify: Alice has funds on destination instantly
        assertEq(usdcDest.balanceOf(alice), amount);
        // Bob: 100k - 1k staked - 500 fronted = 98.5k
        assertEq(usdcDest.balanceOf(bob), 100_000e6 - 1000e6 - amount);

        // 4. ISMP confirms fill on source chain (simulated cross-chain message)
        ismpHost.deliverBridgeMessage(
            address(gateway), orderId, bob, amount, MessageType.FILL_CONFIRMATION
        );

        // Verify: Order marked as Filled
        assertEq(uint8(gateway.getOrder(orderId).status), uint8(OrderLib.OrderStatus.Filled));

        // 5. Settlement: verify proof and release escrow
        bytes memory proof = abi.encodePacked(bytes32(uint256(1)));
        gateway.releaseEscrow(orderId, bob, proof);

        // Verify: Order settled, escrow released to filler's source-chain address
        assertEq(uint8(gateway.getOrder(orderId).status), uint8(OrderLib.OrderStatus.Settled));
        // Bob receives the full escrowed amount (including fee) on source chain
        assertEq(usdcSource.balanceOf(bob), amount);

        // 6. Verify settlement propagated to destination
        vm.prank(bob);
        settler.verifySettlement(orderId, proof);
        assertTrue(settler.getFill(orderId).settled);
    }

    /// @notice CANCEL FLOW: Order expires and user cancels
    function test_e2e_cancelFlow() public {
        uint256 amount = 100e6;
        uint256 fee = 0.1e6;
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdcSource), amount, DEST_CHAIN, alice, fee, deadline);

        uint256 aliceBalBefore = usdcSource.balanceOf(alice);

        // Warp past deadline
        vm.warp(deadline + 1);

        // Alice cancels
        vm.prank(alice);
        gateway.cancelOrder(orderId);

        // Verify: full refund
        assertEq(usdcSource.balanceOf(alice), aliceBalBefore + amount);
        assertEq(uint8(gateway.getOrder(orderId).status), uint8(OrderLib.OrderStatus.Cancelled));
    }

    /// @notice Multiple orders, multiple fillers
    function test_e2e_multipleOrdersAndFillers() public {
        uint256 deadline = block.timestamp + 2 hours;

        // Register two fillers
        vm.prank(bob);
        registry.register(1000e6);
        vm.prank(charlie);
        usdcDest.approve(address(registry), type(uint256).max);
        vm.prank(charlie);
        registry.register(1000e6);

        // Alice creates 2 orders
        vm.startPrank(alice);
        bytes32 orderId1 = gateway.createOrder(address(usdcSource), 100e6, DEST_CHAIN, alice, 0.5e6, deadline);
        bytes32 orderId2 = gateway.createOrder(address(usdcSource), 200e6, DEST_CHAIN, alice, 1e6, deadline);
        vm.stopPrank();

        // Bob fills order 1, Charlie fills order 2
        vm.prank(bob);
        settler.fillOrder(orderId1, alice, address(usdcDest), 100e6);
        vm.prank(charlie);
        settler.fillOrder(orderId2, alice, address(usdcDest), 200e6);

        // Both fills recorded
        assertEq(settler.getFill(orderId1).filler, bob);
        assertEq(settler.getFill(orderId2).filler, charlie);

        // Pending settlements = 2
        assertEq(settler.getPendingSettlements().length, 2);

        // Settle order 1
        bytes memory proof = abi.encodePacked(bytes32(uint256(1)));
        settler.verifySettlement(orderId1, proof);

        // Pending settlements = 1
        assertEq(settler.getPendingSettlements().length, 1);
    }

    uint256 internal constant TEE_ENCLAVE_KEY = 0xBEEF;

    function _signTEEAttestation(ITEEVerifier.TEEAttestation memory att)
        internal
        returns (bytes memory signature, bytes memory encoded)
    {
        bytes32 attestationHash = keccak256(abi.encode(
            att.orderId, att.filler, att.amount,
            att.escrowContract, att.escrowChainId, att.timestamp,
            att.tdxQuoteHash
        ));
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", attestationHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(TEE_ENCLAVE_KEY, ethSignedHash);
        signature = abi.encodePacked(r, s, v);
        encoded = abi.encode(att);
    }

    /// @notice TEE SETTLEMENT FLOW: Same as instant but uses TEE attestation
    function test_e2e_teeSettlementFlow() public {
        // 1. Deploy and configure TEEVerifier
        vm.startPrank(owner);
        TEEVerifier teeVerifier = new TEEVerifier();
        teeVerifier.addTrustedEnclave(vm.addr(TEE_ENCLAVE_KEY));
        settler.setTEEVerifier(address(teeVerifier));
        vm.stopPrank();

        // 2. Register filler
        vm.prank(bob);
        registry.register(1000e6);

        // 3. Alice creates order
        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdcSource), 500e6, DEST_CHAIN, alice, 2.5e6, block.timestamp + 2 hours);

        // 4. Bob fills order on destination
        vm.prank(bob);
        settler.fillOrder(orderId, alice, address(usdcDest), 500e6);
        assertEq(usdcDest.balanceOf(alice), 500e6);

        // 5. ISMP confirms fill on source chain
        ismpHost.deliverBridgeMessage(
            address(gateway), orderId, bob, 500e6, MessageType.FILL_CONFIRMATION
        );
        assertEq(uint8(gateway.getOrder(orderId).status), uint8(OrderLib.OrderStatus.Filled));

        // 6. Sign TEE attestation
        (bytes memory signature, bytes memory encoded) = _signTEEAttestation(
            ITEEVerifier.TEEAttestation(orderId, bob, 500e6, address(gateway), 420420417, block.timestamp, bytes32(0))
        );

        // 7. Verify TEE settlement on destination
        settler.verifyTEESettlement(orderId, encoded, signature);
        assertTrue(settler.getFill(orderId).settled);

        // 8. Release escrow on source
        gateway.releaseEscrow(orderId, bob, encoded);
        assertEq(uint8(gateway.getOrder(orderId).status), uint8(OrderLib.OrderStatus.Settled));
        assertEq(usdcSource.balanceOf(bob), 500e6);
    }

    /// @notice Verify double-fill protection across fillers
    function test_e2e_doubleFillPrevention() public {
        uint256 deadline = block.timestamp + 2 hours;

        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdcSource), 100e6, DEST_CHAIN, alice, 0.5e6, deadline);

        // Bob fills
        vm.prank(bob);
        settler.fillOrder(orderId, alice, address(usdcDest), 100e6);

        // Charlie tries to fill the same order
        vm.prank(charlie);
        vm.expectRevert("Order already filled");
        settler.fillOrder(orderId, alice, address(usdcDest), 100e6);
    }
}
