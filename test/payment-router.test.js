import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentRouterStatus, selectPaymentRail } from '../src/commerce/payment-router.js';

test('payment router exposes broad acceptance but keeps unavailable rails fail closed', () => {
  const status = paymentRouterStatus({});
  assert.equal(status.version, 3);
  assert.equal(status.preferredHuman, 'direct_usdc');
  assert.equal(status.preferredFiat, 'tap');
  assert.equal(status.rails.tap.status, 'not_configured');
  assert.equal(status.rails.direct_usdc.status, 'ready');
  assert.equal(status.rails.nowpayments.status, 'not_configured');
  assert.deepEqual(status.rails.nowpayments.missing, ['api_key', 'ipn_secret', 'https_callback']);
  assert.equal(status.rails.stripe.status, 'not_configured');
  assert.equal(status.rails.paytabs.status, 'not_configured');
  assert.equal(status.acceptance.directCrypto.some((x) => x.network === 'Solana'), true);
  assert.equal(status.acceptance.directCrypto.some((x) => x.network === 'TRON'), true);
  assert.deepEqual(status.settlementPreference, ['USDC', 'USDT', 'BTC']);
});

test('Tap test mode is never selectable as a revenue rail', () => {
  const env = {
    TAP_SECRET_KEY: ['sk', 'test', 'example'].join('_'),
    TAP_MERCHANT_ID: 'merchant_example',
    TAP_POST_URL: 'https://osa.example/webhooks/tap',
    TAP_REDIRECT_URL: 'https://osa.example/payments/return',
  };
  const status = paymentRouterStatus(env);
  assert.equal(status.rails.tap.status, 'test_only');
  assert.equal(status.rails.tap.mode, 'test');
  assert.throws(() => selectPaymentRail({ requestedRail: 'tap', env }), /PAYMENT_RAIL_NOT_READY/);
});

test('live Tap becomes preferred human rail and secrets never appear in status', () => {
  const tapKey = ['sk', 'live', 'example'].join('_');
  const env = {
    TAP_SECRET_KEY: tapKey,
    TAP_MERCHANT_ID: 'merchant_example',
    TAP_POST_URL: 'https://osa.example/webhooks/tap',
    TAP_REDIRECT_URL: 'https://osa.example/payments/return',
  };
  const status = paymentRouterStatus(env);
  assert.equal(status.rails.tap.status, 'configured');
  assert.equal(status.preferredHuman, 'tap');
  assert.equal(selectPaymentRail({ requestedRail: 'tap', env }).rail, 'tap');
  assert.equal(selectPaymentRail({ env }).rail, 'tap');
  assert.equal(JSON.stringify(status).includes(tapKey), false);
});

test('Stripe test mode is never selectable as a revenue rail', () => {
  const env = { STRIPE_SECRET_KEY: ['sk', 'test', 'example'].join('_'), STRIPE_WEBHOOK_SECRET: 'whsec_example' };
  const status = paymentRouterStatus(env);
  assert.equal(status.rails.stripe.status, 'test_only');
  assert.equal(status.rails.stripe.mode, 'test');
  assert.throws(() => selectPaymentRail({ requestedRail: 'stripe', env }), /PAYMENT_RAIL_NOT_READY/);
});

test('live Stripe and fully configured NOWPayments remain selectable backups without exposing secrets', () => {
  const stripeKey = ['sk', 'live', 'example'].join('_');
  const env = {
    STRIPE_SECRET_KEY: stripeKey,
    STRIPE_WEBHOOK_SECRET: 'whsec_example',
    NOWPAYMENTS_API_KEY: 'np-key',
    NOWPAYMENTS_IPN_SECRET: 'np-secret',
    NOWPAYMENTS_CALLBACK_URL: 'https://osa.example/webhooks/nowpayments',
  };
  const status = paymentRouterStatus(env);
  assert.equal(status.rails.stripe.status, 'configured');
  assert.equal(status.rails.nowpayments.status, 'configured');
  assert.equal(status.preferredHuman, 'direct_usdc');
  assert.equal(selectPaymentRail({ requestedRail: 'stripe', env }).rail, 'stripe');
  assert.equal(selectPaymentRail({ requestedRail: 'nowpayments', env }).rail, 'nowpayments');
  const text = JSON.stringify(status);
  assert.equal(text.includes(stripeKey), false);
  assert.equal(text.includes('np-key'), false);
  assert.equal(text.includes('np-secret'), false);
});
