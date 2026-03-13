// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentGateway} from "../source/IntentGateway.sol";
import {IntentSettler} from "../destination/IntentSettler.sol";
import {OrderLib} from "../libs/OrderLib.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ════════════════════════════════════════════════════════════════════════════════
//  ERC-7683 Structs — Simplified representations of the standard types
// ════════════════════════════════════════════════════════════════════════════════

/// @notice ERC-7683 Output: describes a token transfer on a specific chain.
/// @param token  Token address encoded as bytes32 (right-padded) for cross-chain compat.
/// @param amount Amount of tokens.
/// @param recipient Recipient address encoded as bytes32.
/// @param chainId Target chain ID for this output.
struct Output {
    bytes32 token;
    uint256 amount;
    bytes32 recipient;
    uint256 chainId;
}

/// @notice ERC-7683 FillInstruction: tells the filler how to execute on the destination chain.
/// @param destinationChainId Chain where the fill should happen.
/// @param destinationSettler Address of the destination settler encoded as bytes32.
/// @param originData Opaque data from the origin needed to process the fill.
struct FillInstruction {
    uint64 destinationChainId;
    bytes32 destinationSettler;
    bytes originData;
}

/// @notice ERC-7683 OnchainCrossChainOrder: user-submitted order on the origin chain.
/// @dev Maps to IntentBridge's createOrder parameters packed into `orderData`.
/// @param fillDeadline Timestamp by which the order must be filled.
/// @param orderDataType Application-specific type discriminator (0x01 for IntentBridge).
/// @param orderData ABI-encoded order parameters: (token, amount, destChain, destAddress, feeOffer).
struct OnchainCrossChainOrder {
    uint32 fillDeadline;
    uint32 orderDataType;
    bytes orderData;
}

/// @notice ERC-7683 GaslessCrossChainOrder: user signs off-chain, relayer submits on-chain.
/// @dev IntentBridge does not currently support gasless orders; included for interface completeness.
/// @param originSettler Address of the origin settler that will process the order.
/// @param user Address of the user who signed the order.
/// @param nonce Replay-protection nonce.
/// @param originChainId Chain where the order originates.
/// @param openDeadline Timestamp by which the order must be opened on-chain.
/// @param fillDeadline Timestamp by which the order must be filled.
/// @param orderDataType Application-specific type discriminator.
/// @param orderData ABI-encoded order parameters.
struct GaslessCrossChainOrder {
    address originSettler;
    address user;
    uint256 nonce;
    uint256 originChainId;
    uint32 openDeadline;
    uint32 fillDeadline;
    uint32 orderDataType;
    bytes orderData;
}

/// @notice ERC-7683 ResolvedCrossChainOrder: fully decoded view of an order for fillers to evaluate.
/// @param user The user who placed the order.
/// @param originChainId The chain where escrow is held.
/// @param openDeadline Deadline for opening (same as fillDeadline for on-chain orders).
/// @param fillDeadline Deadline for filling the order.
/// @param orderId Unique identifier for this order.
/// @param maxSpent Maximum tokens the filler must spend on the destination chain.
/// @param minReceived Minimum tokens the user will receive (amount minus fee).
/// @param fillInstructions Instructions for the filler on how to execute the fill.
struct ResolvedCrossChainOrder {
    address user;
    uint256 originChainId;
    uint32 openDeadline;
    uint32 fillDeadline;
    bytes32 orderId;
    Output[] maxSpent;
    Output[] minReceived;
    FillInstruction[] fillInstructions;
}

// ════════════════════════════════════════════════════════════════════════════════
//  ERC-7683 Interfaces
// ════════════════════════════════════════════════════════════════════════════════

/// @title IERC7683OriginSettler
/// @notice ERC-7683 origin-side interface for opening and resolving cross-chain orders.
/// @dev See https://eips.ethereum.org/EIPS/eip-7683
interface IERC7683OriginSettler {
    /// @notice Emitted when a new cross-chain order is opened.
    /// @param orderId Unique order identifier.
    /// @param resolvedOrder The fully resolved order details for fillers.
    event Open(bytes32 indexed orderId, ResolvedCrossChainOrder resolvedOrder);

    /// @notice Opens a new cross-chain order on-chain.
    /// @param order The on-chain order struct containing fill deadline and encoded order data.
    function open(OnchainCrossChainOrder calldata order) external;

    /// @notice Opens an order on behalf of a user using their off-chain signature.
    /// @param order The gasless order struct signed off-chain.
    /// @param signature The user's EIP-712 signature over the order.
    /// @param originFillerData Optional data for the filler on the origin chain.
    function openFor(
        GaslessCrossChainOrder calldata order,
        bytes calldata signature,
        bytes calldata originFillerData
    ) external;

    /// @notice Resolves an on-chain order into the standard ResolvedCrossChainOrder view.
    /// @param order The on-chain order to resolve.
    /// @return resolved The fully resolved order with outputs and fill instructions.
    function resolve(OnchainCrossChainOrder calldata order)
        external
        view
        returns (ResolvedCrossChainOrder memory resolved);

    /// @notice Resolves a gasless order into the standard ResolvedCrossChainOrder view.
    /// @param order The gasless order to resolve.
    /// @param originFillerData Optional filler data.
    /// @return resolved The fully resolved order with outputs and fill instructions.
    function resolveFor(GaslessCrossChainOrder calldata order, bytes calldata originFillerData)
        external
        view
        returns (ResolvedCrossChainOrder memory resolved);
}

/// @title IERC7683DestinationSettler
/// @notice ERC-7683 destination-side interface for filling cross-chain orders.
/// @dev See https://eips.ethereum.org/EIPS/eip-7683
interface IERC7683DestinationSettler {
    /// @notice Fills a cross-chain order on the destination chain.
    /// @param orderId Unique identifier of the order being filled.
    /// @param originData Opaque data from the origin chain describing the order.
    /// @param fillerData Filler-specific data (e.g., recipient, token, amount).
    function fill(bytes32 orderId, bytes calldata originData, bytes calldata fillerData) external;
}

// ════════════════════════════════════════════════════════════════════════════════
//  ERC-7683 Origin Adapter — wraps IntentGateway
// ════════════════════════════════════════════════════════════════════════════════

/// @title ERC7683OriginAdapter
/// @author IntentBridge Team
/// @notice Wraps IntentGateway to provide an ERC-7683 IOriginSettler-compatible interface.
/// @dev This adapter translates between the ERC-7683 standard order format and IntentBridge's
///      native createOrder() function. It enables any ERC-7683 compatible solver/filler network
///      to interact with the IntentBridge escrow system.
///
///      ERC-7683 Mapping:
///        open()    -> IntentGateway.createOrder()
///        resolve() -> decodes orderData and returns ResolvedCrossChainOrder view
///
///      Order Data Encoding (orderDataType = 0x01):
///        abi.encode(token, amount, destChain, destAddress, feeOffer)
contract ERC7683OriginAdapter is IERC7683OriginSettler {
    using SafeERC20 for IERC20;

    /// @notice IntentBridge order data type identifier.
    uint32 public constant INTENT_BRIDGE_ORDER_TYPE = 0x01;

    /// @notice The underlying IntentGateway that holds escrow.
    IntentGateway public immutable gateway;

    /// @notice Address of the destination settler (ERC7683DestinationAdapter or IntentSettler).
    /// @dev Stored as bytes32 for ERC-7683 cross-chain address compatibility.
    bytes32 public immutable destinationSettler;

    /// @notice Destination chain ID where fills should be executed.
    uint64 public immutable destinationChainId;

    /// @param _gateway Address of the deployed IntentGateway contract.
    /// @param _destinationSettler Address of the destination settler, right-padded to bytes32.
    /// @param _destinationChainId Chain ID of the destination chain (e.g., HyperEVM).
    constructor(address _gateway, bytes32 _destinationSettler, uint64 _destinationChainId) {
        gateway = IntentGateway(_gateway);
        destinationSettler = _destinationSettler;
        destinationChainId = _destinationChainId;
    }

    /// @inheritdoc IERC7683OriginSettler
    /// @notice Opens a cross-chain order by delegating to IntentGateway.createOrder().
    /// @dev The caller must have approved this adapter to spend the order's token amount.
    ///      This adapter transfers tokens from the caller, approves the gateway, and calls
    ///      createOrder. The resulting orderId and resolved order are emitted via the Open event.
    ///
    ///      orderData encoding: abi.encode(address token, uint256 amount, uint32 destChain,
    ///                                     address destAddress, uint256 feeOffer)
    function open(OnchainCrossChainOrder calldata order) external override {
        require(order.orderDataType == INTENT_BRIDGE_ORDER_TYPE, "ERC7683: unsupported order type");

        // Decode IntentBridge-specific order parameters
        (address token, uint256 amount, uint32 destChain, address destAddress, uint256 feeOffer) =
            abi.decode(order.orderData, (address, uint256, uint32, address, uint256));

        // Pull tokens from the user into this adapter
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Approve the gateway and create the order
        IERC20(token).forceApprove(address(gateway), amount);
        bytes32 orderId =
            gateway.createOrder(token, amount, destChain, destAddress, feeOffer, uint256(order.fillDeadline));

        // Build and emit the resolved order for filler indexing
        ResolvedCrossChainOrder memory resolved = _buildResolved(
            msg.sender, orderId, token, amount, destChain, destAddress, feeOffer, order.fillDeadline
        );

        emit Open(orderId, resolved);
    }

    /// @inheritdoc IERC7683OriginSettler
    /// @notice Gasless orders are not supported in the current IntentBridge implementation.
    /// @dev Reverts unconditionally. Future versions may support EIP-712 signed gasless orders.
    function openFor(GaslessCrossChainOrder calldata, bytes calldata, bytes calldata) external pure override {
        revert("ERC7683: gasless orders not supported");
    }

    /// @inheritdoc IERC7683OriginSettler
    /// @notice Resolves an on-chain order into a standardized ResolvedCrossChainOrder.
    /// @dev Pure decoding — does not require the order to exist on-chain. Useful for fillers
    ///      to evaluate orders before they are opened.
    function resolve(OnchainCrossChainOrder calldata order)
        external
        view
        override
        returns (ResolvedCrossChainOrder memory resolved)
    {
        require(order.orderDataType == INTENT_BRIDGE_ORDER_TYPE, "ERC7683: unsupported order type");

        (address token, uint256 amount, uint32 destChain, address destAddress, uint256 feeOffer) =
            abi.decode(order.orderData, (address, uint256, uint32, address, uint256));

        // orderId is unknown at resolve time (depends on nonce), use placeholder
        resolved = _buildResolved(
            address(0), // user unknown at resolve time
            bytes32(0), // orderId unknown at resolve time
            token,
            amount,
            destChain,
            destAddress,
            feeOffer,
            order.fillDeadline
        );
    }

    /// @inheritdoc IERC7683OriginSettler
    /// @notice Gasless order resolution is not supported.
    function resolveFor(GaslessCrossChainOrder calldata, bytes calldata)
        external
        pure
        override
        returns (ResolvedCrossChainOrder memory)
    {
        revert("ERC7683: gasless orders not supported");
    }

    // ──────────────────────────── Internal Helpers ────────────────────────────

    /// @notice Builds a ResolvedCrossChainOrder from IntentBridge order parameters.
    /// @dev Maps IntentBridge fields to ERC-7683 Output and FillInstruction structs:
    ///      - maxSpent[0]: what the filler pays on destination (amount - feeOffer)
    ///      - minReceived[0]: what the user receives on destination (amount - feeOffer)
    ///      - fillInstructions[0]: where and how to fill
    function _buildResolved(
        address user,
        bytes32 orderId,
        address token,
        uint256 amount,
        uint32 destChain,
        address destAddress,
        uint256 feeOffer,
        uint32 fillDeadline
    ) internal view returns (ResolvedCrossChainOrder memory resolved) {
        uint256 userReceives = amount - feeOffer;

        // maxSpent: what the filler must spend on destination to fill the order
        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(token))),
            amount: userReceives,
            recipient: bytes32(uint256(uint160(destAddress))),
            chainId: uint256(destChain)
        });

        // minReceived: what the user gets on destination (same as maxSpent for direct fills)
        Output[] memory minReceived = new Output[](1);
        minReceived[0] = Output({
            token: bytes32(uint256(uint160(token))),
            amount: userReceives,
            recipient: bytes32(uint256(uint160(destAddress))),
            chainId: uint256(destChain)
        });

        // fillInstructions: how the filler should execute the fill
        FillInstruction[] memory instructions = new FillInstruction[](1);
        instructions[0] = FillInstruction({
            destinationChainId: uint64(destChain),
            destinationSettler: destinationSettler,
            originData: abi.encode(orderId, token, amount, destAddress, feeOffer)
        });

        resolved = ResolvedCrossChainOrder({
            user: user,
            originChainId: block.chainid,
            openDeadline: fillDeadline, // on-chain orders are immediately open
            fillDeadline: fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: instructions
        });
    }
}

// ════════════════════════════════════════════════════════════════════════════════
//  ERC-7683 Destination Adapter — wraps IntentSettler
// ════════════════════════════════════════════════════════════════════════════════

/// @title ERC7683DestinationAdapter
/// @author IntentBridge Team
/// @notice Wraps IntentSettler to provide an ERC-7683 IDestinationSettler-compatible interface.
/// @dev This adapter translates the ERC-7683 fill() call into IntentSettler's fillOrder().
///      Fillers calling fill() via this adapter get the same behavior as calling fillOrder()
///      directly — tokens are transferred from the filler to the recipient instantly.
///
///      ERC-7683 Mapping:
///        fill(orderId, originData, fillerData) -> IntentSettler.fillOrder(orderId, recipient, token, amount)
///
///      originData encoding: abi.encode(orderId, token, amount, destAddress, feeOffer)
///      fillerData encoding: empty (unused) — all parameters come from originData
contract ERC7683DestinationAdapter is IERC7683DestinationSettler {
    using SafeERC20 for IERC20;

    /// @notice The underlying IntentSettler that records fills and manages settlement.
    IntentSettler public immutable settler;

    /// @param _settler Address of the deployed IntentSettler contract.
    constructor(address _settler) {
        settler = IntentSettler(_settler);
    }

    /// @inheritdoc IERC7683DestinationSettler
    /// @notice Fills a cross-chain order by decoding originData and delegating to IntentSettler.
    /// @dev The caller (filler) must have approved this adapter to spend the fill token amount.
    ///      Flow: decode originData -> pull tokens from filler -> approve settler -> fillOrder()
    ///
    ///      originData encoding: abi.encode(bytes32 orderId, address token, uint256 amount,
    ///                                      address destAddress, uint256 feeOffer)
    ///
    ///      The filler pays (amount - feeOffer) to the recipient and later reclaims the full
    ///      escrowed amount (including fee) after settlement verification on the source chain.
    function fill(bytes32 orderId, bytes calldata originData, bytes calldata /* fillerData */ ) external override {
        // Decode the origin chain order parameters
        (, address token, uint256 amount, address destAddress, uint256 feeOffer) =
            abi.decode(originData, (bytes32, address, uint256, address, uint256));

        uint256 fillAmount = amount - feeOffer;

        // Pull tokens from the filler
        IERC20(token).safeTransferFrom(msg.sender, address(this), fillAmount);

        // Approve settler and execute the fill
        IERC20(token).forceApprove(address(settler), fillAmount);
        settler.fillOrder(orderId, destAddress, token, fillAmount);
    }
}
