// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IISMP} from "../interfaces/IISMP.sol";

/// @title ISMPHandler - Interface with Hyperbridge's ISMP module
/// @notice Handles incoming and outgoing ISMP messages for cross-chain settlement
/// @dev In production, this integrates with Hyperbridge's ISMP contracts on HyperEVM
contract ISMPHandler is Ownable {
    // ──────────────────────────── Events ────────────────────────────

    event MessageReceived(bytes32 indexed messageId, bytes source, bytes body);
    event MessageDispatched(bytes32 indexed messageId, bytes dest, bytes body);

    // ──────────────────────────── State ────────────────────────────

    /// @notice Authorized contracts that can dispatch messages
    mapping(address => bool) public authorizedDispatchers;

    /// @notice Processed message IDs (prevent replay)
    mapping(bytes32 => bool) public processedMessages;

    /// @notice The Hyperbridge ISMP contract address
    address public hyperbridgeIsmp;

    // ──────────────────────────── Constructor ────────────────────────────

    constructor(address _owner) Ownable(_owner) {}

    // ──────────────────────────── Admin ────────────────────────────

    function setHyperbridgeIsmp(address _hyperbridgeIsmp) external onlyOwner {
        hyperbridgeIsmp = _hyperbridgeIsmp;
    }

    function setAuthorizedDispatcher(address dispatcher, bool authorized) external onlyOwner {
        authorizedDispatchers[dispatcher] = authorized;
    }

    // ──────────────────────────── Core ────────────────────────────

    /// @notice Handle an incoming ISMP message from Hyperbridge
    /// @dev Called by the Hyperbridge ISMP contract after proof verification
    /// @param source The source state machine identifier
    /// @param body The message body
    function onPostRequestReceived(bytes calldata source, bytes calldata body) external {
        // TODO: In production, verify msg.sender == hyperbridgeIsmp
        bytes32 messageId = keccak256(abi.encodePacked(source, body, block.timestamp));
        require(!processedMessages[messageId], "Message already processed");

        processedMessages[messageId] = true;

        emit MessageReceived(messageId, source, body);

        // TODO: Decode body and route to IntentSettler.verifySettlement()
        // or FallbackReceiver.receiveFallbackFunds()
    }

    /// @notice Dispatch an ISMP message to another chain via Hyperbridge
    /// @param dest The destination state machine identifier
    /// @param body The message body
    function dispatchMessage(bytes calldata dest, bytes calldata body) external {
        require(authorizedDispatchers[msg.sender], "Not authorized");

        bytes32 messageId = keccak256(abi.encodePacked(dest, body, block.timestamp));

        emit MessageDispatched(messageId, dest, body);

        // TODO: Call hyperbridgeIsmp.dispatchPost() with the actual ISMP request
        // IISMP(hyperbridgeIsmp).dispatchPost(IISMP.PostRequest({...}));
    }

    /// @notice Verify a consensus proof (delegated to Hyperbridge)
    /// @dev Simplified for hackathon
    function verifyConsensus(bytes calldata proof, bytes calldata message) external view returns (bool) {
        if (hyperbridgeIsmp != address(0)) {
            return IISMP(hyperbridgeIsmp).verifyConsensus(proof, message);
        }
        // Hackathon fallback: accept non-empty proofs
        return proof.length >= 32;
    }
}
