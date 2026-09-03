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

test('payment options expose verified multi-network receive rails', async () => {
  const response = await fetch(`${base}/payment-options`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version, 5);
  assert.equal(body.preferred.humanStablecoin.network, 'Base');
  assert.equal(body.preferred.humanStablecoin.asset, 'USDC');
  assert.equal(body.solana.status, 'verified_receive');
  assert.equal(body.tron.status, 'verified_receive');
  assert.equal(body.directCrypto.some((x) => x.network === 'Solana'), true);
  assert.equal(body.directCrypto.some((x) => x.network === 'TRON'), true);
  assert.equal(body.directCrypto.some((x) => x.network === 'Bitcoin'), true);
  assert.equal(body.directCrypto.some((x) => x.network === 'Base'), true);
  for (const network of ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon']) {
    assert.equal(body.directCrypto.some((x) => x.network === network), true);
  }
  assert.equal(body.fiat.bankTransfer.publicBankDetails, false);
  assert.equal(body.safety.registryAlignedFallbacks, true);
  assert.equal(body.safety.unverifiedNetworksAdvertised, false);
  assert.equal(body.safety.separateBaseAndGenericEvmReceive, true);
  assert.equal(body.safety.secretsExposed, false);
});
