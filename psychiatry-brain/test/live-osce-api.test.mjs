import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

test('Full Live OSCE runs interview -> bell -> viva -> mastery without persisting transcript', async (t) => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'psychiatry-live-osce-'));
  const store = new LearnerStore(stateDir);
  const fakeAsk = async ({ task }) => {
    if (/POST-OSCE VIVA QUESTION GENERATION/.test(task)) {
      return { text: '1. What is your leading diagnosis and differential?\n2. What further investigations are needed?\n3. What is your immediate management and safety plan?' };
    }
    if (/LIVE OSCE ADDENDUM/.test(task)) {
      return { text: 'Formative feedback: good engagement; improve structured risk assessment.\nMASTERY: {"mood":78,"risk":66,"mse":74,"emergency":70,"trading":100}' };
    }
    if (/SIMULATED PSYCHIATRY OSCE ROLEPLAY/.test(task)) {
      return { text: 'بننام ساعتين تقريبًا ومش حاسس إني محتاج نوم أكتر.' };
    }
    return { text: 'OK' };
  };

  const server = createAdaptivePsychiatryServer({ store, ask: fakeAsk });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(stateDir, { recursive: true, force: true });
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const started = await post(base, '/osce/live/start', { stationId: 'acute-mania', difficulty: 'r1', durationMinutes: 8 });
  assert.equal(started.status, 200);
  assert.equal(started.json.ok, true);
  assert.equal(started.json.live.durationSeconds, 480);
  assert.equal(started.json.live.stage, 'interview');
  const liveSessionId = started.json.live.liveSessionId;

  const turn = await post(base, '/osce/live/turn', {
    liveSessionId,
    transcript: 'فاهم إنك حاسس بطاقة عالية. احكي لي أكتر عن نومك.',
    wordsPerMinute: 135,
    responseLatencyMs: 700,
    pauseRatio: 0.2,
    interruptionCount: 0
  });
  assert.equal(turn.status, 200);
  assert.match(turn.json.reply, /ساعتين/);
  assert.equal(turn.json.rawAudioPersisted, false);
  assert.equal(turn.json.transcriptPersisted, false);
  assert.ok(turn.json.interaction.state.cooperation >= 1);

  const closed = await post(base, '/osce/live/close', { liveSessionId });
  assert.equal(closed.status, 200);
  assert.equal(closed.json.live.stage, 'summary');
  assert.equal(closed.json.bell, true);

  const lateTurn = await post(base, '/osce/live/turn', { liveSessionId, message: 'One more question' });
  assert.equal(lateTurn.status, 400);
  assert.match(lateTurn.json.error, /interview_closed/);

  const vivaStart = await post(base, '/osce/live/viva/start', {
    liveSessionId,
    summary: 'Likely acute manic episode with impaired judgment; assess risk and exclude substance/medical causes.'
  });
  assert.equal(vivaStart.status, 200);
  assert.equal(vivaStart.json.totalQuestions, 3);
  assert.match(vivaStart.json.question, /diagnosis/i);

  for (const answer of [
    'Bipolar mania is leading; consider substance-induced and secondary medical causes.',
    'Physical examination, medication/substance history, targeted laboratory tests and collateral.',
    'Immediate safety, senior review, consider admission, manage agitation and start evidence-based treatment.'
  ]) {
    const result = await post(base, '/osce/live/viva/answer', { liveSessionId, answer });
    assert.equal(result.status, 200);
  }

  const finalized = await post(base, '/osce/live/finalize', { liveSessionId });
  assert.equal(finalized.status, 200);
  assert.deepEqual(finalized.json.masteryApplied, { mood: 78, risk: 66, mse: 74, emergency: 70 });
  assert.equal(finalized.json.rawAudioPersisted, false);
  assert.equal(finalized.json.transcriptPersisted, false);
  assert.ok(finalized.json.masterySummary.attempts >= 4);

  const persisted = await readFile(path.join(stateDir, 'learner-state.json'), 'utf8');
  assert.doesNotMatch(persisted, /احكي لي أكتر عن نومك|Likely acute manic episode|Bipolar mania/);
  assert.doesNotMatch(persisted, /trading/);
  assert.match(persisted, /osce_acute_mania/);
});
