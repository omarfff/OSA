# Payment Rails and Financial Controls
Merchant/business rails under exploration: Dodo Payments, WorldFirst, Telr, YooKassa, Razorpay. Continue non-binding setup autonomously; KYC, identity, bank ownership, tax/legal declarations, binding terms, signature/mandate/custody/funding require owner approval.

Private bank-transfer fallback exists. Send beneficiary/bank/IBAN/SWIFT details privately only after authoritative verification; never publish them in pages/logs/issues. Pending transfer is not revenue; count only credited/settled evidence.

x402 is a primary machine-payment candidate. `/best` and `/score` have x402 middleware. It stays disabled without a real receiving address. Mainnet requires explicit production network/facilitator + verified owned receiving address. Never silently promote testnet. Count a paid call only after on-chain transaction proof is reconciled to OSA payment ledger. A previous bug allowing mainnet with a testnet-only default facilitator was fixed fail-closed.

Coinbase CDP CLI is installed on VPS, but never assume production wallet credentials unless verified. Never create/expose seed phrases/private keys without owner approval.

LNbits/Lightning is dormant fallback and requires a funded Lightning backend. API key alone is not revenue infrastructure. Do not use No-KYC/P2P off-ramping as OSA standard bank payout. USDT -> exchange/P2P -> bank is not a fully automatic risk-free business payout. Autonomous trading/sniping/MEV/copy-trading/fund movement are not active revenue paths.
