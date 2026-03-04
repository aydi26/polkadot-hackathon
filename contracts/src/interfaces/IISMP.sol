// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IISMP - Interface for Interoperable State Machine Protocol (Hyperbridge)
/// @notice Handles cross-chain message verification via ISMP
interface IISMP {
    struct PostRequest {
        bytes source;       // Source state machine
        bytes dest;         // Destination state machine
        uint64 nonce;       // Request nonce
        bytes from;         // Sender module
        bytes to;           // Destination module
        uint64 timeoutTimestamp; // Timeout
        bytes body;         // Request body
    }

    struct PostResponse {
        PostRequest request;
        bytes response;
        uint64 timeoutTimestamp;
    }

    struct StorageValue {
        bytes key;
        bytes value;
    }

    /// @notice Verify a cross-chain message from Hyperbridge
    /// @param proof The encoded proof data (ZK BEEFY commitment)
    /// @param message The cross-chain message to verify
    /// @return valid Whether the proof is valid
    function verifyConsensus(bytes calldata proof, bytes calldata message) external view returns (bool valid);

    /// @notice Dispatch a post request to another chain
    /// @param request The post request to dispatch
    function dispatchPost(PostRequest calldata request) external payable;

    /// @notice Get the latest verified height for a state machine
    /// @param stateMachineId The state machine identifier
    /// @return height The latest verified height
    function latestStateMachineHeight(uint256 stateMachineId) external view returns (uint256 height);
}
