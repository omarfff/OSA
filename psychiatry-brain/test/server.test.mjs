import test from 'node:test';
import assert from 'node:assert/strict';
import { askPsychiatryBrain, loadStudyKnowledge, retrieveStudyKnowledge } from '../src/server.mjs';

test('loads only psychiatry-brain markdown knowledge', async () => {
  const db = await loadStudyKnowledge(undefined, { force: true });
  assert.ok(db.files.length >= 7);
  assert.ok(db.files.every((name) => name.endsWith('.md')));
  assert.ok(db.files.includes('00-boundary.md'));
  assert.ok(db.files.includes('20-curriculum.md'));
});

test('retrieves relevant psychiatry context without root OSA knowledge', async () => {
  const result = await retrieveStudyKnowledge('mental status examination mood affect risk assessment');
  assert.match(result.text, /Mental Status Examination|MSE/i);
  assert.doesNotMatch(result.text, /30-Day MCP Reliability Pilot|x402 machine API|TrustScore/);
});

test('uses psychiatry-only system behavior in model call', async () => {
  let requestBody;
  const fakeFetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: 'Mood is subjective; affect is observed.' } }) };
  };
  const answer = await askPsychiatryBrain({
    task: 'Explain mood vs affect',
    context: 'study drill',
    fetchImpl: fakeFetch
  });
  assert.equal(answer.text, 'Mood is subjective; affect is observed.');
  assert.match(requestBody.messages[0].content, /Psychiatry Study Brain/);
  assert.match(requestBody.messages[0].content, /strictly isolated/);
  assert.doesNotMatch(requestBody.messages[0].content, /optimize for verified external revenue/);
});
