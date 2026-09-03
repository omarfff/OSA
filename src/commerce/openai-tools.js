export const CLOSING_TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    type: 'function',
    name: 'list_products',
    description: 'List the small set of active OSA products that can be sold and fulfilled now.',
    strict: true,
    parameters: Object.freeze({
      type: 'object',
      properties: Object.freeze({}),
      required: Object.freeze([]),
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    type: 'function',
    name: 'create_checkout',
    description: 'Create a payment request for an existing OSA product. This never proves payment and never authorizes fulfillment.',
    strict: true,
    parameters: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        product_id: Object.freeze({ type: 'string' }),
        quantity: Object.freeze({ type: 'integer', minimum: 1, maximum: 20 }),
        payment_rail: Object.freeze({ type: 'string', enum: Object.freeze(['tap', 'direct_usdc', 'x402', 'nowpayments']) }),
        pay_currency: Object.freeze({ type: ['string', 'null'] }),
        customer_reference: Object.freeze({ type: 'string' }),
      }),
      required: Object.freeze(['product_id', 'quantity', 'payment_rail', 'pay_currency', 'customer_reference']),
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    type: 'function',
    name: 'get_payment_status',
    description: 'Read verified payment evidence for an existing order. Model output is never itself payment proof.',
    strict: true,
    parameters: Object.freeze({
      type: 'object',
      properties: Object.freeze({ order_id: Object.freeze({ type: 'string' }) }),
      required: Object.freeze(['order_id']),
      additionalProperties: false,
    }),
  }),
]);

export function closingToolNames() {
  return CLOSING_TOOL_DEFINITIONS.map((tool) => tool.name);
}
