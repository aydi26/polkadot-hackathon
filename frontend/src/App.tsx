import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { injected } from "wagmi/connectors";

import { WalletConnect } from "./components/WalletConnect";
import { BridgePage } from "./pages/BridgePage";
import { DashboardPage } from "./pages/DashboardPage";
import { FillerPage } from "./pages/FillerPage";

// wagmi config — TODO: replace with HyperEVM chain config
const config = createConfig({
  chains: [mainnet],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
  },
});

const queryClient = new QueryClient();

function AppContent() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-bold">
              <span className="text-blue-400">Intent</span>Bridge
            </h1>
            <nav className="flex gap-1">
              <NavLink
                to="/"
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg text-sm transition ${
                    isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"
                  }`
                }
              >
                Bridge
              </NavLink>
              <NavLink
                to="/dashboard"
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg text-sm transition ${
                    isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"
                  }`
                }
              >
                Dashboard
              </NavLink>
              <NavLink
                to="/filler"
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg text-sm transition ${
                    isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"
                  }`
                }
              >
                Filler
              </NavLink>
            </nav>
          </div>
          <WalletConnect />
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<BridgePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/filler" element={<FillerPage />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-12">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between text-sm text-gray-500">
          <span>IntentBridge — Polkadot Asset Hub → HyperEVM</span>
          <span>Settlement: ZK BEEFY via Hyperbridge</span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
