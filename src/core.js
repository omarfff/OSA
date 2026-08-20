import crypto from "node:crypto";

const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const pct = (n) => Math.round(clamp(n) * 100);

export function endpointId(value) {
  return value.id || crypto.createHash("sha256").update(`${value.method || "GET"}:${value.url}`).digest("hex").slice(0, 16);
}

function normalizedPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function normalizeEndpoint(raw, source = "manual") {
  const url = raw.url || raw.endpoint || raw.resource?.url;
  if (!url) throw new Error("endpoint url is required");
  const method = String(raw.method || raw.input?.method || "GET").toUpperCase();
  const priceUsd = normalizedPrice(raw.priceUsd ?? raw.price_usd ?? raw.price ?? raw.accepts?.[0]?.price);
  const payment = raw.payment || raw.accepts?.[0] || raw.resource?.accepts?.[0] || null;
  const intents = Array.isArray(raw.intents) ? raw.intents : [raw.intent || raw.category].filter(Boolean);
  return {
    id: endpointId({ ...raw, url, method }),
    name: raw.name || raw.title || raw.toolName || url,
    url,
    method,
    source,
    intents,
    description: raw.description || raw.resource?.description || "",
    priceUsd,
    schema: raw.schema || raw.outputSchema || raw.extensions?.bazaar?.schema || null,
    payment,
    transactionEvidence: Number(raw.transactionEvidence ?? raw.transactions ?? raw.successfulTransactions ?? 0) || 0,
    metadata: raw.metadata || {}
  };
}

export function inferSchemaSignature(payload) {
  if (payload === null) return "null";
  if (Array.isArray(payload)) return `array:${payload.length ? inferSchemaSignature(payload[0]) : "empty"}`;
  if (typeof payload !== "object") return typeof payload;
  return Object.keys(payload).sort().map((k) => `${k}:${typeof payload[k]}`).join("|");
}

export function calculateTrustScore(endpoint, current, previous = null) {
  const uptime = current.ok ? 1 : 0;
  const latencyMs = Number(current.latencyMs ?? 9999);
  const latency = clamp(1 - Math.log10(Math.max(1, latencyMs)) / 4);

  const currentPrice = normalizedPrice(current.priceUsd ?? endpoint.priceUsd);
  const previousPrice = normalizedPrice(previous?.priceUsd ?? endpoint.priceUsd);
  const priceDrift = previousPrice && currentPrice !== null
    ? clamp(Math.abs(currentPrice - previousPrice) / Math.max(previousPrice, 0.000001))
    : 0;
  const priceStability = 1 - priceDrift;

  const schemaChanged = Boolean(previous?.schemaSignature && current.schemaSignature && previous.schemaSignature !== current.schemaSignature);
  const schemaStability = schemaChanged ? 0 : 1;

  const paymentChanged = Boolean(previous?.paymentSignature && current.paymentSignature && previous.paymentSignature !== current.paymentSignature);
  const paymentStability = paymentChanged ? 0 : 1;

  const tx = Number(current.transactionEvidence ?? endpoint.transactionEvidence ?? 0);
  const transactionEvidence = clamp(Math.log10(tx + 1) / 4);

  const weights = {
    uptime: 0.30,
    latency: 0.20,
    priceStability: 0.15,
    schemaStability: 0.15,
    paymentStability: 0.10,
    transactionEvidence: 0.10
  };
  const raw = uptime * weights.uptime + latency * weights.latency + priceStability * weights.priceStability + schemaStability * weights.schemaStability + paymentStability * weights.paymentStability + transactionEvidence * weights.transactionEvidence;

  const reasons = [];
  if (!current.ok) reasons.push("ENDPOINT_DOWN");
  if (latencyMs > 2000) reasons.push("HIGH_LATENCY");
  if (priceDrift > 0.1) reasons.push("PRICE_DRIFT");
  if (schemaChanged) reasons.push("SCHEMA_DRIFT");
  if (paymentChanged) reasons.push("PAYMENT_CHANGED");
  if (tx < 3) reasons.push("LOW_TRANSACTION_EVIDENCE");
  if (!reasons.length) reasons.push("STABLE");

  const evidenceCount = [current.checkedAt, current.status, current.schemaSignature, current.paymentSignature, tx > 0].filter(Boolean).length;
  const confidence = pct(clamp(0.35 + evidenceCount * 0.1 + Math.min(tx, 100) / 1000));

  return {
    score: pct(raw),
    confidence,
    reasonCodes: reasons,
    components: {
      uptime: pct(uptime), latency: pct(latency), priceStability: pct(priceStability),
      schemaStability: pct(schemaStability), paymentStability: pct(paymentStability), transactionEvidence: pct(transactionEvidence)
    }
  };
}

export async function liveVerify(endpoint, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(endpoint.url, {
      method: endpoint.method === "GET" ? "GET" : "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "OSA-Agent-Trust-Oracle/0.1" }
    });
    const latencyMs = Math.round(performance.now() - started);
    let body = null;
    const type = response.headers.get("content-type") || "";
    if (endpoint.method === "GET" && type.includes("application/json")) {
      try { body = await response.clone().json(); } catch { body = null; }
    }
    const paymentHeader = response.headers.get("payment-required") || response.headers.get("x-payment-required") || "";
    return {
      ok: response.ok || response.status === 402,
      status: response.status,
      latencyMs,
      checkedAt: new Date().toISOString(),
      schemaSignature: body ? inferSchemaSignature(body) : null,
      paymentSignature: paymentHeader || JSON.stringify(endpoint.payment || null),
      priceUsd: endpoint.priceUsd,
      transactionEvidence: endpoint.transactionEvidence
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Math.round(performance.now() - started),
      checkedAt: new Date().toISOString(),
      error: error?.name === "AbortError" ? "timeout" : String(error?.message || error),
      schemaSignature: null,
      paymentSignature: JSON.stringify(endpoint.payment || null),
      priceUsd: endpoint.priceUsd,
      transactionEvidence: endpoint.transactionEvidence
    };
  } finally {
    clearTimeout(timer);
  }
}
