import "dotenv/config";

export const config = {
  // RPC endpoints
  rpcAssetHub: process.env.RPC_ASSET_HUB || "wss://asset-hub-polkadot-rpc.polkadot.io",
  rpcHyperEvm: process.env.RPC_HYPEREVM || "https://rpc.hyperliquid.xyz",

  // Filler wallet
  fillerPrivateKey: process.env.FILLER_PRIVATE_KEY || "",

  // Contract addresses
  intentGatewayAddress: process.env.INTENT_GATEWAY_ADDRESS || "",
  intentSettlerAddress: process.env.INTENT_SETTLER_ADDRESS || "",
  fillerRegistryAddress: process.env.FILLER_REGISTRY_ADDRESS || "",

  // USDC on HyperEVM
  usdcAddress: process.env.USDC_ADDRESS_HYPEREVM || "",

  // Filler parameters
  minProfitBps: Number(process.env.MIN_PROFIT_BPS || "3"),
  maxOrderAmount: BigInt(process.env.MAX_ORDER_AMOUNT || "50000000000"), // 50k USDC

  // Polling interval (ms)
  pollInterval: 2000,
} as const;

export function validateConfig(): void {
  const required = [
    "fillerPrivateKey",
    "intentGatewayAddress",
    "intentSettlerAddress",
    "usdcAddress",
  ] as const;

  for (const key of required) {
    if (!config[key]) {
      throw new Error(`Missing required config: ${key}`);
    }
  }
}
