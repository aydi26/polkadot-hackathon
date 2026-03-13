// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IISMPBridge - Real ISMP types for IntentBridge cross-chain messaging
/// @notice Mirrors polytope-labs/ismp-solidity types for Hyperbridge integration
/// @dev When Hyperbridge SDK is available as a stable Foundry lib, replace with direct imports

// ──────────────────── ISMP Core Types (from ismp-solidity/interfaces/Message.sol) ────────────────────

/// @notice A post request sent between state machines
struct PostRequest {
    bytes source;           // Source state machine identifier (e.g. "EVM-420420417" for Polkadot Hub)
    bytes dest;             // Destination state machine (e.g. "EVM-998" for HyperEVM Testnet)
    uint64 nonce;           // Request nonce
    bytes from;             // Sender module (address as bytes)
    bytes to;               // Destination module (address as bytes)
    uint64 timeoutTimestamp; // Timestamp by which this request times out
    bytes body;             // Request body (our BridgeMessage encoded)
}

/// @notice A post response
struct PostResponse {
    PostRequest request;
    bytes response;
    uint64 timeoutTimestamp;
}

// ──────────────────── ISMP Module Types (from ismp-solidity/interfaces/IIsmpModule.sol) ────────────────────

/// @notice Incoming post request delivered by the ISMP host
struct IncomingPostRequest {
    PostRequest request;
    address relayer;        // Relayer who delivered this request
}

/// @notice Incoming post response
struct IncomingPostResponse {
    PostResponse response;
    address relayer;
}

// ──────────────────── IIsmpModule Interface ────────────────────

/// @notice Interface that modules must implement to receive ISMP messages
/// @dev Matches polytope-labs/ismp-solidity IIsmpModule exactly
interface IIsmpModule {
    function onAccept(IncomingPostRequest memory incoming) external;
    function onPostResponse(IncomingPostResponse memory incoming) external;
    function onPostRequestTimeout(PostRequest memory request) external;
    function onPostResponseTimeout(PostResponse memory request) external;
}

// ──────────────────── Dispatch Types (from ismp-solidity/interfaces/IDispatcher.sol) ────────────────────

/// @notice Parameters for dispatching a post request via Hyperbridge
struct DispatchPost {
    bytes dest;             // Destination state machine
    bytes to;               // Destination module
    bytes body;             // Request body
    uint64 timeout;         // Timeout in seconds
    uint256 fee;            // Relayer fee (in feeToken)
    address payer;          // Who pays for this request
}

/// @notice The ISMP dispatcher interface (subset used by IntentBridge)
interface IDispatcher {
    function dispatch(DispatchPost memory request) external payable returns (bytes32 commitment);
    function host() external view returns (bytes memory);
    function nonce() external view returns (uint256);
    function feeToken() external view returns (address);
}

// ──────────────────── StateMachine Library (from ismp-solidity/interfaces/StateMachine.sol) ────────────────────

/// @notice Helpers for constructing state machine identifiers
library StateMachine {
    /// @dev Address an EVM state machine (e.g. Polkadot Hub = 420420417, HyperEVM Testnet = 998)
    function evm(uint256 chainId) internal pure returns (bytes memory) {
        return abi.encodePacked("EVM-", _toString(chainId));
    }

    /// @dev Address a Polkadot parachain
    function polkadot(uint256 paraId) internal pure returns (bytes memory) {
        return abi.encodePacked("POLKADOT-", _toString(paraId));
    }

    /// @dev Uint to string (minimal implementation)
    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}

// ──────────────────── IntentBridge-Specific Types ────────────────────

/// @notice Message types for cross-chain communication
enum MessageType {
    FILL_CONFIRMATION,      // Dest → Source: filler has fronted funds
    SETTLEMENT_RELEASE,     // Source → Dest: escrow released, settlement confirmed
    FALLBACK_DELIVERY       // Source → Dest: deliver funds via classic bridge
}

/// @notice Cross-chain message payload for IntentBridge
struct BridgeMessage {
    bytes32 orderId;
    address filler;
    uint256 amount;
    MessageType msgType;
}

/// @notice Encode a BridgeMessage for ISMP body
library BridgeMessageCodec {
    function encode(BridgeMessage memory msg_) internal pure returns (bytes memory) {
        return abi.encode(msg_.orderId, msg_.filler, msg_.amount, msg_.msgType);
    }

    function decode(bytes memory data) internal pure returns (BridgeMessage memory) {
        (bytes32 orderId, address filler, uint256 amount, MessageType msgType) =
            abi.decode(data, (bytes32, address, uint256, MessageType));
        return BridgeMessage(orderId, filler, amount, msgType);
    }
}
