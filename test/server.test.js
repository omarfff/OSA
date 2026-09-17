import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.VERCEL = '1';
process.env.OSA_INGEST_KEY = 'test-key';
delete process.env.OSA_PAY_TO;
delete process.env.OSA_TRON_RECEIVE_ADDRESS;
delete process.env.OSA_TRON_OWNERSHIP_PROOF_REF;
delete process.env.OSA_BASE_RECEIVE_ADDRESS;
delete process.env.OSA_EVM_RECEIVE_ADDRESS;
delete process.env.OSA_X402_RECEIVE_ADDRESS;
delete process.env.OSA_SOLANA_RECEIVE_ADDRESS;
delete process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF;
const { default: app } = await import('../src/server.js');
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
after(() => new Promise((resolve) => server.close(resolve)));

test('returns 400 for malformed JSON instead of 500', async () => {
  const response = await fetch(`${base}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-osa-ingest-key': 'test-key' }, body: '{bad' });
  assert.equal(response.status, 400);
});

test('score requires exactly one selector', async () => {
  assert.equal((await fetch(`${base}/score`)).status, 400);
  assert.equal((await fetch(`${base}/score?id=a&url=https%3A%2F%2Fexample.com`)).status, 400);
});

test('rejects invalid history limit and max price', async () => {
  assert.equal((await fetch(`${base}/history?id=x&limit=abc`)).status, 400);
  assert.equal((await fetch(`${base}/history?id=x&limit=501`)).status, 400);
  assert.equal((await fetch(`${base}/best?max_price=abc`)).status, 400);
  assert.equal((await fetch(`${base}/best?max_price=-1`)).status, 400);
});

test('payment options expose one product and only verifier-backed checkout rails', async () => {
  const response = await fetch(`${base}/payment-options`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version, 6);
  assert.equal(body.product.sku, 'OSA-MCP-RELIABILITY-30D');
  assert.equal(body.preferred.humanStablecoin.network, 'Base');
  assert.equal(body.preferred.humanStablecoin.asset, 'USDC');
  assert.deepEqual(body.directCrypto.map((x) => x.network), ['Base', 'Polygon', 'Arbitrum']);
  assert.equal(body.fiat.invoiceRequest.publicBankDetails, false);
  assert.equal(body.safety.tapDisabledByOwner, true);
  assert.equal(body.safety.onlyVerifierBackedNetworksAdvertised, true);
  assert.equal(body.safety.secretsExposed, false);
});

test('checkout options keep assisted invoice and instant wallet paths distinct', async () => {
  const response = await fetch(`${base}/checkout-options`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.preferredHuman, 'invoice_request');
  assert.equal(body.preferredInstantHuman, 'pilot_usdc');
  assert.equal(body.rails.invoice_request.status, 'request_ready');
  assert.equal(body.rails.pilot_usdc.status, 'ready');
  assert.equal(body.rails.tap.status, 'disabled_by_owner');
  assert.equal(body.rails.legacy_five_dollar_checkout.status, 'retired');
});
