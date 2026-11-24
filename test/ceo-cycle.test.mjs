import test from 'node:test';
import assert from 'node:assert/strict';
import { executableSafePlan, runCeoCycle } from '../tools/ceo-cycle.mjs';

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
  assert.deepEqual(plan.map((x) => x.id), ['near-market-scout', 'near-listing-spec', 'payment-watch']);
});

test('CEO cycle executes safe planned agents and grounds a CEO decision', async () => {
  const seen = [];
  const result = await runCeoCycle({
    goal: 'NEAR Agent Market cross-owner paid settlement',
    runAgentImpl: async (agent) => {
      seen.push(agent.id);
      return { ok: true, agent: agent.id, stdout: JSON.stringify({ ok: true, agent: agent.id }) };
    },
    askBrainImpl: async ({ mode, context }) => {
      assert.equal(mode, 'ceo');
      assert.equal(context.revenue_truth, 'Only authoritative external settlement counts as PAID.');
      return { text: 'Decision: continue bounded NEAR experiment', mode: 'ceo', model: 'test' };
    },
  });
  assert.deepEqual(seen, ['near-market-scout', 'near-listing-spec', 'payment-watch']);
  assert.equal(result.ok, true);
  assert.match(result.primary_path, /NEAR Agent Market/);
});
