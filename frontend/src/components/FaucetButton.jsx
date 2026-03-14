import { useState, useRef, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { motion, useAnimation } from "motion/react";
import { USDC_ADDRESS } from "../config/contracts";
import "./FaucetButton.css";

const MINT_ABI = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

const MINT_AMOUNT = parseUnits("10", 6); // 10 USDC (demo cap)

const DropletIcon = ({ size = 16 }) => {
  const controls = useAnimation();

  const handleMouseEnter = useCallback(() => {
    controls.start("animate");
  }, [controls]);

  const handleMouseLeave = useCallback(() => {
    controls.start("normal");
  }, [controls]);

  return (
    <div
      className="droplet-icon"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <motion.path
          animate={controls}
          d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"
          transition={{ duration: 0.6, delay: 0.2 }}
          variants={{
            normal: {
              pathLength: 1,
              opacity: 1,
              pathOffset: 0,
            },
            animate: {
              pathLength: [0, 1],
              opacity: [0, 1],
              pathOffset: [1, 0],
            },
          }}
        />
      </svg>
    </div>
  );
};

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>
);

export default function FaucetButton() {
  const { address, isConnected } = useAccount();
  const [justMinted, setJustMinted] = useState(false);

  const {
    writeContract: mint,
    data: mintTxHash,
    isPending: isMinting,
    reset,
  } = useWriteContract();

  const { isSuccess: mintConfirmed, isLoading: isConfirming } =
    useWaitForTransactionReceipt({ hash: mintTxHash });

  const handleMint = () => {
    setJustMinted(false);
    mint({
      address: USDC_ADDRESS,
      abi: MINT_ABI,
      functionName: "mint",
      args: [address, MINT_AMOUNT],
    });
  };

  // Show success briefly
  if (mintConfirmed && !justMinted) {
    setJustMinted(true);
    setTimeout(() => {
      setJustMinted(false);
      reset();
    }, 3000);
  }

  if (!isConnected) return null;

  return (
    <button
      className={`faucet-btn ${justMinted ? "success" : ""} ${isMinting || isConfirming ? "loading" : ""}`}
      onClick={handleMint}
      disabled={isMinting || isConfirming}
    >
      {isMinting || isConfirming ? (
        <>
          <div className="faucet-spinner" />
          Minting...
        </>
      ) : justMinted ? (
        <>
          <CheckIcon />
          +10 USDC
        </>
      ) : (
        <>
          <DropletIcon size={16} />
          Faucet
        </>
      )}
    </button>
  );
}
