# Velora

Privacy-first intent-based cross-chain bridge: **Polkadot Hub → Arbitrum Sepolia → Hyperliquid Testnet**. All deposits are anonymous by default — destination addresses are ECIES-encrypted and only decryptable inside the TEE. Settlement via TEE attestation (Phala dstack, Intel TDX, ~5-10s).

## How It Works

Users deposit USDC into a **PrivacyPool** (mixing contract on Polkadot Hub) with an encrypted destination and encrypted withdrawal secret. A TEE filler running inside a **Phala dstack CVM** (Intel TDX) decrypts the secret, triggers the withdrawal, creates a private order on IntentGateway, fills it with an unlinkable `fillId` on Arbitrum Sepolia, and deposits the funds to Hyperliquid Testnet via a single-use fresh wallet.

- **Standardized amounts**: 6, 7, 8, 9, or 10 USDC — prevents amount-based correlation.
- **Delivery delay**: Users choose a privacy lock duration (instant, 15s, 30s, 1 min, or custom up to 1h) — breaks timing correlation.
- **Route**: Polkadot Hub → Arbitrum Sepolia → Hyperliquid Testnet. The TEE filler automatically deposits to Hyperliquid via the official bridge after filling.
- **TEE-only settlement**: No fallback mechanism — the TEE filler is required for all operations.

## Privacy by Default

All deposits are anonymous. The privacy model has 6 layers:

| Layer | Mechanism | Protection |
|-------|-----------|------------|
| **1. PrivacyPool mixing** | Time-locked mixing contract on Polkadot Hub | Order created by pool (user = PrivacyPool, not the user) |
| **2. Encrypted destination** | ECIES secp256k1 with TEE public key | Destination address is an opaque blob on-chain |
| **3. Encrypted secret** | ECIES secp256k1 with TEE public key | Withdrawal secret encrypted — only TEE can trigger withdraw |
| **4. Unlinkable fillId** | `keccak256(sourceOrderId, teeSecret)` | No on-chain link between source and destination chains |
| **5. TEE anonymous wallet** | Wallet derived inside dstack enclave | All fills + withdrawals go through the same intermediary |
| **6. Standardized amounts** | 6, 7, 8, 9, 10 USDC | Prevents correlation by unique amount |

```
User (Polkadot Hub)              TEE Filler (dstack CVM)         Hyperliquid
     │                                │                              │
     │  1. Deposit USDC + encrypted   │                              │
     │     dest + secret to Pool      │                              │
     │  ──────────────────────►       │                              │
     │                                │  2. Decrypt secret inside TEE│
     │                                │  3. Trigger pool withdraw    │
     │                                │  4. Decrypt dest, gen fillId │
     │                                │  5. Fill via fresh wallet    │
     │                                │  6. Bridge to HL via Bridge2 │
     │                                │  ───────────────────────►    │
     │                                │  7. usdSend to destination   │
     │                                │    (no link to user)         │
```

- Source chain: `PrivacyDeposit(commitmentHash, amount)` — no user address in event
- Source chain: `PrivateOrderPlaced(orderId, user=PrivacyPool)` — user is the pool contract
- Dest chain: `OrderFilled(fillId, recipient)` — different ID, no cross-chain link
- TDX attestation proves correct execution without revealing the mapping

## Architecture

```
Source Chain (Polkadot Hub)                Destination Chain (Arbitrum Sepolia)
+---------------------------+              +---------------------------+
| PrivacyPool               |              | IntentSettler             |
|  - deposit()              |              |  - fillOrder(fillId)      |
|  - withdraw() [TEE only]  |              |  - verifyTEESettlement()  |
|                           |              |                           |
| DepositRouter             |              | TEEVerifier (dstack)      |
|  - deposit() [proxy]      |              |  - verifyAttestation()    |
|                           |              |  - TDX quote recording    |
| IntentGateway             |              |                           |
|  - createPrivateOrder()   |  TEE Relay   | FillerRegistry            |
|  - releaseEscrow()        | <---------> |  - register/stake/slash   |
|  - teeEncryptionPubKey()  |              +---------------------------+
+---------------------------+                         |
                                           Hyperliquid Testnet
                                           (via Bridge2 + usdSend)

Settlement: TEE attestation (Phala dstack, Intel TDX, ~5-10s)
```

## Project Structure

```
velora/
  contracts/       Solidity smart contracts (Foundry)
  filler/          TypeScript filler service (ethers v6 + @phala/dstack-sdk)
  frontend/        React + Vite + wagmi frontend
  POLKADOT.md      Detailed protocol documentation (FR)
  Velora.md        Privacy design documentation (FR)
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

83 tests covering: unit, fuzz, TEE verification, TDX quote recording, private orders, privacy pool, access control, end-to-end flows.

### Filler Service

```bash
cd filler
npm install
cp .env.example .env   # Fill in RPC endpoints, private key, contract addresses
npm run build
npm start
```

The filler service:
- **PoolWatcher**: Detects `PrivacyDeposit` events, decrypts secrets, triggers withdrawals after time-lock
- **Watcher**: Detects `PrivateOrderPlaced` events on source chain
- **Executor**: Decrypts destination, generates unlinkable fillId, fills via fresh single-use wallet, bridges to Hyperliquid, executes usdSend
- **Settler**: Dual-chain TEE attestation settlement + escrow release
- **Relay**: Cross-chain relay (markOrderFilled on source after fill detection on dest)
- **API**: HTTP API exposing fill data (fillTxHash, freshWalletAddress, settleTxHash, fillId)

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

**Frontend features**:
- **Bridge Widget**: Full state machine (approve → deposit to pool → privacy lock → fill → settle → complete)
- **Fast Faucet**: Mint 10 USDC with fast polling (~2-3s confirmation)
- **Max button**: Sets amount to wallet balance (clamped 6-10 USDC)
- **Amount validation**: Toast popup (bottom-right) guides users to valid amounts (6-10 USDC whole numbers)
- **Completion screen**: Shows all TX hashes + TEE trace (fresh wallet, settlement TX, fill ID, "Verified by TEE" badge)
- **Track tab**: Monitor any order by ID with live status polling

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

## Deployed Contracts

| Contract | Address | Chain |
|----------|---------|-------|
| PrivacyPool | `0x12569697a1A20a9e850Cce09F2D5e517CDB7a42F` | Polkadot Hub Testnet |
| IntentGateway | `0x10507B42691793b2E93179300D8008B849189665` | Polkadot Hub Testnet |
| IntentSettler | `0x821d957c3cBE99ED4144Ae675AE44fd80E32223d` | Arbitrum Sepolia |
| TEEVerifier | `0xC2DdC138A80136a30E0f5731954d765099ba270A` | Arbitrum Sepolia |
| FillerRegistry | `0xF1cdf11e0919dE9a2978dF58C621f4487Af24EdF` | Arbitrum Sepolia |
| USDC (source) | `0xb5C8B011f9EBDBB73cd9EF89aCdb05d64Cd972b2` | Polkadot Hub Testnet |
| USDC2 (dest) | `0x1baAbB04529D43a73232B713C0FE471f7c7334d5` | Arbitrum Sepolia |
| HL Bridge2 | `0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89` | Arbitrum Sepolia |

## Smart Contracts

| Contract | Chain | Description |
|----------|-------|-------------|
| PrivacyPool | Source | Time-locked mixing pool, standardized amounts (6-10 USDC), encrypted secrets |
| DepositRouter | Source | Privacy proxy — hides user address from PrivacyPool Transfer events |
| IntentGateway | Source | Escrow, createPrivateOrder (ECIES encrypted dest), TEE pubkey storage, releaseEscrow |
| IntentSettler | Dest | Fill orders with unlinkable fillId, TEE settlement verification |
| TEEVerifier | Dest | Phala dstack TEE attestation + TDX quote verification (~5-10s) |
| FillerRegistry | Dest | Filler registration, staking, reputation |
| OrderLib | Lib | Order encoding, computePrivateOrderId, status transitions |
| Constants | Lib | Protocol parameters (MIN_FEE_BPS, MAX_ORDER_AMOUNT, chain IDs) |

## Filler Service

| Module | Description |
|--------|-------------|
| pool-watcher | Detects PrivacyDeposit events, decrypts secrets inside TEE, triggers withdraw after time-lock |
| watcher | Listens for PrivateOrderPlaced events on source chain |
| executor | Decrypts destination (ECIES), generates unlinkable fillId, fills via fresh single-use wallet, bridges to HL, executes usdSend |
| settler | TEE attestation settlement: dual attestation (fillId on dest, sourceOrderId on source) + releaseEscrow |
| tee | Phala dstack TEE client: 3 derived keys (wallet, encryption, fillId secret), TDX attestation, ECIES decryption |
| relay | Cross-chain relay (markOrderFilled after fill detection) |
| state | Full lifecycle tracking: DETECTED → FILLING → FILLED → SETTLING → SETTLED → RELEASED |
| api | HTTP API exposing fill data (fillTxHash, freshWalletAddress, settleTxHash, releaseTxHash, fillId) |
| config | Chain configuration, RPC endpoints, multi-dest support |

## Key Technologies

- **TEE (Phala dstack)** — Anonymous fast settlement via Confidential VMs (Intel TDX) with deterministic key derivation and TDX attestation quotes (~5-10s)
- **ECIES Encryption** — secp256k1 ECIES encryption of destination addresses and withdrawal secrets (eciesjs)
- **PrivacyPool** — Time-locked mixing contract on Polkadot Hub with standardized amounts
- **ERC-7683** — Cross-chain intents standard compatibility
- **OpenZeppelin 5.x** — Battle-tested contract primitives (ReentrancyGuard, Pausable, SafeERC20)

## References

- [Phala dstack](https://github.com/Phala-Network/dstack)
- [ERC-7683 Cross-Chain Intents](https://eips.ethereum.org/EIPS/eip-7683)
- [Hyperbridge Documentation](https://docs.hyperbridge.network)
- [ISMP Protocol](https://docs.hyperbridge.network/protocol/ismp)
- [Polkadot BEEFY](https://wiki.polkadot.network/docs/learn-beefy)

## License

MIT
