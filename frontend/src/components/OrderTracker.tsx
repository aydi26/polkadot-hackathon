import { formatUnits } from "viem";
import { OrderStatus, ORDER_STATUS_LABELS } from "../config/contracts";
import type { OrderEvent } from "../hooks/useOrderEvents";

interface OrderTrackerProps {
  orders: OrderEvent[];
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  [OrderStatus.None]: "text-gray-500",
  [OrderStatus.Pending]: "text-yellow-400",
  [OrderStatus.Filled]: "text-blue-400",
  [OrderStatus.Settled]: "text-green-400",
  [OrderStatus.Expired]: "text-red-400",
  [OrderStatus.Cancelled]: "text-gray-400",
  [OrderStatus.Fallback]: "text-orange-400",
};

export function OrderTracker({ orders }: OrderTrackerProps) {
  if (orders.length === 0) {
    return (
      <div className="bg-gray-800 rounded-2xl p-6 text-center text-gray-500">
        No orders yet. Create your first bridge order above.
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-2xl p-6">
      <h2 className="text-xl font-bold text-white mb-4">Your Orders</h2>
      <div className="space-y-3">
        {orders.map((order) => (
          <div key={order.orderId} className="bg-gray-900 rounded-lg p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-mono text-sm text-gray-400">
                  {order.orderId.slice(0, 10)}...{order.orderId.slice(-8)}
                </div>
                <div className="text-lg text-white mt-1">
                  {formatUnits(order.amount, 6)} USDC
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Fee: {formatUnits(order.feeOffer, 6)} USDC
                </div>
              </div>
              <div className="text-right">
                <span className={`text-sm font-medium ${STATUS_COLORS[order.status]}`}>
                  {ORDER_STATUS_LABELS[order.status]}
                </span>
                {order.filler && (
                  <div className="text-xs text-gray-500 mt-1">
                    Filler: {order.filler.slice(0, 6)}...{order.filler.slice(-4)}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
