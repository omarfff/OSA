import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveOsceStore, actorAdaptationDirective, aggregateVoiceProcess } from '../src/live-osce.mjs';

function fakeOsce(now = 1_000_000) {
  return {
    id: 'osce-1',
    station: { id: 'first-episode-psychosis', title: 'First episode psychosis', domains: ['psychosis', 'risk', 'mse', 'formulation'] },
    difficulty: 'r1',
    transcript: [{ role: 'actor', text: 'مين قالك عني؟' }],
    createdAt: now
  };
}

test('live OSCE defaults to eight minutes and exposes no persistent audio/transcript', () => {
  const store = new LiveOsceStore();
  const state = store.start({ osceSession: fakeOsce(), now: 1_000_000 });
  assert.equal(state.durationSeconds, 480);
  assert.equal(state.remainingSeconds, 480);
  assert.equal(state.rawAudioPersisted, false);
  assert.equal(state.transcriptPersisted, false);
  assert.equal(state.stage, 'interview');
});

test('duration is clamped to 7-10 minutes', () => {
  const store = new LiveOsceStore();
  const a = store.start({ osceSession: fakeOsce(), durationMinutes: 2, now: 1_000_000 });
  const b = store.start({ osceSession: { ...fakeOsce(), id: 'osce-2' }, durationMinutes: 20, now: 2_000_000 });
  assert.equal(a.durationSeconds, 420);
  assert.equal(b.durationSeconds, 600);
});

test('timer closes interview and rings bell at deadline', () => {
  const store = new LiveOsceStore();
  const started = store.start({ osceSession: fakeOsce(), durationMinutes: 7, now: 1_000_000 });
  const state = store.publicState(store.get(started.liveSessionId, 1_420_000), 1_420_000);
  assert.equal(state.remainingSeconds, 0);
  assert.equal(state.bell, true);
  assert.equal(state.stage, 'summary');
  assert.throws(() => store.assertInterviewOpen(started.liveSessionId, 1_420_001), /interview_closed/);
});

test('actor adaptation rewards validation and reacts to confrontation/interruptions without changing case facts', () => {
  const session = { transcript: [{ role: 'learner', text: 'فاهم إن ده مخوفك، احكي لي أكتر.' }], interactionState: { cooperation: 0, guardedness: 0, irritation: 0 } };
  const first = actorAdaptationDirective(session, { wordsPerMinute: 120, interruptions: 0 });
  assert.ok(first.state.cooperation >= 1);
  session.transcript.push({ role: 'learner', text: 'ده مش حقيقي، أنت غلط.' });
  const second = actorAdaptationDirective(session, { wordsPerMinute: 200, interruptions: 4 });
  assert.ok(second.state.guardedness >= 2);
  assert.ok(second.state.irritation >= 1);
  assert.match(second.directive, /guarded|irritation|briefer/i);
});

test('voice metrics are aggregated as communication process only', () => {
  const summary = aggregateVoiceProcess([
    { wordsPerMinute: 100, pauseRatio: 0.2, interruptions: 1 },
    { wordsPerMinute: 140, pauseRatio: 0.4, interruptions: 2 }
  ]);
  assert.equal(summary.available, true);
  assert.equal(summary.wordsPerMinute, 120);
  assert.equal(summary.pauseRatio, 0.30000000000000004);
  assert.equal(summary.interruptions, 3);
});

test('viva lifecycle requires summary and deletes final session', () => {
  const store = new LiveOsceStore();
  const started = store.start({ osceSession: fakeOsce(), now: 1_000_000 });
  store.closeInterview(started.liveSessionId, 1_100_000);
  const state = store.beginViva(started.liveSessionId, 'Psychosis with risk to others.', ['What is the differential?', 'What investigations?', 'What immediate management?'], 1_100_100);
  assert.equal(state.stage, 'viva');
  const one = store.answerViva(started.liveSessionId, 'Substance-induced psychosis is important.', 1_100_200);
  assert.equal(one.complete, false);
  assert.equal(one.nextQuestion, 'What investigations?');
  store.answerViva(started.liveSessionId, 'Physical exam, urine toxicology, targeted labs.', 1_100_300);
  const three = store.answerViva(started.liveSessionId, 'Safety, senior review, admission if indicated.', 1_100_400);
  assert.equal(three.complete, true);
  store.finalize(started.liveSessionId, 1_100_500);
  assert.throws(() => store.get(started.liveSessionId, 1_100_600), /not_found/);
});
