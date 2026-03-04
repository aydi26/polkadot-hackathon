import { useReadContract, useReadContracts } from "wagmi";

const FILLER_REGISTRY_ABI = [
  {
    type: "function",
    name: "getActiveFillers",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getFillerInfo",
    inputs: [{ name: "filler", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "filler", type: "address" },
          { name: "stake", type: "uint256" },
          { name: "ordersFilled", type: "uint256" },
          { name: "ordersSettled", type: "uint256" },
          { name: "registeredAt", type: "uint256" },
          { name: "active", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export interface FillerStats {
  address: `0x${string}`;
  stake: bigint;
  ordersFilled: bigint;
  ordersSettled: bigint;
  settlementRate: number;
  active: boolean;
}

export function useFillerStats(registryAddress: `0x${string}`) {
  const { data: activeFillers } = useReadContract({
    address: registryAddress,
    abi: FILLER_REGISTRY_ABI,
    functionName: "getActiveFillers",
  });

  return {
    activeFillers: activeFillers ?? [],
    fillerCount: activeFillers?.length ?? 0,
  };
}
