const RATE = ['very_slow', 'slow', 'normal', 'rapid', 'very_rapid'];
const VOLUME = ['soft', 'normal', 'loud'];
const PROSODY = ['reduced', 'normal', 'expansive', 'irritable', 'anxious', 'guarded', 'fluctuating'];

const ACTOR_DELIVERY = Object.freeze({
  'depression-suicide-risk': { rate: 'slow', volume: 'soft', prosody: 'reduced', latencyMs: 1200, interruptions: 'low', notes: 'longer pauses; low energy; answers suicide questions clearly if asked directly' },
  'acute-mania': { rate: 'very_rapid', volume: 'loud', prosody: 'expansive', latencyMs: 80, interruptions: 'high', notes: 'pressured, overfamiliar, distractible; mild irritability if repeatedly challenged' },
  'first-episode-psychosis': { rate: 'slow', volume: 'soft', prosody: 'guarded', latencyMs: 900, interruptions: 'low', notes: 'short guarded answers; scanning/suspicious tone; becomes more cooperative with neutral validation' },
  'alcohol-withdrawal': { rate: 'rapid', volume: 'normal', prosody: 'anxious', latencyMs: 180, interruptions: 'medium', notes: 'restless, uncomfortable, asks for relief repeatedly' },
  'delirium-vs-psychosis': { rate: 'slow', volume: 'soft', prosody: 'fluctuating', latencyMs: 1400, interruptions: 'low', notes: 'attention and coherence vary within the encounter; occasional lost thread' },
  'capacity-refusal': { rate: 'normal', volume: 'normal', prosody: 'guarded', latencyMs: 450, interruptions: 'low', notes: 'calm but firm; suspicious if interviewer directly argues with belief' },
  'ocd-assessment': { rate: 'normal', volume: 'soft', prosody: 'anxious', latencyMs: 500, interruptions: 'low', notes: 'embarrassed initially; clearer with normalization and nonjudgmental questions' },
  'parent-child-adhd': { rate: 'normal', volume: 'normal', prosody: 'normal', latencyMs: 350, interruptions: 'low', notes: 'concerned parent; some guilt; responds well to concrete non-blaming questions' }
});

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function actorDelivery(stationId) {
  return { ...(ACTOR_DELIVERY[stationId] || { rate: 'normal', volume: 'normal', prosody: 'normal', latencyMs: 400, interruptions: 'low', notes: 'natural conversational delivery' }) };
}

export function sanitizeVoiceObservation(input = {}) {
  const transcript = String(input.transcript || '').trim();
  if (!transcript) throw new Error('transcript_required');
  if (transcript.length > 4000) throw new Error('transcript_too_long');

  const wordsPerMinute = finiteOrNull(input.wordsPerMinute);
  const responseLatencyMs = finiteOrNull(input.responseLatencyMs);
  const meanPauseMs = finiteOrNull(input.meanPauseMs);
  const pauseRatio = finiteOrNull(input.pauseRatio);
  const interruptionCount = finiteOrNull(input.interruptionCount);
  const volumeDb = finiteOrNull(input.volumeDb);
  const selfCorrections = finiteOrNull(input.selfCorrections);

  return {
    transcript,
    observed: {
      wordsPerMinute: wordsPerMinute == null ? null : clamp(wordsPerMinute, 20, 320),
      responseLatencyMs: responseLatencyMs == null ? null : clamp(responseLatencyMs, 0, 15000),
      meanPauseMs: meanPauseMs == null ? null : clamp(meanPauseMs, 0, 10000),
      pauseRatio: pauseRatio == null ? null : clamp(pauseRatio, 0, 1),
      interruptionCount: interruptionCount == null ? null : clamp(Math.round(interruptionCount), 0, 100),
      volumeDb: volumeDb == null ? null : clamp(volumeDb, -90, 0),
      selfCorrections: selfCorrections == null ? null : clamp(Math.round(selfCorrections), 0, 100)
    }
  };
}

export function describeLearnerVoice(observed = {}) {
  const notes = [];
  if (observed.wordsPerMinute != null) {
    if (observed.wordsPerMinute < 90) notes.push('speech pace is slow');
    else if (observed.wordsPerMinute > 190) notes.push('speech pace is fast');
    else notes.push('speech pace is broadly conversational');
  }
  if (observed.responseLatencyMs != null && observed.responseLatencyMs > 2500) notes.push('response latency is prolonged');
  if (observed.pauseRatio != null && observed.pauseRatio > 0.35) notes.push('high pause proportion');
  if (observed.interruptionCount != null && observed.interruptionCount >= 3) notes.push('multiple interruptions/overlaps detected');
  if (observed.selfCorrections != null && observed.selfCorrections >= 3) notes.push('several self-corrections detected');
  return notes.length ? notes.join('; ') : 'no reliable acoustic observations were supplied';
}

export function communicationCoaching(observed = {}) {
  const strengths = [];
  const targets = [];
  if (observed.wordsPerMinute != null) {
    if (observed.wordsPerMinute >= 100 && observed.wordsPerMinute <= 175) strengths.push('controlled conversational pace');
    if (observed.wordsPerMinute > 190) targets.push('slow the question delivery and allow the patient more processing space');
    if (observed.wordsPerMinute < 80) targets.push('increase fluency slightly while keeping empathic pauses');
  }
  if (observed.responseLatencyMs != null && observed.responseLatencyMs < 250) targets.push('avoid replying too quickly after sensitive disclosures; allow a short therapeutic pause');
  if (observed.interruptionCount != null && observed.interruptionCount >= 3) targets.push('reduce interruptions unless needed for safety or a markedly pressured patient');
  if (observed.pauseRatio != null && observed.pauseRatio >= 0.15 && observed.pauseRatio <= 0.35) strengths.push('uses pauses rather than continuous questioning');
  return { strengths, targets };
}

export class VoiceOsceStore {
  constructor({ ttlMs = 45 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.sessions = new Map();
  }

  cleanup(now = Date.now()) {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }

  start(sessionId, stationId) {
    this.cleanup();
    const state = {
      sessionId,
      stationId,
      observations: [],
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  get(sessionId) {
    this.cleanup();
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error('voice_session_not_found');
    return state;
  }

  append(sessionId, packet) {
    const state = this.get(sessionId);
    state.observations.push({ ...packet.observed });
    state.expiresAt = Date.now() + this.ttlMs;
    return state;
  }

  summary(sessionId) {
    const state = this.get(sessionId);
    if (!state.observations.length) return { turns: 0, aggregate: {}, coaching: { strengths: [], targets: [] } };
    const keys = ['wordsPerMinute', 'responseLatencyMs', 'meanPauseMs', 'pauseRatio', 'interruptionCount', 'volumeDb', 'selfCorrections'];
    const aggregate = {};
    for (const key of keys) {
      const vals = state.observations.map((x) => x[key]).filter((x) => x != null);
      aggregate[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    return { turns: state.observations.length, aggregate, coaching: communicationCoaching(aggregate) };
  }

  finish(sessionId) {
    const summary = this.summary(sessionId);
    this.sessions.delete(sessionId);
    return summary;
  }
}

export function voiceExaminerContext(summary) {
  const aggregate = summary?.aggregate || {};
  const observation = describeLearnerVoice(aggregate);
  const coaching = summary?.coaching || { strengths: [], targets: [] };
  return [
    'VOICE COMMUNICATION OBSERVATIONS (formative only; do not infer diagnosis or personality from voice):',
    observation,
    `Strengths: ${coaching.strengths.join('; ') || 'none established from supplied metrics'}`,
    `Targets: ${coaching.targets.join('; ') || 'none established from supplied metrics'}`,
    'Treat these as communication-process observations only. Audio quality, device processing, accent and language can alter acoustic measurements.'
  ].join('\n');
}

export const voiceOsceCapabilities = Object.freeze({
  input: 'transcript_plus_optional_acoustic_metrics',
  rawAudioPersisted: false,
  transcriptPersisted: false,
  medicalInferenceFromVoiceAlone: false,
  actorDeliveryDirectives: true,
  learnerCommunicationCoaching: true,
  supportedActorRateLabels: RATE,
  supportedActorVolumeLabels: VOLUME,
  supportedActorProsodyLabels: PROSODY
});
