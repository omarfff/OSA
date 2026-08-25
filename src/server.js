import crypto from "node:crypto";
import express from "express";
import { normalizeEndpoint, calculateTrustScore, liveVerify } from "./core.js";
import { addSnapshot, historyFor, latestSnapshot, listEndpoints, storeMode, upsertEndpoint } from "./store.js";
import { buildPaymentMiddleware } from "./x402.js";
import { paymentOptions } from "./payment-options.js";

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: "1mb" }));

const payment = await buildPaymentMiddleware();
if (payment) app.use(payment);

function boundedNumber(value, fallback, min, max, integer = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const bounded = Math.max(min, Math.min(max, n));
  return integer ? Math.trunc(bounded) : bounded;
}

const timeoutMs = boundedNumber(process.env.OSA_LIVE_TIMEOUT_MS, 5000, 250, 60_000, true);
const bestConcurrency = boundedNumber(process.env.OSA_BEST_CONCURRENCY, 4, 1, 8, true);
const bestDeadlineMs = boundedNumber(process.env.OSA_BEST_DEADLINE_MS, 12_000, 1000, 60_000, true);
const maxCandidates = boundedNumber(process.env.OSA_MAX_CANDIDATES, 20, 1, 50, true);

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

async function previousSnapshot(id) {
  return await latestSnapshot(id);
}

async function scoreOne(endpoint, requestTimeoutMs = timeoutMs) {
  const previous = await previousSnapshot(endpoint.id);
  const current = await liveVerify(endpoint, requestTimeoutMs);
  const trust = calculateTrustScore(endpoint, current, previous);
  await addSnapshot({ endpointId: endpoint.id, ...current, ...trust });
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

app.get("/health", (_req, res) => res.json({ ok: true, service: "OSA Agent Trust Oracle", version: "0.3.1", x402: Boolean(process.env.OSA_PAY_TO), secureFetch: true, storage: storeMode() }));

app.get("/payment-options", (_req, res) => res.json(paymentOptions()));



app.post("/ingest", requireIngestKey, async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  try {
    const saved = await Promise.all(items.map((x) => upsertEndpoint(normalizeEndpoint(x, x.source || "manual"))));
    res.status(201).json({ count: saved.length, endpoints: saved });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.post("/sources/mcp", requireIngestKey, async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.tools || req.body?.servers || [];
  try {
    const saved = await Promise.all(items.map((x) => upsertEndpoint(normalizeEndpoint(x, "mcp-registry"))));
    res.status(201).json({ count: saved.length, endpoints: saved });
  } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});

app.post("/sources/bazaar", requireIngestKey, async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.resources || req.body?.items || [];
  try {
    const saved = await Promise.all(items.map((x) => upsertEndpoint(normalizeEndpoint(x, "x402-bazaar"))));
    res.status(201).json({ count: saved.length, endpoints: saved });
  } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});

app.get("/score", async (req, res) => {
  const id = typeof req.query.id === 'string' && req.query.id ? req.query.id : null;
  const url = typeof req.query.url === 'string' && req.query.url ? req.query.url : null;
  if ((id && url) || (!id && !url)) return res.status(400).json({ error: "provide exactly one of id or url" });
  const endpoint = (await listEndpoints()).find((x) => (id ? x.id === id : x.url === url));
  if (!endpoint) return res.status(404).json({ error: "endpoint not found in trusted registry" });
  res.json(await scoreOne(endpoint));
});

app.get("/history", async (req, res) => {
  if (typeof req.query.id !== 'string' || !req.query.id) return res.status(400).json({ error: "id is required" });
  let limit = 100;
  if (req.query.limit !== undefined) {
    const parsed = Number(req.query.limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) return res.status(400).json({ error: "limit must be an integer between 1 and 500" });
    limit = parsed;
  }
  res.json({ endpointId: req.query.id, snapshots: await historyFor(req.query.id, limit) });
});

app.get("/best", async (req, res) => {
  const intent = String(req.query.intent || "").toLowerCase();
  let maxPrice = Infinity;
  if (req.query.max_price !== undefined) {
    maxPrice = Number(req.query.max_price);
    if (!Number.isFinite(maxPrice) || maxPrice < 0) return res.status(400).json({ error: "max_price must be a finite non-negative number" });
  }
  const matching = (await listEndpoints()).filter((x) => {
    const intentOk = !intent || (x.intents || []).some((i) => String(i).toLowerCase().includes(intent)) || String(x.description || "").toLowerCase().includes(intent);
    const priceOk = x.priceUsd === null || x.priceUsd === undefined || x.priceUsd <= maxPrice;
    return intentOk && priceOk;
  });
  const candidates = matching.slice(0, maxCandidates);
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
    totalCandidates: matching.length,
    truncated: matching.length > candidates.length,
    alternatives: rest.slice(0, 5).map((x) => ({ endpoint: x.endpoint, score: x.score, confidence: x.confidence, reasonCodes: x.reasonCodes }))
  });
});

app.get("/.well-known/osa.json", (_req, res) => res.json({
  name: "OSA Agent Trust Oracle",
  version: "0.3.1",
  description: "Pre-purchase trust scoring and live verification for agent/API endpoints.",
  endpoints: ["GET /best", "GET /score", "GET /history", "GET /payment-options", "POST /ingest", "POST /sources/mcp", "POST /sources/bazaar"],
  security: { ssrfProtection: true, ingestAuthentication: true, responseByteLimit: true, boundedConcurrency: true },
  x402: { enabled: Boolean(process.env.OSA_PAY_TO), network: process.env.OSA_NETWORK || "eip155:84532", currency: "USDC" },
  output: ["endpoint", "score", "confidence", "alternatives", "reasonCodes"]
}));

app.use((error, _req, res, _next) => {
  console.error("OSA request failed", String(error?.message || error));
  if (res.headersSent) return;
  const status = Number(error?.status || error?.statusCode || 500);
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: status === 413 ? "payload too large" : "invalid request" });
    return;
  }
  res.status(500).json({ error: "internal error" });
});

const port = Number(process.env.PORT || 4021);
if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`OSA Agent Trust Oracle listening on :${port}`));
}

export default app;
