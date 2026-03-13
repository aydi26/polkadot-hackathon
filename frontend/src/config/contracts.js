// ──────────────────── Chain Config ────────────────────
export const SOURCE_CHAIN_ID = 420420417; // Polkadot Hub Testnet
export const DEST_CHAIN_ID = 421614; // Default destination (Arbitrum Sepolia → Hyperliquid Testnet)

export const CHAINS = {
  // Source chain — Polkadot Hub Testnet
  source: { id: SOURCE_CHAIN_ID, name: "Polkadot Hub Testnet" },
  // Destination chain — Arbitrum Sepolia (→ Hyperliquid Testnet)
  destination: { id: DEST_CHAIN_ID, name: "Arbitrum Sepolia" },
  // Aliases
  assetHub: { id: SOURCE_CHAIN_ID, name: "Polkadot Hub Testnet" },
  arbSepolia: { id: 421614, name: "Arbitrum Sepolia" },
};

// ──────────────────── Multi-Destination Config ────────────────────
export const DEST_CHAINS = {
  421614: {
    id: 421614,
    name: "Arbitrum Sepolia",
    shortName: "Arb Sepolia",
    settlementMode: "tee",
    finalDestination: "Hyperliquid Testnet",
    estimatedTime: "~2s",
    classicTime: "~7min",
    settlerAddress:
      import.meta.env.VITE_SETTLER_421614 ||
      import.meta.env.VITE_INTENT_SETTLER_ADDRESS ||
      "0x0000000000000000000000000000000000000000",
    usdcAddress:
      import.meta.env.VITE_USDC_421614 ||
      import.meta.env.VITE_USDC_DEST_ADDRESS ||
      "0x1baAbB04529D43a73232B713C0FE471f7c7334d5",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
  },
};

// ──────────────────── Hyperliquid Bridge ────────────────────
export const HL_BRIDGE_ADDRESS = "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89";

// ──────────────────── Deployed Addresses ────────────────────
// TODO: replace with actual deployed addresses
export const INTENT_GATEWAY_ADDRESS =
  import.meta.env.VITE_INTENT_GATEWAY_ADDRESS ||
  "0x0000000000000000000000000000000000000000";

export const INTENT_SETTLER_ADDRESS =
  import.meta.env.VITE_INTENT_SETTLER_ADDRESS ||
  "0x0000000000000000000000000000000000000000";

export const USDC_SOURCE_ADDRESS =
  import.meta.env.VITE_USDC_SOURCE_ADDRESS ||
  "0x0000000000000000000000000000000000000000";

export const USDC_DEST_ADDRESS =
  import.meta.env.VITE_USDC_DEST_ADDRESS ||
  "0x0000000000000000000000000000000000000000";

// Alias for backward compatibility with BridgeWidget
export const USDC_ADDRESS = USDC_SOURCE_ADDRESS;

// ──────────────────── Protocol Constants ────────────────────
export const MIN_FEE_BPS = 5;
export const MAX_FEE_BPS = 100;
export const BPS_DENOMINATOR = 10000;
export const FILLER_WINDOW = 30; // seconds
export const MIN_ORDER_AMOUNT = 1_000_000; // 1 USDC in 6 decimals
export const MAX_ORDER_AMOUNT = 1_000_000_000_000; // 1M USDC

// ──────────────────── ABIs ────────────────────

export const INTENT_GATEWAY_ABI = [
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "destChain", type: "uint32" },
      { name: "destAddress", type: "address" },
      { name: "feeOffer", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    name: "createOrder",
    outputs: [{ name: "orderId", type: "bytes32" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "orderId", type: "bytes32" }],
    name: "executeFallback",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "orderId", type: "bytes32" }],
    name: "cancelOrder",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "orderId", type: "bytes32" }],
    name: "getOrder",
    outputs: [
      {
        components: [
          { name: "orderId", type: "bytes32" },
          { name: "user", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "destChain", type: "uint32" },
          { name: "destAddress", type: "address" },
          { name: "feeOffer", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getActiveOrders",
    outputs: [{ name: "", type: "bytes32[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserNonce",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "token", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "destChain", type: "uint32" },
      { indexed: false, name: "destAddress", type: "address" },
      { indexed: false, name: "feeOffer", type: "uint256" },
      { indexed: false, name: "deadline", type: "uint256" },
    ],
    name: "OrderPlaced",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: false, name: "user", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "destAddress", type: "address" },
    ],
    name: "FallbackExecuted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: false, name: "user", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
    name: "OrderCancelled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: false, name: "fillerAddress", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "EscrowReleased",
    type: "event",
  },
];

// Destination chain: read fill status
export const INTENT_SETTLER_ABI = [
  {
    inputs: [{ name: "orderId", type: "bytes32" }],
    name: "getFill",
    outputs: [
      {
        components: [
          { name: "orderId", type: "bytes32" },
          { name: "filler", type: "address" },
          { name: "recipient", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "fillTimestamp", type: "uint256" },
          { name: "settled", type: "bool" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getPendingSettlements",
    outputs: [{ name: "", type: "bytes32[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: true, name: "filler", type: "address" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "token", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "fillTimestamp", type: "uint256" },
    ],
    name: "OrderFilled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: true, name: "filler", type: "address" },
      { indexed: false, name: "proofHash", type: "bytes32" },
    ],
    name: "SettlementVerified",
    type: "event",
  },
];

export const ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

// ──────────────────── Order Status ────────────────────
export const OrderStatus = {
  None: 0,
  Pending: 1,
  Filled: 2,
  Settled: 3,
  Expired: 4,
  Cancelled: 5,
  Fallback: 6,
};

export const ORDER_STATUS_LABELS = {
  [OrderStatus.None]: "None",
  [OrderStatus.Pending]: "Pending",
  [OrderStatus.Filled]: "Filled",
  [OrderStatus.Settled]: "Settled",
  [OrderStatus.Expired]: "Expired",
  [OrderStatus.Cancelled]: "Cancelled",
  [OrderStatus.Fallback]: "Fallback",
};
