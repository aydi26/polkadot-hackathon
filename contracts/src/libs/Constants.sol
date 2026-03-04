// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Constants - Protocol parameters
library Constants {
    /// @notice Minimum fee in basis points (5 bps = 0.05%)
    uint256 constant MIN_FEE_BPS = 5;

    /// @notice Maximum fee in basis points (100 bps = 1%)
    uint256 constant MAX_FEE_BPS = 100;

    /// @notice Filler window in seconds — time fillers have to fill before fallback
    uint256 constant FILLER_WINDOW = 30;

    /// @notice Settlement timeout in seconds (1 hour)
    uint256 constant SETTLEMENT_TIMEOUT = 3600;

    /// @notice Maximum order amount (1M USDC — 6 decimals)
    uint256 constant MAX_ORDER_AMOUNT = 1_000_000e6;

    /// @notice Minimum order amount (1 USDC — 6 decimals)
    uint256 constant MIN_ORDER_AMOUNT = 1e6;

    /// @notice Polkadot Asset Hub chain ID
    uint32 constant ASSET_HUB_CHAIN_ID = 1000;

    /// @notice HyperEVM chain ID
    uint32 constant HYPEREVM_CHAIN_ID = 999;

    /// @notice Basis points denominator
    uint256 constant BPS_DENOMINATOR = 10_000;

    /// @notice Filler unregister cooldown (24 hours)
    uint256 constant UNREGISTER_COOLDOWN = 86_400;

    /// @notice Minimum filler stake (100 USDC)
    uint256 constant MIN_FILLER_STAKE = 100e6;

    /// @notice Congestion multiplier for fee calculation (scaled by 1e18)
    uint256 constant CONGESTION_MULTIPLIER = 0.02e18;

    /// @notice Large order threshold for size premium (10,000 USDC)
    uint256 constant LARGE_ORDER_THRESHOLD = 10_000e6;

    /// @notice Size premium in bps for large orders
    uint256 constant SIZE_PREMIUM_BPS = 5;
}
