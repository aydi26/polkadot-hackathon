import { useState } from "react";
import { parseUnits, formatUnits } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACTS, INTENT_GATEWAY_ABI, ERC20_ABI, CHAINS } from "../config/contracts";

export function OrderForm() {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [feeBps, setFeeBps] = useState("10"); // 10 bps default

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const amountWei = amount ? parseUnits(amount, 6) : 0n;
  const feeAmount = amountWei > 0n ? (amountWei * BigInt(feeBps)) / 10000n : 0n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

  const handleApprove = () => {
    writeContract({
      address: CONTRACTS.usdc,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACTS.intentGateway, amountWei],
    });
  };

  const handleCreateOrder = () => {
    if (!destAddress) return;
    writeContract({
      address: CONTRACTS.intentGateway,
      abi: INTENT_GATEWAY_ABI,
      functionName: "createOrder",
      args: [
        CONTRACTS.usdc,
        amountWei,
        CHAINS.hyperEvm.id,
        destAddress as `0x${string}`,
        feeAmount,
        deadline,
      ],
    });
  };

  if (!isConnected) {
    return (
      <div className="bg-gray-800 rounded-2xl p-6 text-center text-gray-400">
        Connect your wallet to bridge USDC
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-2xl p-6 space-y-4">
      <h2 className="text-xl font-bold text-white">Bridge USDC</h2>
      <p className="text-sm text-gray-400">Polkadot Asset Hub → HyperEVM</p>

      {/* Amount */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Amount (USDC)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="100"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Destination address */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Destination Address (HyperEVM)</label>
        <input
          type="text"
          value={destAddress}
          onChange={(e) => setDestAddress(e.target.value)}
          placeholder="0x..."
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Fee */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Filler Fee ({feeBps} bps)</label>
        <input
          type="range"
          min="5"
          max="100"
          value={feeBps}
          onChange={(e) => setFeeBps(e.target.value)}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>5 bps (slow)</span>
          <span className="text-green-400">{amount ? formatUnits(feeAmount, 6) : "0"} USDC</span>
          <span>100 bps (fast)</span>
        </div>
      </div>

      {/* Summary */}
      {amountWei > 0n && (
        <div className="bg-gray-900 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between text-gray-400">
            <span>You send</span>
            <span className="text-white">{amount} USDC</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Filler fee</span>
            <span className="text-yellow-400">-{formatUnits(feeAmount, 6)} USDC</span>
          </div>
          <div className="flex justify-between text-gray-400 border-t border-gray-700 pt-2">
            <span>You receive</span>
            <span className="text-green-400 font-bold">
              {formatUnits(amountWei - feeAmount, 6)} USDC
            </span>
          </div>
          <div className="flex justify-between text-gray-500 text-xs">
            <span>Estimated time</span>
            <span>~2 seconds (with filler)</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleApprove}
          disabled={isPending || !amount}
          className="flex-1 px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
        >
          1. Approve USDC
        </button>
        <button
          onClick={handleCreateOrder}
          disabled={isPending || isConfirming || !amount || !destAddress}
          className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {isPending ? "Confirming..." : isConfirming ? "Processing..." : "2. Bridge"}
        </button>
      </div>

      {isSuccess && (
        <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 text-green-400 text-sm">
          Transaction submitted! Waiting for filler...
        </div>
      )}
    </div>
  );
}
