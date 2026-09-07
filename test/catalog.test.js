import assert from 'node:assert/strict';
import test from 'node:test';
import { getProduct, listProducts, quoteProduct } from '../src/commerce/catalog.js';

test('catalog keeps one revenue-first product with exact $79 price', () => {
  const products = listProducts();
  assert.equal(products.length, 1);
  assert.equal(products[0].id, 'mcp_reliability_pilot_30d');
  assert.equal(products[0].priceMinor, 7900);
  assert.equal(products[0].durationDays, 30);
  assert.equal(getProduct('missing'), null);
});

test('pilot scope matches the market problem without tool execution', () => {
  const product = getProduct('mcp_reliability_pilot_30d');
  assert.match(product.positioning, /MCP reliability/i);
  assert.ok(product.deliverables.some((line) => /initialize -> tools\/list/i.test(line)));
  assert.ok(product.deliverables.some((line) => /schema fingerprint/i.test(line)));
  assert.ok(product.deliverables.some((line) => /payment-rail drift/i.test(line)));
  assert.ok(product.acceptance.some((line) => /No tools\/call/i.test(line)));
  assert.ok(product.acceptance.some((line) => /401\/403/i.test(line)));
});

test('catalog callers cannot mutate canonical nested product scope', () => {
  const first = getProduct('mcp_reliability_pilot_30d');
  first.deliverables.push('mutated');
  const second = getProduct('mcp_reliability_pilot_30d');
  assert.equal(second.deliverables.includes('mutated'), false);
});

test('quotes in integer minor units', () => {
  assert.deepEqual(quoteProduct('mcp_reliability_pilot_30d', 2), {
    productId: 'mcp_reliability_pilot_30d',
    sku: 'OSA-MCP-RELIABILITY-30D',
    quantity: 2,
    currency: 'usd',
    amountMinor: 15800,
    amount: 158,
    fulfillment: 'mcp_reliability_pilot',
  });
  assert.throws(() => quoteProduct('mcp_reliability_pilot_30d', 0), /INVALID_QUANTITY/);
});
