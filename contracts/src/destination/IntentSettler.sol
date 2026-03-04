// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {OrderLib} from "../libs/OrderLib.sol";
import {IIntentSettler} from "../interfaces/IIntentSettler.sol";
import {FillStore} from "./FillStore.sol";

/// @title IntentSettler - Settlement destination contract
/// @notice Manages fill execution by fillers and settlement verification via ZK proof
/// @dev Deployed on HyperEVM
contract IntentSettler is IIntentSettler, FillStore, ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────── State ────────────────────────────

    /// @notice ISMP handler for proof verification
    address public ismpHandler;

    /// @notice Whitelisted tokens
    mapping(address => bool) public supportedTokens;

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

    /// @inheritdoc IIntentSettler
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
    }

    /// @inheritdoc IIntentSettler
    function verifySettlement(bytes32 orderId, bytes calldata proof) external nonReentrant {
        require(_isFilled(orderId), "Order not filled");
        OrderLib.Fill storage fill = _fills[orderId];
        require(!fill.settled, "Already settled");

        // TODO: Real ISMP/Hyperbridge ZK BEEFY proof verification
        // For hackathon: simplified verification
        _verifyProof(orderId, proof);

        fill.settled = true;
        _removePendingFill(orderId);

        bytes32 proofHash = keccak256(proof);

        emit SettlementVerified(orderId, fill.filler, proofHash);

        // TODO: Send signal back to Asset Hub to release escrow
        // In production: dispatch ISMP post request to source chain
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
        // TODO: IISMP(ismpHandler).verifyConsensus(proof, abi.encode(orderId));
    }
}
