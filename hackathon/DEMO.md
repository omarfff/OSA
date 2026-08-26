# OSA Safe Router demo runbook

Goal: show a real pre-purchase route, reproduce its evidence hash and record the receipt on Arbitrum Sepolia in under three minutes.

## One-time preparation

1. Use a dedicated Arbitrum Sepolia deployment wallet with only testnet funds.
2. Obtain Arbitrum Sepolia ETH from a faucet linked on the official event page.
3. Set the private key only in the local terminal environment. Never put it in this file, a screen recording, chat, Git or the submission form.
4. Compile and verify locally:

```bash
npm ci
npm run contract:compile
npm test
npm run chaos
```

5. In a local terminal, read the key without echoing it and deploy:

```bash
read -s ARBITRUM_DEPLOYER_PRIVATE_KEY
export ARBITRUM_DEPLOYER_PRIVATE_KEY
export ARBITRUM_RPC_URL="https://your-arbitrum-sepolia-rpc"
export ARBITRUM_CONFIRM_TESTNET_TX="YES"
npm run arbitrum:deploy
```

6. Copy only the resulting public contract address into `OSA_ARBITRUM_REGISTRY` and the submission file.

## Demo data and server

Start OSA with the deployed public registry address:

```bash
export OSA_INGEST_KEY="demo-local-only"
export OSA_ARBITRUM_CHAIN_ID="421614"
export OSA_ARBITRUM_REGISTRY="0xPUBLIC_CONTRACT_ADDRESS"
npm start
```

In another terminal, ingest two public, read-only demo endpoints:

```bash
curl -sS http://127.0.0.1:4021/ingest \
  -X POST \
  -H 'content-type: application/json' \
  -H 'x-osa-ingest-key: demo-local-only' \
  --data '[
    {
      "id": "github-api",
      "name": "GitHub API",
      "url": "https://api.github.com",
      "method": "GET",
      "intent": "developer-data",
      "priceUsd": 0,
      "transactionEvidence": 50
    },
    {
      "id": "httpbin-json",
      "name": "HTTPBin JSON",
      "url": "https://httpbin.org/json",
      "method": "GET",
      "intent": "developer-data",
      "priceUsd": 0,
      "transactionEvidence": 5
    }
  ]'
```

Request the route and preserve the returned canonical evidence:

```bash
curl -sS 'http://127.0.0.1:4021/route?intent=developer-data&max_price=0'
```

The response should show:

- the winning endpoint and alternatives;
- score, confidence and reason codes;
- `arbitrum.providerId`, `evidenceHash` and `decisionId`;
- `recordRouteReceipt` calldata arguments;
- chain ID `421614` and the deployed public registry address.

Record a fresh decision using the same query. The script validates and anchors the exact evidence it fetches in this step:

```bash
export OSA_ROUTE_URL='http://127.0.0.1:4021/route?intent=developer-data&max_price=0'
npm run arbitrum:record
```

The recording script first asks the deployed contract to recompute `decisionId`, refuses to send if it differs, simulates the transaction, sends it, waits for confirmation and prints the Arbiscan URL.

## Suggested 150-second narration

**0:00–0:20 — Problem**

“Payment rails tell an AI agent how to pay an API. They do not tell it whether the provider is live, unchanged or worth paying right now. OSA is the trust and procurement layer before machine spend.”

**0:20–0:50 — Live route**

Show the two registered endpoints, call `/route`, then point to the selected endpoint, score, confidence, reason codes and alternatives.

**0:50–1:20 — Evidence commitment**

Show the canonical evidence, `evidenceHash` and `decisionId`. Explain that the evidence remains offchain while its commitment is public and reproducible.

**1:20–1:50 — Contract**

Open `OSARouteRegistry.sol`. Highlight bounded scores, the observation-time check, reporter-bound `receiptId`, and the absence of payable/admin functions.

**1:50–2:15 — Arbitrum proof**

Run `npm run arbitrum:record`, open the resulting Arbiscan transaction and show the `RouteReceiptRecorded` event.

**2:15–2:30 — Close**

“OSA lets autonomous buyers choose before they pay and prove what they knew after they paid. Arbitrum makes that audit trail inexpensive and independently verifiable.”

## Recording safety checklist

- [ ] Terminal history and environment output do not expose the private key or RPC credentials.
- [ ] Browser wallet, balances and unrelated accounts are not visible.
- [ ] Contract and transaction links resolve on Arbitrum Sepolia.
- [ ] The event shown in Arbiscan matches the route `decisionId`.
- [ ] The video does not call testnet activity revenue or claim an unreceived prize.
- [ ] The final video URL is inserted into the submission document only after it is accessible.
