import test from "node:test";
import assert from "node:assert/strict";
import { calculateTrustScore, normalizeEndpoint, inferSchemaSignature, isPublicIpAddress, validateTargetUrl, createPinnedLookup } from "../src/core.js";

test("normalizes Bazaar-like records", () => {
  const ep = normalizeEndpoint({ name: "Tool", resource: { url: "https://example.com/tool" }, accepts: [{ price: 0.02 }] }, "x402-bazaar");
  assert.equal(ep.url, "https://example.com/tool");
  assert.equal(ep.method, "GET");
  assert.equal(ep.source, "x402-bazaar");
});

test("rejects verification methods that could mutate remote systems", () => {
  assert.throws(() => normalizeEndpoint({ url: "https://example.com", method: "POST" }), /GET\/HEAD/);
});

test("stable healthy endpoint scores higher than drifting endpoint", () => {
  const ep = normalizeEndpoint({ url: "https://example.com", priceUsd: 0.01, transactionEvidence: 100 });
  const previous = { priceUsd: 0.01, schemaSignature: "a:string", paymentSignature: "p1" };
  const good = calculateTrustScore(ep, { ok: true, latencyMs: 100, priceUsd: 0.01, schemaSignature: "a:string", paymentSignature: "p1", checkedAt: new Date().toISOString(), status: 200, transactionEvidence: 100 }, previous);
  const bad = calculateTrustScore(ep, { ok: false, latencyMs: 4000, priceUsd: 0.05, schemaSignature: "b:string", paymentSignature: "p2", checkedAt: new Date().toISOString(), status: 500, transactionEvidence: 0 }, previous);
  assert.ok(good.score > bad.score);
  assert.ok(bad.reasonCodes.includes("PRICE_DRIFT"));
  assert.ok(bad.reasonCodes.includes("SCHEMA_DRIFT"));
});

test("schema signature is stable across object key order", () => {
  assert.equal(inferSchemaSignature({ b: 1, a: "x" }), inferSchemaSignature({ a: "y", b: 2 }));
});

test("classifies private, loopback, link-local and documentation addresses as non-public", () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicIpAddress(ip), false, ip);
  }
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});

test("SSRF guard rejects literal private targets, local names, credentials and unsafe schemes", async () => {
  await assert.rejects(validateTargetUrl('http://127.0.0.1/admin'), /non-public/);
  await assert.rejects(validateTargetUrl('http://169.254.169.254/latest/meta-data/'), /non-public/);
  await assert.rejects(validateTargetUrl('http://localhost:3000'), /local endpoint/);
  await assert.rejects(validateTargetUrl('https://user:pass@example.com'), /credentials/);
  await assert.rejects(validateTargetUrl('file:///etc/passwd'), /http\/https/);
  const publicLiteral = await validateTargetUrl('https://8.8.8.8/');
  assert.equal(publicLiteral.addresses[0].address, '8.8.8.8');
});


test("detects price drift when an endpoint changes from free to paid", () => {
  const ep = normalizeEndpoint({ url: "https://example.com", priceUsd: 0 });
  const score = calculateTrustScore(ep, { ok: true, latencyMs: 50, priceUsd: 1, schemaSignature: "a:string", paymentSignature: "p", checkedAt: new Date().toISOString(), status: 200, transactionEvidence: 0 }, { priceUsd: 0, schemaSignature: "a:string", paymentSignature: "p" });
  assert.ok(score.reasonCodes.includes("PRICE_DRIFT"));
});

test("never produces NaN scores from invalid telemetry", () => {
  const ep = normalizeEndpoint({ url: "https://example.com", transactionEvidence: -5 });
  const score = calculateTrustScore(ep, { ok: true, latencyMs: Number.NaN, schemaSignature: "a:string", paymentSignature: "p", checkedAt: new Date().toISOString(), status: 200, transactionEvidence: -10 }, null);
  assert.ok(Number.isInteger(score.score));
  assert.ok(score.score >= 0 && score.score <= 100);
  assert.equal(ep.transactionEvidence, 0);
});

test("pinned DNS lookup supports Node all=true contract", async () => {
  const lookup = createPinnedLookup({ address: "93.184.216.34", family: 4 });
  const rows = await new Promise((resolve, reject) => lookup("example.com", { all: true }, (err, value) => err ? reject(err) : resolve(value)));
  assert.deepEqual(rows, [{ address: "93.184.216.34", family: 4 }]);
  const single = await new Promise((resolve, reject) => lookup("example.com", {}, (err, address, family) => err ? reject(err) : resolve({ address, family })));
  assert.deepEqual(single, { address: "93.184.216.34", family: 4 });
});
