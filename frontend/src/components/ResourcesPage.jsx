import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import "./ResourcesPage.css";

const ChevronIcon = ({ open }) => (
  <svg
    viewBox="0 0 24 24"
    stroke="currentColor"
    fill="none"
    strokeWidth="2"
    className={`docs-chevron ${open ? "open" : ""}`}
  >
    <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ===== DOCS DATA ===== */
const docsTree = [
  {
    id: "getting-started",
    label: "Getting Started",
    category: "Protocol",
    content: {
      title: "Getting Started",
      body: "Velora is a privacy-first intent-based cross-chain bridge from Polkadot Asset Hub to Hyperliquid Testnet (via Arbitrum Sepolia). All deposits are anonymous by default — funds go through a PrivacyPool mixing contract on Polkadot Hub, your destination address is ECIES-encrypted, and the TEE filler handles everything automatically including the deposit to Hyperliquid via a single-use fresh wallet.",
      subsections: [
        {
          title: "Prerequisites",
          items: [
            "A wallet connected to Polkadot Hub Testnet (chain ID 420420417)",
            "Paseo testnet tokens for gas — use the 'Faucet Paseo' button in the header to get them from faucet.polkadot.io",
            "USDC tokens on Polkadot Hub — use the 'Faucet' button in the header to mint 10 USDC (fast confirmation ~2-3s)",
            "Choose a standardized amount: 6, 7, 8, 9, or 10 USDC (whole numbers only)",
          ],
        },
        {
          title: "Quick Guide",
          items: [
            "1. Connect your wallet and switch to Polkadot Hub Testnet",
            "2. Get Paseo testnet tokens (Faucet Paseo) and mint USDC (Faucet)",
            "3. Use the MAX button to auto-fill your balance (clamped to 6-10 USDC), or enter an amount manually",
            "4. Optionally set a privacy lock duration via the gear icon (longer = more privacy)",
            "5. Optionally enter a different destination address for maximum privacy",
            "6. Click Bridge and confirm the transactions — the TEE handles the rest",
          ],
        },
      ],
    },
  },
  {
    id: "how-it-works",
    label: "How It Works",
    category: "Protocol",
    children: [
      {
        id: "complete-flow",
        label: "Complete Flow",
        content: {
          title: "Complete Flow",
          body: "The bridge works in 7 automated steps. After depositing into the PrivacyPool, the user does nothing — the TEE filler handles withdrawal, fill, Hyperliquid deposit, and settlement automatically.",
          subsections: [
            {
              title: "Steps",
              items: [
                "1. Approve USDC spending to the DepositRouter/PrivacyPool contract.",
                "2. Deposit into PrivacyPool via DepositRouter — frontend encrypts both your destination address AND a withdrawal secret with the TEE public key (ECIES secp256k1). On-chain: only opaque blobs, no user address in events. The DepositRouter masks your address in ERC-20 Transfer events.",
                "3. Privacy Lock — funds sit in the pool for your chosen delay (instant to 1 hour). Mixed with other deposits of the same amount.",
                "4. TEE filler auto-triggers — the PoolWatcher decrypts the secret inside the TEE enclave, calls withdraw() on the PrivacyPool. The pool creates a private order on IntentGateway with msg.sender = PrivacyPool (not you).",
                "5. Filler fills via fresh wallet — the TEE Executor decrypts the destination address, generates an unlinkable fillId = keccak256(sourceOrderId, teeSecret), creates a single-use fresh wallet, transfers USDC2 to it, bridges to Hyperliquid via Bridge2, and executes usdSend from the fresh wallet to your destination address. The fresh wallet is discarded after use.",
                "6. TEE settlement — dual TEE attestation: one on the destination chain (verifyTEESettlement), one on the source chain (releaseEscrow). TDX quote recorded on-chain. Escrow released on Polkadot Hub (~5-10s total).",
                "7. Bridge Complete — the completion screen shows all TX hashes, the fresh wallet address, and a TEE Trace section with the Fill ID, single-use wallet, and attestation TX link.",
              ],
            },
          ],
        },
      },
      {
        id: "privacy-pool",
        label: "Privacy Pool",
        content: {
          title: "PrivacyPool Contract",
          body: "The PrivacyPool is a mixing contract deployed on Polkadot Hub. It breaks the on-chain link between the user who deposits and the bridge order that follows. All deposits go through a DepositRouter proxy that further hides the user's address.",
          subsections: [
            {
              title: "How it works",
              items: [
                "User deposits USDC via DepositRouter → PrivacyPool with encrypted destination + encrypted secret + commitment hash.",
                "The PrivacyDeposit event contains NO user address — only the commitment hash, amount, delay, and encrypted secret.",
                "The ERC-20 Transfer event shows from: DepositRouter (not the user's wallet) thanks to the proxy.",
                "Funds are time-locked for the chosen delay (0s, 15s, 30s, 60s, or custom up to 1 hour).",
                "After the lock expires, the TEE filler decrypts the secret and calls withdraw() from the TEE wallet.",
                "The pool approves USDC to IntentGateway and calls createPrivateOrder() — the order shows user = PrivacyPool, not the original depositor.",
                "The commitment hash system (keccak256(secret)) ensures only the holder of the secret can trigger withdrawal.",
                "Standardized amounts (6-10 USDC) are enforced on-chain: require(standardAmounts[amount]).",
              ],
            },
          ],
        },
      },
      {
        id: "privacy-model",
        label: "Privacy Model",
        content: {
          title: "Privacy Model — 6 Layers",
          body: "Velora uses 6 complementary layers to protect the link between source and destination:",
          subsections: [
            {
              title: "Privacy Layers",
              items: [
                "1. PrivacyPool mixing — funds sit in a shared pool with time-lock. The order is created by the pool contract (not the user). The DepositRouter proxy hides the user's address in Transfer events.",
                "2. Encrypted destination — ECIES-encrypted with TEE secp256k1 public key. On-chain, only an opaque blob is visible. Only the TEE can decrypt inside the enclave.",
                "3. Encrypted secret — the withdrawal secret is also ECIES-encrypted. Only the TEE can trigger the withdraw. User's address never appears in the withdraw TX.",
                "4. Unlinkable fill IDs — TEE generates fillId = keccak256(sourceOrderId, teeSecret). Different IDs on source and destination chains. No cross-chain correlation possible.",
                "5. Fresh single-use wallet — each fill creates a new random wallet that bridges to Hyperliquid and executes usdSend. The wallet is discarded after use. No pattern of deposits from the same address.",
                "6. Standardized amounts — 6, 7, 8, 9, 10 USDC. All deposits of the same amount are indistinguishable in the pool. Prevents correlation by unique amount.",
              ],
            },
            {
              title: "What an observer sees",
              items: [
                "Polkadot Hub: PrivacyDeposit event with commitmentHash (no user address). Transfer from DepositRouter to PrivacyPool.",
                "Polkadot Hub: PrivateOrderPlaced event with user = PrivacyPool address. Withdraw TX from TEE wallet.",
                "Arbitrum Sepolia: OrderFilled event with unlinkable fillId (different from sourceOrderId). Filler = TEE wallet.",
                "Hyperliquid: usdSend from a fresh single-use wallet to the destination. Different wallet for each fill.",
                "Conclusion: no provable link between the depositor and the recipient across any chain.",
              ],
            },
          ],
        },
      },
      {
        id: "tee-settlement",
        label: "TEE Settlement",
        content: {
          title: "TEE Settlement (Phala dstack)",
          body: "The filler runs in a Phala dstack Confidential VM (Intel TDX). It derives 3 independent keys inside the enclave: wallet (signing), encryption (ECIES decrypt), and fillId secret (unlinkable IDs). Settlement uses TEE attestations recorded on-chain.",
          subsections: [
            {
              title: "Settlement Steps",
              items: [
                "1. TEE Executor fills the order via a fresh single-use wallet → bridge to Hyperliquid → usdSend to destination.",
                "2. TEE Relay detects OrderFilled on Arbitrum Sepolia, maps fillId → sourceOrderId, calls markOrderFilled on source.",
                "3. TEE Settler requests attestation for sourceOrderId → releaseEscrow() on IntentGateway (Polkadot Hub).",
                "4. TDX attestation quote hash recorded on-chain (TEEVerifier.TDXQuoteRecorded event) for off-chain auditability.",
                "5. Escrow released — filler recovers funds on Polkadot Hub. Order fully settled (~5-10s total).",
              ],
            },
            {
              title: "3 Derived Keys (inside TEE)",
              items: [
                "Wallet key (velora/filler/wallet) — signs transactions, attestations, triggers pool withdrawals.",
                "Encryption key (velora/filler/encryption) — ECIES private key for decrypting destination addresses and withdrawal secrets.",
                "FillId secret (velora/filler/fillid-secret) — used in keccak256(sourceOrderId, secret) to generate unlinkable fill IDs.",
              ],
            },
            {
              title: "TEE Modes",
              items: [
                "dstack — Production CVM: keys derived by dstack KMS (tied to app-id), TDX quotes from Intel hardware. Unix socket /var/run/dstack.sock.",
                "simulator — Local development: dstack simulator at localhost:8090. Docker Compose setup included.",
                "mock — Hackathon/testing: keys derived from TEE_PRIVATE_KEY env var via keccak256. No hardware required.",
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: "architecture",
    label: "Architecture",
    category: "Technical",
    content: {
      title: "Architecture",
      body: "Four components: PrivacyPool + DepositRouter (mixing on Polkadot Hub), IntentGateway/IntentSettler (escrow + fill), the TEE filler service (privacy intermediary with fresh wallets), and a filler API for the frontend to display TEE trace data.",
      table: [
        { label: "Source Chain", value: "Polkadot Hub Testnet — DepositRouter (privacy proxy) + PrivacyPool (mixing, 6-10 USDC, time-lock) + IntentGateway (escrow, TEE pubkey)" },
        { label: "Destination Chain", value: "Arbitrum Sepolia — IntentSettler (fill with unlinkable fillId) + TEEVerifier (attestation + TDX quotes) + FillerRegistry" },
        { label: "Final Destination", value: "Hyperliquid Testnet — USDC2 deposit via Bridge2 contract + usdSend via fresh single-use wallet" },
        { label: "TEE Filler", value: "Phala dstack CVM (Intel TDX) — PoolWatcher, Watcher, Executor (fresh wallet), Settler (TEE attestation), Relay, API" },
        { label: "Filler API", value: "HTTP API (port 3001) — /api/fill/:orderId returns fillTxHash, freshWalletAddress, settleTxHash, releaseTxHash, fillId" },
        { label: "Privacy", value: "DepositRouter proxy + PrivacyPool mixing + ECIES encryption + unlinkable fillId + fresh single-use wallet + standardized amounts" },
      ],
    },
  },
  {
    id: "smart-contracts",
    label: "Smart Contracts",
    category: "Technical",
    content: {
      title: "Smart Contracts",
      body: "Deployed on Polkadot Hub Testnet (source) and Arbitrum Sepolia (destination). TEE-only settlement — no fallback mechanism.",
      table: [
        { label: "PrivacyPool.sol", value: "Source chain mixing pool. deposit() locks standardized USDC (6-10) with encrypted secret + dest + time-lock. withdraw() called by TEE filler — creates private order via IntentGateway." },
        { label: "DepositRouter.sol", value: "Source chain privacy proxy. Forwards deposits to PrivacyPool while masking the user's address in ERC-20 Transfer events." },
        { label: "IntentGateway.sol", value: "Source chain escrow. createPrivateOrder() stores ECIES-encrypted destination. teeEncryptionPubKey() for frontend encryption. releaseEscrow() with TEE attestation." },
        { label: "IntentSettler.sol", value: "Destination chain. fillOrder(fillId) with unlinkable IDs. verifyTEESettlement() and verifyTEESettlementWithQuote() for attestation verification." },
        { label: "TEEVerifier.sol", value: "Verifies ECDSA signatures from trusted enclaves. Records TDX quote hashes on-chain. Manages trusted enclave addresses." },
        { label: "FillerRegistry.sol", value: "Filler registration, staking, reputation tracking, and slashing." },
        { label: "OrderLib.sol", value: "Order structs, computeOrderId(), computePrivateOrderId(), status transitions." },
        { label: "Constants.sol", value: "Protocol parameters: MIN_FEE_BPS=5, MAX_FEE_BPS=100, FILLER_WINDOW=30, MIN/MAX_ORDER_AMOUNT." },
      ],
    },
  },
  {
    id: "frontend-features",
    label: "Frontend Features",
    category: "Technical",
    content: {
      title: "Frontend Features",
      body: "The Velora frontend is built with React 19, Vite, wagmi v3, and viem. It provides a complete bridge experience with privacy controls and TEE verification.",
      subsections: [
        {
          title: "Bridge Widget",
          items: [
            "Full state machine: input → approve → deposit to pool → privacy lock countdown → filler delivery → settlement → completed.",
            "Amount input with validation: only whole numbers 6-10 USDC accepted. Toast notification (bottom-right, auto-dismiss) guides users to valid amounts.",
            "MAX button: sets amount to wallet balance (clamped between 6 and 10 USDC). MIN button: sets 6 USDC.",
            "Privacy lock configuration via gear icon: Instant, 15s, 30s, 1 min, or custom duration up to 1 hour.",
            "Optional destination address input for maximum privacy (send to a different wallet).",
            "Route card showing receive amount (fee-deducted, 2 decimals), estimated time, and settlement mode.",
            "Track tab: monitor any order by ID with live status polling on both chains.",
          ],
        },
        {
          title: "Completion Screen",
          items: [
            "Bridge Complete view with all transaction details and TEE verification proof.",
            "TX hash links: Withdraw TX (Polkadot Blockscout), Deposit TX (Polkadot Blockscout), HL Bridge TX (Arbiscan).",
            "Fresh Wallet address displayed with copy button — the single-use wallet used for this fill.",
            "TEE Settlement TX link to Arbiscan — the attestation submission transaction.",
            "Escrow Release TX link to Polkadot Blockscout — the escrow release on source chain.",
            "TEE Trace section: green 'Verified by TEE (dstack)' badge with shield icon, Fill ID (unlinkable), single-use wallet, and attestation TX.",
          ],
        },
        {
          title: "Faucet",
          items: [
            "Faucet Paseo button: links to faucet.polkadot.io for Paseo testnet gas tokens.",
            "USDC Faucet button: mints 10 USDC on Polkadot Hub with fast polling (~2-3s confirmation) and explicit gas parameter to avoid estimation delays.",
          ],
        },
      ],
    },
  },
  {
    id: "fees",
    label: "Fee Structure",
    category: "Reference",
    content: {
      title: "Fee Structure",
      body: "A small fee (default 10 bps) is automatically calculated and deducted. The receive amount is truncated to 2 decimal places to match Hyperliquid usdSend precision.",
      table: [
        { label: "Bridge Fee", value: "10 bps (0.10%) — automatically deducted from amount" },
        { label: "Fee Range", value: "5 bps (min) to 100 bps (max), configurable" },
        { label: "Fee Recipient", value: "The TEE filler who fronts the funds and handles the anonymous fill" },
        { label: "Receive Precision", value: "Truncated to 2 decimal places (e.g., 9.99 USDC) to match Hyperliquid usdSend" },
        { label: "Standardized Amounts", value: "6, 7, 8, 9, or 10 USDC (whole numbers, enforced on-chain)" },
        { label: "User Gas", value: "Approve + deposit on Polkadot Hub only" },
        { label: "Filler Gas", value: "Withdraw, fill, bridge to HL, usdSend, settlement, escrow release — all paid by filler" },
      ],
    },
  },
  {
    id: "network-config",
    label: "Network Configuration",
    category: "Reference",
    content: {
      title: "Deployed Contracts",
      body: "Current testnet deployment. Source chain: Polkadot Hub Testnet. Destination: Arbitrum Sepolia → Hyperliquid Testnet.",
      table: [
        { label: "Source Chain", value: "Polkadot Hub Testnet (chain ID 420420417)" },
        { label: "Destination Chain", value: "Arbitrum Sepolia (chain ID 421614) → Hyperliquid Testnet" },
        { label: "PrivacyPool", value: "0x12569697a1A20a9e850Cce09F2D5e517CDB7a42F (Polkadot Hub)" },
        { label: "IntentGateway", value: "0x10507B42691793b2E93179300D8008B849189665 (Polkadot Hub)" },
        { label: "IntentSettler", value: "0x821d957c3cBE99ED4144Ae675AE44fd80E32223d (Arbitrum Sepolia)" },
        { label: "TEEVerifier", value: "0xC2DdC138A80136a30E0f5731954d765099ba270A (Arbitrum Sepolia)" },
        { label: "FillerRegistry", value: "0xF1cdf11e0919dE9a2978dF58C621f4487Af24EdF (Arbitrum Sepolia)" },
        { label: "MockUSDC (source)", value: "0xb5C8B011f9EBDBB73cd9EF89aCdb05d64Cd972b2" },
        { label: "USDC2 (dest)", value: "0x1baAbB04529D43a73232B713C0FE471f7c7334d5" },
        { label: "HL Bridge2", value: "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89" },
        { label: "Filler API", value: "http://localhost:3001 (default)" },
      ],
    },
  },
  {
    id: "verify-privacy",
    label: "Verify Privacy",
    category: "Reference",
    content: {
      title: "How to Verify Your Deposit is Anonymous",
      body: "After bridging, you can verify the privacy on-chain using the TX links shown on the completion screen:",
      subsections: [
        {
          title: "What to check",
          items: [
            "Source chain (Polkadot Hub): Find the PrivacyDeposit event — it has NO user address, only the commitment hash and encrypted blobs.",
            "Source chain: The ERC-20 Transfer event shows from: DepositRouter (not your wallet) thanks to the privacy proxy.",
            "Source chain: Find the PrivateOrderPlaced event — the 'user' field shows the PrivacyPool address (0x1256...), NOT your wallet address.",
            "Source chain: The withdraw TX shows 'from: TEE filler wallet' — NOT your address. The filler triggered it automatically.",
            "Destination chain (Arbitrum Sepolia): Find the OrderFilled event — the fillId is different from the sourceOrderId. No on-chain link between the two chains.",
            "Hyperliquid: The usdSend comes from a fresh single-use wallet (shown on the completion screen), not from the TEE filler wallet. Different wallet for each fill.",
            "The completion screen shows clickable links for every TX: Withdraw TX, Deposit TX, HL Bridge TX, TEE Settlement TX, and Escrow Release TX.",
            "The TEE Trace section on the completion screen shows the Fill ID (unlinkable) and the fresh wallet address used for your fill.",
          ],
        },
      ],
    },
  },
  {
    id: "important-notes",
    label: "Important Notes",
    category: "Reference",
    content: {
      title: "Important Notes",
      subsections: [
        {
          title: "Key Information",
          items: [
            "All deposits are anonymous by default. There is no public order option — every order goes through PrivacyPool.",
            "The TEE filler automatically triggers the withdrawal and fills via a fresh wallet — you never call withdraw() yourself.",
            "Your destination and secret are encrypted with the TEE public key (ECIES secp256k1) and stored on-chain. Only the TEE can decrypt them.",
            "Standardized amounts (6-10 USDC, whole numbers) are enforced on-chain. The frontend shows a toast notification for invalid amounts.",
            "The privacy lock delay (0s to 1 hour) lets funds mix in the pool before the order is created. Longer = more privacy.",
            "Each fill uses a fresh single-use wallet that is discarded after the Hyperliquid deposit — no pattern of deposits from the same address.",
            "Orders can be cancelled after deadline expiry if the filler doesn't fill.",
            "The TEE Trace on the completion screen (Fill ID, fresh wallet, attestation TX) provides cryptographic proof of correct execution.",
            "Use the Faucet Paseo button for testnet gas tokens and the Faucet button for mock USDC.",
          ],
        },
      ],
    },
  },
];

/* ===== SIDEBAR NAV ITEM ===== */
function SidebarItem({ item, activeId, onSelect, depth = 0 }) {
  const [open, setOpen] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  const isActive = item.id === activeId;
  const hasActiveChild = hasChildren && item.children.some(
    (c) => c.id === activeId || (c.children && c.children.some((cc) => cc.id === activeId))
  );

  useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);

  if (hasChildren) {
    return (
      <li>
        <button
          className={`docs-sidebar-btn ${hasActiveChild ? "has-active" : ""}`}
          onClick={() => setOpen((o) => !o)}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          <span>{item.label}</span>
          <ChevronIcon open={open} />
        </button>
        {open && (
          <ul className="docs-sidebar-children">
            {item.children.map((child) => (
              <SidebarItem
                key={child.id}
                item={child}
                activeId={activeId}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        className={`docs-sidebar-link ${isActive ? "active" : ""}`}
        onClick={() => onSelect(item.id)}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {item.label}
      </button>
    </li>
  );
}

/* ===== CONTENT RENDERER ===== */
function DocContent({ content }) {
  if (!content) return null;

  return (
    <div className="docs-content">
      <h1 className="docs-content-title">{content.title}</h1>

      {content.body && <p className="docs-content-body">{content.body}</p>}

      {content.subsections &&
        content.subsections.map((sub, i) => (
          <div key={i} className="docs-subsection">
            <h3 className="docs-subsection-title">{sub.title}</h3>
            {sub.items && (
              <ul className="docs-subsection-list">
                {sub.items.map((item, j) => (
                  <li key={j} className="docs-subsection-item">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

      {content.table && (
        <div className="docs-table">
          {content.table.map((row, i) => (
            <div key={i} className="docs-table-row">
              <span className="docs-table-label">{row.label}</span>
              <span className="docs-table-value">{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== FIND CONTENT BY ID ===== */
function findContent(tree, id) {
  for (const item of tree) {
    if (item.id === id) return item.content;
    if (item.children) {
      const found = findContent(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

/* ===== MAIN PAGE ===== */
export default function ResourcesPage() {
  const [activeId, setActiveId] = useState("getting-started");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const content = findContent(docsTree, activeId);

  const handleSelect = (id) => {
    setActiveId(id);
    setSidebarOpen(false);
  };

  // Group items by category
  const categories = {};
  docsTree.forEach((item) => {
    const cat = item.category || "General";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(item);
  });

  return (
    <div className="docs-page">
      {/* Mobile sidebar toggle */}
      <button
        className="docs-mobile-toggle"
        onClick={() => setSidebarOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
        </svg>
        Documentation
      </button>

      {/* Sidebar */}
      <aside className={`docs-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="docs-sidebar-header">
          <span className="docs-sidebar-title">Documentation</span>
        </div>
        <nav className="docs-sidebar-nav">
          {Object.entries(categories).map(([category, items]) => (
            <div key={category} className="docs-sidebar-category">
              <span className="docs-sidebar-category-label">{category}</span>
              <ul className="docs-sidebar-list">
                {items.map((item) => (
                  <SidebarItem
                    key={item.id}
                    item={item}
                    activeId={activeId}
                    onSelect={handleSelect}
                  />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="docs-sidebar-cta">
          <Link to="/" className="docs-sidebar-cta-btn">
            Start Bridging
          </Link>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="docs-sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="docs-main">
        <DocContent content={content} />
      </main>
    </div>
  );
}
