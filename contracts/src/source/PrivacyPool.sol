// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PrivacyPool — Time-locked mixing pool for anonymous bridge deposits
/// @notice Users deposit standardized USDC amounts with a commitment hash, encrypted destination,
///         and encrypted secret. The TEE filler decrypts the secret after the time-lock expires
///         and triggers the withdrawal automatically — the user never calls withdraw().
///
/// @dev Privacy model:
///      1. Deposit: user → PrivacyPool (event has no user address, only commitmentHash)
///      2. Wait: funds sit in pool mixed with other deposits of same amount
///      3. Withdraw: TEE filler decrypts secret → calls withdraw() (msg.sender = filler TEE wallet)
///         → PrivacyPool → IntentGateway.createPrivateOrder() (msg.sender = pool)
///      4. Fill: TEE filler decrypts destination + generates unlinkable fillId
///
///      The user's address never appears in the withdraw or order creation — only in the
///      initial deposit tx and ERC20 Transfer event.
contract PrivacyPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────── Types ────────────────────────────

    struct Deposit {
        uint256 amount;
        bytes encryptedDest;
        bytes encryptedSecret; // ECIES-encrypted secret (only TEE can decrypt)
        uint256 releaseTime;
        bool withdrawn;
    }

    // ──────────────────────────── State ────────────────────────────

    /// @notice USDC token address
    IERC20 public immutable usdc;

    /// @notice IntentGateway contract for creating private orders
    address public gateway;

    /// @notice Destination chain ID (Arbitrum Sepolia = 421614)
    uint32 public immutable destChain;

    /// @notice Deposits indexed by commitment hash
    mapping(bytes32 => Deposit) public deposits;

    /// @notice Maximum allowed delay in seconds (1 hour)
    uint256 public constant MAX_DELAY = 3600;

    /// @notice Standard amounts (6 decimals USDC)
    mapping(uint256 => bool) public standardAmounts;

    // ──────────────────────────── Events ────────────────────────────

    /// @notice Emitted on deposit — NO user address, includes encrypted secret for TEE filler
    event PrivacyDeposit(
        bytes32 indexed commitmentHash,
        uint256 amount,
        uint256 delaySeconds,
        bytes encryptedSecret
    );

    /// @notice Emitted on withdrawal — NO user address
    event PrivacyWithdraw(bytes32 indexed commitmentHash);

    // ──────────────────────────── Constructor ────────────────────────────

    constructor(address _usdc, address _gateway, uint32 _destChain) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        gateway = _gateway;
        destChain = _destChain;

        // Standard amounts: 6, 7, 8, 9, 10 USDC (6 decimals)
        standardAmounts[6e6] = true;
        standardAmounts[7e6] = true;
        standardAmounts[8e6] = true;
        standardAmounts[9e6] = true;
        standardAmounts[10e6] = true;
    }

    // ──────────────────────────── Core ────────────────────────────

    /// @notice Deposit USDC into the privacy pool
    /// @param amount Standardized amount (6, 7, 8, 9, or 10 USDC)
    /// @param commitmentHash keccak256(secret) — used to authenticate withdrawal
    /// @param encryptedDest ECIES-encrypted destination address (only TEE can decrypt)
    /// @param encryptedSecret ECIES-encrypted secret (TEE decrypts to trigger withdrawal)
    /// @param delaySeconds Time to hold funds before withdrawal is allowed (0 to 3600)
    function deposit(
        uint256 amount,
        bytes32 commitmentHash,
        bytes calldata encryptedDest,
        bytes calldata encryptedSecret,
        uint256 delaySeconds
    ) external nonReentrant {
        require(standardAmounts[amount], "Non-standard amount");
        require(delaySeconds <= MAX_DELAY, "Delay too long");
        require(encryptedDest.length > 0, "Empty encrypted dest");
        require(encryptedSecret.length > 0, "Empty encrypted secret");
        require(commitmentHash != bytes32(0), "Zero commitment");
        require(deposits[commitmentHash].amount == 0, "Commitment already used");

        deposits[commitmentHash] = Deposit({
            amount: amount,
            encryptedDest: encryptedDest,
            encryptedSecret: encryptedSecret,
            releaseTime: block.timestamp + delaySeconds,
            withdrawn: false
        });

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // Event has NO user address — TEE filler reads encryptedSecret to trigger withdraw later
        emit PrivacyDeposit(commitmentHash, amount, delaySeconds, encryptedSecret);
    }

    /// @notice Withdraw from pool and create private order on IntentGateway
    /// @dev Called by TEE filler (not the user) after decrypting the secret inside the enclave
    /// @param secret The preimage of the commitment hash
    /// @param feeOffer Fee offered to filler (in token units)
    /// @param deadline Order deadline timestamp
    function withdraw(
        bytes32 secret,
        uint256 feeOffer,
        uint256 deadline
    ) external nonReentrant {
        bytes32 commitmentHash = keccak256(abi.encodePacked(secret));
        Deposit storage dep = deposits[commitmentHash];

        require(dep.amount > 0, "Deposit not found");
        require(!dep.withdrawn, "Already withdrawn");
        require(block.timestamp >= dep.releaseTime, "Still locked");
        require(feeOffer < dep.amount, "Fee >= amount");

        dep.withdrawn = true;

        // Approve IntentGateway to spend the deposited amount
        usdc.approve(gateway, dep.amount);

        // Create private order — msg.sender is THIS CONTRACT (not the user!)
        (bool success,) = gateway.call(
            abi.encodeWithSignature(
                "createPrivateOrder(address,uint256,uint32,bytes,uint256,uint256)",
                address(usdc),
                dep.amount,
                destChain,
                dep.encryptedDest,
                feeOffer,
                deadline
            )
        );
        require(success, "Order creation failed");

        emit PrivacyWithdraw(commitmentHash);
    }

    // ──────────────────────────── Views ────────────────────────────

    /// @notice Check if a deposit exists and is ready for withdrawal
    function isReady(bytes32 commitmentHash) external view returns (bool) {
        Deposit storage dep = deposits[commitmentHash];
        return dep.amount > 0 && !dep.withdrawn && block.timestamp >= dep.releaseTime;
    }

    /// @notice Get remaining lock time for a deposit
    function remainingLockTime(bytes32 commitmentHash) external view returns (uint256) {
        Deposit storage dep = deposits[commitmentHash];
        if (dep.releaseTime <= block.timestamp) return 0;
        return dep.releaseTime - block.timestamp;
    }

    // ──────────────────────────── Admin ────────────────────────────

    function setGateway(address _gateway) external onlyOwner {
        gateway = _gateway;
    }
}
