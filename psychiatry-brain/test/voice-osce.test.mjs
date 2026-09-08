import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VoiceOsceStore,
  actorDelivery,
  sanitizeVoiceObservation,
  describeLearnerVoice,
  communicationCoaching,
  voiceExaminerContext,
  voiceOsceCapabilities
} from '../src/voice-osce.mjs';

test('actor delivery encodes clinically plausible observable style without diagnosis leakage', () => {
  const mania = actorDelivery('acute-mania');
  assert.equal(mania.rate, 'very_rapid');
  assert.equal(mania.interruptions, 'high');
  assert.equal('diagnosis' in mania, false);

  const depression = actorDelivery('depression-suicide-risk');
  assert.equal(depression.rate, 'slow');
  assert.equal(depression.volume, 'soft');
});

test('voice packet requires transcript and clamps acoustic metrics', () => {
  assert.throws(() => sanitizeVoiceObservation({}), /transcript_required/);
  const packet = sanitizeVoiceObservation({
    transcript: 'Could you tell me more about what has been happening?',
    wordsPerMinute: 999,
    responseLatencyMs: -20,
    pauseRatio: 2,
    interruptionCount: 3.4,
    volumeDb: -120
  });
  assert.equal(packet.observed.wordsPerMinute, 320);
  assert.equal(packet.observed.responseLatencyMs, 0);
  assert.equal(packet.observed.pauseRatio, 1);
  assert.equal(packet.observed.interruptionCount, 3);
  assert.equal(packet.observed.volumeDb, -90);
});

test('voice observations are communication-process descriptions, not diagnoses', () => {
  const text = describeLearnerVoice({ wordsPerMinute: 215, interruptionCount: 4, pauseRatio: 0.2 });
  assert.match(text, /speech pace is fast/);
  assert.match(text, /interruptions/);
  assert.doesNotMatch(text, /mania|anxiety|personality|diagnosis/i);
});

test('communication coaching identifies controllable interviewing targets', () => {
  const result = communicationCoaching({ wordsPerMinute: 220, interruptionCount: 5, responseLatencyMs: 100 });
  assert.ok(result.targets.some((x) => /slow/i.test(x)));
  assert.ok(result.targets.some((x) => /interrupt/i.test(x)));
  assert.ok(result.targets.some((x) => /therapeutic pause/i.test(x)));
});

test('voice session state is memory-only and deleted at finish', () => {
  const store = new VoiceOsceStore();
  store.start('session-1', 'acute-mania');
  const packet = sanitizeVoiceObservation({ transcript: 'How are you sleeping?', wordsPerMinute: 145, pauseRatio: 0.2 });
  store.append('session-1', packet);
  const summary = store.summary('session-1');
  assert.equal(summary.turns, 1);
  assert.equal(summary.aggregate.wordsPerMinute, 145);
  const finished = store.finish('session-1');
  assert.equal(finished.turns, 1);
  assert.throws(() => store.get('session-1'), /voice_session_not_found/);
});

test('voice examiner context explicitly forbids medical inference from learner voice', () => {
  const context = voiceExaminerContext({
    aggregate: { wordsPerMinute: 150 },
    coaching: { strengths: ['controlled conversational pace'], targets: [] }
  });
  assert.match(context, /formative only/i);
  assert.match(context, /do not infer diagnosis or personality from voice/i);
  assert.match(context, /device processing/i);
});

test('capability declaration keeps raw audio and transcript persistence disabled', () => {
  assert.equal(voiceOsceCapabilities.rawAudioPersisted, false);
  assert.equal(voiceOsceCapabilities.transcriptPersisted, false);
  assert.equal(voiceOsceCapabilities.medicalInferenceFromVoiceAlone, false);
  assert.equal(voiceOsceCapabilities.actorDeliveryDirectives, true);
});
