# OSA Closing Engine

Purpose: convert an already-qualified buyer into a paid, verifiably fulfilled order. This is part of the Closing Desk; it is not an acquisition engine and it does not create revenue by itself.

## Authority split

- Model layer: understand the buyer request, list approved products, request a checkout, and read payment status.
- Host/runtime layer: create provider payment requests, verify provider callbacks, reconcile independent payment evidence, reserve idempotency keys, and start fulfillment.
- Database/runtime evidence overrides model output. A model statement such as "paid" can never unlock fulfillment.
- No tool in the model-facing surface may pay out, refund, transfer funds, sign a transaction, accept legal terms, or move custody.

## Initial catalog

Keep one existing funnel before adding products: `mcp_reliability_pilot_30d` / `OSA-MCP-RELIABILITY-30D` at USD 79. Add another SKU only after evidence that a buyer needs it or the current offer cannot close.

## Payment router

Priority remains:

1. Direct USDC on Base for human buyers when practical.
2. x402 mainnet for machine buyers only when the runtime configuration is genuinely mainnet.
3. NOWPayments as a checkout compatibility rail. It remains `not_configured` until API key, IPN secret and a public HTTPS callback URL are present.

Suggested server-only environment variables:

- `NOWPAYMENTS_API_KEY`
- `NOWPAYMENTS_IPN_SECRET`
- `NOWPAYMENTS_CALLBACK_URL`
- `NOWPAYMENTS_BASE_URL` (optional; defaults to `https://api.nowpayments.io/v1`)

Secrets must not be exposed through `/payment-options`, logs, client JavaScript, issues, model prompts, or the Experience Ledger.

## NOWPayments proof rule

The adapter verifies IPN authenticity by canonical deep key sorting followed by HMAC-SHA512 comparison against `x-nowpayments-sig`. A valid IPN is provider-authentication evidence, not final cash proof by itself.

Fulfillment stays locked until all required evidence is present. For NOWPayments the conservative initial gate requires:

- valid IPN signature;
- `payment_status=finished`;
- non-empty payment and order identifiers;
- positive `actually_paid`; and
- an independently verified controlled receipt with transaction hash, network, asset and amount that matches the payment or order identifier.

This can be relaxed only after a verified production settlement path proves a safer provider-specific reconciliation rule.

## OpenAI tool surface

New integrations should target the Responses API function-calling/tool shape rather than building new work on the legacy Assistants API. The model-facing tool surface is intentionally narrow: `list_products`, `create_checkout`, `get_payment_status`.

## Deployment gate

Code path: isolated branch -> unit tests -> repository CI/chaos/security review -> merge -> VPS deploy -> live health check -> sandbox/provider test -> production live verification. Do not count sandbox, waiting, confirming, page views, checkout creation, valid callbacks without settlement proof, or model assertions as revenue.
