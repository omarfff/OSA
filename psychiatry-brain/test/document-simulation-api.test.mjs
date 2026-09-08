import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LearnerStore } from '../src/learning.mjs';
import { createAdaptivePsychiatryServer } from '../src/adaptive-server.mjs';

async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, json: await response.json() };
}

test('document simulation API returns grounded bundle without writing source into learner state', async (t) => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'psychiatry-doc-sim-'));
  const store = new LearnerStore(stateDir);
  const fakeAsk = async ({ task }) => {
    if (/SYNTHESIZE A HIGH-YIELD/.test(task)) return { text: 'High-yield summary.' };
    if (/SOURCE-GROUNDED STUDY SUMMARY/.test(task)) return { text: 'Source-unit summary.' };
    return { text: '1. Difficult board question\nA. One\nB. Two\nC. Three\nD. Four\nCorrect: B\nA: wrong\nB: correct\nC: wrong\nD: wrong' };
  };

  const server = createAdaptivePsychiatryServer({ store, ask: fakeAsk });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(stateDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const secretMarker = 'GUIDELINE_SOURCE_MARKER_DO_NOT_PERSIST';
  const sourceText = `${secretMarker}\n${'clinical prescribing source '.repeat(5000)}`;

  const response = await post(base, '/documents/simulate', {
    title: 'Uploaded prescribing chapter',
    sourceText,
    questionCount: 10,
    difficulty: 'board',
    format: 'sba',
    language: 'bilingual'
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.questionCount, 10);
  assert.equal(response.json.groundedOnly, true);
  assert.equal(response.json.sourcePersisted, false);
  assert.equal(response.json.rawPdfPersisted, false);
  assert.equal(response.json.questionsPersisted, false);
  assert.equal(response.json.questionBatches.reduce((n, x) => n + x.count, 0), 10);

  const entries = await readdir(stateDir);
  if (entries.includes('learner-state.json')) {
    const persisted = await readFile(path.join(stateDir, 'learner-state.json'), 'utf8');
    assert.doesNotMatch(persisted, new RegExp(secretMarker));
  } else {
    assert.equal(entries.length, 0);
  }
});
