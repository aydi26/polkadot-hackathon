import { useFillerStats } from "../hooks/useFillerStats";
import { CONTRACTS } from "../config/contracts";

export function FillerPage() {
  const { activeFillers, fillerCount } = useFillerStats(CONTRACTS.fillerRegistry);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Filler Dashboard</h1>

      {/* Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800 rounded-xl p-4">
          <div className="text-sm text-gray-400">Active Fillers</div>
          <div className="text-xl font-bold text-white mt-1">{fillerCount}</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4">
          <div className="text-sm text-gray-400">Your P&L</div>
          <div className="text-xl font-bold text-green-400 mt-1">— USDC</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4">
          <div className="text-sm text-gray-400">Orders Filled</div>
          <div className="text-xl font-bold text-white mt-1">—</div>
        </div>
      </div>

      {/* Active Fillers List */}
      <div className="bg-gray-800 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Active Fillers</h2>
        {fillerCount === 0 ? (
          <div className="text-gray-500 text-sm">No active fillers registered</div>
        ) : (
          <div className="space-y-2">
            {(activeFillers as `0x${string}`[]).map((addr, i) => (
              <div
                key={addr}
                className="flex justify-between items-center bg-gray-900 rounded-lg p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 text-sm">#{i + 1}</span>
                  <span className="font-mono text-white text-sm">
                    {addr.slice(0, 6)}...{addr.slice(-4)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-400 rounded-full" />
                  <span className="text-green-400 text-sm">Active</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Register as filler */}
      <div className="bg-gray-800 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-2">Become a Filler</h2>
        <p className="text-sm text-gray-400 mb-4">
          Stake USDC and earn fees by filling bridge orders. Minimum stake: 100 USDC.
        </p>
        <button
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          disabled
        >
          Register as Filler (Coming Soon)
        </button>
      </div>
    </div>
  );
}
