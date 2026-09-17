import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('public checkout keeps one $79 product and a non-crypto invoice request', () => {
  const source = read('supabase/functions/osa-pay/index.ts');
  assert.match(source, /OSA-MCP-RELIABILITY-30D/);
  assert.match(source, /amount:\s*79/);
  assert.match(source, /invoice_request/);
  assert.match(source, /payment_status:\s*"not_paid"/);
  assert.match(source, /Request the \$79 invoice/);
  assert.doesNotMatch(source, /gumroad/i);
  assert.doesNotMatch(source, /osa-agent-100/);
  assert.doesNotMatch(source, />\s*\$5\s*</);
});

test('storefront routes the paid CTA through the unified checkout', () => {
  const source = read('supabase/functions/procurement-site/index.ts');
  assert.match(source, /functions\/v1\/osa-pay/);
  assert.match(source, /Choose invoice or wallet/);
  assert.doesNotMatch(source, /functions\/v1\/osa-pilot-usdc/);
});

test('wallet checkout emits verifier-bound ERC-681 requests', () => {
  const source = read('supabase/functions/osa-pilot-usdc/index.ts');
  assert.match(source, /chainId:8453/);
  assert.match(source, /chainId:137/);
  assert.match(source, /chainId:42161/);
  assert.match(source, /payment_uri:paymentUri\(network,units\)/);
  assert.match(source, /ethereum:\$\{n\.usdc\}@\$\{n\.chainId\}\/transfer/);
  assert.match(source, /Open compatible wallet/);
});
