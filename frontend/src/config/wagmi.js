import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";

// Polkadot Hub Testnet (Paseo Asset Hub)
export const polkadotHubTestnet = defineChain({
  id: 420420417,
  name: "Polkadot Hub Testnet",
  nativeCurrency: { name: "Paseo", symbol: "PAS", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://eth-rpc-testnet.polkadot.io/"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://blockscout-testnet.polkadot.io" },
  },
  testnet: true,
});

// Arbitrum Sepolia
export const arbitrumSepolia = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] },
  },
  blockExplorers: {
    default: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" },
  },
  testnet: true,
});

// Polkadot Hub Testnet = source chain
// Arbitrum Sepolia = destination chain (→ Hyperliquid Testnet via official bridge)
export const config = createConfig({
  chains: [polkadotHubTestnet, arbitrumSepolia],
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  transports: {
    [polkadotHubTestnet.id]: http("https://eth-rpc-testnet.polkadot.io/"),
    [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
  },
});
