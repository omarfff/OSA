# OSA

OSA is a machine-commerce trust and procurement system for evaluating agent/API endpoints before purchase or routing spend.

## Core product

OSA combines live endpoint verification with historical evidence and produces a TrustScore plus confidence and reason codes.

- `GET /best` — rank matching endpoints by trust, intent and optional max price.
- `GET /score` — live-verify a registered endpoint.
- `GET /history` — return historical snapshots.
- `POST /ingest` — authenticated registry ingestion.
- `POST /sources/mcp` and `POST /sources/bazaar` — ingest MCP/Bazaar-shaped records.
- `/.well-known/osa.json` — machine-readable product metadata.

TrustScore currently considers uptime, latency, price stability, schema stability, payment stability and transaction evidence. Confidence is reported separately.

## Architecture

OSA uses a split-plane design:

- **Product/Data/Commercial plane** — procurement/MCP distribution, pricing and benchmark history, endpoint observations, product usage, leads/deals and payment reconciliation.
- **Control/Execution/Security plane** — VPS agents, approvals, task policy, audit/control alerts, SSH bridge and certificate-only RAW SSH execution.
- **GitHub** — canonical source, CI/security scanning and controlled deployment workflows.

The split keeps product data workloads separate from privileged infrastructure execution.

## Security

- Endpoint verification is read-only (`GET`/`HEAD`).
- SSRF defenses reject local/private/link-local/documentation targets and unsafe URL schemes.
- DNS results and redirect targets are revalidated.
- Response size, redirect count, timeouts and concurrency are bounded.
- Ingestion is authenticated in production.
- Privileged VPS execution uses short-lived SSH certificates and host-key verification.
- Secrets and private keys are not committed to this repository.

## Commercial acquisition tool

`npm run lead:audit -- https://example.com`

The Lead-Leakage Audit performs a public-page, read-only conversion-path audit. It does not submit forms, authenticate, bypass controls or access private systems. It can be used as an evidence-first acquisition wedge for OSA services without becoming a separate product strategy.

## Quick start

```bash
npm install
npm test
npm start
```

## Payments

Optional x402 v2 payment middleware can protect `/best` and `/score`. Payments remain disabled when `OSA_PAY_TO` is not configured. Test/sandbox payment events must never be counted as revenue.

## Operating rule

OSA is one product. Agent Trust Oracle, Procurement Guard, pricing/benchmark intelligence, MCP reliability and payment-rail checks are modules of the same pre-transaction decision system.

Progress means verified external usage, verified payment and repeat usage — not internal test rows, crawler probes, generated dashboards or speculative revenue.

## OSA Brain research

`POST /v1/research` prefers Gemini Google Search grounding. When Google returns quota exhaustion, the brain can fall back to bounded DuckDuckGo/Google News results and use Gemini only to synthesize the untrusted snippets with numbered source links. Set `OSA_WEB_SEARCH_FALLBACK_ENABLED=false` to fail closed instead.
