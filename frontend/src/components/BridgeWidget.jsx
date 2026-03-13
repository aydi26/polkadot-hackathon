import { useState, useEffect } from "react";
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
import { parseUnits, formatUnits } from "viem";
import {
  INTENT_GATEWAY_ADDRESS,
  USDC_ADDRESS,
  INTENT_GATEWAY_ABI,
  INTENT_SETTLER_ABI,
  ERC20_ABI,
  CHAINS,
  DEST_CHAINS,
  MIN_FEE_BPS,
  MAX_FEE_BPS,
  BPS_DENOMINATOR,
  FILLER_WINDOW,
  SOURCE_CHAIN_ID,
  DEST_CHAIN_ID,
  OrderStatus,
  HL_BRIDGE_ADDRESS,
} from "../config/contracts";
import ElasticSlider from "./ElasticSlider";
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
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="12" fill="#E6007A"/>
    <circle cx="12" cy="5.5" r="2.5" fill="white"/>
    <circle cx="12" cy="18.5" r="2.5" fill="white"/>
    <circle cx="6.5" cy="8.5" r="2" fill="white"/>
    <circle cx="17.5" cy="8.5" r="2" fill="white"/>
    <circle cx="6.5" cy="15.5" r="2" fill="white"/>
    <circle cx="17.5" cy="15.5" r="2" fill="white"/>
  </svg>
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

const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6" />
  </svg>
);

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

/* ===== STEPS ===== */
const STEPS_INSTANT = [
  { key: "approve", label: "Approve USDC" },
  { key: "create", label: "Create Order" },
  { key: "fill", label: "Filler Delivery" },
  { key: "settle", label: "Settlement" },
  { key: "deposit_hl", label: "Deposit to HL" },
];

const STEPS_CLASSIC = [
  { key: "approve", label: "Approve USDC" },
  { key: "create", label: "Create Order" },
  { key: "fallback", label: "Fallback Bridge" },
  { key: "settle", label: "ZK BEEFY Settlement" },
  { key: "deposit_hl", label: "Deposit to HL" },
];

export default function BridgeWidget() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();
  const isWrongChain = isConnected && chainId !== SOURCE_CHAIN_ID;

  // UI state
  const [bridgeMode, setBridgeMode] = useState("instant");
  const [amount, setAmount] = useState("");
  const [showRecipient, setShowRecipient] = useState(false);
  const [destAddress, setDestAddress] = useState("");
  const [feeBps, setFeeBps] = useState(10);
  const [step, setStep] = useState("input");
  const [error, setError] = useState(null);
  const [failedAt, setFailedAt] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("bridge");
  const [selectedDestChain, setSelectedDestChain] = useState(DEST_CHAIN_ID);
  const [showDestPicker, setShowDestPicker] = useState(false);

  // Derived destination config
  const destChainConfig = DEST_CHAINS[selectedDestChain] || DEST_CHAINS[421614];
  const destChainObj = arbitrumSepolia;
  const DestLogo = ArbitrumLogo;

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

  // Wait for receipts
  const { isSuccess: approveConfirmed, isError: approveReverted } =
    useWaitForTransactionReceipt({ hash: approveTxHash });
  const { data: createReceipt, isSuccess: createConfirmed, isError: createReverted } =
    useWaitForTransactionReceipt({ hash: createTxHash });
  const { isSuccess: depositHLConfirmed, isError: depositHLReverted } =
    useWaitForTransactionReceipt({ hash: depositHLTxHash });

  // Track orderId from createOrder tx logs
  const [orderId, setOrderId] = useState(null);

  // Computed values
  const amountWei = amount ? parseUnits(amount, 6) : 0n;
  const feeAmount =
    bridgeMode === "instant" && amountWei > 0n
      ? (amountWei * BigInt(feeBps)) / BigInt(BPS_DENOMINATOR)
      : 0n;
  const receiveAmount = amountWei > 0n ? amountWei - feeAmount : 0n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  // After approve confirms -> create order
  useEffect(() => {
    if (approveConfirmed && step === "approving") {
      createOrder({
        address: INTENT_GATEWAY_ADDRESS,
        abi: INTENT_GATEWAY_ABI,
        functionName: "createOrder",
        args: [
          USDC_ADDRESS,
          amountWei,
          selectedDestChain,
          destAddress || address,
          feeAmount,
          deadline,
        ],
      });
      setStep("creating");
    }
  }, [approveConfirmed]);

  // After order creation confirms — extract orderId from logs
  useEffect(() => {
    if (createConfirmed && step === "creating") {
      // Extract orderId from OrderPlaced event log
      if (createReceipt?.logs?.length > 0) {
        // OrderPlaced event: first topic after event signature is indexed orderId
        const orderLog = createReceipt.logs.find(
          (log) => log.address?.toLowerCase() === INTENT_GATEWAY_ADDRESS.toLowerCase() && log.topics?.length >= 2
        );
        if (orderLog) {
          setOrderId(orderLog.topics[1]);
        }
      }
      setStep(bridgeMode === "instant" ? "waiting_fill" : "waiting_fallback");
    }
  }, [createConfirmed]);

  // Poll order status on source chain (getOrder) and destination chain (getFill)
  useEffect(() => {
    if (!orderId || (step !== "waiting_fill" && step !== "waiting_fallback" && step !== "settling")) return;

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
          setStep("depositing_hl");
        } else if (status === OrderStatus.Filled || isFilled) {
          setStep("settling");
        }
      } catch (err) {
        console.error("[Poll] Error checking order status:", err);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [orderId, step]);

  // Handle errors
  useEffect(() => {
    if (approveError && step === "approving") {
      setError(approveError.message?.slice(0, 150) || "Approval failed");
      setFailedAt("approve");
      setStep("failed");
    }
  }, [approveError]);

  useEffect(() => {
    if (createError && step === "creating") {
      setError(createError.message?.slice(0, 150) || "Order creation failed");
      setFailedAt("create");
      setStep("failed");
    }
  }, [createError]);

  useEffect(() => {
    if (approveReverted && step === "approving") {
      setError("Approve transaction reverted");
      setFailedAt("approve");
      setStep("failed");
    }
  }, [approveReverted]);

  useEffect(() => {
    if (createReverted && step === "creating") {
      setError("Create order transaction reverted");
      setFailedAt("create");
      setStep("failed");
    }
  }, [createReverted]);

  // Auto-deposit to Hyperliquid: switch to Arb Sepolia then transfer USDC2 to HL bridge
  const [depositHLTriggered, setDepositHLTriggered] = useState(false);
  useEffect(() => {
    if (step !== "depositing_hl" || depositHLTriggered) return;
    // Switch chain to Arbitrum Sepolia if needed
    if (chainId !== arbitrumSepolia.id) {
      switchChain({ chainId: arbitrumSepolia.id });
      return; // will re-run when chainId changes
    }
    setDepositHLTriggered(true);
    depositHL({
      address: destChainConfig.usdcAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [HL_BRIDGE_ADDRESS, receiveAmount],
    });
  }, [step, chainId, depositHLTriggered]);

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
    approve({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [INTENT_GATEWAY_ADDRESS, amountWei],
    });
    setStep("approving");
  };

  const handleReset = () => {
    setStep("input");
    setAmount("");
    setError(null);
    setFailedAt(null);
    setDepositHLTriggered(false);
    resetApprove();
    resetCreate();
    resetDepositHL();
    refetchBalance();
  };

  const handleMaxAmount = () => {
    if (usdcBalance) setAmount(formatUnits(usdcBalance, 6));
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
      return { text: "Enter an amount", disabled: true, variant: "secondary" };
    if (parseFloat(amount) < 1)
      return { text: "Minimum 1 USDC", disabled: true, variant: "secondary" };
    if (usdcBalance !== undefined && parseUnits(amount || "0", 6) > usdcBalance)
      return { text: "Insufficient USDC balance", disabled: true, variant: "secondary" };
    return {
      text: bridgeMode === "instant" ? "Instant Bridge" : "Classic Bridge",
      disabled: false,
      variant: "primary",
      onClick: handleBridge,
    };
  };

  const buttonConfig = getButtonConfig();
  const steps = bridgeMode === "instant" ? STEPS_INSTANT : STEPS_CLASSIC;

  // Step progress
  const getStepStatus = (stepKey) => {
    const order =
      bridgeMode === "instant"
        ? ["approve", "create", "fill", "settle", "deposit_hl"]
        : ["approve", "create", "fallback", "settle", "deposit_hl"];
    const stepIndex = order.indexOf(stepKey);
    const stepMap = {
      approving: 0,
      creating: 1,
      waiting_fill: 2,
      waiting_fallback: 2,
      settling: 3,
      depositing_hl: 4,
      completed: 5,
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
              {bridgeMode === "instant" ? "Instant Bridge" : "Classic Bridge"}
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
                          {step === "creating" && "Creating order..."}
                          {step === "waiting_fill" && "Waiting for filler (~2s)..."}
                          {step === "waiting_fallback" &&
                            `Classic pipeline (~${Math.ceil(FILLER_WINDOW / 60 + 6)} min)...`}
                          {step === "settling" && (destChainConfig.settlementMode === "tee" ? "TEE (Phala) settlement..." : "ZK BEEFY settlement...")}
                          {step === "depositing_hl" && "Depositing to Hyperliquid..."}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

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
                <span className="bridge-route-receive-tag">
                  {bridgeMode === "instant" ? destChainConfig.estimatedTime : destChainConfig.classicTime}
                </span>
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
              {bridgeMode === "instant"
                ? "Your USDC has been deposited to Hyperliquid via the official bridge."
                : "Your USDC has been deposited to Hyperliquid via the classic trustless pipeline."}
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
                <span className="value">{bridgeMode === "instant" ? "Instant" : "Classic"}</span>
              </div>
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

      {/* Settings panel */}
      {showSettings && (
        <div className="bridge-settings-panel">
          <div className="bridge-settings-row">
            <span className="bridge-settings-label">Bridge Mode</span>
            <div className="bridge-mode-options">
              <button
                className={`bridge-mode-option ${bridgeMode === "instant" ? "active" : ""}`}
                onClick={() => setBridgeMode("instant")}
              >
                Instant
              </button>
              <button
                className={`bridge-mode-option ${bridgeMode === "classic" ? "active" : ""}`}
                onClick={() => setBridgeMode("classic")}
              >
                Classic
              </button>
            </div>
          </div>
          {bridgeMode === "instant" && (
            <div className="bridge-settings-row gas-row">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="bridge-settings-label">Filler Fee</span>
                <span className="bridge-gas-value">{feeBps} bps</span>
              </div>
              <div className="bridge-gas-slider">
                <ElasticSlider
                  defaultValue={feeBps}
                  startingValue={MIN_FEE_BPS}
                  maxValue={MAX_FEE_BPS}
                  stepSize={1}
                  isStepped
                  onChange={(v) => setFeeBps(Math.round(v))}
                />
              </div>
            </div>
          )}
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

          {/* TO card — with destination chain selector */}
          <div className="bridge-card bridge-card-dest" style={{ position: "relative" }}>
            <div
              className="bridge-card-content"
              onClick={() => setShowDestPicker(!showDestPicker)}
              style={{ cursor: "pointer" }}
            >
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
                <div className="bridge-card-chevron">
                  <ChevronDownIcon size={12} />
                </div>
              </div>
            </div>
            {showDestPicker && (
              <div className="bridge-dest-picker">
                {Object.values(DEST_CHAINS).map((chain) => (
                  <button
                    key={chain.id}
                    className={`bridge-dest-option ${chain.id === selectedDestChain ? "active" : ""}`}
                    onClick={() => {
                      setSelectedDestChain(chain.id);
                      setShowDestPicker(false);
                    }}
                  >
                    <ArbitrumLogo size={20} />
                    <span className="bridge-dest-option-name">{chain.name}{chain.finalDestination ? ` → ${chain.finalDestination}` : ""}</span>
                    {chain.id === selectedDestChain && <span className="bridge-dest-check">{"\u2713"}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Send card (amount input) */}
          <div className="bridge-send-card">
            <div className="bridge-send-header">
              <span className="bridge-send-label">Send</span>
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
                      <button className="bridge-send-max" onClick={handleMaxAmount}>
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
                <span className="bridge-route-receive-tag">
                  {bridgeMode === "instant" ? destChainConfig.estimatedTime : destChainConfig.classicTime}
                </span>
              </div>
              <div className="bridge-route-divider" />
              <div className="bridge-route-path">
                <div className="bridge-route-path-header">
                  <div className="bridge-route-path-left">
                    <div className="bridge-route-path-dot" />
                    <span className="bridge-route-path-name">IntentBridge</span>
                  </div>
                  <span className="bridge-route-path-tag">
                    {bridgeMode === "instant" ? "INSTANT" : "CLASSIC"}
                  </span>
                </div>
                <div className="bridge-route-path-meta">
                  <span className="bridge-route-meta-item">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {bridgeMode === "instant" ? destChainConfig.estimatedTime : destChainConfig.classicTime}
                  </span>
                  <span className="bridge-route-meta-sep" />
                  <span className="bridge-route-meta-item">
                    {destChainConfig.settlementMode === "tee" ? "TEE (Phala)" : "ZK BEEFY"}
                  </span>
                  {bridgeMode === "instant" && feeAmount > 0n && (
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
          <div className="status-mode-row">
            <button className="status-mode-btn active">By Order ID</button>
            <button className="status-mode-btn">By Tx Hash</button>
          </div>
          <div className="status-input-row">
            <input
              type="text"
              className="status-input"
              placeholder="Enter order ID (0x...)"
            />
            <button className="status-track-btn" disabled>
              Track
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
