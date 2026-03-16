// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title DepositRouter — Privacy-preserving proxy for PrivacyPool deposits
/// @notice Routes user deposits through this contract so that the ERC20 Transfer
///         event to the PrivacyPool shows `router → pool` instead of `user → pool`.
///         This prevents trivial deanonymization via Transfer event indexing.
///
/// @dev Flow:
///      1. User approves DepositRouter for USDC spending
///      2. User calls router.deposit() — pulls USDC from user to router
///      3. Router approves PrivacyPool and calls pool.deposit()
///      4. On-chain Transfer events: user→router (generic), router→pool (no user identity)
///
///      An observer indexing Transfer events to the PrivacyPool only sees this contract
///      as the sender, not the original user. The user→router Transfer is mixed with
///      all other router users, increasing the anonymity set.
contract DepositRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice USDC token
    IERC20 public immutable usdc;

    /// @notice PrivacyPool address
    address public immutable pool;

    constructor(address _usdc, address _pool) {
        usdc = IERC20(_usdc);
        pool = _pool;
    }

    /// @notice Deposit into PrivacyPool via this router (hides user address from pool Transfer events)
    /// @param amount Standardized USDC amount (6, 7, 8, 9, or 10 USDC)
    /// @param commitmentHash keccak256(secret) for withdrawal authentication
    /// @param encryptedDest ECIES-encrypted destination address
    /// @param encryptedSecret ECIES-encrypted secret for TEE withdrawal
    /// @param delaySeconds Time-lock before withdrawal is allowed
    function deposit(
        uint256 amount,
        bytes32 commitmentHash,
        bytes calldata encryptedDest,
        bytes calldata encryptedSecret,
        uint256 delaySeconds
    ) external nonReentrant {
        // Pull USDC from user to router (Transfer: user → router)
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // Approve PrivacyPool to spend
        usdc.approve(pool, amount);

        // Call pool.deposit (Transfer: router → pool — user identity is hidden)
        (bool success,) = pool.call(
            abi.encodeWithSignature(
                "deposit(uint256,bytes32,bytes,bytes,uint256)",
                amount,
                commitmentHash,
                encryptedDest,
                encryptedSecret,
                delaySeconds
            )
        );
        require(success, "Pool deposit failed");
    }
}
