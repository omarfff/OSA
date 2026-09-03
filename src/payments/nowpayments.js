import crypto from 'node:crypto';

const DEFAULT_BASE_URL = 'https://api.nowpayments.io/v1';

function httpsBaseUrl(value = DEFAULT_BASE_URL) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:') throw new Error('NOWPAYMENTS_BASE_URL_MUST_BE_HTTPS');
  return url.toString().replace(/\/$/, '');
}

function httpsUrl(value, code) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(code);
  return url.toString();
}

function currencyCode(value, required = true) {
  const code = String(value || '').trim().toLowerCase();
  if (!code && !required) return null;
  if (!/^[a-z0-9_-]{2,24}$/.test(code)) throw new Error('NOWPAYMENTS_INVALID_CURRENCY');
  return code;
}

function orderId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error('NOWPAYMENTS_INVALID_ORDER_ID');
  return id;
}

function deepSort(value) {
  if (Array.isArray(value)) return value.map(deepSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, deepSort(value[key])]));
}

function hasHttpsCallback(value) {
  try { return new URL(String(value || '')).protocol === 'https:'; }
  catch { return false; }
}

export function canonicalNowPaymentsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('NOWPAYMENTS_INVALID_IPN_PAYLOAD');
  return JSON.stringify(deepSort(payload));
}

export function nowPaymentsMissingConfig(env = process.env) {
  const missing = [];
  if (!String(env.NOWPAYMENTS_API_KEY || '').trim()) missing.push('api_key');
  if (!String(env.NOWPAYMENTS_IPN_SECRET || '').trim()) missing.push('ipn_secret');
  if (!hasHttpsCallback(env.NOWPAYMENTS_CALLBACK_URL)) missing.push('https_callback');
  return missing;
}

export function nowPaymentsReady(env = process.env) {
  return nowPaymentsMissingConfig(env).length === 0;
}

export function verifyNowPaymentsIpn(payload, signature, secret = process.env.NOWPAYMENTS_IPN_SECRET) {
  const supplied = String(signature || '').trim().toLowerCase();
  const key = String(secret || '').trim();
  if (!key || !/^[a-f0-9]{128}$/.test(supplied)) return false;
  const expected = crypto.createHmac('sha512', key).update(canonicalNowPaymentsPayload(payload)).digest('hex');
  const a = Buffer.from(supplied, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function isNowPaymentsFinished(payload) {
  return Boolean(
    payload
    && String(payload.payment_status || '').toLowerCase() === 'finished'
    && String(payload.payment_id || '').trim()
    && String(payload.order_id || '').trim()
    && Number.isFinite(Number(payload.actually_paid))
    && Number(payload.actually_paid) > 0,
  );
}

export async function listNowPaymentsCurrencies({
  apiKey = process.env.NOWPAYMENTS_API_KEY,
  baseUrl = process.env.NOWPAYMENTS_BASE_URL || DEFAULT_BASE_URL,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('NOWPAYMENTS_API_KEY_REQUIRED');
  if (typeof fetchImpl !== 'function') throw new Error('NOWPAYMENTS_FETCH_REQUIRED');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Math.min(Number(timeoutMs) || 10_000, 30_000)));
  try {
    const response = await fetchImpl(`${httpsBaseUrl(baseUrl)}/currencies`, {
      method: 'GET',
      headers: { 'x-api-key': key, accept: 'application/json' },
      signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('NOWPAYMENTS_INVALID_JSON_RESPONSE'); }
    if (!response.ok) throw new Error(`NOWPAYMENTS_HTTP_${response.status}`);
    const currencies = Array.isArray(data.currencies) ? data.currencies : [];
    return [...new Set(currencies.map((x) => currencyCode(x)).filter(Boolean))].sort();
  } finally {
    clearTimeout(timer);
  }
}

export async function createNowPayment({
  apiKey = process.env.NOWPAYMENTS_API_KEY,
  callbackUrl = process.env.NOWPAYMENTS_CALLBACK_URL,
  baseUrl = process.env.NOWPAYMENTS_BASE_URL || DEFAULT_BASE_URL,
  orderId: rawOrderId,
  description,
  priceAmount,
  priceCurrency = 'usd',
  payCurrency,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('NOWPAYMENTS_API_KEY_REQUIRED');
  if (!callbackUrl) throw new Error('NOWPAYMENTS_CALLBACK_URL_REQUIRED');
  if (typeof fetchImpl !== 'function') throw new Error('NOWPAYMENTS_FETCH_REQUIRED');

  const amount = Number(priceAmount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) throw new Error('NOWPAYMENTS_INVALID_PRICE');

  const body = {
    price_amount: amount,
    price_currency: currencyCode(priceCurrency),
    ipn_callback_url: httpsUrl(callbackUrl, 'NOWPAYMENTS_CALLBACK_URL_MUST_BE_HTTPS'),
    order_id: orderId(rawOrderId),
  };
  const normalizedPayCurrency = currencyCode(payCurrency, false);
  if (normalizedPayCurrency) body.pay_currency = normalizedPayCurrency;
  if (description) body.order_description = String(description).slice(0, 255);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Math.min(Number(timeoutMs) || 10_000, 30_000)));
  try {
    const response = await fetchImpl(`${httpsBaseUrl(baseUrl)}/payment`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('NOWPAYMENTS_INVALID_JSON_RESPONSE'); }
    if (!response.ok) throw new Error(`NOWPAYMENTS_HTTP_${response.status}`);
    if (!String(data.payment_id || '').trim()) throw new Error('NOWPAYMENTS_PAYMENT_ID_MISSING');
    if (!String(data.payment_status || '').trim()) throw new Error('NOWPAYMENTS_PAYMENT_STATUS_MISSING');
    return {
      paymentId: String(data.payment_id),
      status: String(data.payment_status),
      orderId: String(data.order_id || body.order_id),
      purchaseId: data.purchase_id == null ? null : String(data.purchase_id),
      payAddress: data.pay_address == null ? null : String(data.pay_address),
      payAmount: data.pay_amount == null ? null : Number(data.pay_amount),
      payCurrency: data.pay_currency == null ? normalizedPayCurrency : String(data.pay_currency).toLowerCase(),
      priceAmount: data.price_amount == null ? amount : Number(data.price_amount),
      priceCurrency: data.price_currency == null ? body.price_currency : String(data.price_currency).toLowerCase(),
    };
  } finally {
    clearTimeout(timer);
  }
}
