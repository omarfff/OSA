import assert from 'node:assert/strict';
import test from 'node:test';
import { canFulfill, evaluateDirectUsdcEvidence, evaluateNowPaymentsEvidence, evaluateX402Evidence } from '../src/commerce/fulfillment-gate.js';

test('x402 only passes verified mainnet settlement truth', () => {
  assert.equal(evaluateX402Evidence({ environment: 'testnet', settlement_tx: '0x1', metadata: { settlement_success: true } }).ok, false);
  assert.equal(evaluateX402Evidence({ environment: 'mainnet', settlement_tx: null, metadata: { settlement_success: true } }).ok, false);
  const out = evaluateX402Evidence({ environment: 'mainnet', settlement_tx: '0xabc', metadata: { settlement_success: true } });
  assert.equal(out.ok, true);
  assert.equal(out.txHash, '0xabc');
});

test('direct USDC requires success event plus matching verified crypto order', () => {
  const event = { provider: 'direct_usdc', event_type: 'payment.succeeded', payment_id: '0xtx', credits_delta: 25, status: 'fulfilled' };
  assert.equal(evaluateDirectUsdcEvidence(event, null, { successEventTypes: ['payment.succeeded'] }).ok, false);
  assert.equal(evaluateDirectUsdcEvidence(event, { status: 'verified', tx_hash: '0xother' }, { successEventTypes: ['payment.succeeded'] }).ok, false);
  assert.equal(evaluateDirectUsdcEvidence(event, { status: 'verified', tx_hash: '0xtx' }).ok, false);
  const out = evaluateDirectUsdcEvidence(event, { status: 'verified', tx_hash: '0xtx' }, { successEventTypes: ['payment.succeeded'] });
  assert.equal(out.ok, true);
  assert.equal(out.credits, 25);
});

test('NOWPayments valid IPN alone never authorizes fulfillment', () => {
  const payment = { payment_status: 'finished', payment_id: 99, order_id: 'o99', actually_paid: 79 };
  assert.equal(evaluateNowPaymentsEvidence({ ipnVerified: true, payment }).ok, false);
  assert.equal(evaluateNowPaymentsEvidence({
    ipnVerified: true,
    payment,
    receipt: { verified: true, paymentId: '99', txHash: '0xtx', network: 'bitcoin', asset: 'BTC', amount: 0.001 },
  }).ok, true);
});

test('canFulfill is a strict boolean evidence gate', () => {
  assert.equal(canFulfill({ ok: true }), true);
  assert.equal(canFulfill({ ok: 1 }), false);
  assert.equal(canFulfill(null), false);
});
