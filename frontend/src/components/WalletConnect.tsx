import { useAccount, useConnect, useDisconnect } from "wagmi";

export function WalletConnect() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <div className="text-sm">
          <div className="text-gray-400">EVM Wallet</div>
          <div className="font-mono text-green-400">
            {address?.slice(0, 6)}...{address?.slice(-4)}
          </div>
          {chain && <div className="text-xs text-gray-500">{chain.name}</div>}
        </div>
        <button
          onClick={() => disconnect()}
          className="px-3 py-1.5 text-sm bg-red-900/30 text-red-400 rounded-lg hover:bg-red-900/50 transition"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {connectors.map((connector) => (
        <button
          key={connector.uid}
          onClick={() => connect({ connector })}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
        >
          {connector.name}
        </button>
      ))}
    </div>
  );
}
