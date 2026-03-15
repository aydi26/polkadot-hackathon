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

    /// @notice Authorized relayer for testnet (simulates ISMP relay)
    address public relayer;

    /// @notice TEE encryption public key (compressed secp256k1, 33 bytes)
    /// @dev Used by frontend to ECIES-encrypt destAddress for private orders
    bytes public teeEncryptionPubKey;

    // ──────────────────────────── Constructor ────────────────────────────

    constructor(address _owner, address _ismpHandler) Ownable(_owner) {
        ismpHandler = _ismpHandler;
        relayer = _owner; // deployer is default relayer
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

    function setRelayer(address _relayer) external onlyOwner {
        relayer = _relayer;
    }

    function setTEEEncryptionPubKey(bytes calldata _pubKey) external onlyOwner {
        require(_pubKey.length == 33 || _pubKey.length == 65, "Invalid pub key length");
        teeEncryptionPubKey = _pubKey;
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

    /// @notice Create a private order with encrypted destination address
    /// @dev The destAddress is ECIES-encrypted with the TEE public key. Only the TEE filler
    ///      can decrypt it inside the enclave. On-chain, only the encrypted blob is visible.
    function createPrivateOrder(
        address token,
        uint256 amount,
        uint32 destChain,
        bytes calldata encryptedDest,
        uint256 feeOffer,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (bytes32 orderId) {
        require(supportedTokens[token], "Token not supported");
        require(amount >= Constants.MIN_ORDER_AMOUNT, "Amount too low");
        require(amount <= Constants.MAX_ORDER_AMOUNT, "Amount too high");
        require(deadline > block.timestamp, "Deadline in the past");
        require(encryptedDest.length > 0, "Empty encrypted dest");
        require(feeOffer < amount, "Fee >= amount");

        uint256 nonce = _nonces[msg.sender]++;

        orderId = OrderLib.computePrivateOrderId(
            msg.sender, token, amount, destChain, encryptedDest, feeOffer, deadline, nonce
        );

        _orders[orderId] = OrderLib.Order({
            orderId: orderId,
            user: msg.sender,
            token: token,
            amount: amount,
            destChain: destChain,
            destAddress: address(0), // hidden — only TEE knows
            feeOffer: feeOffer,
            deadline: deadline,
            createdAt: block.timestamp,
            status: OrderLib.OrderStatus.Pending
        });

        _encryptedDest[orderId] = encryptedDest;
        _isPrivateOrder[orderId] = true;

        _addActiveOrder(orderId);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit PrivateOrderPlaced(orderId, msg.sender, token, amount, destChain, encryptedDest, feeOffer, deadline);
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

    /// @notice Get encrypted destination for a private order
    function getEncryptedDest(bytes32 orderId) external view returns (bytes memory) {
        return _encryptedDest[orderId];
    }

    /// @notice Check if an order is private
    function isPrivateOrder(bytes32 orderId) external view returns (bool) {
        return _isPrivateOrder[orderId];
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

    /// @notice External mark filled — callable by ISMP host or authorized relayer
    function markOrderFilled(bytes32 orderId) external {
        require(msg.sender == ismpHandler || msg.sender == relayer || msg.sender == address(this), "Unauthorized");
        _markOrderFilled(orderId);
    }
}
