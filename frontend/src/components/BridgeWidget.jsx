import { useState, useEffect, useCallback } from "react";
import { motion, useAnimation } from "motion/react";
import {
  useAccount,
  useConnect,
  useChainId,
  useSwitchChain,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { polkadotHubTestnet, arbitrumSepolia } from "../config/wagmi";
import { parseUnits, formatUnits, keccak256, encodePacked } from "viem";
import {
  INTENT_GATEWAY_ADDRESS,
  USDC_ADDRESS,
  INTENT_GATEWAY_ABI,
  INTENT_SETTLER_ABI,
  ERC20_ABI,
  PRIVACY_POOL_ADDRESS,
  PRIVACY_POOL_ABI,
  CHAINS,
  DEST_CHAINS,
  MIN_FEE_BPS,
  MAX_FEE_BPS,
  BPS_DENOMINATOR,
  SOURCE_CHAIN_ID,
  DEST_CHAIN_ID,
  OrderStatus,
  ORDER_STATUS_LABELS,
  HL_BRIDGE_ADDRESS,
} from "../config/contracts";
import polkadotDotLogo from "../assets svg/polkadot-new-dot-logo.svg";
import "./BridgeWidget.css";

/* ===== SVG ICONS ===== */

const UsdcLogo = ({ size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 2000 2000" xmlns="http://www.w3.org/2000/svg">
    <path d="M1000 2000c554.17 0 1000-445.83 1000-1000S1554.17 0 1000 0 0 445.83 0 1000s445.83 1000 1000 1000z" fill="#2775ca"/>
    <path d="M1275 1158.33c0-145.83-87.5-195.83-262.5-216.66-125-16.67-150-50-150-108.34s41.67-95.83 125-95.83c75 0 116.67 25 137.5 87.5 4.17 12.5 16.67 20.83 29.17 20.83h66.66c16.67 0 29.17-12.5 29.17-29.16v-4.17c-16.67-91.67-91.67-162.5-187.5-170.83v-100c0-16.67-12.5-29.17-33.33-33.34h-62.5c-16.67 0-29.17 12.5-33.34 33.34v95.83c-125 16.67-204.16 100-204.16 204.17 0 137.5 83.33 191.66 258.33 212.5 116.67 20.83 154.17 45.83 154.17 112.5s-58.34 112.5-137.5 112.5c-108.34 0-145.84-45.84-158.34-108.34-4.16-16.66-16.66-25-29.16-25h-70.84c-16.66 0-29.16 12.5-29.16 29.17v4.17c16.66 104.16 83.33 179.16 220.83 200v100c0 16.66 12.5 29.16 33.33 33.33h62.5c16.67 0 29.17-12.5 33.34-33.33v-100c125-20.84 208.33-108.34 208.33-220.84z" fill="#fff"/>
    <path d="M787.5 1595.83c-325-116.66-491.67-479.16-370.83-800 62.5-175 200-308.33 370.83-370.83 16.67-8.33 25-20.83 25-41.67V325c0-16.67-8.33-29.17-25-33.33-4.17 0-12.5 0-16.67 4.16-395.83 125-612.5 545.84-487.5 941.67 75 233.33 254.17 412.5 487.5 487.5 16.67 8.33 33.34 0 37.5-16.67 4.17-4.16 4.17-8.33 4.17-16.66v-58.34c0-12.5-12.5-29.16-25-37.5zM1229.17 295.83c-16.67-8.33-33.34 0-37.5 16.67-4.17 4.17-4.17 8.33-4.17 16.67v58.33c0 16.67 12.5 33.33 25 41.67 325 116.66 491.67 479.16 370.83 800-62.5 175-200 308.33-370.83 370.83-16.67 8.33-25 20.83-25 41.67V1700c0 16.67 8.33 29.17 25 33.33 4.17 0 12.5 0 16.67-4.16 395.83-125 612.5-545.84 487.5-941.67-75-237.5-258.34-416.67-487.5-491.67z" fill="#fff"/>
  </svg>
);

const PolkadotLogo = ({ size = 18 }) => (
  <div style={{
    width: size,
    height: size,
    borderRadius: "50%",
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  }}>
    <img src={polkadotDotLogo} alt="Polkadot" width={size * 0.65} height={size * 0.65} />
  </div>
);

const HyperliquidLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg">
    <circle cx="72" cy="72" r="72" fill="#B0F2B6"/>
    <path d="M144 71.6991C144 119.306 114.866 134.582 99.5156 120.98C86.8804 109.889 83.1211 86.4521 64.116 84.0456C39.9942 81.0113 37.9057 113.133 22.0334 113.133C3.5504 113.133 0 86.2428 0 72.4315C0 58.3063 3.96809 39.0542 19.736 39.0542C38.1146 39.0542 39.1588 66.5722 62.132 65.1073C85.0007 63.5379 85.4184 34.8689 100.247 22.6271C113.195 12.0593 144 23.4641 144 71.6991Z" fill="#072723" transform="scale(0.65) translate(40, 40)"/>
  </svg>
);

const ArbitrumLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="12" fill="#213147"/>
    <path d="M13.5 5.5L17.5 12L13.5 18.5H10.5L14.5 12L10.5 5.5H13.5Z" fill="#12AAFF"/>
    <path d="M10 5.5L14 12L10 18.5H7L11 12L7 5.5H10Z" fill="white"/>
  </svg>
);

const ChevronDownIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 10 6" fill="none">
    <path d="m1 1 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SettingsIcon = ({ size = 20 }) => {
  const controls = useAnimation();
  return (
    <motion.svg
      animate={controls}
      onMouseEnter={() => controls.start({ rotate: 180 })}
      onMouseLeave={() => controls.start({ rotate: 0 })}
      fill="none"
      height={size}
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      transition={{ type: "spring", stiffness: 50, damping: 10 }}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </motion.svg>
  );
};

const ArrowDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="m20 12-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8z" />
  </svg>
);

const WalletIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 4H6C3.79 4 2 5.79 2 8v8c0 2.21 1.79 4 4 4h12c2.21 0 4-1.79 4-4V8c0-2.21-1.79-4-4-4m-1.86 9.77c-.24.2-.57.28-.88.2L4.15 11.25C4.45 10.52 5.16 10 6 10h12c.67 0 1.26.34 1.63.84zM6 6h12c1.1 0 2 .9 2 2v.55c-.59-.34-1.27-.55-2-.55H6c-.73 0-1.41.21-2 .55V8c0-1.1.9-2 2-2" />
  </svg>
);

/* ===== COPY BUTTON ===== */
const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy to clipboard"}
      style={{
        background: copied ? "rgba(76,175,80,0.15)" : "rgba(255,255,255,0.06)",
        border: copied ? "1px solid rgba(76,175,80,0.3)" : "1px solid rgba(255,255,255,0.1)",
        color: copied ? "#4CAF50" : "#8a8a8e",
        borderRadius: 6,
        padding: "3px 6px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        transition: "all 0.15s ease",
      }}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
};

/* ===== STEPS ===== */
const STEPS_INSTANT = [
  { key: "approve", label: "Approve USDC" },
  { key: "create", label: "Deposit to Pool" },
  { key: "pool_waiting", label: "Privacy Lock" },
  { key: "fill", label: "Filler Delivery" },
  { key: "settle", label: "Settlement" },
  { key: "deposit_hl", label: "Deposit to HL" },
];

const STANDARD_AMOUNTS = [
  { value: "6", label: "6" },
  { value: "7", label: "7" },
  { value: "8", label: "8" },
  { value: "9", label: "9" },
  { value: "10", label: "10" },
];
const DELIVERY_DELAYS = [
  { label: "Instant", seconds: 0 },
  { label: "15s", seconds: 15 },
  { label: "30s", seconds: 30 },
  { label: "1 min", seconds: 60 },
];

export default function BridgeWidget() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();
  const isWrongChain = isConnected && chainId !== SOURCE_CHAIN_ID;

  // UI state
  const [amount, setAmount] = useState("");
  const [showRecipient, setShowRecipient] = useState(false);

  // Auto-open destination address when amount is filled
  useEffect(() => {
    if (amount && parseFloat(amount) > 0) {
      setShowRecipient(true);
    }
  }, [amount]);
  const [destAddress, setDestAddress] = useState("");
  const [feeBps, setFeeBps] = useState(10);
  const [deliveryDelay, setDeliveryDelay] = useState(0); // seconds until HL deposit
  const [customDelay, setCustomDelay] = useState(""); // custom delay input
  const [countdown, setCountdown] = useState(0); // remaining seconds for delayed delivery
  const [countdownActive, setCountdownActive] = useState(false);
  const [isOrderSettled, setIsOrderSettled] = useState(false); // tracks if settlement is done
  const [step, setStep] = useState("input");
  const [error, setError] = useState(null);
  const [failedAt, setFailedAt] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("bridge");
  const [selectedDestChain, setSelectedDestChain] = useState(DEST_CHAIN_ID);
  const [showDestPicker, setShowDestPicker] = useState(false);

  // Privacy pool state
  const [poolSecret, setPoolSecret] = useState(null); // bytes32 random secret
  const [commitmentHash, setCommitmentHash] = useState(null);

  // Track tab state
  const [trackInput, setTrackInput] = useState("");
  const [trackedOrder, setTrackedOrder] = useState(null);
  const [trackedFill, setTrackedFill] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [trackError, setTrackError] = useState("");

  // Derived destination config
  const destChainConfig = DEST_CHAINS[selectedDestChain] || DEST_CHAINS[421614];
  const destChainObj = arbitrumSepolia; // underlying chain for RPC
  const DestLogo = HyperliquidLogo;

  // Auto-fill destination with connected address
  useEffect(() => {
    if (address && !destAddress) setDestAddress(address);
  }, [address]);

  // Read USDC balance
  const { data: usdcBalance, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Read USDC allowance for PrivacyPool
  const { data: usdcAllowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, PRIVACY_POOL_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  // Approve tx
  const {
    writeContract: approve,
    data: approveTxHash,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  // Create order tx
  const {
    writeContract: createOrder,
    data: createTxHash,
    error: createError,
    reset: resetCreate,
  } = useWriteContract();

  // Deposit to Hyperliquid tx
  const {
    writeContract: depositHL,
    data: depositHLTxHash,
    error: depositHLError,
    reset: resetDepositHL,
  } = useWriteContract();

  // Wait for deposit HL receipt (Arb Sepolia — fast RPC, wagmi default is fine)
  const { isSuccess: depositHLConfirmed, isError: depositHLReverted } =
    useWaitForTransactionReceipt({ hash: depositHLTxHash });

  // Manual fast polling for source chain tx receipts (Polkadot Hub RPC is slow)
  const [approveConfirmed, setApproveConfirmed] = useState(false);
  const [approveReverted, setApproveReverted] = useState(false);
  const [createConfirmed, setCreateConfirmed] = useState(false);
  const [createReverted, setCreateReverted] = useState(false);
  const [createReceipt, setCreateReceipt] = useState(null);

  useEffect(() => {
    if (!approveTxHash) return;
    let cancelled = false;
    const poll = async () => {
      const { createPublicClient, http } = await import("viem");
      const client = createPublicClient({ chain: polkadotHubTestnet, transport: http("https://eth-rpc-testnet.polkadot.io/") });
      while (!cancelled) {
        try {
          const receipt = await client.getTransactionReceipt({ hash: approveTxHash });
          if (receipt) {
            if (receipt.status === "success") setApproveConfirmed(true);
            else setApproveReverted(true);
            return;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [approveTxHash]);

  useEffect(() => {
    if (!createTxHash) return;
    let cancelled = false;
    const poll = async () => {
      const { createPublicClient, http } = await import("viem");
      const client = createPublicClient({ chain: polkadotHubTestnet, transport: http("https://eth-rpc-testnet.polkadot.io/") });
      while (!cancelled) {
        try {
          const receipt = await client.getTransactionReceipt({ hash: createTxHash });
          if (receipt) {
            if (receipt.status === "success") { setCreateReceipt(receipt); setCreateConfirmed(true); }
            else setCreateReverted(true);
            return;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [createTxHash]);

  // Track orderId from createOrder tx logs
  const [orderId, setOrderId] = useState(null);
  const [fillerWithdrawTxHash, setFillerWithdrawTxHash] = useState(null);

  // Computed values
  const amountWei = amount ? parseUnits(amount, 6) : 0n;
  const feeAmount =
    amountWei > 0n
      ? (amountWei * BigInt(feeBps)) / BigInt(BPS_DENOMINATOR)
      : 0n;
  const receiveAmount = amountWei > 0n ? amountWei - feeAmount : 0n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  // Read TEE encryption public key from contract (for private orders)
  const { data: teePubKey } = useReadContract({
    address: INTENT_GATEWAY_ADDRESS,
    abi: INTENT_GATEWAY_ABI,
    functionName: "teeEncryptionPubKey",
  });

  // All orders are anonymous — deposit into PrivacyPool with encrypted dest
  const submitOrder = async () => {
    const recipient = destAddress || address;
    // Generate random secret
    const secretBytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = "0x" + Array.from(secretBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const commitment = keccak256(encodePacked(["bytes32"], [secret]));
    setPoolSecret(secret);
    setCommitmentHash(commitment);
    // Store secret in localStorage for recovery
    localStorage.setItem(`velora_secret_${commitment}`, secret);

    // Hex helpers (browser-compatible, no Buffer needed)
    const hexToBytes = (hex) => {
      const h = hex.startsWith("0x") ? hex.slice(2) : hex;
      const bytes = new Uint8Array(h.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.substr(i * 2, 2), 16);
      return bytes;
    };
    const bytesToHex = (bytes) => Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');

    // Encrypt destAddress and secret with TEE pubkey
    if (teePubKey && teePubKey !== "0x") {
      try {
        const { encrypt } = await import("eciesjs");
        const addrBytes = hexToBytes(recipient.slice(2)); // 20 bytes
        const pubKeyHex = teePubKey.startsWith("0x") ? teePubKey.slice(2) : teePubKey;
        const encryptedDest = encrypt(pubKeyHex, addrBytes);
        const encryptedDestHex = "0x" + bytesToHex(encryptedDest);

        // Encrypt the secret too (TEE will decrypt it to trigger withdraw)
        const secBytes = hexToBytes(secret.slice(2)); // 32 bytes
        const encryptedSecretBytes = encrypt(pubKeyHex, secBytes);
        const encryptedSecretHex = "0x" + bytesToHex(encryptedSecretBytes);

        createOrder({
          address: PRIVACY_POOL_ADDRESS,
          abi: PRIVACY_POOL_ABI,
          functionName: "deposit",
          args: [amountWei, commitment, encryptedDestHex, encryptedSecretHex, BigInt(deliveryDelay)],
        });
      } catch (err) {
        console.warn("ECIES encryption failed:", err);
        const fallbackDest = "0x" + recipient.slice(2).padStart(40, '0');
        const fallbackSecret = secret;
        createOrder({
          address: PRIVACY_POOL_ADDRESS,
          abi: PRIVACY_POOL_ABI,
          functionName: "deposit",
          args: [amountWei, commitment, fallbackDest, fallbackSecret, BigInt(deliveryDelay)],
        });
      }
    } else {
      // TEE pubkey not yet set — use unencrypted address and secret as bytes
      const fallbackDest = "0x" + recipient.slice(2).padStart(40, '0');
      const fallbackSecret = secret;
      createOrder({
        address: PRIVACY_POOL_ADDRESS,
        abi: PRIVACY_POOL_ABI,
        functionName: "deposit",
        args: [amountWei, commitment, fallbackDest, fallbackSecret, BigInt(deliveryDelay)],
      });
    }
  };

  // After approve confirms -> create order
  useEffect(() => {
    if (approveConfirmed && step === "approving") {
      submitOrder();
      setStep("creating");
    }
  }, [approveConfirmed, step]);

  // After deposit into pool confirms — start privacy delay countdown
  useEffect(() => {
    if (createConfirmed && step === "creating") {
      // Start countdown for privacy delay
      if (deliveryDelay > 0) {
        setCountdown(deliveryDelay);
        setCountdownActive(true);
      }
      setStep("pool_waiting");
    }
  }, [createConfirmed, step]);

  // Poll order status on source chain (getOrder) and destination chain (getFill)
  useEffect(() => {
    if (!orderId || (step !== "waiting_fill" && step !== "settling")) return;

    const interval = setInterval(async () => {
      try {
        // Check source chain order status
        const { createPublicClient, http } = await import("viem");

        const sourceClient = createPublicClient({
          chain: polkadotHubTestnet,
          transport: http("https://eth-rpc-testnet.polkadot.io/"),
        });

        const destClient = createPublicClient({
          chain: destChainObj,
          transport: http(destChainConfig.rpc),
        });

        // Read order status on source
        const order = await sourceClient.readContract({
          address: INTENT_GATEWAY_ADDRESS,
          abi: INTENT_GATEWAY_ABI,
          functionName: "getOrder",
          args: [orderId],
        });

        const status = Number(order.status);

        // Check fill on destination (using dynamic settler address)
        const fill = await destClient.readContract({
          address: destChainConfig.settlerAddress,
          abi: INTENT_SETTLER_ABI,
          functionName: "getFill",
          args: [orderId],
        });

        const isFilled = fill.fillTimestamp > 0n;
        const isSettled = fill.settled;

        if (status === OrderStatus.Settled || isSettled) {
          setIsOrderSettled(true);
          if (!countdownActive) {
            setStep("depositing_hl"); // countdown done + settled → deposit
          }
        } else if (status === OrderStatus.Filled || isFilled) {
          setStep("settling");
        }
      } catch (err) {
        console.error("[Poll] Error checking order status:", err);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [orderId, step]);

  // Countdown timer for privacy delay (starts after pool deposit)
  useEffect(() => {
    if (!countdownActive || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setCountdownActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdownActive, countdown]);

  // Poll for PrivateOrderPlaced event (created by filler via PrivacyPool withdraw)
  const [poolDepositBlock, setPoolDepositBlock] = useState(null);

  // Record block number when pool deposit confirms
  useEffect(() => {
    if (createConfirmed && !poolDepositBlock) {
      (async () => {
        try {
          const { createPublicClient, http } = await import("viem");
          const client = createPublicClient({ chain: polkadotHubTestnet, transport: http("https://eth-rpc-testnet.polkadot.io/") });
          const block = await client.getBlockNumber();
          setPoolDepositBlock(block);
        } catch {}
      })();
    }
  }, [createConfirmed]);

  useEffect(() => {
    if (step !== "pool_waiting" || countdownActive) return;
    // Countdown done — poll for the order created by filler's withdraw
    const PRIVATE_ORDER_TOPIC = "0xfadfdbb2e4035392794a52d22bf4c0a8314d0003ca4b9afdcd840c2aaad13752";
    const interval = setInterval(async () => {
      try {
        const { createPublicClient, http } = await import("viem");
        const sourceClient = createPublicClient({
          chain: polkadotHubTestnet,
          transport: http("https://eth-rpc-testnet.polkadot.io/"),
        });
        const currentBlock = await sourceClient.getBlockNumber();
        const fromBlock = poolDepositBlock ? poolDepositBlock : currentBlock - 200n;
        const logs = await sourceClient.getLogs({
          address: INTENT_GATEWAY_ADDRESS,
          topics: [PRIVATE_ORDER_TOPIC],
          fromBlock,
          toBlock: currentBlock,
        });
        // Find the most recent PrivateOrderPlaced event
        if (logs.length > 0) {
          const latestLog = logs[logs.length - 1];
          if (latestLog.topics && latestLog.topics.length >= 2) {
            setOrderId(latestLog.topics[1]);
            setFillerWithdrawTxHash(latestLog.transactionHash);
            setStep("waiting_fill");
          }
        }
      } catch (err) {
        console.error("[Poll] Error checking for order:", err);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [step, countdownActive, poolDepositBlock]);

  // When settlement completes → deposit HL
  useEffect(() => {
    if (isOrderSettled && step === "settling") {
      setStep("depositing_hl");
    }
  }, [isOrderSettled, step]);

  // ──── Track Order ────
  const handleTrack = useCallback(async () => {
    const id = trackInput.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
      setTrackError("Invalid Order ID (must be 0x + 64 hex chars)");
      return;
    }
    setTrackError("");
    setTrackedOrder(null);
    setTrackedFill(null);
    setIsTracking(true);

    try {
      const { createPublicClient, http } = await import("viem");
      const sourceClient = createPublicClient({
        chain: polkadotHubTestnet,
        transport: http("https://eth-rpc-testnet.polkadot.io/"),
      });
      const order = await sourceClient.readContract({
        address: INTENT_GATEWAY_ADDRESS,
        abi: INTENT_GATEWAY_ABI,
        functionName: "getOrder",
        args: [id],
      });

      if (Number(order.status) === OrderStatus.None) {
        setTrackError("Order not found");
        setIsTracking(false);
        return;
      }
      setTrackedOrder(order);

      try {
        const destClient = createPublicClient({
          chain: destChainObj,
          transport: http(destChainConfig.rpc),
        });
        const fill = await destClient.readContract({
          address: destChainConfig.settlerAddress,
          abi: INTENT_SETTLER_ABI,
          functionName: "getFill",
          args: [id],
        });
        setTrackedFill(fill);
      } catch (_) {
        // fill may not exist yet
      }
    } catch (err) {
      console.error("[Track] Error:", err);
      setTrackError("Failed to fetch order");
      setIsTracking(false);
    }
  }, [trackInput, destChainConfig, destChainObj]);

  const handleStopTracking = useCallback(() => {
    setIsTracking(false);
    setTrackedOrder(null);
    setTrackedFill(null);
    setTrackInput("");
    setTrackError("");
  }, []);

  // Poll tracked order
  useEffect(() => {
    if (!isTracking || !trackInput) return;
    const id = trackInput.trim();

    const TERMINAL = [OrderStatus.Settled, OrderStatus.Expired, OrderStatus.Cancelled];
    if (trackedOrder && TERMINAL.includes(Number(trackedOrder.status))) return;

    const interval = setInterval(async () => {
      try {
        const { createPublicClient, http } = await import("viem");
        const sourceClient = createPublicClient({
          chain: polkadotHubTestnet,
          transport: http("https://eth-rpc-testnet.polkadot.io/"),
        });
        const order = await sourceClient.readContract({
          address: INTENT_GATEWAY_ADDRESS,
          abi: INTENT_GATEWAY_ABI,
          functionName: "getOrder",
          args: [id],
        });
        setTrackedOrder(order);

        try {
          const destClient = createPublicClient({
            chain: destChainObj,
            transport: http(destChainConfig.rpc),
          });
          const fill = await destClient.readContract({
            address: destChainConfig.settlerAddress,
            abi: INTENT_SETTLER_ABI,
            functionName: "getFill",
            args: [id],
          });
          setTrackedFill(fill);
        } catch (_) {}
      } catch (err) {
        console.error("[Track Poll] Error:", err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isTracking, trackInput, trackedOrder?.status, destChainConfig, destChainObj]);

  // Debug logging
  useEffect(() => {
    console.log("[Bridge] step:", step, "approveTxHash:", approveTxHash, "approveConfirmed:", approveConfirmed, "approveError:", approveError?.message?.slice(0, 80));
  }, [step, approveTxHash, approveConfirmed, approveError]);

  useEffect(() => {
    console.log("[Bridge] createTxHash:", createTxHash, "createConfirmed:", createConfirmed, "createError:", createError?.message?.slice(0, 80));
  }, [createTxHash, createConfirmed, createError]);

  // Handle errors
  useEffect(() => {
    if (approveError && step === "approving") {
      setError(approveError.message?.slice(0, 150) || "Approval failed");
      setFailedAt("approve");
      setStep("failed");
    }
  }, [approveError, step]);

  useEffect(() => {
    if (createError && step === "creating") {
      setError(createError.message?.slice(0, 150) || "Order creation failed");
      setFailedAt("create");
      setStep("failed");
    }
  }, [createError, step]);

  useEffect(() => {
    if (approveReverted && step === "approving") {
      setError("Approve transaction reverted");
      setFailedAt("approve");
      setStep("failed");
    }
  }, [approveReverted, step]);

  useEffect(() => {
    if (createReverted && step === "creating") {
      setError("Pool deposit transaction reverted");
      setFailedAt("create");
      setStep("failed");
    }
  }, [createReverted, step]);

  // Auto-deposit to Hyperliquid
  const [depositHLTriggered, setDepositHLTriggered] = useState(false);

  // Step 1: auto-switch chain when entering depositing_hl
  useEffect(() => {
    if (step !== "depositing_hl" || depositHLTriggered) return;
    if (chainId !== arbitrumSepolia.id) {
      switchChain({ chainId: arbitrumSepolia.id });
    }
  }, [step, depositHLTriggered, chainId]);

  // Step 2: auto-send deposit once on correct chain + correct wallet
  useEffect(() => {
    if (step !== "depositing_hl" || depositHLTriggered) return;
    if (chainId !== arbitrumSepolia.id) return;
    // If user set a custom destination, wait for them to switch wallet
    const destWallet = destAddress || address;
    if (destWallet.toLowerCase() !== address.toLowerCase()) return;
    setDepositHLTriggered(true);

    (async () => {
      try {
        const { createPublicClient, http } = await import("viem");
        const arbClient = createPublicClient({
          chain: arbitrumSepolia,
          transport: http(destChainConfig.rpc),
        });
        const gasPrice = await arbClient.getGasPrice();

        depositHL({
          address: destChainConfig.usdcAddress,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [HL_BRIDGE_ADDRESS, receiveAmount],
          gasPrice: gasPrice * 2n,
        });
      } catch {
        depositHL({
          address: destChainConfig.usdcAddress,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [HL_BRIDGE_ADDRESS, receiveAmount],
        });
      }
    })();
  }, [step, depositHLTriggered, chainId, address]);

  // Deposit HL confirmed → completed
  useEffect(() => {
    if (depositHLConfirmed && step === "depositing_hl") {
      setStep("completed");
    }
  }, [depositHLConfirmed]);

  // Deposit HL errors
  useEffect(() => {
    if (depositHLError && step === "depositing_hl") {
      setError(depositHLError.message?.slice(0, 150) || "Hyperliquid deposit failed");
      setFailedAt("deposit_hl");
      setStep("failed");
    }
  }, [depositHLError]);

  useEffect(() => {
    if (depositHLReverted && step === "depositing_hl") {
      setError("Hyperliquid deposit transaction reverted");
      setFailedAt("deposit_hl");
      setStep("failed");
    }
  }, [depositHLReverted]);

  // Handlers
  const handleBridge = () => {
    setError(null);
    setFailedAt(null);
    resetApprove();
    resetCreate();

    // Skip approve if allowance already sufficient
    if (usdcAllowance !== undefined && usdcAllowance >= amountWei) {
      submitOrder();
      setStep("creating");
      return;
    }

    approve({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [PRIVACY_POOL_ADDRESS, amountWei],
    });
    setStep("approving");
  };

  const handleReset = () => {
    setStep("input");
    setAmount("");
    setError(null);
    setFailedAt(null);
    setDepositHLTriggered(false);
    setDeliveryDelay(0);
    setCustomDelay("");
    setCountdown(0);
    setCountdownActive(false);
    setIsOrderSettled(false);
    setPoolSecret(null);
    setCommitmentHash(null);
    setFillerWithdrawTxHash(null);
    setPoolDepositBlock(null);
    resetApprove();
    resetCreate();
    resetDepositHL();
    setApproveConfirmed(false);
    setApproveReverted(false);
    setCreateConfirmed(false);
    setCreateReverted(false);
    setCreateReceipt(null);
    refetchBalance();
    refetchAllowance();
  };

  // Button state
  const getButtonConfig = () => {
    if (!isConnected) {
      return {
        text: "Connect Wallet",
        disabled: false,
        variant: "primary",
        onClick: () => connect({ connector: connectors[0] }),
      };
    }
    if (isWrongChain)
      return {
        text: "Switch to Polkadot Hub",
        disabled: false,
        variant: "primary",
        onClick: () => switchChain({ chainId: polkadotHubTestnet.id }),
      };
    if (!amount || parseFloat(amount) === 0)
      return { text: "Select an amount", disabled: true, variant: "secondary" };
    const validAmounts = STANDARD_AMOUNTS.map((a) => a.value);
    if (!validAmounts.includes(amount))
      return { text: "Select a valid amount (Min, 6-10)", disabled: true, variant: "secondary" };
    if (usdcBalance !== undefined && parseUnits(amount || "0", 6) > usdcBalance)
      return { text: "Insufficient USDC balance", disabled: true, variant: "secondary" };
    return {
      text: "Bridge",
      disabled: false,
      variant: "primary",
      onClick: handleBridge,
    };
  };

  const buttonConfig = getButtonConfig();
  const steps = STEPS_INSTANT;

  // Step progress
  const getStepStatus = (stepKey) => {
    const order = ["approve", "create", "pool_waiting", "fill", "settle", "deposit_hl"];
    const stepIndex = order.indexOf(stepKey);
    const stepMap = {
      approving: 0,
      creating: 1,
      pool_waiting: 2,
      waiting_fill: 3,
      settling: 4,
      depositing_hl: 5,
      completed: 6,
    };
    const currentIndex = stepMap[step];
    if (step === "failed" && failedAt) {
      const failedIndex = order.indexOf(failedAt);
      if (stepIndex < failedIndex) return "completed";
      if (stepIndex === failedIndex) return "failed";
      return "pending";
    }
    if (currentIndex === undefined) return "pending";
    if (stepIndex < currentIndex) return "completed";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  };

  /* ========== RENDER: PROGRESS VIEW ========== */
  if (step !== "input" && step !== "failed" && step !== "completed") {
    return (
      <div className="bridge-widget">
        <div className="bridge-header">
          <div className="bridge-header-left">
            <span className="bridge-title">
              {"Anonymous Bridge"}
            </span>
          </div>
        </div>
        <div className="bridge-body">
          <div className="bridge-progress">
            <div className="bridge-steps">
              {steps.map((s, i) => {
                const status = getStepStatus(s.key);
                return (
                  <div key={s.key} className={`bridge-step ${status === "active" ? "active" : ""}`}>
                    <div className={`bridge-step-icon ${status}`}>
                      {status === "completed" ? (
                        "\u2713"
                      ) : status === "active" ? (
                        <div className="step-spinner" />
                      ) : status === "failed" ? (
                        "!"
                      ) : (
                        i + 1
                      )}
                    </div>
                    <div>
                      <div className="bridge-step-text">{s.label}</div>
                      {status === "active" && (
                        <div style={{ color: "#FC007B", fontSize: 12, marginTop: 2 }}>
                          {step === "approving" && "Confirm in wallet..."}
                          {step === "creating" && "Depositing to privacy pool..."}
                          {step === "pool_waiting" && countdownActive && (
                            <span>Privacy lock: {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}</span>
                          )}
                          {step === "pool_waiting" && !countdownActive && "Waiting for TEE to trigger bridge..."}
                          {step === "waiting_fill" && "Waiting for filler (~2s)..."}
                          {step === "settling" && "TEE anonymous settlement..."}
                          {step === "depositing_hl" && !depositHLTriggered && destAddress && destAddress.toLowerCase() !== address?.toLowerCase() && (
                            <span>Switch to your destination wallet ({destAddress.slice(0, 6)}...{destAddress.slice(-4)}) to deposit on Hyperliquid</span>
                          )}
                          {step === "depositing_hl" && !depositHLTriggered && (!destAddress || destAddress.toLowerCase() === address?.toLowerCase()) && "Switching chain..."}
                          {step === "depositing_hl" && depositHLTriggered && "Depositing to Hyperliquid..."}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Privacy countdown */}
            {step === "pool_waiting" && (
              <div className="privacy-countdown">
                {countdownActive ? (
                  <>
                    <div className="privacy-countdown-timer">
                      {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                    </div>
                    <div className="privacy-countdown-label">Privacy lock in progress</div>
                    <div className="privacy-countdown-sub">Funds are mixing in the pool</div>
                  </>
                ) : (
                  <>
                    <div className="privacy-countdown-timer" style={{ color: "#FC007B" }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <div className="privacy-countdown-label">Waiting for TEE filler</div>
                    <div className="privacy-countdown-sub">The filler will trigger the bridge automatically</div>
                  </>
                )}
              </div>
            )}

            {/* Amount summary */}
            <div className="bridge-route-card" style={{ marginTop: 20 }}>
              <div className="bridge-route-receive">
                <div className="bridge-route-receive-left">
                  <div className="bridge-badge small">
                    <div className="bridge-badge-token"><UsdcLogo size={32} /></div>
                    <div className="bridge-badge-chain"><DestLogo size={14} /></div>
                  </div>
                  <div className="bridge-route-receive-info">
                    <span className="bridge-route-receive-amount">
                      {formatUnits(receiveAmount, 6)} USDC
                    </span>
                    <span className="bridge-route-receive-chain">on {destChainConfig.shortName}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    );
  }

  /* ========== RENDER: FAILED VIEW ========== */
  if (step === "failed") {
    return (
      <div className="bridge-widget">
        <div className="bridge-body">
          <div className="bridge-result">
            <div className="bridge-result-icon error">!</div>
            <div className="bridge-result-title">Transaction Failed</div>
            <div className="bridge-result-subtitle">{error}</div>
            <div className="bridge-result-actions">
              <button className="bridge-btn primary" onClick={handleReset}>
                Try Again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ========== RENDER: COMPLETED VIEW ========== */
  if (step === "completed") {
    return (
      <div className="bridge-widget">
        <div className="bridge-body">
          <div className="bridge-result">
            <div className="bridge-result-icon success">{"\u2713"}</div>
            <div className="bridge-result-title">Bridge Complete</div>
            <div className="bridge-result-subtitle">
              {"Your USDC has been anonymously deposited to Hyperliquid Testnet via TEE (dstack)."}
            </div>
            <div className="bridge-result-details">
              <div className="bridge-result-row">
                <span className="label">Amount</span>
                <span className="value">{amount} USDC</span>
              </div>
              <div className="bridge-result-row">
                <span className="label">Received</span>
                <span className="value">{formatUnits(receiveAmount, 6)} USDC</span>
              </div>
              <div className="bridge-result-row">
                <span className="label">Mode</span>
                <span className="value">{"TEE Anonymous"}</span>
              </div>
              {orderId && (
                <div className="bridge-result-row">
                  <span className="label">Order ID</span>
                  <span className="value" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, fontFamily: "monospace" }}>
                      {orderId.slice(0, 10)}...{orderId.slice(-8)}
                    </span>
                    <CopyButton text={orderId} />
                  </span>
                </div>
              )}
              {fillerWithdrawTxHash && (
                <div className="bridge-result-row">
                  <span className="label">Withdraw TX</span>
                  <a
                    href={`https://blockscout-testnet.polkadot.io/tx/${fillerWithdrawTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="value"
                    style={{ color: "#FC007B", textDecoration: "underline", fontSize: 12 }}
                  >
                    {fillerWithdrawTxHash.slice(0, 10)}...{fillerWithdrawTxHash.slice(-8)}
                  </a>
                </div>
              )}
              {createTxHash && (
                <div className="bridge-result-row">
                  <span className="label">Deposit TX</span>
                  <a
                    href={`https://blockscout-testnet.polkadot.io/tx/${createTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="value"
                    style={{ color: "#FC007B", textDecoration: "underline", fontSize: 12 }}
                  >
                    {createTxHash.slice(0, 10)}...{createTxHash.slice(-8)}
                  </a>
                </div>
              )}
              {depositHLTxHash && (
                <div className="bridge-result-row">
                  <span className="label">Deposit TX</span>
                  <a
                    href={`https://sepolia.arbiscan.io/tx/${depositHLTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="value"
                    style={{ color: "#FC007B", textDecoration: "underline", fontSize: 12 }}
                  >
                    {depositHLTxHash.slice(0, 10)}...{depositHLTxHash.slice(-8)}
                  </a>
                </div>
              )}
            </div>
            <div className="bridge-result-actions">
              <button className="bridge-btn primary" onClick={handleReset}>
                Bridge Again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ========== RENDER: INPUT VIEW (LI.FI style) ========== */
  return (
    <div className="bridge-widget">
      {/* Header */}
      <div className="bridge-header">
        <div className="bridge-header-left">
          <span className="bridge-title">Bridge</span>
          <div className="bridge-tabs">
            <button
              className={`bridge-tab ${activeTab === "bridge" ? "active" : ""}`}
              onClick={() => setActiveTab("bridge")}
            >
              Swap
            </button>
            <button
              className={`bridge-tab ${activeTab === "track" ? "active" : ""}`}
              onClick={() => setActiveTab("track")}
            >
              Track
            </button>
          </div>
        </div>
        <button
          className={`bridge-settings-btn ${showSettings ? "active" : ""}`}
          onClick={() => setShowSettings(!showSettings)}
        >
          <SettingsIcon />
        </button>
      </div>

      {/* Settings overlay (outside widget) */}
      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3 className="settings-modal-title">Privacy Lock Duration</h3>
              <button className="settings-modal-close" onClick={() => setShowSettings(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <p className="settings-modal-desc">How long should your funds stay in the privacy pool before bridging? A longer lock improves anonymity.</p>
            <div className="settings-modal-options">
              {DELIVERY_DELAYS.map((d) => (
                <button
                  key={d.seconds}
                  className={`settings-delay-option ${deliveryDelay === d.seconds && !customDelay ? "active" : ""}`}
                  onClick={() => { setDeliveryDelay(d.seconds); setCustomDelay(""); setShowSettings(false); }}
                >
                  <span className="settings-delay-label">{d.label}</span>
                  <span className="settings-delay-desc">
                    {d.seconds === 0 ? "No lock, bridge immediately" : `Lock for ${d.label.toLowerCase()}`}
                  </span>
                </button>
              ))}
            </div>
            <div className="settings-custom-delay">
              <span className="settings-custom-label">Custom duration (seconds)</span>
              <div className="settings-custom-input-row">
                <input
                  type="text"
                  inputMode="numeric"
                  className="settings-custom-input"
                  placeholder="e.g. 120"
                  value={customDelay}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^[0-9]*$/.test(v)) setCustomDelay(v);
                  }}
                />
                <button
                  className="settings-custom-btn"
                  disabled={!customDelay || parseInt(customDelay) < 0}
                  onClick={() => {
                    const secs = parseInt(customDelay) || 0;
                    setDeliveryDelay(secs);
                    setShowSettings(false);
                  }}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      {activeTab === "bridge" ? (
        <div className="bridge-body">
          {/* FROM card */}
          <div className="bridge-card">
            <div className="bridge-card-content">
              <div className="bridge-card-label">From</div>
              <div className="bridge-card-header">
                <div className="bridge-badge">
                  <div className="bridge-badge-token"><UsdcLogo size={40} /></div>
                  <div className="bridge-badge-chain"><PolkadotLogo size={18} /></div>
                </div>
                <div className="bridge-card-text">
                  <span className="bridge-card-title">USDC</span>
                  <span className="bridge-card-subtitle">Polkadot Asset Hub</span>
                </div>
              </div>
            </div>
          </div>

          {/* Swap arrow */}
          <div className="bridge-swap-wrapper">
            <div className="bridge-swap-pill">
              <ArrowDownIcon />
            </div>
          </div>

          {/* TO card */}
          <div className="bridge-card bridge-card-dest">
            <div className="bridge-card-content">
              <div className="bridge-card-label">To</div>
              <div className="bridge-card-header">
                <div className="bridge-badge">
                  <div className="bridge-badge-token"><UsdcLogo size={40} /></div>
                  <div className="bridge-badge-chain"><DestLogo size={18} /></div>
                </div>
                <div className="bridge-card-text">
                  <span className="bridge-card-title">USDC</span>
                  <span className="bridge-card-subtitle">{destChainConfig.shortName}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Send amount */}
          <div className="bridge-send-card">
            <div className="bridge-send-header">
              <span className="bridge-send-label">Send</span>
              {isConnected && (
                <span style={{ fontSize: 12, color: "#636366" }}>
                  6.00
                  <button className="bridge-send-max" onClick={() => setAmount("6")}>
                    MIN
                  </button>
                </span>
              )}
            </div>
            <div className="bridge-send-body">
              <div className="bridge-badge small">
                <div className="bridge-badge-token"><UsdcLogo size={32} /></div>
                <div className="bridge-badge-chain"><PolkadotLogo size={14} /></div>
              </div>
              <div className="bridge-send-input-area">
                <input
                  type="text"
                  inputMode="decimal"
                  className="bridge-send-input"
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^[0-9]*\.?[0-9]*$/.test(v)) setAmount(v);
                  }}
                  placeholder="0"
                />
                <div className="bridge-send-helper">
                  <span className="bridge-send-usd">
                    {amountWei > 0n
                      ? `~$${parseFloat(amount).toFixed(2)}`
                      : "$0.00"}
                  </span>
                  {isConnected && usdcBalance !== undefined && (
                    <span className="bridge-send-balance">
                      {parseFloat(formatUnits(usdcBalance, 6)).toFixed(2)}
                      <button className="bridge-send-max" onClick={() => setAmount("10")}>
                        MAX
                      </button>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Recipient area */}
          <div className={`bridge-recipient-area ${showRecipient ? "open" : ""}`}>
            <div className="bridge-recipient-card">
              <div className="bridge-recipient-header">
                <WalletIcon />
                <span className="bridge-recipient-title">Destination Address</span>
              </div>
              <input
                type="text"
                className="bridge-recipient-input"
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                placeholder={`0x... address on ${destChainConfig.shortName}`}
              />
            </div>
          </div>

          {/* Route card - shows when amount > 0 */}
          {amountWei > 0n && (
            <div className="bridge-route-card">
              <div className="bridge-route-receive">
                <div className="bridge-route-receive-left">
                  <div className="bridge-badge small">
                    <div className="bridge-badge-token"><UsdcLogo size={32} /></div>
                    <div className="bridge-badge-chain"><DestLogo size={14} /></div>
                  </div>
                  <div className="bridge-route-receive-info">
                    <span className="bridge-route-receive-amount">
                      {formatUnits(receiveAmount, 6)} USDC
                    </span>
                    <span className="bridge-route-receive-chain">
                      on {destChainConfig.shortName}
                      {destChainConfig.finalDestination && ` \u2192 ${destChainConfig.finalDestination}`}
                    </span>
                  </div>
                </div>
              </div>
              <div className="bridge-route-divider" />
              <div className="bridge-route-path">
                <div className="bridge-route-path-header">
                  <div className="bridge-route-path-left">
                    <div className="bridge-route-path-dot" />
                    <span className="bridge-route-path-name">Velora</span>
                  </div>
                  <span className="bridge-route-path-tag">
                    TEE ANONYMOUS
                  </span>
                </div>
                <div className="bridge-route-path-meta">
                  <span className="bridge-route-meta-item">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {destChainConfig.estimatedTime}
                  </span>
                  <span className="bridge-route-meta-sep" />
                  <span className="bridge-route-meta-item">
                    {destChainConfig.settlementMode === "tee" ? "TEE (dstack)" : "ZK BEEFY"}
                  </span>
                  {feeAmount > 0n && (
                    <>
                      <span className="bridge-route-meta-sep" />
                      <span className="bridge-route-meta-item">
                        Fee: {feeBps} bps
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Demo cap alert */}
          {buttonConfig.alert && (
            <div style={{
              background: "rgba(252,0,123,0.08)",
              border: "1px solid rgba(252,0,123,0.2)",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13,
              color: "#FC007B",
              lineHeight: 1.4,
              textAlign: "center",
            }}>
              {buttonConfig.alert}
            </div>
          )}

          {/* Actions */}
          <div className="bridge-actions">
            <button
              className={`bridge-btn ${buttonConfig.variant}`}
              disabled={buttonConfig.disabled}
              onClick={buttonConfig.onClick}
            >
              {buttonConfig.text}
            </button>
            <button
              className={`bridge-wallet-btn ${showRecipient ? "active" : ""}`}
              onClick={() => setShowRecipient(!showRecipient)}
              title="Send to another wallet"
            >
              <WalletIcon />
            </button>
          </div>
        </div>
      ) : (
        /* ========== TRACK TAB ========== */
        <div className="status-panel">
          <div className="status-panel-title">Track Order</div>

          {!isTracking ? (
            <>
              <div className="status-input-row">
                <input
                  type="text"
                  className="status-input"
                  placeholder="Enter order ID (0x...)"
                  value={trackInput}
                  onChange={(e) => { setTrackInput(e.target.value); setTrackError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleTrack()}
                />
                <button
                  className="status-track-btn"
                  disabled={!trackInput || trackInput.length < 10}
                  onClick={handleTrack}
                >
                  Track
                </button>
              </div>
              {trackError && <div className="track-error">{trackError}</div>}
            </>
          ) : (
            <div className="track-results">
              <div
                className="track-status-badge"
                data-status={ORDER_STATUS_LABELS[Number(trackedOrder?.status)]?.toLowerCase()}
              >
                {ORDER_STATUS_LABELS[Number(trackedOrder?.status)] || "Loading..."}
              </div>

              {trackedOrder && (
                <div className="track-details">
                  <div className="track-row">
                    <span className="label">Amount</span>
                    <span className="value">{formatUnits(trackedOrder.amount, 6)} USDC</span>
                  </div>
                  <div className="track-row">
                    <span className="label">Fee</span>
                    <span className="value">{formatUnits(trackedOrder.feeOffer, 6)} USDC</span>
                  </div>
                  <div className="track-row">
                    <span className="label">Sender</span>
                    <span className="value mono">
                      {trackedOrder.user?.slice(0, 8)}...{trackedOrder.user?.slice(-6)}
                    </span>
                  </div>
                  <div className="track-row">
                    <span className="label">Recipient</span>
                    <span className="value mono">
                      {trackedOrder.destAddress === "0x0000000000000000000000000000000000000000"
                        ? "Encrypted (TEE anonymous)"
                        : `${trackedOrder.destAddress?.slice(0, 8)}...${trackedOrder.destAddress?.slice(-6)}`}
                    </span>
                  </div>
                  <div className="track-row">
                    <span className="label">Created</span>
                    <span className="value">
                      {new Date(Number(trackedOrder.createdAt) * 1000).toLocaleString()}
                    </span>
                  </div>
                  <div className="track-row">
                    <span className="label">Deadline</span>
                    <span className="value">
                      {new Date(Number(trackedOrder.deadline) * 1000).toLocaleString()}
                    </span>
                  </div>
                </div>
              )}

              {trackedFill && trackedFill.fillTimestamp > 0n && (
                <div className="track-details" style={{ marginTop: 10 }}>
                  <div className="track-row">
                    <span className="label">Filled by</span>
                    <span className="value mono">
                      {trackedFill.filler?.slice(0, 8)}...{trackedFill.filler?.slice(-6)}
                    </span>
                  </div>
                  <div className="track-row">
                    <span className="label">Fill time</span>
                    <span className="value">
                      {new Date(Number(trackedFill.fillTimestamp) * 1000).toLocaleString()}
                    </span>
                  </div>
                  {trackedOrder?.createdAt > 0n && (
                    <div className="track-row">
                      <span className="label">Fill latency</span>
                      <span className="value">
                        {Number(trackedFill.fillTimestamp) - Number(trackedOrder.createdAt)}s
                      </span>
                    </div>
                  )}
                  <div className="track-row">
                    <span className="label">Settled</span>
                    <span className="value">
                      {trackedFill.settled ? "Yes" : "Pending..."}
                    </span>
                  </div>
                </div>
              )}

              <button className="track-back-btn" onClick={handleStopTracking}>
                ← New Search
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
