// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TEEVerifier} from "../src/settlement/TEEVerifier.sol";
import {IntentSettler} from "../src/destination/IntentSettler.sol";

/// @title DeployTEEVerifier - Deploy TEEVerifier and configure on existing IntentSettler
/// @dev Run after DeployArbitrumSepolia. Requires SETTLER_421614 in .env
contract DeployTEEVerifier is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address settlerAddr = vm.envAddress("SETTLER_421614");

        vm.startBroadcast(pk);

        // Deploy TEEVerifier
        TEEVerifier teeVerifier = new TEEVerifier();

        // Add trusted enclave: use TEE_ENCLAVE_ADDRESS if set (dstack-derived wallet),
        // otherwise fall back to deployer (for testnet mock TEE signing)
        address enclaveAddr = vm.envOr("TEE_ENCLAVE_ADDRESS", deployer);
        teeVerifier.addTrustedEnclave(enclaveAddr);

        // Configure TEEVerifier on IntentSettler
        IntentSettler settler = IntentSettler(settlerAddr);
        settler.setTEEVerifier(address(teeVerifier));

        vm.stopBroadcast();

        console2.log("=== TEE Verifier Deployment ===");
        console2.log("TEEVerifier deployed at:", address(teeVerifier));
        console2.log("Trusted enclave:", enclaveAddr);
        console2.log("Configured on settler:", settlerAddr);
        console2.log("");
        console2.log("TEE_VERIFIER_421614=", address(teeVerifier));
    }
}
