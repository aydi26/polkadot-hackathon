# Velora

Intent-based cross-chain bridge: **Polkadot Hub → Arbitrum Sepolia → Hyperliquid Testnet**. Two modes: **Instant Bridge** (~2s via fillers) and **Classic Bridge** (~6-8min trustless). Three-layer settlement: TEE fast path (Phala dstack, ~5-10s), ZK BEEFY fallback (~6-8min), and classic trustless bridge. **All deposits are anonymous** — destination addresses are ECIES-encrypted and only decryptable inside the TEE.

## How It Works

Users lock USDC in escrow on the source chain and express an **intent** to receive funds on the destination chain. **All orders are private by default** — the destination address is encrypted with the TEE's public key before being stored on-chain.

- A TEE filler running inside a Phala dstack CVM (Intel TDX) fronts the funds immediately (~2s). The TEE decrypts the destination address, fills the order using an unlinkable `fillId` on the destination chain, and settles via TEE attestation (~5-10s). No on-chain link between source and destination.
- **Standardized amounts**: 6, 7, 8, 9, or 10 USDC — prevents amount-based correlation.
- **Delivery delay**: Users choose when funds arrive on Hyperliquid (instant, 15min, 30min, 1 hour) — breaks timing correlation.
- **Route**: Polkadot Hub → Arbitrum Sepolia → Hyperliquid Testnet. The frontend **automatically deposits** to Hyperliquid Testnet via the official bridge after the chosen delay.

## Privacy by Default

All deposits are anonymous. The privacy layer has three components:

1. **Encrypted destination address** — The frontend ECIES-encrypts the recipient address with the TEE's secp256k1 public key before storing on-chain. On the source chain, only an opaque ciphertext is visible — no one can see where the funds are going.

2. **Unlinkable fill IDs** — The TEE generates a `fillId = keccak256(sourceOrderId, teeSecret)` for the destination chain. The `sourceOrderId` on Polkadot Hub and the `fillId` on Arbitrum Sepolia cannot be linked without knowing the TEE secret.

3. **TEE-derived anonymous wallet** — The filler runs inside a Phala dstack CVM (Intel TDX). Its wallet is derived deterministically via `deriveKey()` — an anonymous intermediary that processes all fills.

```
User (Polkadot Hub)           TEE Filler (dstack CVM)         Hyperliquid
     │                              │                              │
     │  1. Lock USDC + encrypted    │                              │
     │     dest (ECIES blob)        │                              │
     │  ──────────────────────►     │                              │
     │                              │  2. Decrypt dest inside TEE  │
     │                              │  3. Generate unlinkable      │
     │                              │     fillId for dest chain    │
     │                              │  4. Fill with TEE wallet     │
     │                              │  5. Deposit to HL Bridge2    │
     │                              │  ───────────────────────►    │
     │                              │    (no link to user)         │
```

- Source chain: `PrivateOrderPlaced(sourceOrderId, encryptedDest)` — destination hidden
- Dest chain: `OrderFilled(fillId, recipient)` — different ID, no cross-chain link
- TDX attestation proves correct execution without revealing the mapping

## Architecture

```
Source Chain (Polkadot Hub)                 Destination Chain (Arbitrum Sepolia)
+---------------------------+               +---------------------------+
| IntentGateway             |               | IntentSettler             |
|  - createPrivateOrder()   |               |  - fillOrder(fillId)      |
|  - releaseEscrow()        |  ISMP/Relay   |  - verifyTEESettlement()  |
|  - executeFallback()      | <-----------> |  - verifySettlement()     |
|  - cancelOrder()          |               |                           |
|  - IIsmpModule.onAccept() |               | TEEVerifier (dstack)      |
+---------------------------+               |  - verifyAttestation()    |
                                            |  - TDX quote recording   |
                                            | BEEFYVerifier (fallback)  |
                                            | FallbackReceiver          |
                                            |  - receiveFallbackFunds() |
                                            | FillerRegistry            |
                                            |  - register/stake/slash   |
                                            +---------------------------+
                                                       |
                                            Hyperliquid Testnet (official bridge)

Settlement: TEE fast path (dstack, ~5-10s) > ZK BEEFY fallback (~6-8min)
ERC-7683:   ERC7683OriginAdapter + ERC7683DestinationAdapter
```

## Project Structure

```
velora/
  contracts/       Solidity smart contracts (Foundry)
  filler/          TypeScript filler service (ethers v6 + @phala/dstack-sdk)
  frontend/        React + Vite + wagmi frontend
  POLKADOT.md      Detailed protocol documentation (FR)
```

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, cast)
- Node.js >= 18
- Docker (for dstack simulator)
- Git

### Contracts

```bash
cd contracts
forge install
forge build
forge test -vvv
```

90+ tests covering: unit, fuzz, ISMP integration, TEE verification, TDX quote recording, private orders, access control, end-to-end flows.

### Filler Service

```bash
cd filler
npm install
cp .env.example .env   # Fill in RPC endpoints, private key, contract addresses
npm run build
npm start
```

The filler service watches for `OrderPlaced` events, fills profitable orders with retry logic, auto-settles fills via TEE attestation, and includes a cross-chain relay simulator for testnet.

**TEE modes** (set `TEE_MODE` in .env):
- `mock` — Local signing with `TEE_PRIVATE_KEY` (default, no dstack needed)
- `simulator` — dstack simulator for local dev: `docker compose up`
- `dstack` — Production CVM deployment via Phala Cloud

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # Fill in contract addresses
npm run dev            # http://localhost:5173
```

## Testnet Deployment

The bridge deploys on **Polkadot Hub Testnet** (source, chain 420420417) + **Arbitrum Sepolia** (destination, chain 421614).

```bash
cd contracts
cp .env.example .env   # Fill PRIVATE_KEY, RPC_SOURCE, RPC_DESTINATION

# Deploy source contracts (Polkadot Hub Testnet — requires Foundry nightly)
foundryup --version nightly
forge script script/DeployAssetHub.s.sol --chain polkadot-testnet --rpc-url https://eth-rpc-testnet.polkadot.io/ --broadcast

# Deploy destination contracts (Arbitrum Sepolia)
forge script script/DeployArbitrumSepolia.s.sol --rpc-url https://sepolia-rollup.arbitrum.io/rpc --broadcast

# Deploy TEE verifier (set TEE_ENCLAVE_ADDRESS to dstack-derived wallet address)
forge script script/DeployTEEVerifier.s.sol --rpc-url https://sepolia-rollup.arbitrum.io/rpc --broadcast
```

USDC2 on Arbitrum Sepolia: `0x1baAbB04529D43a73232B713C0FE471f7c7334d5` — compatible with the official Hyperliquid Testnet bridge for deposit.

Hyperliquid Bridge2 (Arb Sepolia): `0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89` — deposit via `USDC2.transfer(bridge, amount)`. Validators credit on Hyperliquid in <1 min. Minimum 5 USDC.

## Smart Contracts

| Contract | Chain | Description |
|----------|-------|-------------|
| IntentGateway | Source | Escrow, createPrivateOrder (ECIES encrypted dest), TEE pubkey storage |
| IntentSettler | Dest | Fill orders with unlinkable fillId, TEE settlement verification |
| FillerRegistry | Dest | Filler staking, reputation |
| TEEVerifier | Dest | Phala dstack TEE attestation + TDX quote verification (~5-10s) |
| ISMPHandler | Dest | ISMP dispatch with real DispatchPost types |
| ERC7683Adapter | Both | ERC-7683 IOriginSettler + IDestinationSettler wrappers |
| OrderLib | Lib | Order encoding, computePrivateOrderId, status transitions |
| FeeCalculator | Lib | Dynamic fee calculation |

## Filler Service

| Module | Description |
|--------|-------------|
| watcher | Listens for OrderPlaced events on source chain |
| executor | Fills orders on destination chain with exponential backoff retry |
| settler | Dual-chain auto-settlement: TEE fast path or BEEFY fallback + releaseEscrow (source) |
| tee | Phala dstack TEE client: wallet derivation, TDX attestation, ECIES decryption, fillId generation |
| relay | Cross-chain relay simulator for testnet (markOrderFilled after fill detection) |
| state | Full lifecycle tracking: DETECTED -> FILLING -> FILLED -> SETTLING -> SETTLED -> RELEASED |
| pricing | Fee evaluation and profitability analysis |
| config | Chain configuration, RPC endpoints, multi-dest support |

## Key Technologies

- **TEE (Phala dstack)** — Anonymous fast settlement via Confidential VMs (Intel TDX) with deterministic key derivation and TDX attestation quotes (~5-10s)
- **ECIES Encryption** — secp256k1 ECIES encryption of destination addresses (eciesjs)
- **Hyperbridge / ISMP** — Trustless cross-chain messaging via state proofs
- **ERC-7683** — Cross-chain intents standard compatibility
- **OpenZeppelin 5.x** — Battle-tested contract primitives (ReentrancyGuard, Pausable, SafeERC20)

## References

- [Phala dstack](https://github.com/Phala-Network/dstack)
- [ERC-7683 Cross-Chain Intents](https://eips.ethereum.org/EIPS/eip-7683)
- [Hyperbridge Documentation](https://docs.hyperbridge.network)
- [ISMP Protocol](https://docs.hyperbridge.network/protocol/ismp)
- [Polkadot BEEFY](https://wiki.polkadot.network/docs/learn-beefy)
- [XCM v5](https://wiki.polkadot.network/docs/learn-xcm)

## License

MIT
