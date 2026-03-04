import { useEffect, useState } from "react";
import { type Log } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { CONTRACTS, INTENT_GATEWAY_ABI, INTENT_SETTLER_ABI, OrderStatus } from "../config/contracts";

export interface OrderEvent {
  orderId: `0x${string}`;
  user: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  destChain: number;
  destAddress: `0x${string}`;
  feeOffer: bigint;
  deadline: bigint;
  status: OrderStatus;
  fillTimestamp?: bigint;
  filler?: `0x${string}`;
}

export function useOrderEvents() {
  const [orders, setOrders] = useState<OrderEvent[]>([]);
  const publicClient = usePublicClient();

  // Watch for new OrderPlaced events
  useWatchContractEvent({
    address: CONTRACTS.intentGateway,
    abi: INTENT_GATEWAY_ABI,
    eventName: "OrderPlaced",
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args;
        if (!args.orderId) continue;

        setOrders((prev) => {
          const exists = prev.find((o) => o.orderId === args.orderId);
          if (exists) return prev;

          return [
            ...prev,
            {
              orderId: args.orderId!,
              user: args.user!,
              token: args.token!,
              amount: args.amount!,
              destChain: args.destChain!,
              destAddress: args.destAddress!,
              feeOffer: args.feeOffer!,
              deadline: args.deadline!,
              status: OrderStatus.Pending,
            },
          ];
        });
      }
    },
  });

  // Watch for OrderFilled events
  useWatchContractEvent({
    address: CONTRACTS.intentSettler,
    abi: INTENT_SETTLER_ABI,
    eventName: "OrderFilled",
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args;
        if (!args.orderId) continue;

        setOrders((prev) =>
          prev.map((o) =>
            o.orderId === args.orderId
              ? { ...o, status: OrderStatus.Filled, filler: args.filler, fillTimestamp: args.fillTimestamp }
              : o
          )
        );
      }
    },
  });

  // Watch for SettlementVerified events
  useWatchContractEvent({
    address: CONTRACTS.intentSettler,
    abi: INTENT_SETTLER_ABI,
    eventName: "SettlementVerified",
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args;
        if (!args.orderId) continue;

        setOrders((prev) =>
          prev.map((o) => (o.orderId === args.orderId ? { ...o, status: OrderStatus.Settled } : o))
        );
      }
    },
  });

  return { orders };
}
