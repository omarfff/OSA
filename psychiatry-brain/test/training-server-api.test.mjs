import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createTrainingPsychiatryServer } from '../src/training-server.mjs';

async function withServer(fn) {
  const ask = async ({ task }) => {
    if (task.includes('CLINICAL QUESTION')) return { text: 'Clinical question scaffold' };
    if (task.includes('AUDITABLE DECISION SUPPORT')) return { text: 'Evidence synthesis [S1]' };
    if (task.includes('SOURCE-FAITHFUL NOTE')) return { text: 'Structured note' };
    if (task.includes('EVIDENCE AUDIT')) return { text: 'Documentation audit' };
    if (task.includes('ORAL DEFENCE')) return { text: 'Challenge?\nWhat evidence supports your decision?' };
    if (task.includes('FORMATIVE FEEDBACK')) return { text: 'Verdict: Partially supported' };
    return { text: 'stub' };
  };
  const server = createTrainingPsychiatryServer({ bind: '127.0.0.1', port: 0, ask });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test('training capabilities declare EBP, formulation and consultant mode without persistence', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/training/capabilities`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.evidenceBasedReasoning, true);
    assert.equal(body.documentationFormulationLab, true);
    assert.equal(body.consultantMode, true);
    assert.equal(body.externalNetworkRetrievalInsideVps, false);
    assert.equal(body.caseTextPersisted, false);
    assert.equal(body.generatedNotesPersisted, false);
  });
});

test('evidence reasoning API accepts bounded source excerpts and returns non-persistent bundle', async () => {
  await withServer(async (base) => {
    const result = await post(base, '/reasoning/evidence', {
      caseText: 'Fictional patient with depression and renal impairment.',
      evidenceSources: [{ title: 'Current guideline excerpt', type: 'guideline', text: 'Renal function is a treatment modifier.' }]
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.sourceGrounded, true);
    assert.equal(result.body.casePersisted, false);
    assert.match(result.body.synthesis, /\[S1\]/);
  });
});

test('documentation and consultant endpoints remain stateless', async () => {
  await withServer(async (base) => {
    const documentation = await post(base, '/documentation/formulate', {
      sourceText: 'Fictional transcript: the patient reports poor sleep.',
      learnerDraft: 'Poor sleep reported.',
      sourceKind: 'fictional_transcript'
    });
    assert.equal(documentation.status, 200);
    assert.equal(documentation.body.generatedNotePersisted, false);
    assert.equal(documentation.body.learnerDraftCompared, true);

    const challenge = await post(base, '/consultant/challenge', {
      caseText: 'Fictional case.',
      learnerDecision: 'I would verify the current guideline before prescribing.'
    });
    assert.equal(challenge.status, 200);
    assert.equal(challenge.body.challengePersisted, false);

    const feedback = await post(base, '/consultant/feedback', {
      caseText: 'Fictional case.',
      learnerDecision: 'I would verify the current guideline before prescribing.',
      learnerResponse: 'I need an authoritative current guideline because the supplied case does not include evidence.'
    });
    assert.equal(feedback.status, 200);
    assert.equal(feedback.body.feedbackPersisted, false);
  });
});
