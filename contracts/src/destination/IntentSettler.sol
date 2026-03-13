// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {OrderLib} from "../libs/OrderLib.sol";
import {IIntentSettler} from "../interfaces/IIntentSettler.sol";
import {IFillerRegistry} from "../interfaces/IFillerRegistry.sol";
import {ITEEVerifier} from "../interfaces/ITEEVerifier.sol";
import {FillStore} from "./FillStore.sol";
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

/// @title IntentSettler - Settlement destination contract
/// @notice Manages fill execution by fillers and settlement verification via ZK proof
/// @dev Deployed on destination chain (Arbitrum Sepolia)
/// @dev ERC-7683: Equivalent to IDestinationSettler — manages fill execution
contract IntentSettler is IIntentSettler, IIsmpModule, FillStore, ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────── State ────────────────────────────

    /// @notice ISMP host for cross-chain messaging and proof verification
    address public ismpHandler;

    /// @notice Whitelisted tokens
    mapping(address => bool) public supportedTokens;

    /// @notice FillerRegistry address for recording fills/settlements
    address public fillerRegistry;

    /// @notice TEE Verifier for fast settlement via Phala Network attestations
    address public teeVerifier;

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

    function setFillerRegistry(address _fillerRegistry) external onlyOwner {
        fillerRegistry = _fillerRegistry;
    }

    function setTEEVerifier(address _teeVerifier) external onlyOwner {
        teeVerifier = _teeVerifier;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ──────────────────────────── Core Functions ────────────────────────────

    /// @inheritdoc IIntentSettler
    /// @dev ERC-7683: Equivalent to IDestinationSettler.fill()
    function fillOrder(bytes32 orderId, address recipient, address token, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        require(!_isFilled(orderId), "Order already filled");
        require(recipient != address(0), "Invalid recipient");
        require(supportedTokens[token], "Token not supported");
        require(amount > 0, "Amount must be > 0");

        // Record the fill
        _fills[orderId] = OrderLib.Fill({
            orderId: orderId,
            filler: msg.sender,
            recipient: recipient,
            token: token,
            amount: amount,
            fillTimestamp: block.timestamp,
            settled: false
        });

        _addPendingFill(orderId);

        // Transfer funds from filler to recipient (user gets funds instantly)
        IERC20(token).safeTransferFrom(msg.sender, recipient, amount);

        emit OrderFilled(orderId, msg.sender, recipient, token, amount, block.timestamp);

        if (fillerRegistry != address(0)) {
            IFillerRegistry(fillerRegistry).recordFill(msg.sender);
        }
    }

    /// @inheritdoc IIntentSettler
    function verifySettlement(bytes32 orderId, bytes calldata proof) external nonReentrant {
        require(_isFilled(orderId), "Order not filled");
        OrderLib.Fill storage fill = _fills[orderId];
        require(!fill.settled, "Already settled");

        // Verify ZK BEEFY proof (hackathon: simplified verification)
        _verifyProof(orderId, proof);

        fill.settled = true;
        _removePendingFill(orderId);

        bytes32 proofHash = keccak256(proof);

        emit SettlementVerified(orderId, fill.filler, proofHash);

        if (fillerRegistry != address(0)) {
            IFillerRegistry(fillerRegistry).recordSettlement(fill.filler);
        }
    }

    /// @notice Verify settlement via TEE attestation (fast path ~5-10s)
    /// @dev Uses Phala Network TEE attestation instead of ZK BEEFY proof.
    ///      The TEE enclave verifies the escrow lock on the source chain and signs an attestation.
    function verifyTEESettlement(bytes32 orderId, bytes calldata teeAttestation, bytes calldata signature)
        external
        nonReentrant
    {
        require(_isFilled(orderId), "Order not filled");
        OrderLib.Fill storage fill = _fills[orderId];
        require(!fill.settled, "Already settled");
        require(teeVerifier != address(0), "TEE verifier not set");

        // Decode attestation
        ITEEVerifier.TEEAttestation memory attestation = abi.decode(teeAttestation, (ITEEVerifier.TEEAttestation));

        // Verify attestation via TEE verifier
        require(
            ITEEVerifier(teeVerifier).verifyAttestation(attestation, signature),
            "TEE attestation invalid"
        );

        // Verify attestation matches this order
        require(attestation.orderId == orderId, "Order ID mismatch");
        require(attestation.filler == fill.filler, "Filler mismatch");

        fill.settled = true;
        _removePendingFill(orderId);

        emit TEESettlementVerified(orderId, fill.filler, address(0));

        if (fillerRegistry != address(0)) {
            IFillerRegistry(fillerRegistry).recordSettlement(fill.filler);
        }
    }

    // ──────────────────────────── IIsmpModule ────────────────────────────

    /// @notice Handle incoming ISMP message — SETTLEMENT_RELEASE from source chain
    /// @dev Called by the ISMP host when the source chain confirms escrow release.
    ///      Marks the fill as settled on the destination side.
    function onAccept(IncomingPostRequest memory incoming) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
        BridgeMessage memory bridgeMsg = BridgeMessageCodec.decode(incoming.request.body);

        if (bridgeMsg.msgType == MessageType.SETTLEMENT_RELEASE) {
            OrderLib.Fill storage fill = _fills[bridgeMsg.orderId];
            if (fill.filler != address(0) && !fill.settled) {
                fill.settled = true;
                _removePendingFill(bridgeMsg.orderId);
                emit SettlementVerified(bridgeMsg.orderId, fill.filler, keccak256(incoming.request.body));
            }
        }
    }

    /// @notice Handle timeout of a previously dispatched request
    function onPostRequestTimeout(PostRequest memory) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
    }

    function onPostResponse(IncomingPostResponse memory) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
    }

    function onPostResponseTimeout(PostResponse memory) external override {
        require(msg.sender == ismpHandler, "Only ISMP host");
    }

    // ──────────────────────────── Views ────────────────────────────

    /// @inheritdoc IIntentSettler
    function getFill(bytes32 orderId) external view returns (OrderLib.Fill memory) {
        return _fills[orderId];
    }

    /// @inheritdoc IIntentSettler
    function getPendingSettlements() external view returns (bytes32[] memory) {
        return _pendingFillIds;
    }

    // ──────────────────────────── Internal ────────────────────────────

    /// @notice Verify ZK BEEFY proof — simplified for hackathon
    function _verifyProof(bytes32 orderId, bytes calldata proof) internal view {
        require(proof.length > 0, "Empty proof");
    }
}
