import { useOrderEvents } from "../hooks/useOrderEvents";
import { OrderTracker } from "../components/OrderTracker";
import { SettlementProgress } from "../components/SettlementProgress";
import { OrderStatus, ORDER_STATUS_LABELS } from "../config/contracts";
import { formatUnits } from "viem";

export function DashboardPage() {
  const { orders } = useOrderEvents();

  const totalBridged = orders.reduce((sum, o) => sum + o.amount, 0n);
  const filledCount = orders.filter((o) => o.status >= OrderStatus.Filled).length;
  const settledCount = orders.filter((o) => o.status === OrderStatus.Settled).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total Bridged" value={`${formatUnits(totalBridged, 6)} USDC`} />
        <StatCard label="Total Orders" value={String(orders.length)} />
        <StatCard label="Filled" value={String(filledCount)} />
        <StatCard label="Settled" value={String(settledCount)} />
      </div>

      {/* Active settlements */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Active Settlements</h2>
        {orders
          .filter((o) => o.status === OrderStatus.Filled)
          .map((order) => (
            <div key={order.orderId} className="bg-gray-800 rounded-xl p-4 space-y-3">
              <div className="flex justify-between">
                <span className="font-mono text-sm text-gray-400">
                  {order.orderId.slice(0, 10)}...
                </span>
                <span className="text-blue-400 text-sm">
                  {formatUnits(order.amount, 6)} USDC
                </span>
              </div>
              <SettlementProgress
                orderStatus={order.status}
                fillTimestamp={order.fillTimestamp}
                mode="filler"
              />
            </div>
          ))}
        {orders.filter((o) => o.status === OrderStatus.Filled).length === 0 && (
          <div className="text-gray-500 text-sm">No active settlements</div>
        )}
      </div>

      {/* Order history */}
      <OrderTracker orders={orders} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="text-sm text-gray-400">{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}
