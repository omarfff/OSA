const DEFAULT_BASE_URL = 'https://api.tap.company/v2';

function httpsUrl(value, code) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:') throw new Error(code);
  return url.toString();
}

function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  const url = new URL(String(value || DEFAULT_BASE_URL));
  if (url.protocol !== 'https:') throw new Error('TAP_BASE_URL_MUST_BE_HTTPS');
  return url.toString().replace(/\/$/, '');
}

export function tapMissingConfig(env = process.env) {
  const missing = [];
  const secret = String(env.TAP_SECRET_KEY || '').trim();
  if (!/^sk_live_/.test(secret)) missing.push('live_secret_key');
  if (!String(env.TAP_MERCHANT_ID || '').trim()) missing.push('merchant_id');
  try { httpsUrl(env.TAP_POST_URL, 'TAP_POST_URL_MUST_BE_HTTPS'); } catch { missing.push('https_post_url'); }
  try { httpsUrl(env.TAP_REDIRECT_URL, 'TAP_REDIRECT_URL_MUST_BE_HTTPS'); } catch { missing.push('https_redirect_url'); }
  return [...new Set(missing)];
}

export function tapRuntimeStatus(env = process.env) {
  const secret = String(env.TAP_SECRET_KEY || '').trim();
  const missing = tapMissingConfig(env);
  if (missing.length === 0) return { status: 'configured', mode: 'live', missing: [] };
  if (/^sk_test_/.test(secret)) return { status: 'test_only', mode: 'test', missing };
  return { status: 'not_configured', mode: 'unconfigured', missing };
}

function reference(value, prefix) {
  const v = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(v)) throw new Error(`TAP_INVALID_${prefix.toUpperCase()}_REFERENCE`);
  return v;
}

function chargeId(value) {
  const v = String(value || '').trim();
  if (!/^chg_[A-Za-z0-9_-]{3,160}$/.test(v)) throw new Error('TAP_INVALID_CHARGE_ID');
  return v;
}

async function tapRequest({ method, path, secretKey, baseUrl, body, timeoutMs = 10_000, fetchImpl = globalThis.fetch }) {
  const secret = String(secretKey || '').trim();
  if (!/^sk_live_/.test(secret)) throw new Error('TAP_LIVE_SECRET_KEY_REQUIRED');
  if (typeof fetchImpl !== 'function') throw new Error('TAP_FETCH_REQUIRED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Math.min(Number(timeoutMs) || 10_000, 30_000)));
  try {
    const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('TAP_INVALID_JSON_RESPONSE'); }
    if (!response.ok) throw new Error(`TAP_HTTP_${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function createTapHostedCharge({
  secretKey = process.env.TAP_SECRET_KEY,
  merchantId = process.env.TAP_MERCHANT_ID,
  postUrl = process.env.TAP_POST_URL,
  redirectUrl = process.env.TAP_REDIRECT_URL,
  baseUrl = process.env.TAP_BASE_URL || DEFAULT_BASE_URL,
  amount,
  currency = 'SAR',
  orderReference,
  transactionReference,
  description = 'OSA payment',
  customer,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const mid = String(merchantId || '').trim();
  if (!mid) throw new Error('TAP_MERCHANT_ID_REQUIRED');
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 10_000_000) throw new Error('TAP_INVALID_AMOUNT');
  const ccy = String(currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(ccy)) throw new Error('TAP_INVALID_CURRENCY');

  const body = {
    amount: numericAmount,
    currency: ccy,
    customer_initiated: true,
    threeDSecure: true,
    save_card: false,
    description: String(description || 'OSA payment').slice(0, 255),
    reference: {
      transaction: reference(transactionReference, 'transaction'),
      order: reference(orderReference, 'order'),
    },
    merchant: { id: mid },
    source: { id: 'src_all' },
    post: { url: httpsUrl(postUrl, 'TAP_POST_URL_MUST_BE_HTTPS') },
    redirect: { url: httpsUrl(redirectUrl, 'TAP_REDIRECT_URL_MUST_BE_HTTPS') },
  };

  if (customer && typeof customer === 'object') {
    const c = {};
    if (customer.firstName) c.first_name = String(customer.firstName).slice(0, 80);
    if (customer.lastName) c.last_name = String(customer.lastName).slice(0, 80);
    if (customer.email) c.email = String(customer.email).slice(0, 254);
    if (customer.phoneCountryCode && customer.phoneNumber) {
      c.phone = {
        country_code: String(customer.phoneCountryCode).replace(/\D/g, '').slice(0, 4),
        number: String(customer.phoneNumber).replace(/\D/g, '').slice(0, 20),
      };
    }
    if (Object.keys(c).length) body.customer = c;
  }

  const data = await tapRequest({ method: 'POST', path: '/charges/', secretKey, baseUrl, body, timeoutMs, fetchImpl });
  if (!String(data.id || '').trim()) throw new Error('TAP_CHARGE_ID_MISSING');
  if (!String(data.status || '').trim()) throw new Error('TAP_CHARGE_STATUS_MISSING');
  const paymentUrl = data.transaction?.url == null ? null : String(data.transaction.url);
  if (!paymentUrl) throw new Error('TAP_PAYMENT_URL_MISSING');
  return {
    chargeId: String(data.id),
    status: String(data.status),
    paymentUrl,
    orderReference: String(data.reference?.order || body.reference.order),
    transactionReference: String(data.reference?.transaction || body.reference.transaction),
    amount: data.amount == null ? numericAmount : Number(data.amount),
    currency: String(data.currency || ccy).toUpperCase(),
  };
}

export async function retrieveTapCharge({
  chargeId: rawChargeId,
  secretKey = process.env.TAP_SECRET_KEY,
  baseUrl = process.env.TAP_BASE_URL || DEFAULT_BASE_URL,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const id = chargeId(rawChargeId);
  const data = await tapRequest({ method: 'GET', path: `/charges/${encodeURIComponent(id)}`, secretKey, baseUrl, timeoutMs, fetchImpl });
  if (String(data.id || '') !== id) throw new Error('TAP_CHARGE_ID_MISMATCH');
  return {
    id,
    status: String(data.status || ''),
    amount: Number(data.amount),
    currency: String(data.currency || '').toUpperCase(),
    orderReference: data.reference?.order == null ? null : String(data.reference.order),
    transactionReference: data.reference?.transaction == null ? null : String(data.reference.transaction),
    raw: data,
  };
}

export function isTapCaptured(charge) {
  return Boolean(charge && String(charge.id || '').trim() && String(charge.status || '').toUpperCase() === 'CAPTURED');
}
