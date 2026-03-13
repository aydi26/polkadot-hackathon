// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IntentGateway} from "../src/source/IntentGateway.sol";
import {IntentSettler} from "../src/destination/IntentSettler.sol";
import {ISMPHandler} from "../src/settlement/ISMPHandler.sol";

/// @title ConfigureCrossChain - Post-deployment cross-chain configuration
/// @dev Run this after deploying both source and destination contracts
///      Sets up the cross-chain references between the two chains
contract ConfigureCrossChain is Script {
    function run() external {
        // Source chain addresses
        address gatewayAddr = vm.envAddress("INTENT_GATEWAY_ADDRESS");

        // Destination chain addresses
        address settlerAddr = vm.envAddress("INTENT_SETTLER_ADDRESS");
        address ismpHandlerAddr = vm.envAddress("ISMP_HANDLER_ADDRESS");

        // Chain IDs for ISMP routing
        uint256 sourceChainId = vm.envOr("SOURCE_CHAIN_ID", uint256(420420417)); // Polkadot Hub Testnet
        uint256 destChainId = vm.envOr("DEST_CHAIN_ID", uint256(421614)); // Arbitrum Sepolia

        console2.log("=== Cross-Chain Configuration ===");
        console2.log("Source chain ID:", sourceChainId);
        console2.log("Dest chain ID:", destChainId);
        console2.log("Gateway:", gatewayAddr);
        console2.log("Settler:", settlerAddr);
        console2.log("ISMPHandler:", ismpHandlerAddr);

        vm.startBroadcast();

        // Configure ISMP handler with correct chain IDs
        ISMPHandler handler = ISMPHandler(ismpHandlerAddr);
        handler.setChainIds(sourceChainId, destChainId);

        console2.log("Chain IDs configured on ISMPHandler");
        console2.log("=== Configuration Complete ===");

        vm.stopBroadcast();
    }
}
