# OSA Agent Trust Oracle

A working MVP for choosing and verifying agent/API endpoints **before purchase**.

## What it does

- `GET /best` — ranks matching endpoints by TrustScore, optional `intent` and `max_price`.
- `GET /score` — performs live verification and returns TrustScore + confidence + reason codes.
- `GET /history` — returns historical snapshots for an endpoint.
- Snapshot persistence instead of only keeping latest state.
- TrustScore includes uptime, latency, price drift, schema drift, payment changes, and transaction evidence.
- Unified ingestion for manual records, MCP Registry-shaped records, and x402/Bazaar-shaped resources.
- Optional x402 v2 payment protection for `/best` and `/score` using USDC.
- Bazaar discovery extension metadata when x402 is enabled.

## Quick start

```bash
npm install
npm test
npm start
```

Then ingest an endpoint:

```bash
curl -X POST http://localhost:4021/ingest \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/api","intent":"search","priceUsd":0.01,"transactionEvidence":12}'
```

Find the best endpoint:

```bash
curl 'http://localhost:4021/best?intent=search&max_price=0.05'
```

## x402

Payments are disabled by default so local development is frictionless. To enable them:

```bash
cp .env.example .env
export OSA_PAY_TO=0xYOUR_WALLET
export OSA_NETWORK=eip155:84532
export OSA_FACILITATOR_URL=https://x402.org/facilitator
npm start
```

Use Base Sepolia for testing first. When enabled, `/best` and `/score` are protected through the official x402 server packages and expose Bazaar discovery metadata.

## TrustScore

Current MVP weights:

- uptime 30%
- latency 20%
- price stability 15%
- schema stability 15%
- payment stability 10%
- transaction evidence 10%

The API also returns `confidence` separately so a high score with weak evidence is distinguishable from a well-proven endpoint.

## Production next steps

Replace JSON persistence with Postgres/Supabase, add scheduled source crawlers, and deploy behind a stable HTTPS origin before turning on mainnet payments.
