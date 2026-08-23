import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";

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
  if (!['GET', 'HEAD'].includes(method)) throw new Error("only GET/HEAD verification targets are supported");
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

function mappedIpv4(address) {
  const value = address.toLowerCase().split('%')[0];
  if (!value.startsWith('::ffff:')) return null;
  const tail = value.slice(7);
  if (net.isIP(tail) === 4) return tail;
  const parts = tail.split(':');
  if (parts.length !== 2) return null;
  const hi = Number.parseInt(parts[0], 16);
  const lo = Number.parseInt(parts[1], 16);
  if (![hi, lo].every(Number.isFinite)) return null;
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isPublicIpAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (version === 6) {
    let value = address.toLowerCase().split('%')[0];
    const mapped = mappedIpv4(value);
    if (mapped) return isPublicIpAddress(mapped);
    if (value === '::' || value === '::1' || value.startsWith('::')) return false;
    const first = Number.parseInt(value.split(':')[0] || '0', 16);
    if (!Number.isFinite(first)) return false;
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (value.startsWith('2001:db8:')) return false; // documentation
    return true;
  }
  return false;
}

export async function validateTargetUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); }
  catch { throw Object.assign(new Error('invalid endpoint URL'), { code: 'INVALID_URL' }); }
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('only http/https endpoints are allowed'), { code: 'UNSAFE_PROTOCOL' });
  if (url.username || url.password) throw Object.assign(new Error('endpoint URLs with credentials are not allowed'), { code: 'URL_CREDENTIALS' });
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw Object.assign(new Error('local endpoint targets are not allowed'), { code: 'NON_PUBLIC_TARGET' });
  }

  if (net.isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) throw Object.assign(new Error('non-public endpoint target is not allowed'), { code: 'NON_PUBLIC_TARGET' });
    return { url, addresses: [{ address: hostname, family: net.isIP(hostname) }] };
  }

  let addresses;
  try { addresses = await dns.lookup(hostname, { all: true, verbatim: true }); }
  catch { throw Object.assign(new Error('endpoint DNS resolution failed'), { code: 'DNS_FAILED' }); }
  if (!addresses.length || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
    throw Object.assign(new Error('endpoint resolves to a non-public address'), { code: 'NON_PUBLIC_TARGET' });
  }
  return { url, addresses };
}

async function requestOnce(rawUrl, method, timeoutMs, maxBytes) {
  const { url, addresses } = await validateTargetUrl(rawUrl);
  const pinned = addresses[0];
  const transport = url.protocol === 'https:' ? https : http;
  return await new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers: { 'user-agent': 'OSA-Agent-Trust-Oracle/0.2', accept: 'application/json, */*;q=0.1' },
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family)
    }, (res) => {
      const status = Number(res.statusCode || 0);
      const headers = res.headers;
      if (status >= 300 && status < 400 && headers.location) {
        res.resume();
        resolve({ status, headers, body: '', redirect: new URL(headers.location, url).href, url });
        return;
      }
      if (method === 'HEAD') {
        res.resume();
        resolve({ status, headers, body: '', redirect: null, url });
        return;
      }
      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          res.destroy(Object.assign(new Error('endpoint response too large'), { code: 'RESPONSE_TOO_LARGE' }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8'), redirect: null, url }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('endpoint request timed out'), { code: 'TIMEOUT' })));
    req.on('error', reject);
    req.end();
  });
}

async function safeRequest(rawUrl, method, timeoutMs, maxBytes, maxRedirects) {
  const started = Date.now();
  let current = rawUrl;
  let previousProtocol = null;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) throw Object.assign(new Error('endpoint request timed out'), { code: 'TIMEOUT' });
    const result = await requestOnce(current, method, remaining, maxBytes);
    if (!result.redirect) return result;
    const next = new URL(result.redirect);
    if (previousProtocol === 'https:' && next.protocol === 'http:') {
      throw Object.assign(new Error('HTTPS downgrade redirect refused'), { code: 'REDIRECT_DOWNGRADE' });
    }
    previousProtocol = result.url.protocol;
    current = next.href;
  }
  throw Object.assign(new Error('too many endpoint redirects'), { code: 'TOO_MANY_REDIRECTS' });
}

export async function liveVerify(endpoint, timeoutMs = 5000, options = {}) {
  const started = performance.now();
  const maxBytes = Number(options.maxBytes || process.env.OSA_MAX_RESPONSE_BYTES || 262144);
  const maxRedirects = Number(options.maxRedirects ?? process.env.OSA_MAX_REDIRECTS ?? 2);
  try {
    const response = await safeRequest(endpoint.url, endpoint.method === 'GET' ? 'GET' : 'HEAD', timeoutMs, maxBytes, maxRedirects);
    const latencyMs = Math.round(performance.now() - started);
    let body = null;
    const type = String(response.headers['content-type'] || '');
    if (endpoint.method === 'GET' && type.includes('application/json') && response.body) {
      try { body = JSON.parse(response.body); } catch { body = null; }
    }
    const paymentHeader = response.headers['payment-required'] || response.headers['x-payment-required'] || '';
    return {
      ok: (response.status >= 200 && response.status < 300) || response.status === 402,
      status: response.status,
      latencyMs,
      checkedAt: new Date().toISOString(),
      schemaSignature: body ? inferSchemaSignature(body) : null,
      paymentSignature: String(paymentHeader || JSON.stringify(endpoint.payment || null)),
      priceUsd: endpoint.priceUsd,
      transactionEvidence: endpoint.transactionEvidence
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Math.round(performance.now() - started),
      checkedAt: new Date().toISOString(),
      error: String(error?.code || error?.message || error),
      schemaSignature: null,
      paymentSignature: JSON.stringify(endpoint.payment || null),
      priceUsd: endpoint.priceUsd,
      transactionEvidence: endpoint.transactionEvidence
    };
  }
}
