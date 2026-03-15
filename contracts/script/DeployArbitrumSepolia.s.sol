// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {IntentSettler} from "../src/destination/IntentSettler.sol";
import {FillerRegistry} from "../src/destination/FillerRegistry.sol";
import {ProofVerifier} from "../src/settlement/ProofVerifier.sol";
import {ISMPHandler} from "../src/settlement/ISMPHandler.sol";
import {BEEFYVerifier} from "../src/settlement/BEEFYVerifier.sol";

/// @title DeployArbitrumSepolia - Deploy all destination contracts on Arbitrum Sepolia
/// @dev Usage: forge script script/DeployArbitrumSepolia.s.sol --rpc-url $RPC_ARBITRUM_SEPOLIA --broadcast
/// @dev Hyperbridge IsmpHost on Arbitrum Sepolia: 0x3435bD7e5895356535459D6087D1eB982DAd90e7
contract DeployArbitrumSepolia is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        // Use real Hyperbridge IsmpHost if available, otherwise deployer (event-relay mode)
        address ismpHost = vm.envOr("ISMP_HOST_ADDRESS", deployer);

        vm.startBroadcast(pk);

        // Use existing USDC if provided, otherwise deploy MockUSDC
        address usdcAddr = vm.envOr("USDC_EXISTING", address(0));
        if (usdcAddr != address(0)) {
            console2.log("Using existing USDC at:", usdcAddr);
        } else {
            MockERC20 mockUsdc = new MockERC20("Mock USDC", "USDC", 6);
            usdcAddr = address(mockUsdc);
            console2.log("MockUSDC deployed at:", usdcAddr);
            mockUsdc.mint(deployer, 1_000_000e6);
            console2.log("Minted 1M USDC to deployer:", deployer);
        }

        // Deploy ISMPHandler
        ISMPHandler ismpHandler = new ISMPHandler(deployer);

        // Deploy BEEFYVerifier
        BEEFYVerifier beefyVerifier = new BEEFYVerifier(2);

        // Deploy ProofVerifier
        ProofVerifier proofVerifier = new ProofVerifier(address(ismpHandler));

        // Deploy IntentSettler
        // ismpHandler = deployer for event-relay mode, or real IsmpHost for ISMP mode
        IntentSettler settler = new IntentSettler(deployer, ismpHost);
        settler.addSupportedToken(usdcAddr);

        // Deploy FillerRegistry
        FillerRegistry registry = new FillerRegistry(deployer, usdcAddr);
        registry.setIntentSettler(address(settler));

        // Configure
        ismpHandler.setAuthorizedDispatcher(address(settler), true);
        settler.setFillerRegistry(address(registry));

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== DESTINATION CHAIN (Arbitrum Sepolia 421614) - Copy these to .env ===");
        console2.log("USDC_DEST_421614=", usdcAddr);
        console2.log("SETTLER_421614=", address(settler));
        console2.log("REGISTRY_421614=", address(registry));
        console2.log("ISMP_HANDLER_421614=", address(ismpHandler));
        console2.log("PROOF_VERIFIER_421614=", address(proofVerifier));
        console2.log("BEEFY_VERIFIER_421614=", address(beefyVerifier));
        console2.log("");
        console2.log("ISMP Host used:", ismpHost);
        if (ismpHost == deployer) {
            console2.log("MODE: event-relay (deployer as ismpHandler)");
        } else {
            console2.log("MODE: real ISMP (Hyperbridge IsmpHost)");
        }
    }
}
