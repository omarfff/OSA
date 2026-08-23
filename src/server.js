import crypto from "node:crypto";
import express from "express";
import { normalizeEndpoint, calculateTrustScore, liveVerify } from "./core.js";
import { addSnapshot, historyFor, listEndpoints, listSnapshots, upsertEndpoint } from "./store.js";
import { buildPaymentMiddleware } from "./x402.js";

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: "1mb" }));

const payment = await buildPaymentMiddleware();
if (payment) app.use(payment);

const timeoutMs = Math.max(250, Number(process.env.OSA_LIVE_TIMEOUT_MS || 5000));
const bestConcurrency = Math.max(1, Math.min(8, Number(process.env.OSA_BEST_CONCURRENCY || 4)));
const bestDeadlineMs = Math.max(1000, Number(process.env.OSA_BEST_DEADLINE_MS || 12000));
const maxCandidates = Math.max(1, Math.min(50, Number(process.env.OSA_MAX_CANDIDATES || 20)));

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function requireIngestKey(req, res, next) {
  const configured = process.env.OSA_INGEST_KEY;
  if (!configured) {
    if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') return next();
    return res.status(503).json({ error: 'ingest is disabled until OSA_INGEST_KEY is configured' });
  }
  if (!safeEqual(req.get('x-osa-ingest-key'), configured)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function previousSnapshot(id) {
  return listSnapshots().filter((x) => x.endpointId === id).at(-1) || null;
}

async function scoreOne(endpoint, requestTimeoutMs = timeoutMs) {
  const previous = previousSnapshot(endpoint.id);
  const current = await liveVerify(endpoint, requestTimeoutMs);
  const trust = calculateTrustScore(endpoint, current, previous);
  addSnapshot({ endpointId: endpoint.id, ...current, ...trust });
  return { endpoint, live: current, ...trust };
}

async function scoreWithBudget(candidates) {
  const deadline = Date.now() + bestDeadlineMs;
  const scored = new Array(candidates.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= candidates.length) return;
      const remaining = deadline - Date.now();
      if (remaining <= 150) return;
      scored[index] = await scoreOne(candidates[index], Math.min(timeoutMs, remaining));
    }
  }
  await Promise.all(Array.from({ length: Math.min(bestConcurrency, candidates.length) }, () => worker()));
  return scored.filter(Boolean);
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "OSA Agent Trust Oracle", version: "0.2.0", x402: Boolean(process.env.OSA_PAY_TO), secureFetch: true }));

app.post("/ingest", requireIngestKey, (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  try {
    const saved = items.map((x) => upsertEndpoint(normalizeEndpoint(x, x.source || "manual")));
    res.status(201).json({ count: saved.length, endpoints: saved });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.post("/sources/mcp", requireIngestKey, (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.tools || req.body?.servers || [];
  try {
    const saved = items.map((x) => upsertEndpoint(normalizeEndpoint(x, "mcp-registry")));
    res.status(201).json({ count: saved.length, endpoints: saved });
  } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});

app.post("/sources/bazaar", requireIngestKey, (req, res) => {
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
  }).slice(0, maxCandidates);
  if (!candidates.length) return res.status(404).json({ error: "no matching endpoints" });
  const scored = await scoreWithBudget(candidates);
  if (!scored.length) return res.status(504).json({ error: 'verification deadline exceeded' });
  scored.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  const [best, ...rest] = scored;
  res.json({
    endpoint: best.endpoint,
    score: best.score,
    confidence: best.confidence,
    reasonCodes: best.reasonCodes,
    live: best.live,
    evaluated: scored.length,
    candidates: candidates.length,
    alternatives: rest.slice(0, 5).map((x) => ({ endpoint: x.endpoint, score: x.score, confidence: x.confidence, reasonCodes: x.reasonCodes }))
  });
});

app.get("/.well-known/osa.json", (_req, res) => res.json({
  name: "OSA Agent Trust Oracle",
  version: "0.2.0",
  description: "Pre-purchase trust scoring and live verification for agent/API endpoints.",
  endpoints: ["GET /best", "GET /score", "GET /history", "POST /ingest", "POST /sources/mcp", "POST /sources/bazaar"],
  security: { ssrfProtection: true, ingestAuthentication: true, responseByteLimit: true, boundedConcurrency: true },
  x402: { enabled: Boolean(process.env.OSA_PAY_TO), network: process.env.OSA_NETWORK || "eip155:84532", currency: "USDC" },
  output: ["endpoint", "score", "confidence", "alternatives", "reasonCodes"]
}));

const port = Number(process.env.PORT || 4021);
if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`OSA Agent Trust Oracle listening on :${port}`));
}

export default app;
