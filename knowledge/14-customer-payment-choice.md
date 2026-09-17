# OSA Customer Payment Choice

## Decision record

Work-Type: payment

Revenue-Impact: blocker

External-Evidence: the owner identified crypto-only checkout as a conversion blocker because the buyer chooses how to pay

Why-Now: the live registry and `osa-pay` page still exposed a retired $5 SKU and a hosted checkout that contradicted the single $79 offer

Kill-Criteria: stop payment expansion after one verifier-backed instant rail plus one assisted invoice route; add a new provider only for a real payer requirement or after live merchant activation

Risk-Exception: none

## Product rule

OSA has one public human offer before first payment:

- `OSA-MCP-RELIABILITY-30D`
- OSA 30-Day MCP Reliability Pilot
- USD 79

Payment choice must not create a second product or change fulfillment.

## Customer experience

Humans see two honest choices:

1. Request a private invoice and bank-transfer instructions. The request is a lead, not payment evidence.
2. Pay immediately with USDC on Base, Polygon, or Arbitrum from an existing compatible wallet or exchange account. OSA does not create or custody a buyer wallet.

Autonomous clients may use x402 where mainnet settlement is enabled. That machine rail is not promoted as the default human checkout.

Card, Mada, Apple Pay, Google Pay, and any hosted provider remain hidden until the merchant account, live capability, signed webhook, and independent retrieval check are all verified. Tap is disabled by owner decision and must not become selectable merely because credentials exist.

## Truth rules

- Invoice requested != invoice issued != bank settlement.
- Wallet connected != transaction submitted != on-chain settlement.
- Page view, test event, transaction hash, provider webhook alone, or model statement is never revenue proof.
- Fulfillment starts only after the rail-specific independent evidence gate passes.
- A verified wallet in inventory is not automatically a supported checkout network. Only advertise networks implemented by the active product verifier.
