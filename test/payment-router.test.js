import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentRouterStatus, selectPaymentRail } from '../src/commerce/payment-router.js';

test('human checkout defaults to invoice request with USDC as the instant option', () => {
  const status = paymentRouterStatus({});
  assert.equal(status.version, 4);
  assert.equal(status.product.sku, 'OSA-MCP-RELIABILITY-30D');
  assert.equal(status.preferredHuman, 'invoice_request');
  assert.equal(status.preferredInstantHuman, 'pilot_usdc');
  assert.equal(status.rails.invoice_request.status, 'request_ready');
  assert.equal(status.rails.pilot_usdc.status, 'ready');
  assert.deepEqual(status.rails.pilot_usdc.networks, ['Base', 'Polygon', 'Arbitrum']);
  assert.equal(selectPaymentRail({ env: {} }).rail, 'invoice_request');
  assert.equal(selectPaymentRail({ requestedRail: 'pilot_usdc', env: {} }).rail, 'pilot_usdc');
});

test('Tap and the legacy five-dollar checkout stay unselectable even with credentials present', () => {
  const env = {
    TAP_SECRET_KEY: ['sk', 'live', 'example'].join('_'),
    TAP_MERCHANT_ID: 'merchant_example',
    TAP_POST_URL: 'https://osa.example/webhooks/tap',
    TAP_REDIRECT_URL: 'https://osa.example/payments/return',
  };
  const status = paymentRouterStatus(env);
  assert.equal(status.rails.tap.status, 'disabled_by_owner');
  assert.equal(status.rails.tap.advertised, false);
  assert.equal(status.rails.legacy_five_dollar_checkout.status, 'retired');
  assert.throws(() => selectPaymentRail({ requestedRail: 'tap', env }), /PAYMENT_RAIL_NOT_READY/);
  assert.throws(() => selectPaymentRail({ requestedRail: 'legacy_five_dollar_checkout', env }), /PAYMENT_RAIL_NOT_READY/);
});

test('card credentials never make the unapproved customer rail live or advertised', () => {
  const secret = ['sk', 'live', 'example'].join('_');
  const status = paymentRouterStatus({ STRIPE_SECRET_KEY: secret, STRIPE_WEBHOOK_SECRET: 'whsec_example' });
  assert.equal(status.rails.card_wallet.status, 'not_live');
  assert.equal(status.rails.card_wallet.providerStatus, 'configured');
  assert.equal(status.rails.card_wallet.advertised, false);
  assert.equal(JSON.stringify(status).includes(secret), false);
  assert.throws(() => selectPaymentRail({ requestedRail: 'card_wallet' }), /PAYMENT_RAIL_NOT_READY/);
});
