// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {IntentGateway} from "../src/source/IntentGateway.sol";
import {IntentSettler} from "../src/destination/IntentSettler.sol";
import {FillerRegistry} from "../src/destination/FillerRegistry.sol";
import {FallbackReceiver} from "../src/destination/FallbackReceiver.sol";
import {ProofVerifier} from "../src/settlement/ProofVerifier.sol";
import {ISMPHandler} from "../src/settlement/ISMPHandler.sol";
import {BEEFYVerifier} from "../src/settlement/BEEFYVerifier.sol";

/// @title DeployTestnetSource - Deploy MockUSDC + IntentGateway on Polkadot Hub Testnet
/// @dev Usage: forge script script/DeployTestnet.s.sol:DeployTestnetSource --rpc-url $RPC_SOURCE --broadcast
contract DeployTestnetSource is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        // Deploy MockUSDC
        MockERC20 usdc = new MockERC20("Mock USDC", "USDC", 6);
        console2.log("MockUSDC deployed at:", address(usdc));

        // Mint 1M USDC to deployer (for testing)
        usdc.mint(deployer, 1_000_000e6);
        console2.log("Minted 1M USDC to deployer:", deployer);

        // Deploy IntentGateway (ismpHandler = deployer for testnet - allows markOrderFilled)
        IntentGateway gateway = new IntentGateway(deployer, deployer);
        gateway.addSupportedToken(address(usdc));
        console2.log("IntentGateway deployed at:", address(gateway));

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== SOURCE CHAIN (Polkadot Hub Testnet) - Copy these to .env ===");
        console2.log("USDC_SOURCE=", address(usdc));
        console2.log("INTENT_GATEWAY_ADDRESS=", address(gateway));
    }
}

/// @title DeployTestnetDest - Deploy destination contracts on HyperEVM Testnet
/// @dev Usage: forge script script/DeployTestnet.s.sol:DeployTestnetDest --rpc-url $RPC_DESTINATION --broadcast
/// @dev Set USDC_EXISTING=0x... to use an existing token (e.g. USDC2 on HyperEVM) instead of deploying MockUSDC
contract DeployTestnetDest is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        // Use existing USDC if provided (e.g. USDC2 on HyperEVM: 0x1baAbB04529D43a73232B713C0FE471f7c7334d5)
        // Otherwise deploy a new MockUSDC
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

        // Deploy IntentSettler (ismpHandler = deployer for testnet relay)
        IntentSettler settler = new IntentSettler(deployer, deployer);
        settler.addSupportedToken(usdcAddr);

        // Deploy FillerRegistry
        FillerRegistry registry = new FillerRegistry(deployer, usdcAddr);
        registry.setIntentSettler(address(settler));

        // Deploy FallbackReceiver
        FallbackReceiver fallbackReceiver = new FallbackReceiver(deployer, deployer);
        fallbackReceiver.setDeliveryToken(usdcAddr);

        // Configure
        ismpHandler.setAuthorizedDispatcher(address(settler), true);
        settler.setFillerRegistry(address(registry));

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== DESTINATION CHAIN (HyperEVM Testnet) - Copy these to .env ===");
        console2.log("USDC_DESTINATION=", usdcAddr);
        console2.log("INTENT_SETTLER_ADDRESS=", address(settler));
        console2.log("FILLER_REGISTRY_ADDRESS=", address(registry));
        console2.log("FALLBACK_RECEIVER_ADDRESS=", address(fallbackReceiver));
        console2.log("ISMP_HANDLER_ADDRESS=", address(ismpHandler));
        console2.log("PROOF_VERIFIER_ADDRESS=", address(proofVerifier));
        console2.log("BEEFY_VERIFIER_ADDRESS=", address(beefyVerifier));
    }
}
