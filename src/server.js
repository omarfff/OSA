import express from "express";
import { normalizeEndpoint, calculateTrustScore, liveVerify } from "./core.js";
import { addSnapshot, historyFor, listEndpoints, listSnapshots, upsertEndpoint } from "./store.js";
import { buildPaymentMiddleware } from "./x402.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const payment = await buildPaymentMiddleware();
if (payment) app.use(payment);

const timeoutMs = Number(process.env.OSA_LIVE_TIMEOUT_MS || 5000);

function previousSnapshot(id) {
  return listSnapshots().filter((x) => x.endpointId === id).at(-1) || null;
}

async function scoreOne(endpoint) {
  const previous = previousSnapshot(endpoint.id);
  const current = await liveVerify(endpoint, timeoutMs);
  const trust = calculateTrustScore(endpoint, current, previous);
  addSnapshot({ endpointId: endpoint.id, ...current, ...trust });
  return { endpoint, live: current, ...trust };
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "OSA Agent Trust Oracle", version: "0.1.0", x402: Boolean(process.env.OSA_PAY_TO) }));

app.post("/ingest", (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  try {
    const saved = items.map((x) => upsertEndpoint(normalizeEndpoint(x, x.source || "manual")));
    res.status(201).json({ count: saved.length, endpoints: saved });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.post("/sources/mcp", (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.tools || req.body?.servers || [];
  try {
    const saved = items.map((x) => upsertEndpoint(normalizeEndpoint(x, "mcp-registry")));
    res.status(201).json({ count: saved.length, endpoints: saved });
  } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});

app.post("/sources/bazaar", (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.resources || req.body?.items || [];
  try {
    const saved = items.map((x) => upsertEndpoint(normalizeEndpoint(x, "x402-bazaar")));
    res.status(201).json({ count: saved.length, endpoints: saved });
  } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});

app.get("/score", async (req, res) => {
  const id = req.query.id;
  const url = req.query.url;
  const endpoint = listEndpoints().find((x) => (id && x.id === id) || (url && x.url === url));
  if (!endpoint) return res.status(404).json({ error: "endpoint not found in trusted registry" });
  res.json(await scoreOne(endpoint));
});

app.get("/history", (req, res) => {
  if (!req.query.id) return res.status(400).json({ error: "id is required" });
  res.json({ endpointId: req.query.id, snapshots: historyFor(req.query.id, Number(req.query.limit || 100)) });
});

app.get("/best", async (req, res) => {
  const intent = String(req.query.intent || "").toLowerCase();
  const maxPrice = req.query.max_price === undefined ? Infinity : Number(req.query.max_price);
  const candidates = listEndpoints().filter((x) => {
    const intentOk = !intent || (x.intents || []).some((i) => String(i).toLowerCase().includes(intent)) || String(x.description || "").toLowerCase().includes(intent);
    const priceOk = x.priceUsd === null || x.priceUsd === undefined || x.priceUsd <= maxPrice;
    return intentOk && priceOk;
  });
  if (!candidates.length) return res.status(404).json({ error: "no matching endpoints" });
  const scored = [];
  for (const endpoint of candidates.slice(0, 20)) scored.push(await scoreOne(endpoint));
  scored.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  const [best, ...rest] = scored;
  res.json({
    endpoint: best.endpoint,
    score: best.score,
    confidence: best.confidence,
    reasonCodes: best.reasonCodes,
    live: best.live,
    alternatives: rest.slice(0, 5).map((x) => ({ endpoint: x.endpoint, score: x.score, confidence: x.confidence, reasonCodes: x.reasonCodes }))
  });
});

app.get("/.well-known/osa.json", (_req, res) => res.json({
  name: "OSA Agent Trust Oracle",
  version: "0.1.0",
  description: "Pre-purchase trust scoring and live verification for agent/API endpoints.",
  endpoints: ["GET /best", "GET /score", "GET /history", "POST /ingest", "POST /sources/mcp", "POST /sources/bazaar"],
  x402: { enabled: Boolean(process.env.OSA_PAY_TO), network: process.env.OSA_NETWORK || "eip155:84532", currency: "USDC" },
  output: ["endpoint", "score", "confidence", "alternatives", "reasonCodes"]
}));

const port = Number(process.env.PORT || 4021);
if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`OSA Agent Trust Oracle listening on :${port}`));
}

export default app;
