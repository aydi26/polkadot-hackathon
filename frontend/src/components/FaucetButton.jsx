import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { USDC_ADDRESS, ERC20_ABI } from "../config/contracts";
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

const MINT_AMOUNT = parseUnits("1000", 6); // 1000 USDC

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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
          +1000 USDC
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          Faucet
        </>
      )}
    </button>
  );
}
