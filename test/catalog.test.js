import assert from 'node:assert/strict';
import test from 'node:test';
import { getProduct, listProducts, quoteProduct } from '../src/commerce/catalog.js';

test('catalog keeps the current closing product small and exact', () => {
  const products = listProducts();
  assert.equal(products.length, 1);
  assert.equal(products[0].id, 'mcp_reliability_pilot_30d');
  assert.equal(products[0].priceMinor, 7900);
  assert.equal(getProduct('missing'), null);
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
