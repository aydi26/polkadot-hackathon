import http from "http";
import { FillerState } from "./state.js";

export function startAPI(state: FillerState, port: number = 3001): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /api/fill/:orderId
    const match = req.url?.match(/^\/api\/fill\/(0x[0-9a-fA-F]{64})$/);
    if (match && req.method === "GET") {
      const orderId = match[1];
      const record = state.get(orderId);
      if (record) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          orderId: record.orderId,
          fillTxHash: record.fillTxHash || null,
                    status: record.status,
          filledAt: record.filledAt || null,
          settledAt: record.settledAt || null,
        }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Order not found" }));
      }
      return;
    }

    // GET /api/fills — list all records
    if (req.url === "/api/fills" && req.method === "GET") {
      const records = state.getAllRecords().map((r) => ({
        orderId: r.orderId,
        fillTxHash: r.fillTxHash || null,
        freshWalletAddress: r.freshWalletAddress || null,
        status: r.status,
        filledAt: r.filledAt || null,
        settledAt: r.settledAt || null,
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(records));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, () => {
    console.log(`[API] Filler API listening on http://localhost:${port}`);
  });

  return server;
}
