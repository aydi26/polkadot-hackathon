// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IntentGateway} from "../src/source/IntentGateway.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

/// @title DeployAssetHub - Deploy IntentGateway on source chain (Polkadot Hub Testnet)
/// @dev If USDC_ADDRESS is not set, deploys a MockUSDC automatically
contract DeployAssetHub is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address usdc = vm.envOr("USDC_ADDRESS", address(0));
        address ismpHandler = vm.envOr("ISMP_HANDLER_ADDRESS", address(0));

        vm.startBroadcast(pk);

        // Deploy MockUSDC if no existing address provided
        if (usdc == address(0)) {
            MockERC20 mockUsdc = new MockERC20("Mock USDC", "USDC", 6);
            usdc = address(mockUsdc);
            // Mint 1M USDC to deployer for testing
            mockUsdc.mint(deployer, 1_000_000e6);
            console2.log("MockUSDC deployed at:", usdc);
        }

        IntentGateway gateway = new IntentGateway(deployer, ismpHandler);
        gateway.addSupportedToken(usdc);

        console2.log("=== Source Chain (Polkadot Hub Testnet) Deployment ===");
        console2.log("IntentGateway deployed at:", address(gateway));
        console2.log("USDC whitelisted:", usdc);
        console2.log("ISMP handler:", ismpHandler);
        console2.log("Deployer:", deployer);

        vm.stopBroadcast();
    }
}
