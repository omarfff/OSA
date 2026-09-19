import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const configUrl = new URL('../config/agent-fabric.json', import.meta.url);
const wrapperUrl = new URL('../ops/ai-router-with-brain-env.sh', import.meta.url);

test('Gemini wrapper reuses Brain env without exposing a secret value', async () => {
  const wrapper = await fs.readFile(wrapperUrl, 'utf8');
  assert.match(wrapper, /\/etc\/osa\/brain\.env/);
  assert.match(wrapper, /OSA_GEMINI_API_KEY=.*GEMINI_API_KEY/);
  assert.match(wrapper, /gemini-3\.8-flash/);
  assert.match(wrapper, /export OSA_AI_PROVIDER_ORDER="\$PROVIDER_ORDER_OVERRIDE"/);
  assert.match(wrapper, /export OSA_AI_MAX_OUTPUT_TOKENS="\$MAX_OUTPUT_OVERRIDE"/);
  assert.ok(wrapper.indexOf('export OSA_AI_PROVIDER_ORDER=') > wrapper.indexOf('. "$ENV_FILE"'));
  assert.doesNotMatch(wrapper, /AIza[0-9A-Za-z_-]{20,}/);
});

test('Agent Fabric keeps Gemini helper bounded and financial execution blocked', async () => {
  const config = JSON.parse(await fs.readFile(configUrl, 'utf8'));
  assert.equal(config.policy.financial_execution, 'blocked');

  const status = config.agents.find((agent) => agent.id === 'ai-router-status');
  const helper = config.agents.find((agent) => agent.id === 'ai-helper');

  assert.ok(status);
  assert.ok(helper);
  assert.equal(status.access, 'read_only');
  assert.equal(helper.access, 'draft');
  assert.equal(status.enabled, true);
  assert.equal(helper.enabled, true);
  assert.deepEqual(status.command, ['bash', 'ops/ai-router-with-brain-env.sh', 'status']);
  assert.deepEqual(helper.command, ['bash', 'ops/ai-router-with-brain-env.sh', 'ask']);
});
