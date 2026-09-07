import test from 'node:test';
import assert from 'node:assert/strict';
import { askPsychiatryBrain, loadStudyKnowledge, retrieveStudyKnowledge, responseViolations } from '../src/server.mjs';

test('loads only psychiatry-brain markdown knowledge', async () => {
  const db = await loadStudyKnowledge(undefined, { force: true });
  assert.ok(db.files.length >= 8);
  assert.ok(db.files.every((name) => name.endsWith('.md')));
  assert.ok(db.files.includes('00-boundary.md'));
  assert.ok(db.files.includes('20-curriculum.md'));
  assert.ok(db.files.includes('22-core-facts.md'));
});

test('retrieves relevant psychiatry context without root OSA knowledge', async () => {
  const result = await retrieveStudyKnowledge('mental status examination mood affect risk assessment');
  assert.match(result.text, /Mental Status Examination|MSE/i);
  assert.match(result.text, /Mood.*subject|Affect.*observ/i);
  assert.doesNotMatch(result.text, /30-Day MCP Reliability Pilot|x402 machine API|TrustScore/);
});

test('uses psychiatry-only system behavior in model call', async () => {
  let requestBody;
  const fakeFetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: 'Mood is the sustained subjective internal emotional state; affect is the observed external expression of emotion.' } }) };
  };
  const answer = await askPsychiatryBrain({
    task: 'Explain mood vs affect',
    context: 'study drill',
    fetchImpl: fakeFetch
  });
  assert.match(answer.text, /Mood.*subjective/i);
  assert.match(requestBody.messages[0].content, /Psychiatry Study Brain/);
  assert.match(requestBody.messages[0].content, /strictly isolated/);
  assert.match(requestBody.messages[0].content, /TASK DISCIPLINE/);
  assert.doesNotMatch(requestBody.messages[0].content, /optimize for verified external revenue/);
});

test('flags an invented case when no case was requested', () => {
  const violations = responseViolations({
    task: 'Explain mood vs affect in two concise lines.',
    text: 'A 45-year-old patient presents with depression. Suicide risk: high.'
  });
  assert.ok(violations.includes('invented_case'));
  assert.ok(violations.includes('invented_risk_level'));
});

test('retries when the first model answer invents a patient case', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    const content = calls === 1
      ? 'The patient presents with depression. Suicide risk: high. Working diagnosis: MDD.'
      : 'Mood is the sustained subjective emotional state reported by the patient.\nAffect is the observed external expression of emotion during the interview.';
    return { ok: true, json: async () => ({ message: { content } }) };
  };
  const answer = await askPsychiatryBrain({
    task: 'Explain mood vs affect in two concise lines.',
    fetchImpl: fakeFetch
  });
  assert.equal(calls, 2);
  assert.equal(answer.scope_repaired, true);
  assert.doesNotMatch(answer.text, /working diagnosis|suicide risk/i);
});
