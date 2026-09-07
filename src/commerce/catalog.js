const MCP_PILOT_DELIVERABLES = Object.freeze([
  'Protocol preflight: initialize -> tools/list without invoking tools',
  'Baseline uptime and latency evidence with timestamps',
  'Tool catalog and input/output schema fingerprint',
  'Breaking schema drift detection for removed or changed tools',
  'Price and payment-rail drift evidence when publicly observable',
  '30-day evidence summary with incidents, recoveries and reason codes',
]);

const MCP_PILOT_ACCEPTANCE = Object.freeze([
  'No tools/call execution during the public baseline probe',
  'Public endpoints are probed without customer credentials',
  '401/403 is classified as auth-required, not falsely reported as downtime',
  'Network probes keep bounded timeout/response size and public-target protections',
  'Schema evidence is fingerprinted so drift is reproducible',
  'Payment or fulfillment is never inferred from a model statement or page view',
]);

const PRODUCT_ROWS = Object.freeze([
  Object.freeze({
    id: 'mcp_reliability_pilot_30d',
    sku: 'OSA-MCP-RELIABILITY-30D',
    name: 'OSA 30-Day MCP Reliability Pilot',
    positioning: 'Pre-transaction MCP reliability, tool-contract and payment-drift assurance for teams that depend on remote MCP servers.',
    idealFor: 'MCP providers and teams evaluating or depending on remote MCP/API vendors.',
    currency: 'usd',
    priceMinor: 7900,
    durationDays: 30,
    active: true,
    fulfillment: 'mcp_reliability_pilot',
    deliverables: MCP_PILOT_DELIVERABLES,
    acceptance: MCP_PILOT_ACCEPTANCE,
  }),
]);

function cloneProduct(product) {
  return product ? {
    ...product,
    deliverables: product.deliverables ? [...product.deliverables] : undefined,
    acceptance: product.acceptance ? [...product.acceptance] : undefined,
  } : null;
}

export function listProducts() {
  return PRODUCT_ROWS.filter((product) => product.active).map(cloneProduct);
}

export function getProduct(productId) {
  const id = String(productId || '').trim();
  if (!id) return null;
  return cloneProduct(PRODUCT_ROWS.find((product) => product.id === id && product.active));
}

export function quoteProduct(productId, quantity = 1) {
  const product = getProduct(productId);
  if (!product) throw new Error('PRODUCT_NOT_FOUND');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error('INVALID_QUANTITY');
  const amountMinor = product.priceMinor * quantity;
  if (!Number.isSafeInteger(amountMinor)) throw new Error('PRICE_OVERFLOW');
  return {
    productId: product.id,
    sku: product.sku,
    quantity,
    currency: product.currency,
    amountMinor,
    amount: amountMinor / 100,
    fulfillment: product.fulfillment,
  };
}
