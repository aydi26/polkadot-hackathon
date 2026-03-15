// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OrderLib - Order encoding, hashing, and status management
library OrderLib {
    // ──────────────────────────── Enums ────────────────────────────

    enum OrderStatus {
        None,       // Order does not exist
        Pending,    // Created, waiting for filler
        Filled,     // Filler has fronted the funds
        Settled,    // Settlement verified, escrow released
        Expired,    // Deadline passed, can be cancelled
        Cancelled   // User cancelled after expiry
    }

    // ──────────────────────────── Structs ────────────────────────────

    struct Order {
        bytes32 orderId;
        address user;
        address token;
        uint256 amount;
        uint32 destChain;
        address destAddress;
        uint256 feeOffer;
        uint256 deadline;
        uint256 createdAt;
        OrderStatus status;
    }

    struct Fill {
        bytes32 orderId;
        address filler;
        address recipient;
        address token;
        uint256 amount;
        uint256 fillTimestamp;
        bool settled;
    }

    // ──────────────────────────── Functions ────────────────────────────

    /// @notice Compute unique order ID from parameters
    function computeOrderId(
        address user,
        address token,
        uint256 amount,
        uint32 destChain,
        address destAddress,
        uint256 feeOffer,
        uint256 deadline,
        uint256 nonce
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(user, token, amount, destChain, destAddress, feeOffer, deadline, nonce));
    }

    /// @notice Compute unique order ID for private orders (uses hash of encrypted dest instead of plaintext)
    function computePrivateOrderId(
        address user,
        address token,
        uint256 amount,
        uint32 destChain,
        bytes memory encryptedDest,
        uint256 feeOffer,
        uint256 deadline,
        uint256 nonce
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(user, token, amount, destChain, keccak256(encryptedDest), feeOffer, deadline, nonce));
    }

    /// @notice Check if an order can be filled (status == Pending and within deadline)
    function canFill(Order storage order) internal view returns (bool) {
        return order.status == OrderStatus.Pending && block.timestamp <= order.deadline;
    }

    /// @notice Check if an order can be cancelled (past deadline and still Pending)
    function canCancel(Order storage order) internal view returns (bool) {
        return order.status == OrderStatus.Pending && block.timestamp > order.deadline;
    }

}
