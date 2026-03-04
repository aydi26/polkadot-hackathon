// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IntentGateway} from "../src/source/IntentGateway.sol";
import {IIntentGateway} from "../src/interfaces/IIntentGateway.sol";
import {OrderLib} from "../src/libs/OrderLib.sol";
import {Constants} from "../src/libs/Constants.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract IntentGatewayTest is Test {
    IntentGateway public gateway;
    MockERC20 public usdc;

    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public ismpHandler = makeAddr("ismpHandler");

    uint32 public constant DEST_CHAIN = Constants.HYPEREVM_CHAIN_ID;
    uint256 public constant AMOUNT = 100e6; // 100 USDC
    uint256 public constant FEE = 0.1e6; // 0.10 USDC

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        gateway = new IntentGateway(owner, ismpHandler);

        vm.prank(owner);
        gateway.addSupportedToken(address(usdc));

        // Fund alice
        usdc.mint(alice, 10_000e6);
        vm.prank(alice);
        usdc.approve(address(gateway), type(uint256).max);
    }

    // ──────────────────── createOrder tests ────────────────────

    function test_createOrder() public {
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, deadline);

        OrderLib.Order memory order = gateway.getOrder(orderId);
        assertEq(order.user, alice);
        assertEq(order.token, address(usdc));
        assertEq(order.amount, AMOUNT);
        assertEq(order.destChain, DEST_CHAIN);
        assertEq(order.destAddress, bob);
        assertEq(order.feeOffer, FEE);
        assertEq(uint8(order.status), uint8(OrderLib.OrderStatus.Pending));

        // Funds locked in contract
        assertEq(usdc.balanceOf(address(gateway)), AMOUNT);
        assertEq(usdc.balanceOf(alice), 10_000e6 - AMOUNT);
    }

    function test_createOrder_emitsEvent() public {
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(alice);
        vm.expectEmit(false, true, false, true);
        emit IIntentGateway.OrderPlaced(bytes32(0), alice, address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, deadline);
        gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, deadline);
    }

    function test_createOrder_revert_unsupportedToken() public {
        MockERC20 badToken = new MockERC20("Bad", "BAD", 18);
        vm.prank(alice);
        vm.expectRevert("Token not supported");
        gateway.createOrder(address(badToken), AMOUNT, DEST_CHAIN, bob, FEE, block.timestamp + 1 hours);
    }

    function test_createOrder_revert_amountTooLow() public {
        vm.prank(alice);
        vm.expectRevert("Amount too low");
        gateway.createOrder(address(usdc), 0.5e6, DEST_CHAIN, bob, 0, block.timestamp + 1 hours);
    }

    function test_createOrder_revert_amountTooHigh() public {
        vm.prank(alice);
        vm.expectRevert("Amount too high");
        gateway.createOrder(address(usdc), 2_000_000e6, DEST_CHAIN, bob, FEE, block.timestamp + 1 hours);
    }

    function test_createOrder_revert_deadlineInPast() public {
        vm.prank(alice);
        vm.expectRevert("Deadline in the past");
        gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, block.timestamp - 1);
    }

    function test_createOrder_revert_feeGteAmount() public {
        vm.prank(alice);
        vm.expectRevert("Fee >= amount");
        gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, AMOUNT, block.timestamp + 1 hours);
    }

    function testFuzz_createOrder(uint256 amount, uint256 fee) public {
        amount = bound(amount, Constants.MIN_ORDER_AMOUNT, Constants.MAX_ORDER_AMOUNT);
        fee = bound(fee, 0, amount - 1);

        usdc.mint(alice, amount);
        vm.prank(alice);
        usdc.approve(address(gateway), amount);

        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdc), amount, DEST_CHAIN, bob, fee, block.timestamp + 1 hours);

        OrderLib.Order memory order = gateway.getOrder(orderId);
        assertEq(order.amount, amount);
        assertEq(order.feeOffer, fee);
    }

    // ──────────────────── cancelOrder tests ────────────────────

    function test_cancelOrder() public {
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, deadline);

        // Warp past deadline
        vm.warp(deadline + 1);

        uint256 balanceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        gateway.cancelOrder(orderId);

        OrderLib.Order memory order = gateway.getOrder(orderId);
        assertEq(uint8(order.status), uint8(OrderLib.OrderStatus.Cancelled));
        assertEq(usdc.balanceOf(alice), balanceBefore + AMOUNT);
    }

    function test_cancelOrder_revert_notOwner() public {
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, deadline);

        vm.warp(deadline + 1);
        vm.prank(bob);
        vm.expectRevert("Not order owner");
        gateway.cancelOrder(orderId);
    }

    function test_cancelOrder_revert_notExpired() public {
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, deadline);

        vm.prank(alice);
        vm.expectRevert("Cannot cancel: not expired or not pending");
        gateway.cancelOrder(orderId);
    }

    // ──────────────────── executeFallback tests ────────────────────

    function test_executeFallback() public {
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, deadline);

        // Warp past filler window
        vm.warp(block.timestamp + Constants.FILLER_WINDOW + 1);

        gateway.executeFallback(orderId);

        OrderLib.Order memory order = gateway.getOrder(orderId);
        assertEq(uint8(order.status), uint8(OrderLib.OrderStatus.Fallback));
    }

    function test_executeFallback_revert_tooEarly() public {
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(alice);
        bytes32 orderId = gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, deadline);

        vm.expectRevert("Cannot fallback: not pending or filler window not expired");
        gateway.executeFallback(orderId);
    }

    // ──────────────────── getActiveOrders tests ────────────────────

    function test_getActiveOrders() public {
        uint256 deadline = block.timestamp + 1 hours;

        vm.startPrank(alice);
        bytes32 id1 = gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, deadline);
        bytes32 id2 = gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, deadline);
        vm.stopPrank();

        bytes32[] memory active = gateway.getActiveOrders();
        assertEq(active.length, 2);
        assertEq(active[0], id1);
        assertEq(active[1], id2);
    }

    // ──────────────────── pause tests ────────────────────

    function test_pause_blocksCreateOrder() public {
        vm.prank(owner);
        gateway.pause();

        vm.prank(alice);
        vm.expectRevert();
        gateway.createOrder(address(usdc), AMOUNT, DEST_CHAIN, bob, FEE, block.timestamp + 1 hours);
    }
}
