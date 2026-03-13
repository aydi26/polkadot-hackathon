// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {FillerRegistry} from "../src/destination/FillerRegistry.sol";
import {IFillerRegistry} from "../src/interfaces/IFillerRegistry.sol";
import {Constants} from "../src/libs/Constants.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract FillerRegistryTest is Test {
    FillerRegistry public registry;
    MockERC20 public usdc;

    address public owner = makeAddr("owner");
    address public fillerA = makeAddr("fillerA");
    address public fillerB = makeAddr("fillerB");

    uint256 public constant STAKE = 1000e6; // 1000 USDC

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        registry = new FillerRegistry(owner, address(usdc));

        // Fund fillers
        usdc.mint(fillerA, 10_000e6);
        usdc.mint(fillerB, 10_000e6);

        vm.prank(fillerA);
        usdc.approve(address(registry), type(uint256).max);
        vm.prank(fillerB);
        usdc.approve(address(registry), type(uint256).max);
    }

    function test_register() public {
        vm.prank(fillerA);
        registry.register(STAKE);

        IFillerRegistry.FillerInfo memory info = registry.getFillerInfo(fillerA);
        assertEq(info.filler, fillerA);
        assertEq(info.stake, STAKE);
        assertTrue(info.active);
        assertEq(info.ordersFilled, 0);

        assertEq(usdc.balanceOf(address(registry)), STAKE);
    }

    function test_register_revert_alreadyRegistered() public {
        vm.prank(fillerA);
        registry.register(STAKE);

        vm.prank(fillerA);
        vm.expectRevert("Already registered");
        registry.register(STAKE);
    }

    function test_register_revert_stakeTooLow() public {
        vm.prank(fillerA);
        vm.expectRevert("Stake too low");
        registry.register(10e6); // Below MIN_FILLER_STAKE
    }

    function test_unregister_cooldown() public {
        vm.prank(fillerA);
        registry.register(STAKE);

        // First call: initiate cooldown
        vm.prank(fillerA);
        registry.unregister();

        // Second call before cooldown: revert
        vm.prank(fillerA);
        vm.expectRevert("Cooldown not elapsed");
        registry.unregister();

        // Warp past cooldown
        vm.warp(block.timestamp + Constants.UNREGISTER_COOLDOWN);

        uint256 balanceBefore = usdc.balanceOf(fillerA);
        vm.prank(fillerA);
        registry.unregister();

        IFillerRegistry.FillerInfo memory info = registry.getFillerInfo(fillerA);
        assertFalse(info.active);
        assertEq(usdc.balanceOf(fillerA), balanceBefore + STAKE);
    }

    function test_slash() public {
        vm.prank(fillerA);
        registry.register(STAKE);

        bytes32 orderId = keccak256("bad-order");

        vm.prank(owner);
        registry.slash(fillerA, orderId);

        IFillerRegistry.FillerInfo memory info = registry.getFillerInfo(fillerA);
        assertFalse(info.active);
        assertEq(info.stake, 0);

        // Slashed funds go to owner
        assertEq(usdc.balanceOf(owner), STAKE);
    }

    function test_getActiveFillers() public {
        vm.prank(fillerA);
        registry.register(STAKE);
        vm.prank(fillerB);
        registry.register(STAKE);

        address[] memory active = registry.getActiveFillers();
        assertEq(active.length, 2);
    }

    function test_getFillerScore() public {
        // Set test contract as intentSettler so recordFill/recordSettlement work
        vm.prank(owner);
        registry.setIntentSettler(address(this));

        vm.prank(fillerA);
        registry.register(STAKE);

        // Initially 0
        assertEq(registry.getFillerScore(fillerA), 0);

        // Record some fills and settlements
        registry.recordFill(fillerA);
        registry.recordFill(fillerA);
        registry.recordSettlement(fillerA);

        // Score = (1 * 1000e6) / 2 = 500e6
        assertEq(registry.getFillerScore(fillerA), 500e6);
    }
}
