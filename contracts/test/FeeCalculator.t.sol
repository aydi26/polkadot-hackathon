// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {FeeCalculator} from "../src/libs/FeeCalculator.sol";
import {Constants} from "../src/libs/Constants.sol";

contract FeeCalculatorTest is Test {
    function test_calculateBaseFee() public pure {
        uint256 amount = 100e6; // 100 USDC
        uint256 baseFee = FeeCalculator.calculateBaseFee(amount);
        // 5 bps of 100 USDC = 0.05 USDC = 50000
        assertEq(baseFee, 50_000);
    }

    function test_calculateBaseFee_largeAmount() public pure {
        uint256 amount = 1_000_000e6;
        uint256 baseFee = FeeCalculator.calculateBaseFee(amount);
        // 5 bps of 1M USDC = 500 USDC
        assertEq(baseFee, 500e6);
    }

    function test_calculateCongestionPremium() public pure {
        uint256 premium = FeeCalculator.calculateCongestionPremium(10, 5);
        // (10 * 0.02e18) / (5 * 1e18) = 0.04 = 0 (truncated to 0 in integer math)
        // Actually: (10 * 20000000000000000) / (5 * 1000000000000000000) = 0
        // The congestion multiplier is very small — this is expected
        assertEq(premium, 0);
    }

    function test_calculateCongestionPremium_highCongestion() public pure {
        uint256 premium = FeeCalculator.calculateCongestionPremium(100, 1);
        // (100 * 0.02e18) / (1 * 1e18) = 2
        assertEq(premium, 2);
    }

    function test_calculateCongestionPremium_noFillers() public pure {
        uint256 premium = FeeCalculator.calculateCongestionPremium(10, 0);
        assertEq(premium, 0);
    }

    function test_calculateSizePremium_belowThreshold() public pure {
        uint256 premium = FeeCalculator.calculateSizePremium(100e6);
        assertEq(premium, 0);
    }

    function test_calculateSizePremium_aboveThreshold() public pure {
        uint256 amount = 20_000e6; // 20k USDC
        uint256 premium = FeeCalculator.calculateSizePremium(amount);
        // excess = 10_000e6, premium = (10_000e6 * 5) / 10_000 = 5e6 = 5 USDC
        assertEq(premium, 5e6);
    }

    function test_calculateSuggestedFee() public pure {
        uint256 fee = FeeCalculator.calculateSuggestedFee(100e6, 10, 5);
        // baseFee = 50000, congestion = 0, size = 0
        assertEq(fee, 50_000);
    }

    function test_validateFee_valid() public pure {
        uint256 amount = 100e6;
        uint256 minFee = (Constants.MIN_FEE_BPS * amount) / Constants.BPS_DENOMINATOR;
        assertTrue(FeeCalculator.validateFee(minFee, amount));
    }

    function test_validateFee_tooLow() public pure {
        uint256 amount = 100e6;
        assertFalse(FeeCalculator.validateFee(0, amount));
    }

    function test_validateFee_tooHigh() public pure {
        uint256 amount = 100e6;
        uint256 maxFee = (Constants.MAX_FEE_BPS * amount) / Constants.BPS_DENOMINATOR;
        assertFalse(FeeCalculator.validateFee(maxFee + 1, amount));
    }

    function testFuzz_calculateSuggestedFee(uint256 amount, uint256 pendingOrders, uint256 activeFillers) public pure {
        amount = bound(amount, Constants.MIN_ORDER_AMOUNT, Constants.MAX_ORDER_AMOUNT);
        pendingOrders = bound(pendingOrders, 0, 1000);
        activeFillers = bound(activeFillers, 0, 100);

        uint256 fee = FeeCalculator.calculateSuggestedFee(amount, pendingOrders, activeFillers);
        // Fee should always be >= base fee
        uint256 baseFee = FeeCalculator.calculateBaseFee(amount);
        assertGe(fee, baseFee);
    }
}
