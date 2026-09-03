import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { canonicalNowPaymentsPayload, createNowPayment, isNowPaymentsFinished, listNowPaymentsCurrencies, nowPaymentsMissingConfig, nowPaymentsReady, verifyNowPaymentsIpn } from '../src/payments/nowpayments.js';

test('NOWPayments is disabled until API key, IPN secret and HTTPS callback are all configured', () => {
  assert.equal(nowPaymentsReady({}), false);
  assert.deepEqual(nowPaymentsMissingConfig({}), ['api_key', 'ipn_secret', 'https_callback']);
  assert.equal(nowPaymentsReady({ NOWPAYMENTS_API_KEY: 'k', NOWPAYMENTS_IPN_SECRET: 's', NOWPAYMENTS_CALLBACK_URL: 'http://osa.example/ipn' }), false);
  assert.deepEqual(nowPaymentsMissingConfig({ NOWPAYMENTS_API_KEY: 'k', NOWPAYMENTS_IPN_SECRET: 's', NOWPAYMENTS_CALLBACK_URL: 'http://osa.example/ipn' }), ['https_callback']);
  assert.equal(nowPaymentsReady({ NOWPAYMENTS_API_KEY: 'k', NOWPAYMENTS_IPN_SECRET: 's', NOWPAYMENTS_CALLBACK_URL: 'https://osa.example/ipn' }), true);
  assert.deepEqual(nowPaymentsMissingConfig({ NOWPAYMENTS_API_KEY: 'k', NOWPAYMENTS_IPN_SECRET: 's', NOWPAYMENTS_CALLBACK_URL: 'https://osa.example/ipn' }), []);
});

test('discovers and normalizes available NOWPayments currencies without leaking the API key', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, text: async () => JSON.stringify({ currencies: ['BTC', 'usdttrc20', 'btc', 'USDC'] }) };
  };
  const out = await listNowPaymentsCurrencies({ apiKey: 'secret-key', fetchImpl });
  assert.equal(request.url, 'https://api.nowpayments.io/v1/currencies');
  assert.equal(request.options.headers['x-api-key'], 'secret-key');
  assert.deepEqual(out, ['btc', 'usdc', 'usdttrc20']);
});

test('verifies deep-sorted HMAC-SHA512 IPN and rejects tampering', () => {
  const payload = { z: 2, a: { d: 4, b: 3 }, payment_status: 'finished', payment_id: 7, order_id: 'o1', actually_paid: 1 };
  const secret = 'ipn-secret';
  const canonical = canonicalNowPaymentsPayload(payload);
  assert.equal(canonical, '{"a":{"b":3,"d":4},"actually_paid":1,"order_id":"o1","payment_id":7,"payment_status":"finished","z":2}');
  const sig = crypto.createHmac('sha512', secret).update(canonical).digest('hex');
  assert.equal(verifyNowPaymentsIpn(payload, sig, secret), true);
  assert.equal(verifyNowPaymentsIpn({ ...payload, actually_paid: 2 }, sig, secret), false);
});

test('creates payment without leaking API key into body', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({
        payment_id: 123,
        payment_status: 'waiting',
        order_id: 'osa-order-1',
        purchase_id: 456,
        pay_address: 'wallet',
        pay_amount: 12.3,
        pay_currency: 'btc',
        price_amount: 79,
        price_currency: 'usd',
      }),
    };
  };
  const out = await createNowPayment({
    apiKey: 'secret-key',
    callbackUrl: 'https://osa.example/webhooks/nowpayments',
    orderId: 'osa-order-1',
    description: 'OSA pilot',
    priceAmount: 79,
    payCurrency: 'btc',
    fetchImpl,
  });
  assert.equal(request.url, 'https://api.nowpayments.io/v1/payment');
  assert.equal(request.options.headers['x-api-key'], 'secret-key');
  assert.equal(request.options.body.includes('secret-key'), false);
  assert.equal(JSON.parse(request.options.body).ipn_callback_url, 'https://osa.example/webhooks/nowpayments');
  assert.deepEqual(out, {
    paymentId: '123',
    status: 'waiting',
    orderId: 'osa-order-1',
    purchaseId: '456',
    payAddress: 'wallet',
    payAmount: 12.3,
    payCurrency: 'btc',
    priceAmount: 79,
    priceCurrency: 'usd',
  });
});

test('fails closed on insecure callback and only finished is terminal success', async () => {
  await assert.rejects(() => createNowPayment({ apiKey: 'k', callbackUrl: 'http://bad.test/ipn', orderId: 'o1', priceAmount: 1, fetchImpl: async () => {} }), /CALLBACK_URL_MUST_BE_HTTPS/);
  assert.equal(isNowPaymentsFinished({ payment_status: 'confirmed', payment_id: 1, order_id: 'o1', actually_paid: 1 }), false);
  assert.equal(isNowPaymentsFinished({ payment_status: 'finished', payment_id: 1, order_id: 'o1', actually_paid: 1 }), true);
});
