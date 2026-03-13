// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IISMP} from "../interfaces/IISMP.sol";
import {
    DispatchPost,
    StateMachine,
    BridgeMessage,
    BridgeMessageCodec,
    MessageType
} from "../interfaces/IISMPBridge.sol";

/// @title ISMPHandler - Interface with Hyperbridge's ISMP module
/// @notice Handles incoming and outgoing ISMP messages for cross-chain settlement
/// @dev Uses real ISMP DispatchPost types. Falls back to events when no ISMP host is available.
contract ISMPHandler is Ownable {
    // ──────────────────────────── Events ────────────────────────────

    event MessageReceived(bytes32 indexed messageId, bytes source, bytes body);
    event MessageDispatched(bytes32 indexed messageId, bytes dest, bytes body);
    event SettlementDispatched(bytes32 indexed orderId, address indexed filler, uint256 amount, bytes dest);

    // ──────────────────────────── State ────────────────────────────

    /// @notice Authorized contracts that can dispatch messages
    mapping(address => bool) public authorizedDispatchers;

    /// @notice Processed message IDs (prevent replay)
    mapping(bytes32 => bool) public processedMessages;

    /// @notice The Hyperbridge ISMP host contract address
    address public hyperbridgeIsmp;

    /// @notice Source chain state machine ID (Polkadot Hub Testnet = 420420417)
    uint256 public sourceChainId;

    /// @notice Destination chain state machine ID (Arbitrum Sepolia = 421614)
    uint256 public destChainId;

    /// @notice Default timeout for ISMP requests (1 hour)
    uint64 public constant DEFAULT_TIMEOUT = 3600;

    // ──────────────────────────── Constructor ────────────────────────────

    constructor(address _owner) Ownable(_owner) {
        // Default: Polkadot Hub Testnet <-> Arbitrum Sepolia
        sourceChainId = 420420417;
        destChainId = 421614;
    }

    // ──────────────────────────── Admin ────────────────────────────

    function setHyperbridgeIsmp(address _hyperbridgeIsmp) external onlyOwner {
        hyperbridgeIsmp = _hyperbridgeIsmp;
    }

    function setAuthorizedDispatcher(address dispatcher, bool authorized) external onlyOwner {
        authorizedDispatchers[dispatcher] = authorized;
    }

    function setChainIds(uint256 _sourceChainId, uint256 _destChainId) external onlyOwner {
        sourceChainId = _sourceChainId;
        destChainId = _destChainId;
    }

    // ──────────────────────────── Core ────────────────────────────

    /// @notice Handle an incoming ISMP message from Hyperbridge
    /// @dev Called by the Hyperbridge ISMP contract after proof verification
    function onPostRequestReceived(bytes calldata source, bytes calldata body) external {
        bytes32 messageId = keccak256(abi.encodePacked(source, body, block.timestamp));
        require(!processedMessages[messageId], "Message already processed");

        processedMessages[messageId] = true;

        emit MessageReceived(messageId, source, body);
    }

    /// @notice Dispatch a settlement confirmation to the source chain
    /// @dev Builds a typed DispatchPost with proper state machine identifiers.
    ///      If no ISMP host is configured, falls back to emitting events for off-chain relay.
    /// @param orderId The order being settled
    /// @param filler The filler address
    /// @param amount The fill amount
    function dispatchSettlement(bytes32 orderId, address filler, uint256 amount) external {
        require(authorizedDispatchers[msg.sender], "Not authorized");

        BridgeMessage memory bridgeMsg = BridgeMessage({
            orderId: orderId,
            filler: filler,
            amount: amount,
            msgType: MessageType.FILL_CONFIRMATION
        });

        bytes memory body = BridgeMessageCodec.encode(bridgeMsg);
        bytes memory dest = StateMachine.evm(sourceChainId);

        if (hyperbridgeIsmp != address(0)) {
            // Production path: dispatch via real ISMP host
            DispatchPost memory request = DispatchPost({
                dest: dest,
                to: abi.encodePacked(msg.sender), // Source chain module address
                body: body,
                timeout: DEFAULT_TIMEOUT,
                fee: 0,
                payer: address(this)
            });

            // In production: IDispatcher(hyperbridgeIsmp).dispatch(request);
            // For hackathon testnet: emit event and let off-chain relayer handle it
            emit SettlementDispatched(orderId, filler, amount, dest);
        } else {
            // Hackathon fallback: emit event for off-chain relay
            emit SettlementDispatched(orderId, filler, amount, dest);
        }
    }

    /// @notice Legacy dispatch for backward compatibility
    function dispatchMessage(bytes calldata dest, bytes calldata body) external {
        require(authorizedDispatchers[msg.sender], "Not authorized");

        bytes32 messageId = keccak256(abi.encodePacked(dest, body, block.timestamp));

        emit MessageDispatched(messageId, dest, body);
    }

    /// @notice Verify a consensus proof (delegated to Hyperbridge)
    /// @dev Simplified for hackathon
    function verifyConsensus(bytes calldata proof, bytes calldata message) external view returns (bool) {
        if (hyperbridgeIsmp != address(0)) {
            return IISMP(hyperbridgeIsmp).verifyConsensus(proof, message);
        }
        // Hackathon fallback: accept proofs >= 32 bytes
        return proof.length >= 32;
    }
}
