import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentRouterStatus, selectPaymentRail } from '../src/commerce/payment-router.js';

test('payment router exposes broad acceptance but keeps unavailable rails fail closed', () => {
  const status = paymentRouterStatus({});
  assert.equal(status.version, 2);
  assert.equal(status.rails.direct_usdc.status, 'ready');
  assert.equal(status.rails.nowpayments.status, 'not_configured');
  assert.deepEqual(status.rails.nowpayments.missing, ['api_key', 'ipn_secret', 'https_callback']);
  assert.equal(status.rails.stripe.status, 'not_configured');
  assert.equal(status.acceptance.directCrypto.some((x) => x.network === 'Solana'), true);
  assert.equal(status.acceptance.directCrypto.some((x) => x.network === 'TRON'), false);
  assert.deepEqual(status.settlementPreference, ['USDC', 'USDT', 'BTC']);
});

test('Stripe test mode is never selectable as a revenue rail', () => {
  const env = { STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_WEBHOOK_SECRET: 'whsec_example' };
  const status = paymentRouterStatus(env);
  assert.equal(status.rails.stripe.status, 'test_only');
  assert.equal(status.rails.stripe.mode, 'test');
  assert.throws(() => selectPaymentRail({ requestedRail: 'stripe', env }), /PAYMENT_RAIL_NOT_READY/);
});

test('live Stripe and fully configured NOWPayments become selectable without exposing secrets', () => {
  const env = {
    STRIPE_SECRET_KEY: 'sk_live_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_example',
    NOWPAYMENTS_API_KEY: 'np-key',
    NOWPAYMENTS_IPN_SECRET: 'np-secret',
    NOWPAYMENTS_CALLBACK_URL: 'https://osa.example/webhooks/nowpayments',
  };
  const status = paymentRouterStatus(env);
  assert.equal(status.rails.stripe.status, 'configured');
  assert.equal(status.rails.nowpayments.status, 'configured');
  assert.deepEqual(status.rails.nowpayments.missing, []);
  assert.equal(selectPaymentRail({ requestedRail: 'stripe', env }).rail, 'stripe');
  assert.equal(selectPaymentRail({ requestedRail: 'nowpayments', env }).rail, 'nowpayments');
  const text = JSON.stringify(status);
  assert.equal(text.includes('sk_live_example'), false);
  assert.equal(text.includes('np-key'), false);
  assert.equal(text.includes('np-secret'), false);
});
