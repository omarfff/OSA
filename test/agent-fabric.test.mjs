import test from 'node:test';
import assert from 'node:assert/strict';
import { executionDecision, normalizeAgentArgs, planForGoal, publicUrlArg } from '../tools/agent-fabric.mjs';

const readAgent = { id: 'reader', access: 'read_only', args: 'none', enabled: true };
const writeAgent = { id: 'writer', access: 'write', args: 'passthrough', enabled: true };

test('read-only agents are allowed by default and writes are gated', () => {
  assert.equal(executionDecision(readAgent, {}).allowed, true);
  assert.equal(executionDecision(writeAgent, {}).allowed, false);
  assert.equal(executionDecision(writeAgent, { OSA_AGENT_ALLOW_WRITE: '1' }).allowed, true);
  assert.equal(executionDecision({ id: 'money', access: 'financial' }, { OSA_AGENT_ALLOW_WRITE: '1' }).allowed, false);
});

test('public URL arguments reject local and credential targets', () => {
  assert.match(publicUrlArg('https://example.com/path'), /^https:\/\/example\.com/);
  assert.throws(() => publicUrlArg('http://127.0.0.1:8080'), /private_target_not_allowed/);
  assert.throws(() => publicUrlArg('https://user:pass@example.com'), /credentials_or_fragment_not_allowed/);
});

test('argument policy is enforced', () => {
  assert.deepEqual(normalizeAgentArgs(readAgent, []), []);
  assert.throws(() => normalizeAgentArgs(readAgent, ['extra']), /agent_accepts_no_arguments/);
  assert.deepEqual(normalizeAgentArgs({ args: 'one_public_url' }, ['https://example.com']), ['https://example.com/']);
});

test('revenue goal plans revenue-first agents', () => {
  const agents = [
    { id: 'revenue-scout', args: 'none', enabled: true, access: 'read_only' },
    { id: 'lead-auditor', args: 'one_public_url', enabled: true, access: 'read_only' },
    { id: 'mcp-verifier', args: 'one_public_url', enabled: true, access: 'read_only' },
    { id: 'payment-watch', args: 'none', enabled: true, access: 'read_only' },
  ];
  const ids = planForGoal('نبغا دخل revenue وفلوس', agents).map((x) => x.id);
  assert.deepEqual(ids, ['revenue-scout', 'lead-auditor', 'mcp-verifier', 'payment-watch']);
});
