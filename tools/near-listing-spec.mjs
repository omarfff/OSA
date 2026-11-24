#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

export function buildNearListingSpec({
  priceUsd = Number(process.env.OSA_NEAR_MCP_PRICE_USD || 0.35),
  slaSeconds = Number(process.env.OSA_NEAR_MCP_SLA_SECONDS || 180),
} = {}) {
  const price = Number.isFinite(priceUsd) ? Math.max(0.05, Math.min(priceUsd, 5)) : 0.35;
  const sla = Number.isFinite(slaSeconds) ? Math.max(60, Math.min(Math.trunc(slaSeconds), 600)) : 180;
  return {
    product: {
      handle: 'osa-mcp-preflight',
      name: 'Public MCP Preflight & Evidence',
      category: 'dev_tools',
      pricing_model: 'per_call',
      price_usd: Number(price.toFixed(2)),
      sla_seconds: sla,
      payable_with_preference: ['USDC'],
    },
    buyer_input: {
      required: ['public_mcp_https_url'],
      optional: ['expected_behavior'],
      constraints: [
        'HTTPS public endpoint only',
        'No credentials, API keys, cookies, wallet signatures or private-network targets',
        'No query-string secrets or login flows',
      ],
    },
    deliverable: {
      format: ['json'],
      fields: [
        'ok',
        'protocolOk',
        'authRequired',
        'stage',
        'status',
        'protocolVersion',
        'serverInfo',
        'capabilities',
        'sessionMode',
        'latencyMs',
        'toolCount',
        'toolNames',
        'schemaFingerprint',
        'issues',
      ],
      promise: 'Evidence from a bounded public MCP initialize + tools/list probe; no fabricated findings.',
    },
    acceptance_tests: [
      'Reject non-HTTPS, credential-bearing, private/local or malformed targets before network access.',
      'Return a bounded deterministic result for authentication-required endpoints.',
      'Never execute MCP tools; only initialize and list the catalog.',
      'Fingerprint the normalized tool schema.',
      'Report malformed, duplicate or missing input-schema definitions.',
      'Bound response size and timeout.',
    ],
    buyer_safety: {
      secrets_required: false,
      login_required: false,
      money_movement: false,
      tool_execution: false,
      private_targets_allowed: false,
    },
    commercial_truth: {
      current_state: 'BUILT',
      selling_state_requires: 'external marketplace listing/application or real buyer interaction',
      paid_state_requires: 'authoritative external settlement evidence',
      first_success_kpi: 'verified cross-owner paid settlement',
    },
  };
}

async function main() {
  process.stdout.write(JSON.stringify(buildNearListingSpec(), null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
