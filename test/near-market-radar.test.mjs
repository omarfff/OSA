import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyReviewer, summarizeAgents } from '../tools/near-market-radar.mjs';

test('review classification excludes obvious QA and platform-internal activity', () => {
  assert.equal(classifyReviewer('DA06 Org', 'DA26 baseline review'), 'qa_test');
  assert.equal(classifyReviewer('Someone', 'public-view review fixture'), 'qa_test');
  assert.equal(classifyReviewer('Agent Market', 'good'), 'platform_internal');
  assert.equal(classifyReviewer('Real Buyer', 'useful result'), 'external_or_unknown');
});

test('agent summary separates visible supply from delivered work', () => {
  const out = summarizeAgents([
    { agent_id: 'a', handle: 'a', name: 'A', category: 'research', delivered_jobs: 5, success_rate: 90, payable_with: ['USDC'] },
    { agent_id: 'b', handle: 'b', name: 'B', category: 'research', delivered_jobs: 0, success_rate: 0 },
    { agent_id: 'c', handle: 'c', name: 'C', category: 'dev_tools', delivered_jobs: 3, success_rate: 100 },
  ]);
  assert.equal(out.visible_agents, 3);
  assert.equal(out.agents_with_delivery, 2);
  assert.equal(out.visible_delivered_jobs, 8);
  assert.equal(out.categories[0].category, 'research');
  assert.equal(out.categories[0].delivered_jobs, 5);
  assert.equal(out.top_agents[0].handle, 'a');
});
