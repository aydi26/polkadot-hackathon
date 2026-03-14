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
      body: "Velora is an intent-based cross-chain bridge from Polkadot Asset Hub to Hyperliquid Testnet (via Arbitrum Sepolia). Users lock USDC in an on-chain escrow and choose between two bridging modes: Instant Bridge (~2s, filler fronts funds for a fee) or Classic Bridge (~6-8 min, trustless settlement via ZK BEEFY with no extra fees). Funds are automatically deposited to Hyperliquid via the official bridge.",
      subsections: [
        {
          title: "Prerequisites",
          items: [
            "A wallet connected to Polkadot Asset Hub (source chain)",
            "USDC tokens on Polkadot Asset Hub",
            "A destination address (same wallet on Arbitrum Sepolia and Hyperliquid)",
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
        id: "instant-bridge",
        label: "Instant Bridge",
        content: {
          title: "Instant Bridge (~2 seconds)",
          body: "The fast path. A filler (liquidity provider) fronts your USDC on Arbitrum Sepolia immediately after you create your order. You pay a small fee (5-100 bps) for instant settlement. If no filler is available within 30s, the system automatically falls back to Classic Bridge — you always receive your funds.",
          subsections: [
            {
              title: "Flow",
              items: [
                "1. Approve USDC spending on IntentGateway",
                "2. Create order with feeOffer > 0 (your chosen fee in bps)",
                "3. Filler detects your order and calls fillOrder() on IntentSettler within ~2s",
                "4. You receive USDC2 on Arbitrum Sepolia, auto-deposited to Hyperliquid",
                "5. TEE (Phala) settlement (~5-10s) or ZK BEEFY fallback (~6-8 min), releasing escrow to filler",
              ],
            },
            {
              title: "Automatic Fallback",
              items: [
                "If no filler responds within FILLER_WINDOW (~30s), the system triggers executeFallback() automatically",
                "Your order switches to the Classic Bridge pipeline (XCM v5 → ZK BEEFY → ISMP)",
                "You receive your full amount (~6-8 min) — the filler fee is NOT deducted since no filler filled",
                "This guarantees delivery in 100% of cases, regardless of filler availability",
              ],
            },
          ],
        },
      },
      {
        id: "classic-bridge",
        label: "Classic Bridge",
        content: {
          title: "Classic Bridge (~6-8 minutes)",
          body: "The trustless path. No filler involved, no extra fees. Your USDC is bridged through the full ZK BEEFY settlement pipeline. Slower but completely permissionless.",
          subsections: [
            {
              title: "Flow",
              items: [
                "1. Approve USDC spending on IntentGateway",
                "2. Create order with feeOffer = 0 (no filler fee)",
                "3. XCM v5 message is sent cross-chain",
                "4. ZK BEEFY proof is generated and verified on Arbitrum Sepolia",
                "5. FallbackReceiver releases USDC to your destination address, auto-deposited to Hyperliquid",
              ],
            },
          ],
        },
      },
      {
        id: "settlement",
        label: "Settlement Pipeline",
        content: {
          title: "Settlement Pipeline",
          body: "Settlement uses a dual-path approach: TEE fast path via Phala Network (~5-10s) as primary, with ZK BEEFY as trustless fallback (~6-8 min). Both verify Polkadot state on the EVM side.",
          subsections: [
            {
              title: "Pipeline Steps",
              items: [
                "Polkadot validators sign BEEFY commitments",
                "Hyperbridge relayer picks up the commitment",
                "ZK proof is generated (Groth16 over BEEFY signature aggregation)",
                "ProofVerifier contract verifies the ZK proof on Arbitrum Sepolia",
                "ISMP handler dispatches the cross-chain message",
                "IntentSettler or FallbackReceiver finalizes the transfer",
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
      body: "The protocol operates across two chains: Polkadot Asset Hub (source, escrow) and Arbitrum Sepolia (destination, settlement → Hyperliquid). A filler service monitors pending orders and provides instant liquidity for users who opt into the Instant Bridge mode.",
      table: [
        { label: "Source Chain", value: "Polkadot Asset Hub (IntentGateway.sol — escrow & order management)" },
        { label: "Destination Chain", value: "Arbitrum Sepolia (IntentSettler.sol — fill & settlement) → Hyperliquid Testnet" },
        { label: "Filler Service", value: "TypeScript service (ethers v6, @polkadot/api) monitoring and filling orders" },
        { label: "Settlement", value: "TEE (Phala Network, ~5-10s) fast path, ZK BEEFY fallback (~6-8 min)" },
        { label: "Frontend", value: "React 19, Vite, wagmi, viem, @tanstack/react-query" },
      ],
    },
  },
  {
    id: "smart-contracts",
    label: "Smart Contracts",
    category: "Technical",
    content: {
      title: "Smart Contracts",
      body: "The protocol is built on four core contracts plus supporting libraries:",
      table: [
        { label: "IntentGateway.sol", value: "Source chain escrow. createOrder() locks USDC, releaseEscrow() pays filler, executeFallback() triggers classic path, cancelOrder() for expired orders." },
        { label: "IntentSettler.sol", value: "Destination chain settlement. fillOrder() lets fillers front funds, verifySettlement() validates ZK BEEFY proofs." },
        { label: "FillerRegistry.sol", value: "Optional filler registration and staking. Fillers deposit collateral to participate." },
        { label: "FallbackReceiver.sol", value: "Classic bridge endpoint. Receives USDC after ZK BEEFY settlement when no filler is used." },
        { label: "ProofVerifier.sol", value: "Verifies ZK Groth16 proofs of BEEFY consensus." },
        { label: "OrderLib.sol", value: "Shared order struct and hashing (EIP-712)." },
      ],
    },
  },
  {
    id: "fees",
    label: "Fee Structure",
    category: "Reference",
    content: {
      title: "Fee Structure",
      body: "Fees only apply to Instant Bridge mode. Classic Bridge has zero protocol fees.",
      table: [
        { label: "Instant Bridge Fee", value: "5 - 100 bps (0.05% - 1.00%), set by user" },
        { label: "Classic Bridge Fee", value: "0 (no filler, no extra fee)" },
        { label: "Fee Recipient", value: "The filler who fronts the funds" },
        { label: "How it works", value: "feeAmount = amount * feeBps / 10000. Filler receives amount + feeAmount from escrow after settlement." },
      ],
    },
  },
  {
    id: "network-config",
    label: "Network Configuration",
    category: "Reference",
    content: {
      title: "Network Configuration",
      body: "Current testnet deployment:",
      table: [
        { label: "Source Chain", value: "Polkadot Hub Testnet (chain ID 420420417)" },
        { label: "Destination Chain", value: "Arbitrum Sepolia (chain ID 421614) → Hyperliquid Testnet" },
        { label: "IntentGateway", value: "0xf1860c78a3fcb470321904936D8672A4bEbf9C3d (Polkadot Hub Testnet)" },
        { label: "IntentSettler", value: "0xc3b89b522812d4966193367b8698969A8FbC9c4B (Arbitrum Sepolia)" },
        { label: "MockUSDC (source)", value: "0xb5C8B011f9EBDBB73cd9EF89aCdb05d64Cd972b2 (6 decimals)" },
        { label: "USDC2 (dest)", value: "0x1baAbB04529D43a73232B713C0FE471f7c7334d5 (Arbitrum Sepolia)" },
        { label: "TEEVerifier", value: "0x375bC4F385cFed492a8efD384912baB912033E2B (Phala Network)" },
        { label: "HL Bridge2", value: "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89 (auto-deposit to Hyperliquid)" },
        { label: "Filler Window", value: "30 seconds (time for filler to fill before fallback)" },
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
            "Instant Bridge requires active fillers. If no filler picks up your order within 30s, the system automatically falls back to Classic Bridge — your funds are always delivered.",
            "Higher fee offers attract fillers faster. 5 bps minimum, 100 bps maximum.",
            "Classic Bridge is fully trustless — no third party involved, just ZK proofs.",
            "Orders can be cancelled after expiry if neither filled nor settled.",
            "ZK BEEFY proof verification is simplified for the hackathon demo (accepts proof.length >= 32).",
            "USDC uses 6 decimals. 100 USDC = 100,000,000 in raw units.",
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
