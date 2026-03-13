// SPDX-License-Identifier: MIT
// NOTE: Script name is historical — deploys to Arbitrum Sepolia (destination chain)
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IntentSettler} from "../src/destination/IntentSettler.sol";
import {FillerRegistry} from "../src/destination/FillerRegistry.sol";
import {FallbackReceiver} from "../src/destination/FallbackReceiver.sol";
import {ProofVerifier} from "../src/settlement/ProofVerifier.sol";
import {ISMPHandler} from "../src/settlement/ISMPHandler.sol";
import {BEEFYVerifier} from "../src/settlement/BEEFYVerifier.sol";
import {TEEVerifier} from "../src/settlement/TEEVerifier.sol";

/// @title DeployHyperEVM - Deploy all destination contracts (Arbitrum Sepolia)
/// @dev Destination chain: Arbitrum Sepolia (chain ID 421614) → Hyperliquid Testnet
contract DeployHyperEVM is Script {
    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address usdc = vm.envAddress("USDC_DESTINATION_ADDRESS");

        vm.startBroadcast();

        // 1. Deploy ISMP Handler
        ISMPHandler ismpHandler = new ISMPHandler(deployer);
        console2.log("ISMPHandler deployed at:", address(ismpHandler));

        // 2. Deploy BEEFY Verifier (threshold = 2 for testnet)
        BEEFYVerifier beefyVerifier = new BEEFYVerifier(2);
        console2.log("BEEFYVerifier deployed at:", address(beefyVerifier));

        // 2b. Deploy TEE Verifier (Phala Network attestation verification)
        TEEVerifier teeVerifier = new TEEVerifier();
        teeVerifier.addTrustedEnclave(deployer); // deployer as trusted enclave for testnet
        console2.log("TEEVerifier deployed at:", address(teeVerifier));

        // 3. Deploy Proof Verifier
        ProofVerifier proofVerifier = new ProofVerifier(address(ismpHandler));
        console2.log("ProofVerifier deployed at:", address(proofVerifier));

        // 4. Deploy IntentSettler
        IntentSettler settler = new IntentSettler(deployer, address(ismpHandler));
        settler.addSupportedToken(usdc);
        console2.log("IntentSettler deployed at:", address(settler));

        // 5. Deploy FillerRegistry
        FillerRegistry registry = new FillerRegistry(deployer, usdc);
        registry.setIntentSettler(address(settler));
        console2.log("FillerRegistry deployed at:", address(registry));

        // 6. Deploy FallbackReceiver
        FallbackReceiver fallbackReceiver = new FallbackReceiver(deployer, address(ismpHandler));
        fallbackReceiver.setDeliveryToken(usdc);
        console2.log("FallbackReceiver deployed at:", address(fallbackReceiver));

        // 7. Configure ISMP Handler
        ismpHandler.setAuthorizedDispatcher(address(settler), true);

        // 8. Configure settler with registry and TEE verifier
        settler.setFillerRegistry(address(registry));
        settler.setTEEVerifier(address(teeVerifier));

        console2.log("=== Destination Chain Deployment Complete ===");

        vm.stopBroadcast();
    }
}
