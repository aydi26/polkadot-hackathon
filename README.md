# Velora — Privacy-First Cross-Chain Bridge

**Polkadot Hub → Arbitrum Sepolia → Hyperliquid Testnet**

All deposits are anonymous by default. Destination addresses are ECIES-encrypted and only decryptable inside a TEE. Settlement via TEE attestation (Phala dstack, Intel TDX, ~5-10s).

---

## TL;DR

Velora is a **privacy-first intent-based cross-chain bridge** between Polkadot Asset Hub and Hyperliquid Testnet (via Arbitrum Sepolia).

- **PrivacyPool** — Users deposit into a time-locked mixing contract on Polkadot Hub. The TEE filler triggers withdrawal automatically.
- **TEE-only settlement** (~5-10s) — The filler runs in a Phala dstack CVM (Intel TDX). It decrypts the destination inside the enclave, fills with an unlinkable `fillId` via a **single-use fresh wallet**, and settles via TDX attestation.
- **Standardized amounts** — 6, 7, 8, 9, or 10 USDC. Prevents amount-based correlation.
- **Delivery delay** — Privacy lock from instant to 1 hour. Breaks timing correlation.
- **Route** — Polkadot Hub → Arbitrum Sepolia → Hyperliquid Testnet. The filler automatically deposits to Hyperliquid via Bridge2 + `usdSend`.

No fallback mechanism. The TEE filler is required for all operations.

```
Comparison with other bridges:

| Criteria              | Classic bridge          | Optimistic bridge       | Velora (privacy-first)        |
|-----------------------|------------------------|------------------------|-------------------------------|
| User wait time        | 15-45 min              | 2-10 min               | ~2s (after privacy lock)      |
| Privacy               | None                   | None                   | 6 layers of protection        |
| Trust assumption      | Validator committee    | Honest watcher         | TEE attestation (TDX)         |
| Capital efficiency    | Low (mint/burn)        | Medium (bonding)       | High (competitive filler)     |
| Mixing                | No                     | No                     | PrivacyPool time-locked       |
| Destination visible   | Yes                    | Yes                    | No (ECIES encrypted)          |
| IDs linkable          | Yes                    | Yes                    | No (fillId unlinkable)        |
```

---

## How It Works — Complete Flow

The bridge works in **7 automated steps**. After depositing into the PrivacyPool, the user does nothing — the TEE filler handles withdrawal, fill, Hyperliquid deposit, and settlement automatically.

### Step 1 — User prepares the bridge (Frontend)

1. Connect wallet on Polkadot Hub Testnet (chain ID 420420417)
2. Get Paseo testnet tokens via **Faucet Paseo** button (links to faucet.polkadot.io)
3. Mint USDC via **Faucet** button (10 USDC, fast confirmation ~2-3s)
4. Choose a standardized amount: 6, 7, 8, 9, or 10 USDC
   - **MAX** button selects wallet balance (clamped 6-10 USDC)
   - **MIN** button selects 6 USDC
   - Invalid amounts trigger a toast notification (bottom-right)
5. Optionally enter a different destination address for maximum privacy
6. Configure privacy lock duration via the gear icon (Instant, 15s, 30s, 1 min, custom up to 1h)
7. Click "Bridge"

### Step 2 — Encryption + Deposit into PrivacyPool

The frontend:

1. Generates a random **secret** (32 bytes) → `commitmentHash = keccak256(secret)`
2. Reads the **TEE public key** from IntentGateway (`teeEncryptionPubKey()`)
3. **ECIES-encrypts** the destination address → `encryptedDest`
4. **ECIES-encrypts** the secret → `encryptedSecret`
5. Calls `DepositRouter.deposit(amount, commitmentHash, encryptedDest, encryptedSecret, delaySeconds)`
   - DepositRouter proxies to PrivacyPool, masking the user's address in Transfer events
6. Stores the secret in `localStorage` for recovery

**On-chain:** Event `PrivacyDeposit(commitmentHash, amount, delay, encryptedSecret)` — **no user address**. Transfer shows `from: DepositRouter`, not the user.

### Step 3 — Privacy Lock (on-chain time-lock)

Funds sit in the PrivacyPool for the chosen delay. The contract enforces `block.timestamp >= releaseTime`. During this time, funds mix with other deposits of the same amount.

### Step 4 — TEE filler auto-triggers withdrawal

The **PoolWatcher** inside the TEE:

1. Detects the `PrivacyDeposit` event
2. Waits for `isReady(commitmentHash) == true`
3. **Decrypts the secret** inside the TEE enclave (ECIES)
4. Calls `PrivacyPool.withdraw(secret, feeOffer, deadline)` from the TEE wallet

The PrivacyPool verifies `keccak256(secret) == commitmentHash`, approves USDC to IntentGateway, and calls `createPrivateOrder()` — **msg.sender = PrivacyPool** (not the user).

### Step 5 — Filler fills via fresh wallet

The TEE **Executor**:

1. Detects `PrivateOrderPlaced` on IntentGateway
2. **Decrypts** the destination address (ECIES)
3. Generates unlinkable `fillId = keccak256(sourceOrderId, teeSecret)`
4. Creates a **fresh single-use wallet** (random key, used once then discarded)
5. Transfers USDC2 + ETH gas to the fresh wallet
6. Fresh wallet bridges USDC2 to Hyperliquid via `USDC2.transfer(HL_BRIDGE_ADDRESS, amount)`
7. Waits for HL credit (~30-60s)
8. Executes `usdSend` from fresh wallet to the decrypted destination
9. Verifies funds arrived — fresh wallet discarded

### Step 6 — TEE Settlement

**Relay:** Detects `OrderFilled(fillId)` on Arbitrum Sepolia → maps `fillId → sourceOrderId` → calls `markOrderFilled()` on source.

**Settlement:** TEE signs attestation for `sourceOrderId` → `releaseEscrow()` on IntentGateway. TDX quote recorded on-chain. Escrow released on Polkadot Hub. (~5-10s total)

### Step 7 — Bridge Complete (Frontend)

The completion screen displays:
- Amount sent and received (fee-deducted, 2 decimal places)
- **Order ID** with copy button
- **Withdraw TX** → Polkadot Blockscout link
- **Deposit TX** → Polkadot Blockscout link
- **HL Bridge TX** → Arbiscan link
- **Fresh Wallet** address with copy button
- **TEE Settlement TX** → Arbiscan link
- **Escrow Release TX** → Polkadot Blockscout link
- **TEE Trace** section: green "Verified by TEE (dstack)" badge with Fill ID, single-use wallet, attestation TX

---

## Privacy Model — 6 Layers

| Layer | Mechanism | Protection |
|-------|-----------|------------|
| **1. PrivacyPool mixing** | Time-locked mixing contract on Polkadot Hub | Order created by pool contract (user = PrivacyPool, not the user). DepositRouter masks address in Transfer events |
| **2. Encrypted destination** | ECIES secp256k1 with TEE public key | Destination address is an opaque blob on-chain. Only TEE can decrypt |
| **3. Encrypted secret** | ECIES secp256k1 with TEE public key | Withdrawal secret encrypted. Only TEE can trigger withdraw. User address never in withdraw TX |
| **4. Unlinkable fillId** | `keccak256(sourceOrderId, teeSecret)` | Different IDs on source and destination chains. No cross-chain correlation |
| **5. Fresh single-use wallet** | Random wallet created per fill | Bridges to HL and executes usdSend. Discarded after use. No pattern of deposits |
| **6. Standardized amounts** | 6, 7, 8, 9, 10 USDC | All deposits of the same amount are indistinguishable in the pool |

### What an observer sees

**On Polkadot Hub:**
```
# Deposit (user TX via DepositRouter)
Transfer(from: DepositRouter, to: PrivacyPool, 10 USDC)
PrivacyDeposit(commitmentHash: 0xABC..., amount: 10, delay: 30, encryptedSecret: 0x04fa...)
→ No user address in event

# Withdraw (TEE filler TX)
PrivacyWithdraw(commitmentHash: 0xABC...)
PrivateOrderPlaced(orderId: 0x3414..., user: PrivacyPool, encryptedDest: 0x04d8...)
→ user = PrivacyPool, not Alice
→ TX from TEE wallet, not Alice
```

**On Arbitrum Sepolia:**
```
OrderFilled(
  fillId: 0xc034...,      ← Different from 0x3414 (unlinkable)
  filler: 0x9417...,      ← TEE wallet (same for all fills)
  recipient: 0xBob...,    ← Visible, but not linked to Alice
  amount: 10 USDC
)
```

**On Hyperliquid:**
```
usdSend(
  from: 0xFresh...,       ← Fresh single-use wallet (discarded after)
  to: 0xBob...,           ← Destination
  amount: 9.99 USDC       ← Net amount (fee deducted, truncated to 2 decimals)
)
```

**Conclusion:** An observer sees that Alice deposited 10 USDC into the pool, and that Bob received ~9.99 USDC on Hyperliquid. But they **cannot prove** the link:
- The deposit event has no user address (DepositRouter masks Alice)
- The order was created by the PrivacyPool (not Alice)
- The withdraw was triggered by the TEE wallet (not Alice)
- `fillId ≠ sourceOrderId`
- The HL deposit comes from a fresh single-use wallet (not the TEE wallet)
- With other 10 USDC deposits in the pool, correlation is impossible

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    Polkadot Asset Hub (Source Chain)                      │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                     DepositRouter (Privacy Proxy)                   │  │
│  │  deposit(amount, commitmentHash, encryptedDest, encryptedSecret)   │  │
│  │  → Forwards to PrivacyPool (masks user address in Transfer events) │  │
│  └───────────────────────────┬────────────────────────────────────────┘  │
│                              │                                           │
│  ┌───────────────────────────▼────────────────────────────────────────┐  │
│  │                     PrivacyPool (Mixing Contract)                   │  │
│  │                                                                    │  │
│  │  deposit()  → Lock USDC + register commitment, delay, secrets      │  │
│  │  withdraw() → Verify secret, approve → createPrivateOrder()        │  │
│  │  Standard amounts: 6, 7, 8, 9, 10 USDC                           │  │
│  │  Time-lock: 0 to 3600 seconds                                     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                     IntentGateway (Escrow)                         │  │
│  │                                                                    │  │
│  │  createPrivateOrder()  → Order with encryptedDest                  │  │
│  │  markOrderFilled()     → Mark as filled (relay)                    │  │
│  │  releaseEscrow()       → Release funds (TEE attestation)           │  │
│  │  teeEncryptionPubKey() → TEE ECIES public key                     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Events:                                                                 │
│  PrivacyDeposit(commitmentHash, amount, delay) — NO user address        │
│  PrivateOrderPlaced(orderId, user=PrivacyPool, encryptedDest)           │
│  EscrowReleased(orderId, filler, amount)                                │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                  TEE Filler (Phala dstack CVM — Intel TDX)               │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │  PoolWatcher     │  │  Watcher         │  │  Executor            │   │
│  │  Detect deposits │  │  Detect orders   │  │  Decrypt dest        │   │
│  │  Decrypt secrets │  │  from Gateway    │  │  Fresh wallet        │   │
│  │  Trigger withdraw│  │                  │  │  Bridge to HL        │   │
│  └──────────────────┘  └──────────────────┘  │  usdSend to dest    │   │
│                                               └──────────────────────┘   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │  Settler         │  │  Relay           │  │  API (port 3001)     │   │
│  │  TEE attestation │  │  fillId→sourceId │  │  /api/fill/:orderId  │   │
│  │  releaseEscrow   │  │  markOrderFilled │  │  fillTxHash, fillId  │   │
│  └──────────────────┘  └──────────────────┘  │  freshWallet,        │   │
│                                               │  settleTxHash        │   │
│  3 derived keys inside enclave:               └──────────────────────┘   │
│  • Wallet (sign TX + attestations)                                       │
│  • Encryption (ECIES decrypt dest + secret)                              │
│  • FillId secret (keccak256 for unlinkable fillId)                       │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Arbitrum Sepolia (Destination Chain)                │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │              IntentSettler (Fill + Settlement)                      │  │
│  │  fillOrder(fillId, recipient, token, amount)                       │  │
│  │  verifyTEESettlement(orderId, attestation, signature)              │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─────────────────────────────┐  ┌───────────────────────────────────┐  │
│  │  TEEVerifier                │  │  FillerRegistry                   │  │
│  │  verifyAttestation()        │  │  register / stake / slash         │  │
│  │  verifyAttestationWithQuote │  │  reputation tracking              │  │
│  │  TDX quote recording       │  │                                   │  │
│  └─────────────────────────────┘  └───────────────────────────────────┘  │
│                                                                          │
│  Events:                                                                 │
│  OrderFilled(fillId, filler, recipient, amount) — fillId ≠ sourceOrderId│
│  TEESettlementVerified(orderId, filler, enclaveSigner)                   │
└──────────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Hyperliquid Testnet                                 │
│                                                                          │
│  Bridge2: 0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89                    │
│  Deposit: USDC2.transfer(bridge, amount) — credited in < 1 min          │
│  usdSend: L1 API — internal wallet → wallet transfer (no gas)           │
│  Minimum: 5 USDC                                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Smart Contracts

### PrivacyPool (Polkadot Hub — Mixing Contract)

Time-locked mixing pool. Standardized amounts enforced on-chain. TEE filler triggers withdrawal automatically.

| Function | Description |
|----------|-------------|
| `deposit(amount, commitmentHash, encryptedDest, encryptedSecret, delaySeconds)` | Lock standardized USDC (6-10) with time-lock. Event `PrivacyDeposit` without user address |
| `withdraw(secret, feeOffer, deadline)` | Called by TEE filler — verifies secret, approves USDC, calls `createPrivateOrder()`. msg.sender = PrivacyPool |
| `isReady(commitmentHash)` | View: checks if time-lock has expired |
| `remainingLockTime(commitmentHash)` | View: remaining seconds before withdrawal is possible |

### DepositRouter (Polkadot Hub — Privacy Proxy)

Forwards deposits to PrivacyPool while masking the user's address in ERC-20 Transfer events. TX shows `from: DepositRouter` instead of the user.

### IntentGateway (Polkadot Hub — Escrow)

| Function | Description |
|----------|-------------|
| `createPrivateOrder(token, amount, destChain, encryptedDest, feeOffer, deadline)` | Creates order with encrypted destination. Called by PrivacyPool. Emits `PrivateOrderPlaced` |
| `markOrderFilled(orderId)` | Called by relay after fill detection on destination |
| `releaseEscrow(orderId, fillerAddress, attestation)` | Verifies TEE attestation and releases funds to filler |
| `cancelOrder(orderId)` | Cancel by user after deadline if order not filled |
| `teeEncryptionPubKey()` | View: TEE ECIES public key for frontend encryption |
| `getOrder(orderId)` | View: full order details |

### IntentSettler (Arbitrum Sepolia — Fill + Settlement)

| Function | Description |
|----------|-------------|
| `fillOrder(fillId, recipient, token, amount)` | Filler fronts funds with unlinkable fillId. Emits `OrderFilled` |
| `verifyTEESettlement(orderId, attestation, signature)` | Verifies TEE attestation signed by enclave |
| `verifyTEESettlementWithQuote(orderId, attestation, signature, tdxQuote)` | Same + records TDX quote hash on-chain |
| `getFill(orderId)` | View: fill details |

### TEEVerifier (Arbitrum Sepolia — Attestation)

| Function | Description |
|----------|-------------|
| `verifyAttestation(orderId, attestation, signature)` | Verifies ECDSA signature from trusted enclave |
| `verifyAttestationWithQuote(orderId, attestation, signature, tdxQuote)` | Verifies + records TDX quote hash |
| `addTrustedEnclave(enclaveAddress)` | Adds trusted enclave address (owner only) |

### FillerRegistry (Arbitrum Sepolia)

| Function | Description |
|----------|-------------|
| `register(stake)` | Stake USDC as solvency guarantee |
| `recordFill(filler, orderId)` | Record a successful fill |
| `recordSettlement(filler, orderId)` | Record a successful settlement |
| `slash(filler, orderId)` | Slash for malicious behavior |

### Libraries

| Contract | Description |
|----------|-------------|
| `OrderLib.sol` | Order encoding/decoding, `computeOrderId()`, `computePrivateOrderId()`, status transitions |
| `Constants.sol` | `MIN_FEE_BPS=5`, `MAX_FEE_BPS=100`, `FILLER_WINDOW=30`, `MIN_ORDER_AMOUNT=1e6`, `MAX_ORDER_AMOUNT=1_000_000e6` |

---

## TEE Settlement — Phala dstack

The filler runs in a **Confidential VM** (CVM) via Phala dstack on **Intel TDX**.

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEE SETTLEMENT (~5-10s)                        │
│                                                                 │
│  3 independent keys derived inside the enclave:                 │
│  • Wallet: sign TX, attestations, trigger pool withdrawals      │
│  • Encryption: decrypt dest + secret (ECIES secp256k1)          │
│  • FillId secret: keccak256(sourceOrderId, secret) = unlinkable │
│                                                                 │
│  T+0s    Filler detects PrivateOrderPlaced                      │
│  T+1s    Decrypt dest with ECIES key inside TEE                 │
│  T+2s    Generate unlinkable fillId                             │
│  T+3s    Create fresh wallet, transfer USDC2 + gas              │
│  T+4s    Fresh wallet bridges to Hyperliquid                    │
│  T+5s    usdSend from fresh wallet → destination                │
│  T+7s    dstack tdxQuote() → TDX attestation                   │
│  T+8s    Sign attestation with TEE wallet key                   │
│  T+9s    releaseEscrow() on IntentGateway                       │
│  T+10s   Escrow released, order complete                        │
│                                                                 │
│  On-chain attestation:                                          │
│  • TEEVerifier.AttestationVerified(orderId, signer)             │
│  • TEEVerifier.TDXQuoteRecorded(orderId, tdxQuoteHash)          │
│  • IntentSettler.TEESettlementVerified(orderId, filler, enclave)│
└─────────────────────────────────────────────────────────────────┘
```

### 3 TEE Modes

| Mode | Transport | Keys | Usage |
|------|-----------|------|-------|
| `dstack` | Unix socket `/var/run/dstack.sock` | Derived by dstack KMS (tied to app-id) | Production (Phala Cloud) |
| `simulator` | HTTP `localhost:8090` | Derived by simulator | Local dev with Docker |
| `mock` | None | Derived from `TEE_PRIVATE_KEY` via keccak256 | Hackathon / tests |

---

## Filler Service

| Module | Description |
|--------|-------------|
| **pool-watcher** | Detects `PrivacyDeposit` events, decrypts secrets inside TEE, triggers `withdraw()` after time-lock expiry |
| **watcher** | Listens for `PrivateOrderPlaced` events on source chain |
| **executor** | Decrypts destination (ECIES), generates unlinkable fillId, creates fresh single-use wallet, bridges to Hyperliquid, executes usdSend to destination |
| **settler** | TEE attestation settlement: dual attestation (sourceOrderId on source) + `releaseEscrow()` |
| **relay** | Cross-chain relay: detects `OrderFilled` on dest → maps `fillId → sourceOrderId` → calls `markOrderFilled()` on source |
| **tee** | Phala dstack TEE client: 3 derived keys (wallet, encryption, fillId secret), TDX attestation, ECIES decryption |
| **state** | Full lifecycle tracking: DETECTED → FILLING → FILLED → SETTLING → SETTLED → RELEASED |
| **api** | HTTP API (port 3001): `/api/fill/:orderId` returns `fillTxHash`, `freshWalletAddress`, `settleTxHash`, `releaseTxHash`, `fillId`, `status` |
| **config** | Chain configuration, RPC endpoints, multi-destination support |

---

## Frontend

Built with React 19, Vite, wagmi v3, viem, motion/react, and eciesjs.

### Bridge Widget
- Full state machine: input → approve → deposit to pool → privacy lock countdown → filler delivery → settlement → completed
- Amount input: only whole numbers 6-10 USDC. Toast notification (bottom-right, auto-dismiss 4s) for invalid amounts
- **MAX** button: sets amount to wallet balance (clamped 6-10 USDC). **MIN** button: sets 6 USDC
- Privacy lock config via gear icon: Instant, 15s, 30s, 1 min, or custom up to 1 hour
- Optional destination address input for maximum privacy
- Route card showing receive amount (fee-deducted, 2 decimals), estimated time, settlement mode
- **Track tab**: monitor any order by ID with live status polling on both chains

### Completion Screen + TEE Trace
- "Bridge Complete" with green checkmark
- All TX hash links: Withdraw TX, Deposit TX, HL Bridge TX (Polkadot Blockscout + Arbiscan)
- Fresh Wallet address with copy button
- TEE Settlement TX → Arbiscan link
- Escrow Release TX → Polkadot Blockscout link
- **TEE Trace** section: green shield badge "Verified by TEE (dstack)", Fill ID (unlinkable) with copy, single-use wallet with copy, attestation TX link

### Faucets
- **Faucet Paseo**: header button linking to `faucet.polkadot.io` for Paseo testnet gas tokens
- **Faucet USDC**: header button minting 10 USDC on Polkadot Hub with fast polling (~2-3s) and explicit gas parameter

---

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

---

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, cast)
- Node.js >= 18
- Docker (for dstack simulator)

### Contracts

```bash
cd contracts
forge install
forge build
forge test -vvv
```

83 tests: unit, fuzz, TEE verification, TDX quote recording, private orders, privacy pool, access control, end-to-end.

### Filler Service

```bash
cd filler
npm install
cp .env.example .env   # Fill in RPC endpoints, private key, contract addresses
npm run build
npm start
```

Set `TEE_MODE` in `.env`: `mock` (default), `simulator`, or `dstack`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # Fill in contract addresses
npm run dev            # http://localhost:5173
```

---

## Testnet Deployment

Source: **Polkadot Hub Testnet** (chain 420420417). Destination: **Arbitrum Sepolia** (chain 421614).

```bash
cd contracts
cp .env.example .env   # Fill PRIVATE_KEY, RPC_SOURCE, RPC_DESTINATION

# Deploy source contracts (Polkadot Hub Testnet)
foundryup --version nightly
forge script script/DeployAssetHub.s.sol --chain polkadot-testnet --rpc-url https://eth-rpc-testnet.polkadot.io/ --broadcast

# Deploy destination contracts (Arbitrum Sepolia)
forge script script/DeployArbitrumSepolia.s.sol --rpc-url https://sepolia-rollup.arbitrum.io/rpc --broadcast

# Deploy TEE verifier
forge script script/DeployTEEVerifier.s.sol --rpc-url https://sepolia-rollup.arbitrum.io/rpc --broadcast
```

---

## Fee Structure

```
feeAmount    = (amountWei * feeBps) / 10000
rawReceive   = amountWei - feeAmount
receiveAmount = truncate(rawReceive, 2 decimals)   // match HL usdSend precision
```

| Parameter | Value |
|-----------|-------|
| Default fee | 10 bps (0.10%) |
| Fee range | 5 bps (min) to 100 bps (max) |
| Recipient | TEE filler who fronts the anonymous fill |
| Precision | Truncated to 2 decimal places (e.g., 9.99 USDC) |
| Amounts | 6, 7, 8, 9, 10 USDC (whole numbers, enforced on-chain) |
| User gas | Approve + deposit on Polkadot Hub only |
| Filler gas | Withdraw, fill, bridge, usdSend, settlement, escrow release |

---

## How to Verify Privacy

After bridging, verify on-chain using the TX links on the completion screen:

1. **Polkadot Hub** — Find `PrivacyDeposit` event: it has **no user address**, only `commitmentHash` and encrypted blobs
2. **Polkadot Hub** — ERC-20 `Transfer` event shows `from: DepositRouter` (not your wallet)
3. **Polkadot Hub** — `PrivateOrderPlaced` event shows `user = PrivacyPool` (0x1256...), **not your address**
4. **Polkadot Hub** — Withdraw TX shows `from: TEE filler wallet`, not you
5. **Arbitrum Sepolia** — `OrderFilled` event: `fillId` is different from `sourceOrderId`. No cross-chain link
6. **Hyperliquid** — `usdSend` comes from a fresh single-use wallet (shown on completion screen), not the TEE wallet

---

## Project Structure

```
velora/
├── contracts/
│   ├── src/
│   │   ├── source/
│   │   │   ├── IntentGateway.sol          # Escrow, createPrivateOrder, releaseEscrow
│   │   │   └── PrivacyPool.sol            # Mixing pool (6-10 USDC), deposit/withdraw
│   │   ├── destination/
│   │   │   ├── IntentSettler.sol           # Fill (fillId unlinkable), TEE settlement
│   │   │   └── FillerRegistry.sol         # Filler staking, reputation
│   │   ├── settlement/
│   │   │   └── TEEVerifier.sol            # TEE attestation + TDX quotes
│   │   ├── libs/
│   │   │   ├── OrderLib.sol               # Order encoding, hash, status transitions
│   │   │   └── Constants.sol              # Protocol parameters
│   │   └── interfaces/
│   │       ├── IIntentGateway.sol
│   │       ├── IIntentSettler.sol
│   │       ├── IFillerRegistry.sol
│   │       └── ITEEVerifier.sol
│   ├── test/                               # 83 tests
│   └── script/                             # Deploy scripts
│
├── filler/
│   └── src/
│       ├── index.ts                        # Entry point
│       ├── pool-watcher.ts                # PrivacyDeposit → decrypt secret → withdraw
│       ├── watcher.ts                      # PrivateOrderPlaced events
│       ├── executor.ts                     # Decrypt dest, fresh wallet, bridge HL, usdSend
│       ├── settler.ts                      # TEE attestation + releaseEscrow
│       ├── relay.ts                        # Cross-chain relay
│       ├── state.ts                        # Lifecycle tracking
│       ├── tee.ts                          # Phala dstack client (3 keys, attestation)
│       ├── api.ts                          # HTTP API
│       └── config.ts                       # Chain config
│
├── frontend/
│   └── src/
│       ├── App.jsx                         # Router, layout, header (Faucet Paseo + Faucet + Connect)
│       ├── components/
│       │   ├── BridgeWidget.jsx            # Bridge state machine + validation toast + TEE trace
│       │   ├── FaucetButton.jsx            # Mint 10 USDC (fast polling)
│       │   ├── ConnectButton.jsx           # Wallet connection
│       │   ├── ResourcesPage.jsx           # Documentation page
│       │   └── ...                         # Plasma, Menu, Team, etc.
│       └── config/
│           ├── contracts.js                # Deployed addresses, ABIs
│           └── wagmi.js                    # Chain + transport config
│
└── README.md                               # This file
```

---

## Tech Stack

### Contracts

| Package | Usage |
|---------|-------|
| Solidity 0.8.24 | Smart contract language |
| Foundry | Build, test, deploy |
| OpenZeppelin 5.x | ERC-20, SafeERC20, ReentrancyGuard, Pausable, Ownable |

### Filler Service

| Package | Usage |
|---------|-------|
| TypeScript | Static typing |
| ethers v6 | EVM interaction (Polkadot Hub + Arbitrum Sepolia) |
| @phala/dstack-sdk | TEE client (TappdClient, deriveKey, tdxQuote) |
| eciesjs | ECIES encryption/decryption secp256k1 |

### Frontend

| Package | Usage |
|---------|-------|
| React 19 | UI framework |
| Vite | Bundler + dev server |
| wagmi v3 + viem | EVM interaction, contract reads/writes |
| @tanstack/react-query | Data fetching (wagmi dependency) |
| eciesjs | ECIES encryption (destination + secret) |
| motion/react | Animations (Framer Motion) |
| gsap + ogl | Background WebGL + menu animations |
| react-router-dom | Routing |

---

## Security

```
1. PrivacyPool mixing        — Funds mixed with other deposits of same amount. Time-lock enforced.
2. ECIES encryption           — Only TEE can decrypt destination and withdrawal secret.
3. Unlinkable fillId          — keccak256(sourceOrderId, teeSecret). No cross-chain link.
4. Fresh single-use wallet    — Random wallet per fill. Discarded after use.
5. TEE attestation (TDX)      — Hardware-backed proof of correct execution. TDX quote on-chain.
6. Double-fill protection     — An orderId can only be filled once. fillOrder() reverts on duplicate.
7. Deadline enforcement       — Cancel after deadline. No cancel before deadline (filler protection).
8. ReentrancyGuard            — All mutative functions protected.
9. Standardized amounts       — 6-10 USDC enforced on-chain. Frontend toast for invalid input.
```

---

## References

- [Phala dstack — Confidential VMs](https://github.com/Phala-Network/dstack)
- [ERC-7683 — Cross-Chain Intents Standard](https://eips.ethereum.org/EIPS/eip-7683)
- [Hyperbridge — Interoperability Protocol](https://docs.hyperbridge.network)
- [ISMP — Interoperable State Machine Protocol](https://docs.hyperbridge.network/protocol/ismp)
- [Polkadot BEEFY](https://wiki.polkadot.network/docs/learn-beefy)
- [Hyperliquid Documentation](https://hyperliquid.gitbook.io/hyperliquid-docs)
- [OpenZeppelin Contracts 5.x](https://docs.openzeppelin.com/contracts)
- [Foundry Book](https://book.getfoundry.sh)

---

## License

MIT
