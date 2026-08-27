# OSA

OSA is a machine-commerce trust and procurement system for evaluating agent/API endpoints before purchase or routing spend.

## Core product

OSA combines live endpoint verification with historical evidence and produces a TrustScore plus confidence and reason codes.

- `GET /best` — rank matching endpoints by trust, intent and optional max price.
- `GET /route` — return the best endpoint plus a deterministic Arbitrum decision receipt.
- `GET /score` — live-verify a registered endpoint.
- `GET /history` — return historical snapshots.
- `POST /ingest` — authenticated registry ingestion.
- `POST /sources/mcp` and `POST /sources/bazaar` — ingest MCP/Bazaar-shaped records.
- `/.well-known/osa.json` — machine-readable product metadata.

TrustScore currently considers uptime, latency, price stability, schema stability, payment stability and transaction evidence. Confidence is reported separately.

## Arbitrum decision receipts

`GET /route` turns an OSA routing result into a privacy-preserving commitment that can be anchored on Arbitrum. The response includes:

- the selected endpoint, alternatives, TrustScore, confidence and reason codes;
- canonical offchain evidence plus its `keccak256` hash;
- a chain-bound `decisionId` for Arbitrum Sepolia or Arbitrum One;
- calldata for `OSARouteRegistry.recordRouteReceipt`.

The Solidity registry stores hashes and bounded scores, not full endpoint evidence. Each reporter receives a distinct `receiptId`, which prevents another address from taking credit for the reporter's receipt. The contract holds no funds, has no owner and exposes no administrative write path.

```bash
npm run contract:compile
npm test
npm run chaos
```

The deployment and recording scripts are deliberately limited to Arbitrum Sepolia. They require local environment variables and never print a private key:

```bash
ARBITRUM_RPC_URL="https://your-arbitrum-sepolia-rpc" npm run arbitrum:deploy
OSA_ARBITRUM_REGISTRY="0x..." OSA_ROUTE_URL="http://127.0.0.1:4021/route?intent=weather" npm run arbitrum:record
```

Set `ARBITRUM_DEPLOYER_PRIVATE_KEY` only in the local execution environment. Both transaction scripts also require the explicit one-run authorization `ARBITRUM_CONFIRM_TESTNET_TX=YES`. Never commit the key, paste it into an issue, or send it in chat. Testnet transactions are technical evidence, not revenue.

Buildathon materials are in [`hackathon/ARBITRUM_OPEN_HOUSE_SINGAPORE.md`](hackathon/ARBITRUM_OPEN_HOUSE_SINGAPORE.md) and [`hackathon/DEMO.md`](hackathon/DEMO.md).

## Python LLM gateway reference

[`examples/python_llm_gateway`](examples/python_llm_gateway) is a dependency-free
reference boundary for hosted or self-hosted LLM providers. It validates messages,
tools, structured output, and usage data; applies bounded timeouts, retries, and
ordered fallback; keeps conversational memory bounded; and emits prompt-free
attempt telemetry. It is a portfolio reference, not a claim of an existing
customer integration.

```bash
npm run test:python
```

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
