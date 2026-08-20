import test from "node:test";
import assert from "node:assert/strict";
import { calculateTrustScore, normalizeEndpoint, inferSchemaSignature } from "../src/core.js";

test("normalizes Bazaar-like records", () => {
  const ep = normalizeEndpoint({ name: "Tool", resource: { url: "https://example.com/tool" }, accepts: [{ price: 0.02 }] }, "x402-bazaar");
  assert.equal(ep.url, "https://example.com/tool");
  assert.equal(ep.method, "GET");
  assert.equal(ep.source, "x402-bazaar");
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
