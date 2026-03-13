// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IIsmpModule,
    IncomingPostRequest,
    PostRequest,
    BridgeMessage,
    BridgeMessageCodec,
    MessageType
} from "../../src/interfaces/IISMPBridge.sol";

/// @title MockIsmpHost - Simulates Hyperbridge ISMP host for testing
/// @dev Allows tests to simulate cross-chain message delivery via onAccept callbacks
contract MockIsmpHost {
    event PostDispatched(bytes dest, bytes body);

    /// @notice Simulate delivering a post request to a module
    function deliverPostRequest(address module, PostRequest memory request) external {
        IncomingPostRequest memory incoming = IncomingPostRequest({request: request, relayer: msg.sender});
        IIsmpModule(module).onAccept(incoming);
    }

    /// @notice Helper: deliver a BridgeMessage to a module
    function deliverBridgeMessage(
        address module,
        bytes32 orderId,
        address filler,
        uint256 amount,
        MessageType msgType
    ) external {
        BridgeMessage memory bridgeMsg =
            BridgeMessage({orderId: orderId, filler: filler, amount: amount, msgType: msgType});

        PostRequest memory request = PostRequest({
            source: bytes("EVM-420420417"),
            dest: bytes("EVM-998"),
            nonce: 1,
            from: abi.encodePacked(msg.sender),
            to: abi.encodePacked(module),
            timeoutTimestamp: uint64(block.timestamp + 3600),
            body: BridgeMessageCodec.encode(bridgeMsg)
        });

        IncomingPostRequest memory incoming = IncomingPostRequest({request: request, relayer: msg.sender});
        IIsmpModule(module).onAccept(incoming);
    }

    /// @notice Simulate a timeout callback
    function deliverTimeout(address module, PostRequest memory request) external {
        IIsmpModule(module).onPostRequestTimeout(request);
    }
}
