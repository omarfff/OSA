# OSA Agent Fabric

OSA uses one governed agent fabric instead of independent bots with overlapping permissions.

## Operating model

The fabric is a control layer over existing OSA tools. It does not grant new credentials and it does not bypass platform controls.

- `read_only` agents may run by default.
- `draft` agents may create local artifacts but do not publish them.
- `write` agents are blocked unless `OSA_AGENT_ALLOW_WRITE=1` is explicitly present in the runtime environment.
- `financial` execution is always blocked by the fabric. Payment bots may observe and reconcile evidence, but cannot transfer, sign, trade, withdraw, or move funds.
- Disabled agents stay blocked unless `OSA_AGENT_ALLOW_DISABLED=1` is explicitly set for a controlled run.
- Commands are executed without a shell from a fixed manifest. This prevents arbitrary command injection through the orchestration layer.

## Commands

```bash
npm run agents:list
npm run agents:plan -- revenue
npm run agents:run -- revenue-scout
npm run agents:run -- lead-auditor https://example.com
npm run agents:run -- mcp-verifier https://public-mcp.example/mcp
```

The primary revenue loop is:

1. `revenue-scout` finds evidence of demand.
2. `lead-auditor` or `mcp-verifier` proves a concrete problem or technical fit.
3. Human/authorized connector action handles the actual external outreach or application.
4. `payment-watch` watches for settlement evidence.
5. OSA records only externally verifiable payment as revenue.

## AI Router

`tools/ai-router.mjs` provides a local-first inference fallback layer. It does not commit or print API keys.

Supported provider classes:

- local Ollama on loopback HTTP;
- any HTTPS OpenAI-compatible endpoint;
- Google Gemini when an explicit API key and model are configured.

```bash
npm run ai:status
npm run ai:ask -- "Summarize the verified blocker"
```

Provider order is controlled by `OSA_AI_PROVIDER_ORDER`. The default is local first so OSA can keep working when external model APIs are unavailable. Remote providers are used only when fully configured.

## Isolation

The psychiatry namespace remains separate. The commercial Agent Fabric must not read, route, or reason from `psychiatry-brain` content. Vehicle automation also stays opt-in and disabled in the default fabric.

## Revenue rule

Adding a bot is not progress by itself. New agents should exist only when they shorten a verified path to a buyer, delivery, settlement, or an operational blocker. First external payment remains the main commercial milestone.
