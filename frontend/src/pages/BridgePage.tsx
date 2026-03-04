import { OrderForm } from "../components/OrderForm";
import { OrderTracker } from "../components/OrderTracker";
import { SettlementProgress } from "../components/SettlementProgress";
import { useOrderEvents } from "../hooks/useOrderEvents";
import { OrderStatus } from "../config/contracts";

export function BridgePage() {
  const { orders } = useOrderEvents();

  // Find the latest active order for settlement tracking
  const activeOrder = orders.find(
    (o) => o.status === OrderStatus.Filled || o.status === OrderStatus.Pending
  );

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <OrderForm />

      {/* Settlement progress for active order */}
      {activeOrder && activeOrder.status === OrderStatus.Filled && (
        <SettlementProgress
          orderStatus={activeOrder.status}
          fillTimestamp={activeOrder.fillTimestamp}
          mode="filler"
        />
      )}

      {activeOrder && activeOrder.status === OrderStatus.Pending && (
        <div className="bg-gray-800 rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse" />
            <div>
              <div className="text-white font-medium">Searching for filler...</div>
              <div className="text-sm text-gray-400">
                If no filler responds within 30s, classic bridge will be used (~7 min)
              </div>
            </div>
          </div>
        </div>
      )}

      <OrderTracker orders={orders} />
    </div>
  );
}
