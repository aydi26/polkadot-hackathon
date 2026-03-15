import "dotenv/config";
import type { TEEMode } from "./tee.js";

// ──────────────────── Per-Destination Chain Config ────────────────────
export interface DestChainConfig {
  chainId: number;
  name: string;
  rpc: string;
  intentSettlerAddress: string;
  fillerRegistryAddress: string;
  usdcAddress: string;
  settlementMode: "event-relay" | "ismp" | "tee";
  teeVerifierAddress: string;
  teeEnabled: boolean;
}

// Known destination chains
const KNOWN_DEST_CHAINS: Array<{ chainId: number; name: string; defaultRpc: string }> = [
  { chainId: 421614, name: "Arbitrum Sepolia", defaultRpc: "https://sepolia-rollup.arbitrum.io/rpc" },
];

function buildDestinations(): Record<number, DestChainConfig> {
  const destinations: Record<number, DestChainConfig> = {};

  for (const chain of KNOWN_DEST_CHAINS) {
    const prefix = `${chain.chainId}`;
    const rpc = process.env[`RPC_DEST_${prefix}`];
    const settler = process.env[`SETTLER_${prefix}`];
    const usdc = process.env[`USDC_DEST_${prefix}`];

    // Only add chain if at least settler address is configured
    if (settler) {
      const teeEnabled = process.env[`TEE_ENABLED_${prefix}`] === "true";
      destinations[chain.chainId] = {
        chainId: chain.chainId,
        name: chain.name,
        rpc: rpc || chain.defaultRpc,
        intentSettlerAddress: settler,
        fillerRegistryAddress: process.env[`REGISTRY_${prefix}`] || "",
        usdcAddress: usdc || "",
        settlementMode: (process.env[`MODE_${prefix}`] as "event-relay" | "ismp" | "tee") || "event-relay",
        teeVerifierAddress: process.env[`TEE_VERIFIER_${prefix}`] || "",
        teeEnabled,
      };
    }
  }

  // Backward compatibility: if no per-chain vars, use legacy flat vars for chain 421614
  if (Object.keys(destinations).length === 0) {
    const legacySettler = process.env.INTENT_SETTLER_ADDRESS;
    if (legacySettler) {
      destinations[421614] = {
        chainId: 421614,
        name: "Arbitrum Sepolia",
        rpc: process.env.RPC_DESTINATION || "https://sepolia-rollup.arbitrum.io/rpc",
        intentSettlerAddress: legacySettler,
        fillerRegistryAddress: process.env.FILLER_REGISTRY_ADDRESS || "",
        usdcAddress: process.env.USDC_ADDRESS_DESTINATION || process.env.USDC_DEST_ADDRESS || "",
        settlementMode: "event-relay",
        teeVerifierAddress: "",
        teeEnabled: false,
      };
    }
  }

  return destinations;
}

// ──────────────────── Main Config ────────────────────
export const config = {
  // Source chain (Polkadot Hub Testnet)
  rpcSource: process.env.RPC_SOURCE || "https://eth-rpc-testnet.polkadot.io/",

  // Filler wallet (same key used on all chains)
  fillerPrivateKey: process.env.FILLER_PRIVATE_KEY || process.env.PRIVATE_KEY || "",

  // Source chain contract
  intentGatewayAddress: process.env.INTENT_GATEWAY_ADDRESS || "",

  // Multi-destination config
  destinations: buildDestinations(),

  // Filler parameters
  minProfitBps: Number(process.env.MIN_PROFIT_BPS || "3"),
  maxOrderAmount: BigInt(process.env.MAX_ORDER_AMOUNT || "50000000000"), // 50k USDC

  // Polling interval (ms)
  pollInterval: 2000,

  // Auto-settlement configuration
  autoSettleDelayMs: Number(process.env.AUTO_SETTLE_DELAY_MS || "30000"), // 30s delay before auto-settling

  // PrivacyPool address (source chain)
  privacyPoolAddress: process.env.PRIVACY_POOL_ADDRESS || "",

  // TEE configuration (dstack / simulator / mock)
  teeMode: (process.env.TEE_MODE || "mock") as TEEMode,
  teeEndpoint: process.env.TEE_ENDPOINT || "", // simulator: http://localhost:8090
  teePrivateKey: process.env.TEE_PRIVATE_KEY || "", // mock mode only
  teeAutoSettleDelayMs: Number(process.env.TEE_AUTO_SETTLE_DELAY_MS || "5000"), // 5s for TEE fast path

  // Retry configuration
  maxRetries: Number(process.env.MAX_RETRIES || "3"),
  retryDelayMs: Number(process.env.RETRY_DELAY_MS || "5000"), // 5s initial delay
} as const;

// ──────────────────── Helpers ────────────────────

export function getDestConfig(chainId: number): DestChainConfig {
  const dest = config.destinations[chainId];
  if (!dest) throw new Error(`No destination config for chain ${chainId}`);
  return dest;
}

export function getSupportedDestChains(): number[] {
  return Object.keys(config.destinations).map(Number);
}

export function validateConfig(): void {
  if (!config.fillerPrivateKey) {
    throw new Error("Missing required config: fillerPrivateKey (FILLER_PRIVATE_KEY or PRIVATE_KEY)");
  }
  if (!config.intentGatewayAddress) {
    throw new Error("Missing required config: intentGatewayAddress (INTENT_GATEWAY_ADDRESS)");
  }

  const destChains = getSupportedDestChains();
  if (destChains.length === 0) {
    throw new Error("No destination chains configured. Set SETTLER_421614 or INTENT_SETTLER_ADDRESS.");
  }

  for (const chainId of destChains) {
    const dest = config.destinations[chainId];
    if (!dest.intentSettlerAddress) {
      throw new Error(`Missing settler address for chain ${chainId}`);
    }
    if (!dest.usdcAddress) {
      throw new Error(`Missing USDC address for chain ${chainId}`);
    }
  }
}
