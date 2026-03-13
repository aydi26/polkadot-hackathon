// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {
    IIsmpModule,
    IncomingPostRequest,
    IncomingPostResponse,
    PostRequest,
    PostResponse,
    BridgeMessage,
    BridgeMessageCodec,
    MessageType
} from "../interfaces/IISMPBridge.sol";

/// @title FallbackReceiver - Receives funds in classic bridge mode (no filler)
/// @notice When no filler is available, funds are sent directly to the user via the
///         XCM v5 -> Hyperbridge -> ZK BEEFY -> ISMP pipeline
/// @dev Deployed on destination chain. Implements IIsmpModule to receive ISMP messages directly.
contract FallbackReceiver is IIsmpModule, Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────── Events ────────────────────────────

    event FallbackFundsReceived(bytes32 indexed orderId, address indexed recipient, address token, uint256 amount);

    // ──────────────────────────── State ────────────────────────────

    /// @notice Authorized ISMP host that can deliver funds
    address public ismpHandler;

    /// @notice Token used for fallback delivery
    address public deliveryToken;

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

    function setDeliveryToken(address _token) external onlyOwner {
        deliveryToken = _token;
    }

    // ──────────────────────────── Core ────────────────────────────

    /// @notice Receive funds from the fallback bridge pipeline (called by ISMP handler or directly)
    /// @dev Called by ISMP handler after ZK BEEFY proof verification
    function receiveFallbackFunds(bytes32 orderId, address recipient, address token, uint256 amount) external {
        require(msg.sender == ismpHandler, "Only ISMP handler");
        require(!delivered[orderId], "Already delivered");
        require(recipient != address(0), "Invalid recipient");

        delivered[orderId] = true;

        IERC20(token).safeTransfer(recipient, amount);

        emit FallbackFundsReceived(orderId, recipient, token, amount);
    }

    // ──────────────────────────── IIsmpModule ────────────────────────────

    /// @notice Handle incoming ISMP message — FALLBACK_DELIVERY from source chain
    /// @dev The proof is already verified by the ISMP host before this callback.
    function onAccept(IncomingPostRequest memory incoming) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
        BridgeMessage memory bridgeMsg = BridgeMessageCodec.decode(incoming.request.body);

        if (bridgeMsg.msgType == MessageType.FALLBACK_DELIVERY) {
            require(!delivered[bridgeMsg.orderId], "Already delivered");
            delivered[bridgeMsg.orderId] = true;

            // In production: decode recipient from extended message body
            // For hackathon: filler field doubles as recipient for fallback
            if (deliveryToken != address(0) && bridgeMsg.filler != address(0)) {
                IERC20(deliveryToken).safeTransfer(bridgeMsg.filler, bridgeMsg.amount);
                emit FallbackFundsReceived(bridgeMsg.orderId, bridgeMsg.filler, deliveryToken, bridgeMsg.amount);
            }
        }
    }

    function onPostRequestTimeout(PostRequest memory) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
    }

    function onPostResponse(IncomingPostResponse memory) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
    }

    function onPostResponseTimeout(PostResponse memory) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
    }
}
