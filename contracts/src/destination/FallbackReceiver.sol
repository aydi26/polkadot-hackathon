// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title FallbackReceiver - Receives funds in classic bridge mode (no filler)
/// @notice When no filler is available, funds are sent directly to the user via the
///         XCM v5 → Hyperbridge → ZK BEEFY → ISMP pipeline
/// @dev Deployed on HyperEVM
contract FallbackReceiver is Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────── Events ────────────────────────────

    event FallbackFundsReceived(bytes32 indexed orderId, address indexed recipient, address token, uint256 amount);

    // ──────────────────────────── State ────────────────────────────

    /// @notice Authorized ISMP handler that can deliver funds
    address public ismpHandler;

    /// @notice Track delivered orders to prevent double delivery
    mapping(bytes32 => bool) public delivered;

    // ──────────────────────────── Constructor ────────────────────────────

    constructor(address _owner, address _ismpHandler) Ownable(_owner) {
        ismpHandler = _ismpHandler;
    }

    // ──────────────────────────── Admin ────────────────────────────

    function setIsmpHandler(address _ismpHandler) external onlyOwner {
        ismpHandler = _ismpHandler;
    }

    // ──────────────────────────── Core ────────────────────────────

    /// @notice Receive funds from the fallback bridge pipeline
    /// @dev Called by ISMP handler after ZK BEEFY proof verification
    /// @param orderId The original order ID
    /// @param recipient The user's address on HyperEVM
    /// @param token The token to deliver
    /// @param amount The amount to deliver
    function receiveFallbackFunds(bytes32 orderId, address recipient, address token, uint256 amount) external {
        require(msg.sender == ismpHandler, "Only ISMP handler");
        require(!delivered[orderId], "Already delivered");
        require(recipient != address(0), "Invalid recipient");

        delivered[orderId] = true;

        IERC20(token).safeTransfer(recipient, amount);

        emit FallbackFundsReceived(orderId, recipient, token, amount);
    }
}
