import { config } from "./config.js";
import type { OrderEvent } from "./watcher.js";

export interface FillDecision {
  shouldFill: boolean;
  reason: string;
  expectedProfit: bigint;
}

export class PricingEngine {
  /**
   * Evaluate whether to fill an order based on profitability.
   */
  evaluate(order: OrderEvent, currentBalance: bigint): FillDecision {
    // Check if order amount exceeds max
    if (order.amount > config.maxOrderAmount) {
      return {
        shouldFill: false,
        reason: `Order amount ${order.amount} exceeds max ${config.maxOrderAmount}`,
        expectedProfit: 0n,
      };
    }

    // Check if we have enough balance (only need net amount after fee)
    const netAmount = order.amount - order.feeOffer;
    if (currentBalance < netAmount) {
      return {
        shouldFill: false,
        reason: `Insufficient balance: ${currentBalance} < ${netAmount} (net after fee)`,
        expectedProfit: 0n,
      };
    }

    // Check if deadline is still valid
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now >= order.deadline) {
      return {
        shouldFill: false,
        reason: "Order deadline has passed",
        expectedProfit: 0n,
      };
    }

    // Calculate profitability
    const feeBps = (order.feeOffer * 10000n) / order.amount;
    const minFeeBps = BigInt(config.minProfitBps);

    if (feeBps < minFeeBps) {
      return {
        shouldFill: false,
        reason: `Fee too low: ${feeBps} bps < min ${minFeeBps} bps`,
        expectedProfit: order.feeOffer,
      };
    }

    return {
      shouldFill: true,
      reason: `Profitable: ${feeBps} bps fee`,
      expectedProfit: order.feeOffer,
    };
  }
}
