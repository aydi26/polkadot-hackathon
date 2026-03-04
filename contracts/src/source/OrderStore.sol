// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OrderLib} from "../libs/OrderLib.sol";

/// @title OrderStore - Storage for bridge orders
/// @notice Internal storage contract used by IntentGateway
abstract contract OrderStore {
    using OrderLib for OrderLib.Order;

    /// @notice All orders by orderId
    mapping(bytes32 => OrderLib.Order) internal _orders;

    /// @notice Active (pending) order IDs
    bytes32[] internal _activeOrderIds;

    /// @notice Index of orderId in _activeOrderIds for O(1) removal
    mapping(bytes32 => uint256) internal _activeOrderIndex;

    /// @notice Per-user nonce for unique order IDs
    mapping(address => uint256) internal _nonces;

    /// @notice Add order to active list
    function _addActiveOrder(bytes32 orderId) internal {
        _activeOrderIndex[orderId] = _activeOrderIds.length;
        _activeOrderIds.push(orderId);
    }

    /// @notice Remove order from active list (swap-and-pop)
    function _removeActiveOrder(bytes32 orderId) internal {
        uint256 index = _activeOrderIndex[orderId];
        uint256 lastIndex = _activeOrderIds.length - 1;

        if (index != lastIndex) {
            bytes32 lastOrderId = _activeOrderIds[lastIndex];
            _activeOrderIds[index] = lastOrderId;
            _activeOrderIndex[lastOrderId] = index;
        }

        _activeOrderIds.pop();
        delete _activeOrderIndex[orderId];
    }
}
