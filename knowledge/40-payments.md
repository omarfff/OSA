# Payment Rails and Financial Controls
Payment infrastructure exists to collect money from a named payer; it is not an acquisition strategy. While verified external revenue is zero, keep the smallest already-working receive path and freeze parallel payment exploration unless a real payer requests another method or the current method blocks payment.

Merchant/business rails previously explored include Dodo Payments, WorldFirst, Telr, YooKassa and Razorpay. Do not continue setup merely for optionality. Resume a rail only for a named payer/market requirement or a directly blocked checkout. KYC, identity, bank ownership, tax/legal declarations, binding terms, signature/mandate/custody/funding require owner approval.

Private bank-transfer fallback exists. Send beneficiary/bank/IBAN/SWIFT details privately only after authoritative verification; never publish them in pages/logs/issues. Pending transfer is not revenue; count only credited/settled evidence.

x402 is an optional machine-payment rail, not a revenue engine. `/best` and `/score` already have x402 middleware. Keep further mainnet/facilitator/chain expansion frozen until a named buyer needs machine payment or a real paid call is blocked. Never silently promote testnet. Count a paid call only after on-chain transaction proof is reconciled to the OSA payment ledger.

Coinbase CDP CLI may exist on VPS, but production wallet credentials must never be assumed. Never create/expose seed phrases/private keys without owner approval.

LNbits/Lightning and extra crypto rails remain dormant fallbacks unless demanded by a payer. API keys, wallet addresses, test balances and receive endpoints are not revenue. Autonomous trading/sniping/MEV/copy-trading/fund movement are not active OSA revenue paths.
