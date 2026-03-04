// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IntentSettler} from "../src/destination/IntentSettler.sol";
import {IIntentSettler} from "../src/interfaces/IIntentSettler.sol";
import {OrderLib} from "../src/libs/OrderLib.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract IntentSettlerTest is Test {
    IntentSettler public settler;
    MockERC20 public usdc;

    address public owner = makeAddr("owner");
    address public filler = makeAddr("filler");
    address public alice = makeAddr("alice");
    address public ismpHandler = makeAddr("ismpHandler");

    bytes32 public constant ORDER_ID = keccak256("test-order-1");
    uint256 public constant AMOUNT = 100e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        settler = new IntentSettler(owner, ismpHandler);

        vm.prank(owner);
        settler.addSupportedToken(address(usdc));

        // Fund filler
        usdc.mint(filler, 100_000e6);
        vm.prank(filler);
        usdc.approve(address(settler), type(uint256).max);
    }

    // ──────────────────── fillOrder tests ────────────────────

    function test_fillOrder() public {
        vm.prank(filler);
        settler.fillOrder(ORDER_ID, alice, address(usdc), AMOUNT);

        OrderLib.Fill memory fill = settler.getFill(ORDER_ID);
        assertEq(fill.filler, filler);
        assertEq(fill.recipient, alice);
        assertEq(fill.amount, AMOUNT);
        assertFalse(fill.settled);

        // Alice received funds
        assertEq(usdc.balanceOf(alice), AMOUNT);
    }

    function test_fillOrder_emitsEvent() public {
        vm.prank(filler);
        vm.expectEmit(true, true, true, false);
        emit IIntentSettler.OrderFilled(ORDER_ID, filler, alice, address(usdc), AMOUNT, block.timestamp);
        settler.fillOrder(ORDER_ID, alice, address(usdc), AMOUNT);
    }

    function test_fillOrder_revert_doubleFill() public {
        vm.prank(filler);
        settler.fillOrder(ORDER_ID, alice, address(usdc), AMOUNT);

        vm.prank(filler);
        vm.expectRevert("Order already filled");
        settler.fillOrder(ORDER_ID, alice, address(usdc), AMOUNT);
    }

    function test_fillOrder_revert_invalidRecipient() public {
        vm.prank(filler);
        vm.expectRevert("Invalid recipient");
        settler.fillOrder(ORDER_ID, address(0), address(usdc), AMOUNT);
    }

    function test_fillOrder_revert_unsupportedToken() public {
        MockERC20 badToken = new MockERC20("Bad", "BAD", 18);
        vm.prank(filler);
        vm.expectRevert("Token not supported");
        settler.fillOrder(ORDER_ID, alice, address(badToken), AMOUNT);
    }

    function test_fillOrder_revert_zeroAmount() public {
        vm.prank(filler);
        vm.expectRevert("Amount must be > 0");
        settler.fillOrder(ORDER_ID, alice, address(usdc), 0);
    }

    // ──────────────────── verifySettlement tests ────────────────────

    function test_verifySettlement() public {
        vm.prank(filler);
        settler.fillOrder(ORDER_ID, alice, address(usdc), AMOUNT);

        bytes memory proof = abi.encodePacked(bytes32(uint256(1)));
        settler.verifySettlement(ORDER_ID, proof);

        OrderLib.Fill memory fill = settler.getFill(ORDER_ID);
        assertTrue(fill.settled);
    }

    function test_verifySettlement_revert_notFilled() public {
        bytes memory proof = abi.encodePacked(bytes32(uint256(1)));
        vm.expectRevert("Order not filled");
        settler.verifySettlement(ORDER_ID, proof);
    }

    function test_verifySettlement_revert_alreadySettled() public {
        vm.prank(filler);
        settler.fillOrder(ORDER_ID, alice, address(usdc), AMOUNT);

        bytes memory proof = abi.encodePacked(bytes32(uint256(1)));
        settler.verifySettlement(ORDER_ID, proof);

        vm.expectRevert("Already settled");
        settler.verifySettlement(ORDER_ID, proof);
    }

    function test_verifySettlement_revert_emptyProof() public {
        vm.prank(filler);
        settler.fillOrder(ORDER_ID, alice, address(usdc), AMOUNT);

        vm.expectRevert("Empty proof");
        settler.verifySettlement(ORDER_ID, "");
    }

    // ──────────────────── getPendingSettlements tests ────────────────────

    function test_getPendingSettlements() public {
        bytes32 orderId2 = keccak256("test-order-2");

        vm.startPrank(filler);
        settler.fillOrder(ORDER_ID, alice, address(usdc), AMOUNT);
        settler.fillOrder(orderId2, alice, address(usdc), AMOUNT);
        vm.stopPrank();

        bytes32[] memory pending = settler.getPendingSettlements();
        assertEq(pending.length, 2);

        // Settle one
        bytes memory proof = abi.encodePacked(bytes32(uint256(1)));
        settler.verifySettlement(ORDER_ID, proof);

        pending = settler.getPendingSettlements();
        assertEq(pending.length, 1);
    }

    // ──────────────────── pause tests ────────────────────

    function test_pause_blocksFillOrder() public {
        vm.prank(owner);
        settler.pause();

        vm.prank(filler);
        vm.expectRevert();
        settler.fillOrder(ORDER_ID, alice, address(usdc), AMOUNT);
    }
}
