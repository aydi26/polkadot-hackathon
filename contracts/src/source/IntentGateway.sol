// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {OrderLib} from "../libs/OrderLib.sol";
import {Constants} from "../libs/Constants.sol";
import {IIntentGateway} from "../interfaces/IIntentGateway.sol";
import {OrderStore} from "./OrderStore.sol";
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

/// @title IntentGateway - Escrow source contract
/// @notice Manages order creation, escrow locking, and release after ZK proof verification
/// @dev Deployed on source chain (Sepolia for hackathon, Asset Hub in production)
/// @dev ERC-7683: Equivalent to IOriginSettler — manages cross-chain order creation and escrow
contract IntentGateway is IIntentGateway, IIsmpModule, OrderStore, ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────── State ────────────────────────────

    /// @notice Whitelisted tokens for bridging
    mapping(address => bool) public supportedTokens;

    /// @notice ISMP host address for cross-chain messaging
    address public ismpHandler;

    // ──────────────────────────── Constructor ────────────────────────────

    constructor(address _owner, address _ismpHandler) Ownable(_owner) {
        ismpHandler = _ismpHandler;
    }

    // ──────────────────────────── Admin ────────────────────────────

    function addSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = true;
    }

    function removeSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = false;
    }

    function setIsmpHandler(address _ismpHandler) external onlyOwner {
        ismpHandler = _ismpHandler;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ──────────────────────────── Core Functions ────────────────────────────

    /// @inheritdoc IIntentGateway
    /// @dev ERC-7683: Equivalent to IOriginSettler.open()
    function createOrder(
        address token,
        uint256 amount,
        uint32 destChain,
        address destAddress,
        uint256 feeOffer,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (bytes32 orderId) {
        require(supportedTokens[token], "Token not supported");
        require(amount >= Constants.MIN_ORDER_AMOUNT, "Amount too low");
        require(amount <= Constants.MAX_ORDER_AMOUNT, "Amount too high");
        require(deadline > block.timestamp, "Deadline in the past");
        require(destAddress != address(0), "Invalid dest address");
        require(feeOffer < amount, "Fee >= amount");

        uint256 nonce = _nonces[msg.sender]++;

        orderId = OrderLib.computeOrderId(msg.sender, token, amount, destChain, destAddress, feeOffer, deadline, nonce);

        _orders[orderId] = OrderLib.Order({
            orderId: orderId,
            user: msg.sender,
            token: token,
            amount: amount,
            destChain: destChain,
            destAddress: destAddress,
            feeOffer: feeOffer,
            deadline: deadline,
            createdAt: block.timestamp,
            status: OrderLib.OrderStatus.Pending
        });

        _addActiveOrder(orderId);

        // Lock funds in escrow
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit OrderPlaced(orderId, msg.sender, token, amount, destChain, destAddress, feeOffer, deadline);
    }

    /// @inheritdoc IIntentGateway
    function releaseEscrow(bytes32 orderId, address fillerAddress, bytes calldata proof) external nonReentrant {
        OrderLib.Order storage order = _orders[orderId];
        require(order.status == OrderLib.OrderStatus.Filled, "Order not filled");
        require(fillerAddress != address(0), "Invalid filler");

        // Verify ZK BEEFY proof via ISMP handler (hackathon: simplified)
        _verifyProof(orderId, proof);

        order.status = OrderLib.OrderStatus.Settled;
        _removeActiveOrder(orderId);

        // Release escrowed funds to filler (amount + fee is the full escrowed amount)
        IERC20(order.token).safeTransfer(fillerAddress, order.amount);

        emit EscrowReleased(orderId, fillerAddress, order.amount - order.feeOffer, order.feeOffer);
    }

    /// @inheritdoc IIntentGateway
    function executeFallback(bytes32 orderId) external nonReentrant whenNotPaused {
        OrderLib.Order storage order = _orders[orderId];
        require(
            OrderLib.canFallback(order, Constants.FILLER_WINDOW),
            "Cannot fallback: not pending or filler window not expired"
        );

        order.status = OrderLib.OrderStatus.Fallback;
        _removeActiveOrder(orderId);

        // In production: dispatch ISMP post request to deliver funds on dest chain
        emit FallbackExecuted(orderId, order.user, order.amount, order.destAddress);
    }

    /// @inheritdoc IIntentGateway
    function cancelOrder(bytes32 orderId) external nonReentrant {
        OrderLib.Order storage order = _orders[orderId];
        require(order.user == msg.sender, "Not order owner");
        require(OrderLib.canCancel(order), "Cannot cancel: not expired or not pending");

        order.status = OrderLib.OrderStatus.Cancelled;
        _removeActiveOrder(orderId);

        // Refund user
        IERC20(order.token).safeTransfer(order.user, order.amount);

        emit OrderCancelled(orderId, order.user, order.amount);
    }

    // ──────────────────────────── IIsmpModule ────────────────────────────

    /// @notice Handle incoming ISMP message — FILL_CONFIRMATION from destination chain
    /// @dev Called by the ISMP host when a filler confirms a fill on the destination chain.
    ///      Automatically marks the order as Filled so escrow can be released.
    function onAccept(IncomingPostRequest memory incoming) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
        BridgeMessage memory bridgeMsg = BridgeMessageCodec.decode(incoming.request.body);

        if (bridgeMsg.msgType == MessageType.FILL_CONFIRMATION) {
            _markOrderFilled(bridgeMsg.orderId);
        }
    }

    /// @notice Handle timeout of a previously dispatched request
    function onPostRequestTimeout(PostRequest memory) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
        // Timeout handling: could revert order to Pending for retry
    }

    function onPostResponse(IncomingPostResponse memory) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
    }

    function onPostResponseTimeout(PostResponse memory) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
    }

    // ──────────────────────────── Views ────────────────────────────

    /// @inheritdoc IIntentGateway
    function getOrder(bytes32 orderId) external view returns (OrderLib.Order memory) {
        return _orders[orderId];
    }

    /// @inheritdoc IIntentGateway
    function getActiveOrders() external view returns (bytes32[] memory) {
        return _activeOrderIds;
    }

    /// @notice Get user nonce
    function getUserNonce(address user) external view returns (uint256) {
        return _nonces[user];
    }

    // ──────────────────────────── Internal ────────────────────────────

    /// @notice Verify ZK BEEFY proof — simplified for hackathon
    /// @dev In production: calls ISMP host to verify Hyperbridge proof
    function _verifyProof(bytes32 orderId, bytes calldata proof) internal view {
        require(proof.length > 0, "Empty proof");
        // In production: IISMP(ismpHandler).verifyConsensus(proof, abi.encode(orderId));
    }

    /// @notice Mark order as filled — only callable internally via onAccept or by this contract
    function _markOrderFilled(bytes32 orderId) internal {
        OrderLib.Order storage order = _orders[orderId];
        require(order.status == OrderLib.OrderStatus.Pending, "Order not pending");
        order.status = OrderLib.OrderStatus.Filled;
    }

    /// @notice External mark filled — restricted to ISMP host (for backward compatibility)
    function markOrderFilled(bytes32 orderId) external {
        require(msg.sender == ismpHandler || msg.sender == address(this), "Unauthorized");
        _markOrderFilled(orderId);
    }
}
