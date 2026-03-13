// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFillerRegistry - Registry for fillers (LPs)
/// @notice Manages filler registration, staking, and reputation
interface IFillerRegistry {
    struct FillerInfo {
        address filler;
        uint256 stake;
        uint256 ordersFilled;
        uint256 ordersSettled;
        uint256 registeredAt;
        bool active;
    }

    event FillerRegistered(address indexed filler, uint256 stake);
    event FillerUnregistered(address indexed filler, uint256 stakeReturned);
    event FillerSlashed(address indexed filler, bytes32 indexed orderId, uint256 slashAmount);

    /// @notice Register as a filler with a USDC stake
    function register(uint256 stake) external;

    /// @notice Unregister and withdraw stake (after cooldown)
    function unregister() external;

    /// @notice Slash a filler's stake for misbehavior
    function slash(address filler, bytes32 orderId) external;

    /// @notice Get filler info
    function getFillerInfo(address filler) external view returns (FillerInfo memory);

    /// @notice Get all active fillers sorted by score
    function getActiveFillers() external view returns (address[] memory);

    /// @notice Record a fill for reputation tracking
    function recordFill(address filler) external;

    /// @notice Record a settlement for reputation tracking
    function recordSettlement(address filler) external;
}
