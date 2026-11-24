import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicCeoDecision, executableSafePlan, runCeoCycle } from '../tools/ceo-cycle.mjs';

test('CEO auto-execution excludes argumented, write and financial agents', () => {
  const agents = [
    { id: 'near-market-scout', args: 'none', enabled: true, access: 'read_only' },
    { id: 'near-listing-spec', args: 'none', enabled: true, access: 'draft' },
    { id: 'payment-watch', args: 'none', enabled: true, access: 'read_only' },
    { id: 'mcp-verifier', args: 'one_public_url', enabled: true, access: 'read_only' },
    { id: 'writer', args: 'none', enabled: true, access: 'write' },
    { id: 'money', args: 'none', enabled: true, access: 'financial' },
  ];
  const plan = executableSafePlan('NEAR Agent Market cross-owner paid settlement', agents);
  assert.deepEqual(plan.map((x) => x.id), ['near-market-scout', 'near-listing-spec']);
});

test('CEO cycle executes safe planned agents and grounds a CEO decision', async () => {
  const seen = [];
  const result = await runCeoCycle({
    goal: 'NEAR Agent Market cross-owner paid settlement',
    runAgentImpl: async (agent) => {
      seen.push(agent.id);
      return { ok: true, agent: agent.id, stdout: JSON.stringify({ ok: true, agent: agent.id }) };
    },
    decisionImpl: async ({ runtime }) => {
      assert.equal(runtime.revenue_truth, 'Only authoritative external settlement counts as PAID.');
      return { text: 'Decision: continue bounded NEAR experiment', provider: 'test', model: 'test' };
    },
  });
  assert.deepEqual(seen, ['near-market-scout', 'near-listing-spec']);
  assert.equal(result.ok, true);
  assert.match(result.primary_path, /NEAR Agent Market/);
});


test('deterministic CEO kernel advances only when market and product are verified', () => {
  const decision = deterministicCeoDecision({
    safe_executions: [
      { agent: 'near-market-scout', ok: true, evidence: { platform_stats: { jobs_this_week: 40, delivered_jobs: 820, active_hires: 624 } } },
      { agent: 'near-listing-spec', ok: true, evidence: { commercial_truth: { current_state: 'BUILT' } } },
    ],
  });
  assert.equal(decision.stage, 'VERIFIED');
  assert.equal(decision.market_active, true);
  assert.equal(decision.product_built, true);
  assert.equal(decision.paid, false);
  assert.match(decision.next_action, /external NEAR listing\/application/);
});

test('routed CEO decision remains usable when every advisory provider fails', async () => {
  const { routedCeoDecision } = await import('../tools/ceo-cycle.mjs');
  const decision = await routedCeoDecision({
    goal: 'NEAR paid settlement',
    runtime: {
      safe_executions: [
        { agent: 'near-market-scout', ok: true, evidence: { platform_stats: { jobs_this_week: 1, delivered_jobs: 1, active_hires: 1 } } },
        { agent: 'near-listing-spec', ok: true, evidence: { commercial_truth: { current_state: 'BUILT' } } },
      ],
    },
    routeChatImpl: async () => ({ ok: false, error: 'all_ai_providers_failed', failures: [{ provider: 'gemini', error: '503' }] }),
  });
  assert.equal(decision.stage, 'VERIFIED');
  assert.equal(decision.provider, null);
  assert.equal(decision.paid, false);
  assert.match(decision.text, /external NEAR listing\/application/);
});
