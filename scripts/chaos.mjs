import assert from 'node:assert/strict';
import { calculateTrustScore, inferSchemaSignature, isPublicIpAddress, normalizeEndpoint } from '../src/core.js';

let seed = Number(process.env.OSA_CHAOS_SEED || 0x5a17c0de) >>> 0;
function rnd() {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17; seed >>>= 0;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 0x100000000;
}
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const int = (n) => Math.floor(rnd() * n);

function randomJson(depth = 0) {
  if (depth > 3) return pick([null, int(100000), rnd() < .5, `s-${int(1e6)}`]);
  const kind = int(5);
  if (kind === 0) return null;
  if (kind === 1) return Array.from({ length: int(6) }, () => randomJson(depth + 1));
  if (kind === 2) return int(1e9);
  if (kind === 3) return `str-${int(1e9)}`;
  const obj = {};
  for (let i = 0; i < int(10); i += 1) obj[`k${int(100)}`] = randomJson(depth + 1);
  return obj;
}

for (let i = 0; i < 5000; i += 1) {
  const method = pick(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', '', null]);
  const raw = {
    url: `https://example.com/api/${int(10000)}?x=${int(1000)}`,
    method,
    priceUsd: pick([rnd() * 100, -1, null, 'abc', String(rnd())]),
    transactionEvidence: pick([int(1e6), -5, 'x', null]),
    metadata: randomJson(1)
  };
  if (method && !['GET', 'HEAD'].includes(method)) {
    assert.throws(() => normalizeEndpoint(raw));
  } else {
    const ep = normalizeEndpoint(raw);
    assert.ok(ep.id && ep.url.startsWith('https://'));
    assert.ok(['GET', 'HEAD'].includes(ep.method));
    const current = {
      ok: rnd() > .2,
      latencyMs: int(20000),
      priceUsd: rnd() * 50,
      schemaSignature: inferSchemaSignature(randomJson()),
      paymentSignature: `p${int(10)}`,
      checkedAt: new Date().toISOString(),
      status: pick([200, 204, 402, 500, 503]),
      transactionEvidence: int(10000)
    };
    const score = calculateTrustScore(ep, current, null);
    assert.ok(Number.isInteger(score.score) && score.score >= 0 && score.score <= 100);
    assert.ok(Number.isInteger(score.confidence) && score.confidence >= 0 && score.confidence <= 100);
  }
  inferSchemaSignature(randomJson());
}

for (let i = 0; i < 2000; i += 1) {
  const privateIps = [
    `10.${int(256)}.${int(256)}.${int(256)}`,
    `127.${int(256)}.${int(256)}.${int(256)}`,
    `172.${16 + int(16)}.${int(256)}.${int(256)}`,
    `192.168.${int(256)}.${int(256)}`,
    `169.254.${int(256)}.${int(256)}`,
    `100.${64 + int(64)}.${int(256)}.${int(256)}`,
  ];
  for (const ip of privateIps) assert.equal(isPublicIpAddress(ip), false, ip);
}

console.log(JSON.stringify({ ok: true, iterations: 7000, seed }));
