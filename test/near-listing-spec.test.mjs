import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNearListingSpec } from '../tools/near-listing-spec.mjs';

test('NEAR listing spec reuses the bounded public MCP preflight product', () => {
  const spec = buildNearListingSpec({ priceUsd: 0.35, slaSeconds: 180 });
  assert.equal(spec.product.handle, 'osa-mcp-preflight');
  assert.equal(spec.product.price_usd, 0.35);
  assert.equal(spec.product.sla_seconds, 180);
  assert.equal(spec.buyer_safety.secrets_required, false);
  assert.equal(spec.buyer_safety.money_movement, false);
  assert.equal(spec.buyer_safety.tool_execution, false);
  assert.equal(spec.commercial_truth.current_state, 'BUILT');
  assert.match(spec.commercial_truth.first_success_kpi, /cross-owner paid settlement/);
});

test('listing price and SLA stay bounded', () => {
  assert.equal(buildNearListingSpec({ priceUsd: 0, slaSeconds: 1 }).product.price_usd, 0.05);
  assert.equal(buildNearListingSpec({ priceUsd: 99, slaSeconds: 9999 }).product.price_usd, 5);
  assert.equal(buildNearListingSpec({ priceUsd: 0.35, slaSeconds: 1 }).product.sla_seconds, 60);
  assert.equal(buildNearListingSpec({ priceUsd: 0.35, slaSeconds: 9999 }).product.sla_seconds, 600);
});
