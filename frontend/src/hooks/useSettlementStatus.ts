import { useState, useEffect } from "react";
import { OrderStatus } from "../config/contracts";

export type SettlementStep = "xcm" | "beefy" | "hyperbridge" | "ismp" | "settled";

export interface SettlementProgress {
  currentStep: SettlementStep;
  steps: {
    id: SettlementStep;
    label: string;
    completed: boolean;
    active: boolean;
  }[];
  estimatedTimeLeft: number; // seconds
}

const STEP_CONFIG: { id: SettlementStep; label: string; duration: number }[] = [
  { id: "xcm", label: "XCM v5 Messaging", duration: 30 },
  { id: "beefy", label: "BEEFY Signatures", duration: 120 },
  { id: "hyperbridge", label: "ZK Proof Generation", duration: 120 },
  { id: "ismp", label: "ISMP Relay", duration: 60 },
  { id: "settled", label: "Settlement Verified", duration: 0 },
];

export function useSettlementStatus(
  orderStatus: OrderStatus,
  fillTimestamp?: bigint
): SettlementProgress | null {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (orderStatus !== OrderStatus.Filled || !fillTimestamp) return;

    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      setElapsed(now - Number(fillTimestamp));
    }, 1000);

    return () => clearInterval(interval);
  }, [orderStatus, fillTimestamp]);

  if (orderStatus === OrderStatus.Settled) {
    return {
      currentStep: "settled",
      steps: STEP_CONFIG.map((s) => ({ ...s, completed: true, active: s.id === "settled" })),
      estimatedTimeLeft: 0,
    };
  }

  if (orderStatus !== OrderStatus.Filled) return null;

  // Simulate progress based on elapsed time
  let accumulatedTime = 0;
  let currentStepId: SettlementStep = "xcm";

  for (const step of STEP_CONFIG) {
    accumulatedTime += step.duration;
    if (elapsed < accumulatedTime) {
      currentStepId = step.id;
      break;
    }
  }

  const totalDuration = STEP_CONFIG.reduce((sum, s) => sum + s.duration, 0);
  const estimatedTimeLeft = Math.max(0, totalDuration - elapsed);

  const steps = STEP_CONFIG.map((step) => {
    let stepStart = 0;
    for (const s of STEP_CONFIG) {
      if (s.id === step.id) break;
      stepStart += s.duration;
    }
    return {
      ...step,
      completed: elapsed >= stepStart + step.duration,
      active: step.id === currentStepId,
    };
  });

  return { currentStep: currentStepId, steps, estimatedTimeLeft };
}
