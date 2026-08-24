import assert from 'node:assert/strict';
import test from 'node:test';
import { createDodoCheckout, dodoReady } from '../src/payments/dodo.js';

test('dodoReady requires key and product', () => {
  assert.equal(dodoReady({}), false);
  assert.equal(dodoReady({ DODO_PAYMENTS_API_KEY: 'k', DODO_PRODUCT_ID: 'p' }), true);
});

test('creates a checkout with bearer auth and product cart', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, text: async () => JSON.stringify({ session_id: 'cs_1', checkout_url: 'https://checkout.example/cs_1' }) };
  };
  const out = await createDodoCheckout({ apiKey: 'secret', productId: 'prod_1', fetchImpl });
  assert.deepEqual(out, { sessionId: 'cs_1', checkoutUrl: 'https://checkout.example/cs_1' });
  assert.equal(request.url, 'https://live.dodopayments.com/checkouts');
  assert.equal(request.options.headers.authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(request.options.body).product_cart, [{ product_id: 'prod_1', quantity: 1 }]);
});

test('fails closed on insecure base/return URLs and bad responses', async () => {
  await assert.rejects(() => createDodoCheckout({ apiKey: 'k', productId: 'p', baseUrl: 'http://x.test', fetchImpl: async () => {} }), /HTTPS/);
  await assert.rejects(() => createDodoCheckout({ apiKey: 'k', productId: 'p', returnUrl: 'http://x.test', fetchImpl: async () => {} }), /HTTPS/);
  await assert.rejects(() => createDodoCheckout({ apiKey: 'k', productId: 'p', fetchImpl: async () => ({ ok: false, status: 401, text: async () => '{}' }) }), /DODO_HTTP_401/);
});
