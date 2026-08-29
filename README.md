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

## GitHub bounty worker

`python3 tools/algora_worker.py --once` performs one bounded discovery and AI-triage run for Algora-backed GitHub issues. The systemd timer installed by `ops/install-algora-worker.sh` runs it every 30 minutes on the VPS.

The worker uses GitHub's supported API and official `algora-pbc[bot]` comments; it never scrapes Algora because Algora's published terms prohibit automated access without written consent. GitHub issue state is authoritative. Closed, stale, crowded, low-value, sensitive or unsupported-language work is rejected before OSA Brain sees it. OSA Brain is advisory only and cannot override policy.

This worker does not execute untrusted repository code, open pull requests, connect Stripe, perform KYC or move funds. Those capabilities remain disabled until the required GitHub write identity, payout eligibility, sandboxed code executor, tests and demo evidence are all verified. A bounty, merged PR or pending transfer is not revenue; only settled payout evidence counts.

The separate patch worker can prepare eligible JavaScript/TypeScript work using
the local `qwen2.5-coder:1.5b` model. It limits generated diffs, blocks workflow
and path changes, and runs repository tests in a network-isolated Docker
container. It still never claims, pushes, opens a PR or moves money. Install it
after the model and `node:20-alpine` image exist with
`sudo bash ops/install-algora-patch-worker.sh`.

## Superteam Earn agent worker

`python3 tools/superteam_agent_worker.py --once` queries Superteam Earn's official
agent API using the server-side agent identity. It sends a full ISO-8601 deadline
lower bound, rejects expired/human-only/non-stablecoin listings, records new
opportunities, and asks the loopback OSA Brain to triage the best actionable
listing. The systemd timer installed by `ops/install-superteam-agent.sh` runs it
every 15 minutes.

The API key and human claim code stay in the VPS credential file and are never
written to reports. The worker never submits work, claims the agent, signs a
wallet transaction, or counts a listed reward as revenue. Project submissions
remain gated on the human Telegram URL required by Superteam.
