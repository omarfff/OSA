const PRODUCT_ROWS = Object.freeze([
  Object.freeze({
    id: 'mcp_reliability_pilot_30d',
    sku: 'OSA-MCP-RELIABILITY-30D',
    name: 'OSA 30-Day MCP Reliability Pilot',
    currency: 'usd',
    priceMinor: 7900,
    active: true,
    fulfillment: 'mcp_reliability_pilot',
  }),
]);

function cloneProduct(product) {
  return product ? { ...product } : null;
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
