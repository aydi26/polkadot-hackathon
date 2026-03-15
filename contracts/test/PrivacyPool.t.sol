// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PrivacyPool} from "../src/source/PrivacyPool.sol";
import {IntentGateway} from "../src/source/IntentGateway.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract PrivacyPoolTest is Test {
    PrivacyPool public pool;
    IntentGateway public gateway;
    MockERC20 public usdc;

    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    uint32 public constant DEST_CHAIN = 421614;
    bytes public constant ENCRYPTED_DEST = hex"04deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567";
    bytes32 public constant SECRET = keccak256("alice-secret-123");
    bytes32 public COMMITMENT;

    function setUp() public {
        COMMITMENT = keccak256(abi.encodePacked(SECRET));

        usdc = new MockERC20("USD Coin", "USDC", 6);

        vm.startPrank(owner);
        gateway = new IntentGateway(owner, owner);
        gateway.addSupportedToken(address(usdc));
        pool = new PrivacyPool(address(usdc), address(gateway), DEST_CHAIN);
        vm.stopPrank();

        // Fund alice
        usdc.mint(alice, 10_000e6);
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
    }

    // ──────────────────── Deposit ────────────────────

    function test_deposit() public {
        vm.prank(alice);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 30);

        (uint256 amount,,, uint256 releaseTime, bool withdrawn) = pool.deposits(COMMITMENT);
        assertEq(amount, 10e6);
        assertEq(releaseTime, block.timestamp + 30);
        assertFalse(withdrawn);
    }

    function test_deposit_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit PrivacyPool.PrivacyDeposit(COMMITMENT, 10e6, 30, ENCRYPTED_DEST);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 30);
    }

    function test_deposit_transfersTokens() public {
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 0);
        assertEq(usdc.balanceOf(alice), balBefore - 10e6);
        assertEq(usdc.balanceOf(address(pool)), 10e6);
    }

    function test_deposit_revert_nonStandardAmount() public {
        vm.prank(alice);
        vm.expectRevert("Non-standard amount");
        pool.deposit(5e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 0);
    }

    function test_deposit_revert_delayTooLong() public {
        vm.prank(alice);
        vm.expectRevert("Delay too long");
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 7200);
    }

    function test_deposit_customDelay() public {
        vm.prank(alice);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 45); // 45 seconds custom

        (uint256 amount,,, uint256 releaseTime,) = pool.deposits(COMMITMENT);
        assertEq(amount, 10e6);
        assertEq(releaseTime, block.timestamp + 45);
    }

    function test_deposit_revert_duplicateCommitment() public {
        vm.prank(alice);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 0);

        usdc.mint(bob, 10_000e6);
        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        vm.expectRevert("Commitment already used");
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 0);
        vm.stopPrank();
    }

    // ──────────────────── Withdraw ────────────────────

    function test_withdraw_instant() public {
        vm.prank(alice);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 0); // instant

        // Anyone can withdraw with the secret
        vm.prank(bob);
        pool.withdraw(SECRET, 0.01e6, block.timestamp + 1 hours);

        (, , , , bool withdrawn) = pool.deposits(COMMITMENT);
        assertTrue(withdrawn);
    }

    function test_withdraw_revert_stillLocked() public {
        vm.prank(alice);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 30); // 15 min lock

        vm.prank(alice);
        vm.expectRevert("Still locked");
        pool.withdraw(SECRET, 0.01e6, block.timestamp + 1 hours);
    }

    function test_withdraw_afterDelay() public {
        vm.prank(alice);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 30);

        // Warp past lock
        vm.warp(block.timestamp + 31);

        vm.prank(alice);
        pool.withdraw(SECRET, 0.01e6, block.timestamp + 1 hours);

        (, , , , bool withdrawn) = pool.deposits(COMMITMENT);
        assertTrue(withdrawn);
    }

    function test_withdraw_revert_doubleWithdraw() public {
        vm.prank(alice);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 0);

        vm.prank(alice);
        pool.withdraw(SECRET, 0.01e6, block.timestamp + 1 hours);

        vm.prank(alice);
        vm.expectRevert("Already withdrawn");
        pool.withdraw(SECRET, 0.01e6, block.timestamp + 1 hours);
    }

    function test_withdraw_revert_wrongSecret() public {
        vm.prank(alice);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 0);

        vm.prank(alice);
        vm.expectRevert("Deposit not found");
        pool.withdraw(keccak256("wrong-secret"), 0.01e6, block.timestamp + 1 hours);
    }

    // ──────────────────── Views ────────────────────

    function test_isReady() public {
        vm.prank(alice);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 30);

        assertFalse(pool.isReady(COMMITMENT));

        vm.warp(block.timestamp + 31);
        assertTrue(pool.isReady(COMMITMENT));
    }

    function test_remainingLockTime() public {
        vm.prank(alice);
        pool.deposit(10e6, COMMITMENT, ENCRYPTED_DEST, ENCRYPTED_DEST, 30);

        assertEq(pool.remainingLockTime(COMMITMENT), 30);

        vm.warp(block.timestamp + 15);
        assertEq(pool.remainingLockTime(COMMITMENT), 15);

        vm.warp(block.timestamp + 20);
        assertEq(pool.remainingLockTime(COMMITMENT), 0);
    }

    // ──────────────────── Standard Amounts ────────────────────

    function test_allStandardAmounts() public {
        uint256[5] memory amounts = [uint256(6e6), 7e6, 8e6, 9e6, 10e6];
        for (uint256 i = 0; i < amounts.length; i++) {
            bytes32 commitment = keccak256(abi.encodePacked("secret", i));
            vm.prank(alice);
            pool.deposit(amounts[i], commitment, ENCRYPTED_DEST, ENCRYPTED_DEST, 0);

            (uint256 stored,,,,) = pool.deposits(commitment);
            assertEq(stored, amounts[i]);
        }
    }
}
