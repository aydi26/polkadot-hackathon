# Velora

Intent-based cross-chain bridge: **Polkadot Hub → Arbitrum Sepolia → Hyperliquid Testnet**. Two modes: **Instant Bridge** (~2s via fillers) and **Classic Bridge** (~6-8min trustless). Three-layer settlement: TEE fast path (Phala Network, ~5-10s), ZK BEEFY fallback (~6-8min), and classic trustless bridge.

## How It Works

Users lock USDC in escrow on the source chain and express an **intent** to receive funds on the destination chain.

- **Instant Bridge**: A filler (liquidity provider) fronts the funds immediately on the destination chain. The user receives USDC in ~2 seconds. Settlement uses the TEE fast path (~5-10s via Phala Network), with ZK BEEFY as fallback (~6-8 min). The filler is reimbursed from escrow + fees.
- **Classic Bridge**: No filler involved. Funds travel through the trustless pipeline (XCM v5 -> Hyperbridge -> ZK BEEFY -> ISMP) directly to the user in ~6-8 minutes. Zero filler fees.
- **Automatic Fallback**: If Instant Bridge is selected but no filler responds within 30s, the system automatically falls back to Classic Bridge. Users always receive their funds.
- **Route A (Polkadot → Arbitrum Sepolia → Hyperliquid Testnet)**: Primary route. Users bridge mock USDC from Polkadot Hub, filler delivers USDC2 on Arbitrum Sepolia, then the frontend **automatically deposits** to Hyperliquid Testnet via the official bridge (`ERC20.transfer` to Bridge2 contract). Funds are credited on Hyperliquid in <1 minute.

The bridge mode is determined by the `feeOffer` parameter: fee > 0 = Instant, fee = 0 = Classic.

## Architecture

```
Source Chain (Polkadot Hub)                 Destination Chain (Arbitrum Sepolia)
+---------------------------+               +---------------------------+
| IntentGateway             |               | IntentSettler             |
|  - createOrder()          |               |  - fillOrder()            |
|  - releaseEscrow()        |  ISMP/Relay   |  - verifySettlement()     |
|  - executeFallback()      | <-----------> |  - verifyTEESettlement()  |
|  - cancelOrder()          |               |                           |
|  - IIsmpModule.onAccept() |               | TEEVerifier (Phala)       |
+---------------------------+               |  - verifyAttestation()    |
                                            | BEEFYVerifier (fallback)  |
                                            | FallbackReceiver          |
                                            |  - receiveFallbackFunds() |
                                            | FillerRegistry            |
                                            |  - register/stake/slash   |
                                            +---------------------------+
                                                       |
                                            Hyperliquid Testnet (official bridge)

Settlement: TEE fast path (Phala, ~5-10s) > ZK BEEFY fallback (~6-8min)
ERC-7683:   ERC7683OriginAdapter + ERC7683DestinationAdapter
```

## Project Structure

```
velora/
  contracts/       Solidity smart contracts (Foundry)
  filler/          TypeScript filler service (ethers v6)
  frontend/        React + Vite + wagmi frontend
  POLKADOT.md      Detailed protocol documentation (FR)
```

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, cast)
- Node.js >= 18
- Git

### Contracts

```bash
cd contracts
forge install
forge build
forge test -vvv
```

80+ tests covering: unit, fuzz, ISMP integration, TEE verification, access control, end-to-end flows.

### Filler Service

```bash
cd filler
npm install
cp .env.example .env   # Fill in RPC endpoints, private key, contract addresses
npm run build
npm start
```

The filler service watches for `OrderPlaced` events, fills profitable orders with retry logic, auto-settles fills, and includes a cross-chain relay simulator for testnet.

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
```

USDC2 on Arbitrum Sepolia: `0x1baAbB04529D43a73232B713C0FE471f7c7334d5` — compatible with the official Hyperliquid Testnet bridge for deposit.

Hyperliquid Bridge2 (Arb Sepolia): `0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89` — deposit via `USDC2.transfer(bridge, amount)`. Validators credit on Hyperliquid in <1 min. Minimum 5 USDC.

## Smart Contracts

| Contract | Chain | Description |
|----------|-------|-------------|
| IntentGateway | Source | Escrow, order management, ISMP fill confirmation handler |
| IntentSettler | Dest | Fill orders, verify settlements, ISMP settlement handler |
| FallbackReceiver | Dest | Classic Bridge fund delivery via ISMP |
| FillerRegistry | Dest | Filler staking, reputation, slashing |
| ProofVerifier | Dest | ZK BEEFY proof verification pipeline |
| ISMPHandler | Dest | ISMP dispatch with real DispatchPost types |
| TEEVerifier | Dest | TEE attestation verification via Phala Network (fast settlement ~5-10s) |
| BEEFYVerifier | Dest | BEEFY commitment verification (fallback, ~6-8min) |
| ERC7683Adapter | Both | ERC-7683 IOriginSettler + IDestinationSettler wrappers |
| OrderLib | Lib | Order encoding, hashing, status transitions |
| FeeCalculator | Lib | Dynamic fee calculation |

## Filler Service

| Module | Description |
|--------|-------------|
| watcher | Listens for OrderPlaced events on source chain |
| executor | Fills orders on destination chain with exponential backoff retry |
| settler | Dual-chain auto-settlement: TEE fast path or BEEFY fallback + releaseEscrow (source) |
| tee | TEE client for Phala attestation requests (mock mode for hackathon) |
| relay | Cross-chain relay simulator for testnet (markOrderFilled after fill detection) |
| state | Full lifecycle tracking: DETECTED -> FILLING -> FILLED -> SETTLING -> SETTLED -> RELEASED |
| pricing | Fee evaluation and profitability analysis |

## Key Technologies

- **TEE (Phala Network)** — Fast settlement via Trusted Execution Environment attestations (~5-10s)
- **Hyperbridge / ISMP** — Trustless cross-chain messaging via state proofs
- **ZK BEEFY** — Zero-knowledge proofs of Polkadot consensus for EVM verification (fallback)
- **XCM v5** — Polkadot native cross-consensus messaging
- **ERC-7683** — Cross-chain intents standard compatibility
- **OpenZeppelin 5.x** — Battle-tested contract primitives (ReentrancyGuard, Pausable, SafeERC20)

## References

- [ERC-7683 Cross-Chain Intents](https://eips.ethereum.org/EIPS/eip-7683)
- [Hyperbridge Documentation](https://docs.hyperbridge.network)
- [ISMP Protocol](https://docs.hyperbridge.network/protocol/ismp)
- [Polkadot BEEFY](https://wiki.polkadot.network/docs/learn-beefy)
- [XCM v5](https://wiki.polkadot.network/docs/learn-xcm)

## License

MIT
