import { useSettlementStatus, type SettlementStep } from "../hooks/useSettlementStatus";
import { OrderStatus } from "../config/contracts";

interface SettlementProgressProps {
  orderStatus: OrderStatus;
  fillTimestamp?: bigint;
  mode: "filler" | "fallback";
}

export function SettlementProgress({ orderStatus, fillTimestamp, mode }: SettlementProgressProps) {
  const progress = useSettlementStatus(orderStatus, fillTimestamp);

  if (!progress) return null;

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-medium text-gray-400">
          Settlement Pipeline {mode === "fallback" ? "(Classic Bridge)" : "(Filler Mode)"}
        </h3>
        {progress.estimatedTimeLeft > 0 && (
          <span className="text-xs text-gray-500">
            ~{Math.ceil(progress.estimatedTimeLeft / 60)} min remaining
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {progress.steps.map((step, i) => (
          <div key={step.id} className="flex items-center flex-1">
            {/* Step dot */}
            <div
              className={`w-3 h-3 rounded-full flex-shrink-0 ${
                step.completed
                  ? "bg-green-500"
                  : step.active
                    ? "bg-blue-500 animate-pulse"
                    : "bg-gray-700"
              }`}
            />

            {/* Connector line */}
            {i < progress.steps.length - 1 && (
              <div
                className={`h-0.5 flex-1 mx-1 ${
                  step.completed ? "bg-green-500" : "bg-gray-700"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Labels */}
      <div className="flex justify-between mt-2">
        {progress.steps.map((step) => (
          <div
            key={step.id}
            className={`text-[10px] text-center flex-1 ${
              step.completed ? "text-green-400" : step.active ? "text-blue-400" : "text-gray-600"
            }`}
          >
            {step.label}
          </div>
        ))}
      </div>
    </div>
  );
}
