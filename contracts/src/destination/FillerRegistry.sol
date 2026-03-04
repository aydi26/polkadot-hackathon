// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IFillerRegistry} from "../interfaces/IFillerRegistry.sol";
import {Constants} from "../libs/Constants.sol";

/// @title FillerRegistry - Registry for fillers (LPs)
/// @notice Optional contract for filler registration, staking, and reputation tracking
/// @dev Deployed on HyperEVM
contract FillerRegistry is IFillerRegistry, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────── State ────────────────────────────

    /// @notice USDC token used for staking
    IERC20 public stakeToken;

    /// @notice Filler data
    mapping(address => FillerInfo) internal _fillers;

    /// @notice Active filler addresses
    address[] internal _activeFillers;

    /// @notice Index tracking for O(1) removal
    mapping(address => uint256) internal _activeFillerIndex;

    /// @notice Unregister request timestamps (cooldown)
    mapping(address => uint256) internal _unregisterRequests;

    // ──────────────────────────── Constructor ────────────────────────────

    constructor(address _owner, address _stakeToken) Ownable(_owner) {
        stakeToken = IERC20(_stakeToken);
    }

    // ──────────────────────────── Core Functions ────────────────────────────

    /// @inheritdoc IFillerRegistry
    function register(uint256 stake) external nonReentrant {
        require(!_fillers[msg.sender].active, "Already registered");
        require(stake >= Constants.MIN_FILLER_STAKE, "Stake too low");

        _fillers[msg.sender] = FillerInfo({
            filler: msg.sender,
            stake: stake,
            ordersFilled: 0,
            ordersSettled: 0,
            registeredAt: block.timestamp,
            active: true
        });

        _activeFillerIndex[msg.sender] = _activeFillers.length;
        _activeFillers.push(msg.sender);

        stakeToken.safeTransferFrom(msg.sender, address(this), stake);

        emit FillerRegistered(msg.sender, stake);
    }

    /// @inheritdoc IFillerRegistry
    function unregister() external nonReentrant {
        FillerInfo storage info = _fillers[msg.sender];
        require(info.active, "Not registered");

        uint256 requestTime = _unregisterRequests[msg.sender];
        if (requestTime == 0) {
            // First call: initiate cooldown
            _unregisterRequests[msg.sender] = block.timestamp;
            return;
        }

        require(block.timestamp >= requestTime + Constants.UNREGISTER_COOLDOWN, "Cooldown not elapsed");

        uint256 stakeAmount = info.stake;
        info.active = false;
        info.stake = 0;
        delete _unregisterRequests[msg.sender];

        // Remove from active list
        _removeActiveFiller(msg.sender);

        stakeToken.safeTransfer(msg.sender, stakeAmount);

        emit FillerUnregistered(msg.sender, stakeAmount);
    }

    /// @inheritdoc IFillerRegistry
    function slash(address filler, bytes32 orderId) external onlyOwner {
        FillerInfo storage info = _fillers[filler];
        require(info.active, "Filler not active");
        require(info.stake > 0, "Nothing to slash");

        uint256 slashAmount = info.stake; // Full slash
        info.stake = 0;
        info.active = false;

        _removeActiveFiller(filler);

        // Slashed funds go to protocol treasury (owner)
        stakeToken.safeTransfer(owner(), slashAmount);

        emit FillerSlashed(filler, orderId, slashAmount);
    }

    // ──────────────────────────── Filler Stats ────────────────────────────

    /// @notice Increment fill count for a filler (called by IntentSettler)
    function recordFill(address filler) external {
        // TODO: Access control — only IntentSettler
        if (_fillers[filler].active) {
            _fillers[filler].ordersFilled++;
        }
    }

    /// @notice Increment settlement count for a filler
    function recordSettlement(address filler) external {
        // TODO: Access control — only IntentSettler
        if (_fillers[filler].active) {
            _fillers[filler].ordersSettled++;
        }
    }

    // ──────────────────────────── Views ────────────────────────────

    /// @inheritdoc IFillerRegistry
    function getFillerInfo(address filler) external view returns (FillerInfo memory) {
        return _fillers[filler];
    }

    /// @inheritdoc IFillerRegistry
    function getActiveFillers() external view returns (address[] memory) {
        return _activeFillers;
    }

    /// @notice Get filler score (simple: orders settled / orders filled ratio × stake)
    function getFillerScore(address filler) external view returns (uint256) {
        FillerInfo storage info = _fillers[filler];
        if (!info.active || info.ordersFilled == 0) return 0;
        return (info.ordersSettled * info.stake) / info.ordersFilled;
    }

    // ──────────────────────────── Internal ────────────────────────────

    function _removeActiveFiller(address filler) internal {
        uint256 index = _activeFillerIndex[filler];
        uint256 lastIndex = _activeFillers.length - 1;

        if (index != lastIndex) {
            address last = _activeFillers[lastIndex];
            _activeFillers[index] = last;
            _activeFillerIndex[last] = index;
        }

        _activeFillers.pop();
        delete _activeFillerIndex[filler];
    }
}
