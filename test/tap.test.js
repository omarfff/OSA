import test from 'node:test';
import assert from 'node:assert/strict';
import { createTapHostedCharge, isTapCaptured, tapMissingConfig, tapRuntimeStatus } from '../src/payments/tap.js';

test('Tap stays fail closed until all live merchant fields exist', () => {
  assert.equal(tapRuntimeStatus({}).status, 'not_configured');
  assert.deepEqual(tapMissingConfig({}), ['live_secret_key', 'merchant_id', 'https_post_url', 'https_redirect_url']);
  const testEnv = {
    TAP_SECRET_KEY: ['sk', 'test', 'example'].join('_'),
    TAP_MERCHANT_ID: 'merchant_example',
    TAP_POST_URL: 'https://osa.example/webhooks/tap',
    TAP_REDIRECT_URL: 'https://osa.example/payments/return',
  };
  assert.equal(tapRuntimeStatus(testEnv).status, 'test_only');
});

test('creates Tap hosted src_all charge without leaking credentials into request body', async () => {
  const liveKey = ['sk', 'live', 'example'].join('_');
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: 'chg_example',
        status: 'INITIATED',
        amount: 79,
        currency: 'SAR',
        reference: { transaction: 'txn_osa_1', order: 'ord_osa_1' },
        transaction: { url: 'https://payments.example/checkout' },
      }),
    };
  };
  const out = await createTapHostedCharge({
    secretKey: liveKey,
    merchantId: 'merchant_example',
    postUrl: 'https://osa.example/webhooks/tap',
    redirectUrl: 'https://osa.example/payments/return',
    amount: 79,
    currency: 'SAR',
    orderReference: 'ord_osa_1',
    transactionReference: 'txn_osa_1',
    description: 'OSA pilot',
    fetchImpl,
  });
  assert.equal(request.url, 'https://api.tap.company/v2/charges/');
  assert.equal(request.options.headers.authorization, `Bearer ${liveKey}`);
  const body = JSON.parse(request.options.body);
  assert.equal(body.source.id, 'src_all');
  assert.equal(body.currency, 'SAR');
  assert.equal(body.threeDSecure, true);
  assert.equal(body.save_card, false);
  assert.equal(request.options.body.includes(liveKey), false);
  assert.deepEqual(out, {
    chargeId: 'chg_example',
    status: 'INITIATED',
    paymentUrl: 'https://payments.example/checkout',
    orderReference: 'ord_osa_1',
    transactionReference: 'txn_osa_1',
    amount: 79,
    currency: 'SAR',
  });
});

test('Tap live charge requires HTTPS callback URLs and CAPTURED is the only terminal success', async () => {
  const liveKey = ['sk', 'live', 'example'].join('_');
  await assert.rejects(() => createTapHostedCharge({
    secretKey: liveKey,
    merchantId: 'merchant_example',
    postUrl: 'http://bad.example/tap',
    redirectUrl: 'https://osa.example/return',
    amount: 1,
    orderReference: 'o1',
    transactionReference: 't1',
    fetchImpl: async () => {},
  }), /TAP_POST_URL_MUST_BE_HTTPS/);
  assert.equal(isTapCaptured({ id: 'chg_1', status: 'INITIATED' }), false);
  assert.equal(isTapCaptured({ id: 'chg_1', status: 'CAPTURED' }), true);
});
