// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntentGateway} from "../src/source/IntentGateway.sol";
import {IntentSettler} from "../src/destination/IntentSettler.sol";
import {MockIsmpHost} from "./mocks/MockIsmpHost.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {OrderLib} from "../src/libs/OrderLib.sol";
import {Constants} from "../src/libs/Constants.sol";
import {MessageType} from "../src/interfaces/IISMPBridge.sol";

/// @title ISMPIntegration - Tests cross-chain ISMP message flow
contract ISMPIntegrationTest is Test {
    IntentGateway public gateway;
    IntentSettler public settler;
    MockIsmpHost public ismpHost;
    MockERC20 public usdc;

    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public filler = makeAddr("filler");

    uint32 public constant DEST_CHAIN = Constants.HYPEREVM_CHAIN_ID;
    uint256 public constant AMOUNT = 100e6;
    uint256 public constant FEE = 0.5e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        ismpHost = new MockIsmpHost();

        // Deploy contracts with MockIsmpHost as the ISMP handler
        gateway = new IntentGateway(owner, address(ismpHost));
        settler = new IntentSettler(owner, address(ismpHost));

        // Configure
        vm.startPrank(owner);
        gateway.addSupportedToken(address(usdc));
        settler.addSupportedToken(address(usdc));
        vm.stopPrank();

        // Fund actors
        usdc.mint(alice, 10_000e6);
        usdc.mint(filler, 100_000e6);

        vm.prank(alice);
        usdc.approve(address(gateway), type(uint256).max);
        vm.prank(filler);
        usdc.approve(address(settler), type(uint256).max);
    }

    /// @notice Full instant flow: createOrder -> fillOrder -> ISMP FILL_CONFIRMATION -> releaseEscrow
    function test_fullInstantFlow() public {
        // 1. Alice creates order on source chain
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, alice, FEE, deadline);

        // Verify order is Pending
        OrderLib.Order memory order = gateway.getOrder(orderId);
        assertEq(uint8(order.status), uint8(OrderLib.OrderStatus.Pending));

        // 2. Filler fills order on destination chain
        vm.prank(filler);
        settler.fillOrder(orderId, alice, address(usdc), AMOUNT);

        // Alice received funds on destination
        assertEq(usdc.balanceOf(alice), 10_000e6 - AMOUNT + AMOUNT); // sent AMOUNT, got AMOUNT back via fill

        // 3. ISMP delivers FILL_CONFIRMATION to source chain gateway
        ismpHost.deliverBridgeMessage(
            address(gateway), orderId, filler, AMOUNT, MessageType.FILL_CONFIRMATION
        );

        // Order is now Filled
        order = gateway.getOrder(orderId);
        assertEq(uint8(order.status), uint8(OrderLib.OrderStatus.Filled));

        // 4. Release escrow with proof
        bytes memory proof = abi.encodePacked(bytes32(uint256(42)));
        gateway.releaseEscrow(orderId, filler, proof);

        // Order is now Settled
        order = gateway.getOrder(orderId);
        assertEq(uint8(order.status), uint8(OrderLib.OrderStatus.Settled));

        // Filler received escrowed funds
        assertEq(usdc.balanceOf(filler), 100_000e6 - AMOUNT + AMOUNT); // fronted AMOUNT, got AMOUNT back
    }

    /// @notice ISMP settlement: source -> destination settlement release
    function test_settlementViaISMP() public {
        // Setup: create and fill an order
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, alice, FEE, deadline);

        vm.prank(filler);
        settler.fillOrder(orderId, alice, address(usdc), AMOUNT);

        // Verify fill is not yet settled
        OrderLib.Fill memory fill = settler.getFill(orderId);
        assertFalse(fill.settled);

        // ISMP delivers SETTLEMENT_RELEASE to destination settler
        ismpHost.deliverBridgeMessage(
            address(settler), orderId, filler, AMOUNT, MessageType.SETTLEMENT_RELEASE
        );

        // Fill is now settled
        fill = settler.getFill(orderId);
        assertTrue(fill.settled);
    }

}
