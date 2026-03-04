// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Constants} from "./Constants.sol";

/// @title FeeCalculator - Dynamic fee calculation
/// @notice Suggests fees based on congestion, order size, and base rate
library FeeCalculator {
    /// @notice Calculate suggested fee for an order
    /// @param amount Order amount
    /// @param pendingOrders Number of pending orders
    /// @param activeFillers Number of active fillers
    /// @return suggestedFee The suggested fee amount in token units
    function calculateSuggestedFee(uint256 amount, uint256 pendingOrders, uint256 activeFillers)
        internal
        pure
        returns (uint256 suggestedFee)
    {
        uint256 baseFee = calculateBaseFee(amount);
        uint256 congestionPremium = calculateCongestionPremium(pendingOrders, activeFillers);
        uint256 sizePremium = calculateSizePremium(amount);

        suggestedFee = baseFee + congestionPremium + sizePremium;
    }

    /// @notice Base fee = MIN_FEE_BPS * amount / 10000
    function calculateBaseFee(uint256 amount) internal pure returns (uint256) {
        return (Constants.MIN_FEE_BPS * amount) / Constants.BPS_DENOMINATOR;
    }

    /// @notice Congestion premium = (pendingOrders / activeFillers) * CONGESTION_MULTIPLIER
    function calculateCongestionPremium(uint256 pendingOrders, uint256 activeFillers)
        internal
        pure
        returns (uint256)
    {
        if (activeFillers == 0) return 0;
        return (pendingOrders * Constants.CONGESTION_MULTIPLIER) / (activeFillers * 1e18);
    }

    /// @notice Size premium for large orders
    function calculateSizePremium(uint256 amount) internal pure returns (uint256) {
        if (amount <= Constants.LARGE_ORDER_THRESHOLD) return 0;
        uint256 excess = amount - Constants.LARGE_ORDER_THRESHOLD;
        return (excess * Constants.SIZE_PREMIUM_BPS) / Constants.BPS_DENOMINATOR;
    }

    /// @notice Validate that a fee offer is within acceptable bounds
    function validateFee(uint256 feeOffer, uint256 amount) internal pure returns (bool) {
        uint256 minFee = (Constants.MIN_FEE_BPS * amount) / Constants.BPS_DENOMINATOR;
        uint256 maxFee = (Constants.MAX_FEE_BPS * amount) / Constants.BPS_DENOMINATOR;
        return feeOffer >= minFee && feeOffer <= maxFee;
    }
}
