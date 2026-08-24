const DEFAULT_BASE_URL = 'https://live.dodopayments.com';

function cleanBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:') throw new Error('DODO_BASE_URL_MUST_BE_HTTPS');
  return url.toString().replace(/\/$/, '');
}

export function dodoReady(env = process.env) {
  return Boolean(env.DODO_PAYMENTS_API_KEY && env.DODO_PRODUCT_ID);
}

export async function createDodoCheckout({
  apiKey = process.env.DODO_PAYMENTS_API_KEY,
  productId = process.env.DODO_PRODUCT_ID,
  quantity = 1,
  returnUrl = process.env.DODO_RETURN_URL,
  baseUrl = process.env.DODO_PAYMENTS_BASE_URL || DEFAULT_BASE_URL,
  timeoutMs = 10000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new Error('DODO_API_KEY_REQUIRED');
  if (!productId) throw new Error('DODO_PRODUCT_ID_REQUIRED');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error('DODO_INVALID_QUANTITY');
  if (typeof fetchImpl !== 'function') throw new Error('DODO_FETCH_REQUIRED');

  const endpoint = `${cleanBaseUrl(baseUrl)}/checkouts`;
  const body = { product_cart: [{ product_id: productId, quantity }] };
  if (returnUrl) {
    const parsedReturn = new URL(returnUrl);
    if (parsedReturn.protocol !== 'https:') throw new Error('DODO_RETURN_URL_MUST_BE_HTTPS');
    body.return_url = parsedReturn.toString();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Math.min(Number(timeoutMs) || 10000, 30000)));
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('DODO_INVALID_JSON_RESPONSE'); }
    if (!response.ok) throw new Error(`DODO_HTTP_${response.status}`);
    if (typeof data.session_id !== 'string' || !data.session_id) throw new Error('DODO_SESSION_ID_MISSING');
    if (typeof data.checkout_url !== 'string' || !data.checkout_url.startsWith('https://')) throw new Error('DODO_CHECKOUT_URL_MISSING');
    return { sessionId: data.session_id, checkoutUrl: data.checkout_url };
  } finally {
    clearTimeout(timer);
  }
}
