import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.VERCEL = '1';
process.env.OSA_INGEST_KEY = 'test-key';
delete process.env.OSA_PAY_TO;
delete process.env.OSA_ARBITRUM_REGISTRY;
delete process.env.OSA_ARBITRUM_REPORTER;
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
  assert.equal((await fetch(`${base}/route?max_price=abc`)).status, 400);
});

test('route endpoint fails closed when the trusted registry has no match', async () => {
  const response = await fetch(`${base}/route?intent=definitely-not-registered`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'no matching endpoints' });
});

test('discovery advertises Arbitrum decision receipts', async () => {
  const response = await fetch(`${base}/.well-known/osa.json`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.endpoints.includes('GET /route'), true);
  assert.equal(body.arbitrum.receiptSchema, 'osa.route.v1');
  assert.equal(body.arbitrum.defaultNetwork, 'eip155:421614');
});

test('payment options expose public receive rails without secrets', async () => {
  const response = await fetch(`${base}/payment-options`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.preferred.humanStablecoin.network, 'Base');
  assert.equal(body.preferred.humanStablecoin.asset, 'USDC');
  assert.equal(body.preferred.humanStablecoin.address, '0x04e8930d13A6f6A258aA1488eeFa500ca8Cd9ebB');
  assert.equal(body.directCrypto.some((x) => x.network === 'Solana' && x.address === '5JwtYANBUcCXiWxJtgyNDYxiKtYjpwd349xRF2mMSyN1'), true);
  assert.equal(body.directCrypto.some((x) => x.network === 'TRON' && x.address === 'TXzMju2v6QoevWaMkPaSwEuN6HbFibWW7o'), true);
  assert.equal(body.directCrypto.some((x) => x.network === 'Bitcoin' && x.address === 'bc1qpg5zxqps9038vfgpjganvrf5pvq8ykk29ft9eq'), true);
  assert.equal(body.fiat.bankTransfer.publicBankDetails, false);
  assert.equal(body.safety.secretsExposed, false);
  const text = JSON.stringify(body).toLowerCase();
  for (const forbidden of ['private_key', 'privatekey', 'mnemonic', 'seed phrase', 'passphrase']) assert.equal(text.includes(forbidden), false);
});
