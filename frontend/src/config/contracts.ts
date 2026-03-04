import { type Abi } from "viem";

// ──────────────────── Chain Configuration ────────────────────

export const CHAINS = {
  assetHub: {
    id: 1000,
    name: "Polkadot Asset Hub",
    rpcUrl: "wss://asset-hub-polkadot-rpc.polkadot.io",
  },
  hyperEvm: {
    id: 999,
    name: "HyperEVM",
    rpcUrl: "https://rpc.hyperliquid.xyz",
  },
} as const;

// ──────────────────── Contract Addresses ────────────────────
// TODO: Update with deployed contract addresses

export const CONTRACTS = {
  intentGateway: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  intentSettler: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  fillerRegistry: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  fallbackReceiver: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  usdc: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  usdcHyperEvm: "0x0000000000000000000000000000000000000000" as `0x${string}`,
} as const;

// ──────────────────── ABIs ────────────────────

export const INTENT_GATEWAY_ABI = [
  {
    type: "function",
    name: "createOrder",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "destChain", type: "uint32" },
      { name: "destAddress", type: "address" },
      { name: "feeOffer", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "orderId", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelOrder",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getOrder",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
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
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getActiveOrders",
    inputs: [],
    outputs: [{ name: "", type: "bytes32[]" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "OrderPlaced",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "destChain", type: "uint32", indexed: false },
      { name: "destAddress", type: "address", indexed: false },
      { name: "feeOffer", type: "uint256", indexed: false },
      { name: "deadline", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EscrowReleased",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "fillerAddress", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FallbackExecuted",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "destAddress", type: "address", indexed: false },
    ],
  },
] as const satisfies Abi;

export const INTENT_SETTLER_ABI = [
  {
    type: "function",
    name: "fillOrder",
    inputs: [
      { name: "orderId", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getFill",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "orderId", type: "bytes32" },
          { name: "filler", type: "address" },
          { name: "recipient", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "fillTimestamp", type: "uint256" },
          { name: "settled", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "OrderFilled",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "filler", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "fillTimestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SettlementVerified",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "filler", type: "address", indexed: true },
      { name: "proofHash", type: "bytes32", indexed: false },
    ],
  },
] as const satisfies Abi;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const satisfies Abi;

// ──────────────────── Order Status ────────────────────

export enum OrderStatus {
  None = 0,
  Pending = 1,
  Filled = 2,
  Settled = 3,
  Expired = 4,
  Cancelled = 5,
  Fallback = 6,
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.None]: "Unknown",
  [OrderStatus.Pending]: "Pending",
  [OrderStatus.Filled]: "Filled",
  [OrderStatus.Settled]: "Settled",
  [OrderStatus.Expired]: "Expired",
  [OrderStatus.Cancelled]: "Cancelled",
  [OrderStatus.Fallback]: "Fallback Bridge",
};
