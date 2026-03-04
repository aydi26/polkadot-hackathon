// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OrderLib} from "../libs/OrderLib.sol";

/// @title FillStore - Storage for fill records
/// @notice Internal storage contract used by IntentSettler
abstract contract FillStore {
    /// @notice All fills by orderId
    mapping(bytes32 => OrderLib.Fill) internal _fills;

    /// @notice Pending (unsettled) fill order IDs
    bytes32[] internal _pendingFillIds;

    /// @notice Index of orderId in _pendingFillIds for O(1) removal
    mapping(bytes32 => uint256) internal _pendingFillIndex;

    /// @notice Check if an order has been filled
    function _isFilled(bytes32 orderId) internal view returns (bool) {
        return _fills[orderId].filler != address(0);
    }

    /// @notice Add fill to pending list
    function _addPendingFill(bytes32 orderId) internal {
        _pendingFillIndex[orderId] = _pendingFillIds.length;
        _pendingFillIds.push(orderId);
    }

    /// @notice Remove fill from pending list (swap-and-pop)
    function _removePendingFill(bytes32 orderId) internal {
        uint256 index = _pendingFillIndex[orderId];
        uint256 lastIndex = _pendingFillIds.length - 1;

        if (index != lastIndex) {
            bytes32 lastId = _pendingFillIds[lastIndex];
            _pendingFillIds[index] = lastId;
            _pendingFillIndex[lastId] = index;
        }

        _pendingFillIds.pop();
        delete _pendingFillIndex[orderId];
    }
}
