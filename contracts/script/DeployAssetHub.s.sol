// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IntentGateway} from "../src/source/IntentGateway.sol";

/// @title DeployAssetHub - Deploy IntentGateway on source chain (Sepolia)
/// @dev For hackathon: deploying on Sepolia as source chain (Asset Hub stand-in)
///      In production: deploy on Polkadot Asset Hub EVM
contract DeployAssetHub is Script {
    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address ismpHandler = vm.envOr("ISMP_HANDLER_ADDRESS", address(0));

        vm.startBroadcast();

        IntentGateway gateway = new IntentGateway(deployer, ismpHandler);
        gateway.addSupportedToken(usdc);

        console2.log("=== Source Chain (Sepolia) Deployment ===");
        console2.log("IntentGateway deployed at:", address(gateway));
        console2.log("USDC whitelisted:", usdc);
        console2.log("ISMP handler:", ismpHandler);

        vm.stopBroadcast();
    }
}
