import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOSING_TOOL_DEFINITIONS, closingToolNames } from '../src/commerce/openai-tools.js';

test('closing tool surface is intentionally narrow and strict', () => {
  assert.deepEqual(closingToolNames(), ['list_products', 'create_checkout', 'get_payment_status']);
  for (const tool of CLOSING_TOOL_DEFINITIONS) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.strict, true);
    assert.equal(tool.parameters.additionalProperties, false);
  }
  const text = JSON.stringify(CLOSING_TOOL_DEFINITIONS).toLowerCase();
  for (const forbidden of ['payout', 'refund', 'transfer_funds', 'sign_transaction', 'accept_terms']) assert.equal(text.includes(forbidden), false);
});
