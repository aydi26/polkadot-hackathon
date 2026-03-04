// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OrderLib} from "../libs/OrderLib.sol";

/// @title IIntentSettler - Settlement destination on HyperEVM
/// @notice Manages fill execution and settlement verification
interface IIntentSettler {
    // ──────────────────────────── Events ────────────────────────────

    event OrderFilled(
        bytes32 indexed orderId,
        address indexed filler,
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 fillTimestamp
    );

    event SettlementVerified(bytes32 indexed orderId, address indexed filler, bytes32 proofHash);

    // ──────────────────────────── Functions ────────────────────────────

    /// @notice Fill an order — filler fronts funds to the user
    function fillOrder(bytes32 orderId, address recipient, address token, uint256 amount) external;

    /// @notice Verify settlement via ZK BEEFY proof
    function verifySettlement(bytes32 orderId, bytes calldata proof) external;

    /// @notice Get fill details for an order
    function getFill(bytes32 orderId) external view returns (OrderLib.Fill memory);

    /// @notice Get all pending (unsettled) fills
    function getPendingSettlements() external view returns (bytes32[] memory);
}
