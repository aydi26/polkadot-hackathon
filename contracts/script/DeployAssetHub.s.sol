// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IntentGateway} from "../src/source/IntentGateway.sol";

/// @title DeployAssetHub - Deploy IntentGateway on Asset Hub (or EVM testnet)
contract DeployAssetHub is Script {
    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address ismpHandler = vm.envAddress("ISMP_HANDLER_ADDRESS");

        vm.startBroadcast();

        IntentGateway gateway = new IntentGateway(deployer, ismpHandler);
        gateway.addSupportedToken(usdc);

        console2.log("IntentGateway deployed at:", address(gateway));
        console2.log("USDC whitelisted:", usdc);

        vm.stopBroadcast();
    }
}
