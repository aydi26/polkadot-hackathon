// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntentGateway} from "../src/source/IntentGateway.sol";
import {IntentSettler} from "../src/destination/IntentSettler.sol";
import {FallbackReceiver} from "../src/destination/FallbackReceiver.sol";
import {FillerRegistry} from "../src/destination/FillerRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {Constants} from "../src/libs/Constants.sol";
import {
    IncomingPostRequest,
    PostRequest,
    BridgeMessage,
    BridgeMessageCodec,
    MessageType
} from "../src/interfaces/IISMPBridge.sol";

/// @title AccessControl - Tests access restrictions on all contracts
contract AccessControlTest is Test {
    IntentGateway public gateway;
    IntentSettler public settler;
    FallbackReceiver public fallbackReceiver;
    FillerRegistry public registry;
    MockERC20 public usdc;

    address public owner = makeAddr("owner");
    address public ismpHost = makeAddr("ismpHost");
    address public attacker = makeAddr("attacker");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        gateway = new IntentGateway(owner, ismpHost);
        settler = new IntentSettler(owner, ismpHost);
        fallbackReceiver = new FallbackReceiver(owner, ismpHost);
        registry = new FillerRegistry(owner, address(usdc));
    }

    // ──────────────────── IntentGateway.markOrderFilled ────────────────────

    function test_markOrderFilled_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert("Unauthorized");
        gateway.markOrderFilled(keccak256("order"));
    }

    function test_markOrderFilled_owner_isRelayer() public {
        // Owner is default relayer, so auth passes but order doesn't exist → "Order not pending"
        vm.prank(owner);
        vm.expectRevert("Order not pending");
        gateway.markOrderFilled(keccak256("order"));
    }

    // ──────────────────── IntentGateway.onAccept ────────────────────

    function test_gateway_onAccept_revert_notIsmpHost() public {
        PostRequest memory req = _makePostRequest(keccak256("order"), address(0), 0, MessageType.FILL_CONFIRMATION);
        IncomingPostRequest memory incoming = IncomingPostRequest({request: req, relayer: attacker});

        vm.prank(attacker);
        vm.expectRevert("Only ISMP host");
        gateway.onAccept(incoming);
    }

    // ──────────────────── IntentSettler.onAccept ────────────────────

    function test_settler_onAccept_revert_notIsmpHost() public {
        PostRequest memory req =
            _makePostRequest(keccak256("order"), address(0), 0, MessageType.SETTLEMENT_RELEASE);
        IncomingPostRequest memory incoming = IncomingPostRequest({request: req, relayer: attacker});

        vm.prank(attacker);
        vm.expectRevert("Only ISMP host");
        settler.onAccept(incoming);
    }

    // ──────────────────── FallbackReceiver.onAccept ────────────────────

    function test_fallbackReceiver_onAccept_revert_notIsmpHost() public {
        PostRequest memory req =
            _makePostRequest(keccak256("order"), address(0), 0, MessageType.FALLBACK_DELIVERY);
        IncomingPostRequest memory incoming = IncomingPostRequest({request: req, relayer: attacker});

        vm.prank(attacker);
        vm.expectRevert("Only ISMP host");
        fallbackReceiver.onAccept(incoming);
    }

    function test_fallbackReceiver_receiveFallbackFunds_revert_notIsmpHandler() public {
        vm.prank(attacker);
        vm.expectRevert("Only ISMP handler");
        fallbackReceiver.receiveFallbackFunds(keccak256("order"), attacker, address(usdc), 100e6);
    }

    // ──────────────────── FillerRegistry.recordFill ────────────────────

    function test_recordFill_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert("Only IntentSettler");
        registry.recordFill(attacker);
    }

    function test_recordSettlement_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert("Only IntentSettler");
        registry.recordSettlement(attacker);
    }

    function test_recordFill_works_fromIntentSettler() public {
        address intentSettler = makeAddr("settler");
        vm.prank(owner);
        registry.setIntentSettler(intentSettler);

        // Register a filler first
        usdc.mint(address(this), 1000e6);
        usdc.approve(address(registry), 1000e6);
        registry.register(1000e6);

        // Now settler can record fills
        vm.prank(intentSettler);
        registry.recordFill(address(this));
    }

    // ──────────────────── Helper ────────────────────

    function _makePostRequest(bytes32 orderId, address filler, uint256 amount, MessageType msgType)
        internal
        pure
        returns (PostRequest memory)
    {
        BridgeMessage memory bridgeMsg =
            BridgeMessage({orderId: orderId, filler: filler, amount: amount, msgType: msgType});

        return PostRequest({
            source: bytes("EVM-420420417"),
            dest: bytes("EVM-998"),
            nonce: 1,
            from: bytes(""),
            to: bytes(""),
            timeoutTimestamp: 999999,
            body: BridgeMessageCodec.encode(bridgeMsg)
        });
    }
}
