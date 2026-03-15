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
      body: "Velora is a privacy-first intent-based cross-chain bridge from Polkadot Asset Hub to Hyperliquid Testnet (via Arbitrum Sepolia). All deposits are anonymous by default — funds go through a PrivacyPool mixing contract on Polkadot Hub, your destination address is ECIES-encrypted, and the TEE filler handles everything automatically. You just deposit and wait.",
      subsections: [
        {
          title: "Prerequisites",
          items: [
            "A wallet connected to Polkadot Hub Testnet",
            "USDC tokens on Polkadot Hub (use the Faucet button in the header)",
            "Choose a standardized amount: 6, 7, 8, 9, or 10 USDC",
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
          body: "The bridge works in 6 automated steps. After depositing into the PrivacyPool, the user does nothing — the TEE filler handles the rest.",
          subsections: [
            {
              title: "Steps",
              items: [
                "1. Approve USDC spending to the PrivacyPool contract",
                "2. Deposit into PrivacyPool — frontend encrypts both your destination address AND a secret with the TEE public key (ECIES secp256k1). On-chain: only opaque blobs, no user address in events.",
                "3. Privacy Lock — funds sit in the pool for your chosen delay (instant to 60s). Mixed with other deposits of the same amount.",
                "4. TEE filler auto-triggers — the filler decrypts the secret inside the TEE enclave, calls withdraw() on the PrivacyPool. The pool creates a private order on IntentGateway with msg.sender = PrivacyPool (not you).",
                "5. Filler fills on Arbitrum Sepolia — the TEE decrypts the destination address, generates an unlinkable fillId, and fills the order. Settlement via TEE attestation (~5-10s).",
                "6. Auto-deposit to Hyperliquid — the frontend detects the settled order and deposits USDC2 to Hyperliquid via the Bridge2 contract.",
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
          body: "The PrivacyPool is a mixing contract deployed on Polkadot Hub. It breaks the on-chain link between the user who deposits and the bridge order that follows.",
          subsections: [
            {
              title: "How it works",
              items: [
                "User deposits USDC + encrypted destination + encrypted secret + commitment hash into the pool.",
                "The PrivacyDeposit event contains NO user address — only the commitment hash and encrypted blobs.",
                "Funds are time-locked for the chosen delay (0s, 15s, 30s, 60s, or custom up to 1 hour).",
                "After the lock expires, the TEE filler decrypts the secret and calls withdraw().",
                "The pool calls createPrivateOrder() on IntentGateway — the order shows user = PrivacyPool, not the original depositor.",
                "The commitment hash system (keccak256(secret)) ensures only the holder of the secret can trigger withdrawal.",
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
                "1. PrivacyPool mixing — funds sit in a shared pool. The order is created by the pool contract (not the user). Breaks user → order link.",
                "2. Encrypted destination — ECIES-encrypted with TEE public key. On-chain, only an opaque blob is visible. Only the TEE can decrypt.",
                "3. Encrypted secret — the withdrawal secret is also ECIES-encrypted. Only the TEE can trigger the withdraw. User's address never appears in the withdraw TX.",
                "4. Unlinkable fill IDs — TEE generates fillId = keccak256(sourceOrderId, teeSecret). Different IDs on source and destination chains.",
                "5. TEE anonymous wallet — all fills go through the same TEE-derived wallet. Acts as a mixer on the destination chain.",
                "6. Standardized amounts — 6, 7, 8, 9, 10 USDC. All deposits of the same amount are indistinguishable in the pool.",
              ],
            },
          ],
        },
      },
      {
        id: "tee-settlement",
        label: "TEE Settlement",
        content: {
          title: "TEE Settlement (dstack)",
          body: "The filler runs in a Phala dstack Confidential VM (Intel TDX). It derives 3 independent keys: wallet (signing), encryption (ECIES decrypt), and fillId secret (unlinkable IDs). Settlement uses dual attestations — one per chain, never cross-referenced.",
          subsections: [
            {
              title: "Settlement Steps",
              items: [
                "TEE signs destination attestation with fillId → verifyTEESettlement() on IntentSettler",
                "TEE signs source attestation with sourceOrderId → releaseEscrow() on IntentGateway",
                "TDX attestation quote recorded on-chain (TDXQuoteRecorded event) for off-chain auditability",
                "In production (dstack mode): hardware Intel TDX guarantees code integrity and key isolation",
              ],
            },
            {
              title: "TEE Modes",
              items: [
                "dstack — Production: keys derived by dstack KMS, TDX quotes from hardware",
                "simulator — Local dev: dstack simulator at localhost:8090",
                "mock — Hackathon: keys derived from TEE_PRIVATE_KEY env var",
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
      body: "Three components: PrivacyPool (mixing on Polkadot Hub), IntentGateway/IntentSettler (escrow + fill), and the TEE filler service (privacy intermediary).",
      table: [
        { label: "Source Chain", value: "Polkadot Hub Testnet — PrivacyPool (mixing) + IntentGateway (escrow)" },
        { label: "Destination Chain", value: "Arbitrum Sepolia — IntentSettler (fill with unlinkable fillId) → Hyperliquid Testnet" },
        { label: "TEE Filler", value: "Phala dstack CVM — decrypts secrets + destinations, triggers withdrawals, fills orders, settles via TDX attestation" },
        { label: "Privacy", value: "PrivacyPool mixing + ECIES encryption + unlinkable fillId + standardized amounts + TEE anonymous wallet" },
      ],
    },
  },
  {
    id: "smart-contracts",
    label: "Smart Contracts",
    category: "Technical",
    content: {
      title: "Smart Contracts",
      body: "Deployed on Polkadot Hub Testnet (source) and Arbitrum Sepolia (destination):",
      table: [
        { label: "PrivacyPool.sol", value: "Source chain mixing pool. deposit() locks USDC with encrypted secret + dest. withdraw() creates private order via IntentGateway. Time-lock enforced on-chain." },
        { label: "IntentGateway.sol", value: "Source chain escrow. createPrivateOrder() stores encrypted destination. TEE pubkey storage. releaseEscrow() after settlement." },
        { label: "IntentSettler.sol", value: "Destination chain. fillOrder(fillId) with unlinkable IDs. verifyTEESettlement() for attestation verification." },
        { label: "TEEVerifier.sol", value: "Verifies ECDSA signatures from trusted enclaves. Records TDX quote hashes on-chain." },
        { label: "FillerRegistry.sol", value: "Filler registration and staking for reputation." },
        { label: "OrderLib.sol", value: "Order structs, computeOrderId / computePrivateOrderId." },
      ],
    },
  },
  {
    id: "fees",
    label: "Fee Structure",
    category: "Reference",
    content: {
      title: "Fee Structure",
      body: "A small fee (10 bps) is automatically calculated and paid to the TEE filler for providing instant anonymous liquidity.",
      table: [
        { label: "Bridge Fee", value: "10 bps (0.10%) — automatically deducted" },
        { label: "Fee Recipient", value: "The TEE filler who fronts the funds on the destination chain" },
        { label: "Standardized Amounts", value: "6, 7, 8, 9, or 10 USDC" },
        { label: "Gas", value: "User pays gas for approve + deposit on Polkadot Hub. Filler pays gas for withdraw + fill + settlement." },
      ],
    },
  },
  {
    id: "network-config",
    label: "Network Configuration",
    category: "Reference",
    content: {
      title: "Deployed Contracts",
      body: "Current testnet deployment:",
      table: [
        { label: "Source Chain", value: "Polkadot Hub Testnet (chain ID 420420417)" },
        { label: "Destination Chain", value: "Arbitrum Sepolia (chain ID 421614) → Hyperliquid Testnet" },
        { label: "PrivacyPool", value: "0x12569697a1A20a9e850Cce09F2D5e517CDB7a42F (Polkadot Hub)" },
        { label: "IntentGateway", value: "0x10507B42691793b2E93179300D8008B849189665 (Polkadot Hub)" },
        { label: "IntentSettler", value: "0x821d957c3cBE99ED4144Ae675AE44fd80E32223d (Arbitrum Sepolia)" },
        { label: "TEEVerifier", value: "0xC2DdC138A80136a30E0f5731954d765099ba270A (Arbitrum Sepolia)" },
        { label: "MockUSDC (source)", value: "0xb5C8B011f9EBDBB73cd9EF89aCdb05d64Cd972b2" },
        { label: "USDC2 (dest)", value: "0x1baAbB04529D43a73232B713C0FE471f7c7334d5" },
        { label: "HL Bridge2", value: "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89" },
      ],
    },
  },
  {
    id: "verify-privacy",
    label: "Verify Privacy",
    category: "Reference",
    content: {
      title: "How to Verify Your Deposit is Anonymous",
      body: "After bridging, you can verify the privacy on-chain:",
      subsections: [
        {
          title: "What to check",
          items: [
            "Source chain (Polkadot Hub): Find the PrivacyDeposit event — it has NO user address, only the commitment hash and encrypted blobs.",
            "Source chain: Find the PrivateOrderPlaced event — the 'user' field shows the PrivacyPool address (0x1256...), NOT your wallet address.",
            "Destination chain (Arbitrum Sepolia): Find the OrderFilled event — the fillId is different from the sourceOrderId. No on-chain link between the two chains.",
            "The withdraw TX on Polkadot Hub shows 'from: TEE filler wallet' — NOT your address. The filler triggered it automatically.",
            "The Bridge Complete screen shows a clickable 'Withdraw TX' link to verify this on the explorer.",
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
            "All deposits are anonymous by default. There is no public order option.",
            "The TEE filler automatically triggers the withdrawal — you never call withdraw() yourself.",
            "Your secret is encrypted with the TEE public key and stored on-chain. Only the TEE can decrypt it.",
            "Standardized amounts (6-10 USDC) prevent amount-based correlation between deposit and fill.",
            "The privacy lock delay (0s to 1 hour) lets funds mix in the pool before the order is created.",
            "Orders can be cancelled after deadline expiry if the filler doesn't fill.",
            "The only on-chain trace linking you to the deposit is the initial deposit TX (from: your wallet → PrivacyPool).",
            "With enough users depositing the same amount, even the deposit TX becomes hard to correlate — same model as Tornado Cash.",
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
