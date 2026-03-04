// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OrderLib} from "../libs/OrderLib.sol";

/// @title IIntentGateway - Escrow source on Asset Hub
/// @notice Manages order creation, escrow, and release
interface IIntentGateway {
    // ──────────────────────────── Events ────────────────────────────

    event OrderPlaced(
        bytes32 indexed orderId,
        address indexed user,
        address token,
        uint256 amount,
        uint32 destChain,
        address destAddress,
        uint256 feeOffer,
        uint256 deadline
    );

    event OrderCancelled(bytes32 indexed orderId, address indexed user, uint256 refundAmount);

    event EscrowReleased(bytes32 indexed orderId, address indexed fillerAddress, uint256 amount, uint256 fee);

    event FallbackExecuted(bytes32 indexed orderId, address indexed user, uint256 amount, address destAddress);

    // ──────────────────────────── Functions ────────────────────────────

    /// @notice Create a new bridge order and lock funds in escrow
    function createOrder(
        address token,
        uint256 amount,
        uint32 destChain,
        address destAddress,
        uint256 feeOffer,
        uint256 deadline
    ) external returns (bytes32 orderId);

    /// @notice Release escrowed funds to the filler after ZK proof verification
    function releaseEscrow(bytes32 orderId, address fillerAddress, bytes calldata proof) external;

    /// @notice Execute fallback bridge when no filler is available after FILLER_WINDOW
    function executeFallback(bytes32 orderId) external;

    /// @notice Cancel an order after deadline if still pending
    function cancelOrder(bytes32 orderId) external;

    /// @notice Get order details
    function getOrder(bytes32 orderId) external view returns (OrderLib.Order memory);

    /// @notice Get all active (pending) orders
    function getActiveOrders() external view returns (bytes32[] memory);
}
