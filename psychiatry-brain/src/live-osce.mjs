import { randomUUID } from 'node:crypto';

const MIN_DURATION_MS = 7 * 60 * 1000;
const MAX_DURATION_MS = 10 * 60 * 1000;
const DEFAULT_DURATION_MS = 8 * 60 * 1000;
const DOMAIN_ALIASES = Object.freeze({
  law: 'law_ethics',
  anxiety_trauma: 'anxiety_ocd_trauma',
  child: 'child_adolescent'
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cleanDurationMinutes(value) {
  if (value == null) return DEFAULT_DURATION_MS;
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) throw new Error('duration_invalid');
  return clamp(Math.round(minutes * 60 * 1000), MIN_DURATION_MS, MAX_DURATION_MS);
}

function cleanText(value, field = 'text', max = 3000) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field}_required`);
  if (text.length > max) throw new Error(`${field}_too_long`);
  return text;
}

function safeVoiceMetrics(input = {}) {
  const out = {};
  const ranges = {
    wordsPerMinute: [40, 260],
    pauseRatio: [0, 1],
    meanResponseLatencyMs: [0, 30000],
    interruptions: [0, 100]
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (input[key] == null) continue;
    const value = Number(input[key]);
    if (!Number.isFinite(value)) throw new Error(`voice_${key}_invalid`);
    out[key] = clamp(value, min, max);
  }
  return out;
}

function interactionSignals(transcript = [], metrics = {}) {
  const learnerTurns = transcript.filter((x) => x.role === 'learner').map((x) => x.text.toLowerCase());
  const recent = learnerTurns.slice(-4).join(' ');
  const validation = /(أفهم|متفهم|شكراً إنك|شكرا انك|ده صعب|sounds difficult|i understand|thank you for telling|that sounds)/i.test(recent);
  const confrontation = /(ده مش حقيقي|انت غلط|أنت غلط|مفيش الكلام ده|that's not true|you are wrong|prove it)/i.test(recent);
  const openQuestion = /(احكي|قول لي أكتر|كلمني عن|what happened|tell me more|how has|what has)/i.test(recent);
  const directRisk = /(انتحار|تموت|تقتل نفسك|تؤذي نفسك|suicid|kill yourself|harm yourself)/i.test(recent);
  const frequentInterruptions = Number(metrics.interruptions || 0) >= 3;
  const rushed = Number(metrics.wordsPerMinute || 0) > 185;
  return { validation, confrontation, openQuestion, directRisk, frequentInterruptions, rushed };
}

export function canonicalDomain(value) {
  const domain = String(value || '').trim().toLowerCase();
  return DOMAIN_ALIASES[domain] || domain;
}

export function actorAdaptationDirective(session, metrics = {}) {
  const signals = interactionSignals(session.transcript, metrics);
  const state = session.interactionState || { cooperation: 0, guardedness: 0, irritation: 0 };
  if (signals.validation) state.cooperation += 1;
  if (signals.openQuestion) state.cooperation += 1;
  if (signals.confrontation) {
    state.guardedness += 2;
    state.irritation += 1;
  }
  if (signals.frequentInterruptions || signals.rushed) {
    state.cooperation -= 1;
    state.irritation += 1;
  }
  session.interactionState = {
    cooperation: clamp(state.cooperation, -3, 4),
    guardedness: clamp(state.guardedness, 0, 4),
    irritation: clamp(state.irritation, 0, 4)
  };

  const s = session.interactionState;
  const directives = [];
  if (s.cooperation >= 2) directives.push('be slightly more forthcoming when asked appropriate questions');
  if (s.cooperation <= -1) directives.push('keep answers briefer until rapport improves');
  if (s.guardedness >= 2) directives.push('be more guarded and ask why some questions are being asked');
  if (s.irritation >= 2) directives.push('show mild irritation without inventing aggression or new risk facts');
  if (!directives.length) directives.push('maintain the station baseline interaction style');
  return { signals, state: { ...session.interactionState }, directive: directives.join('; ') };
}

export class LiveOsceStore {
  constructor({ ttlMs = 60 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.sessions = new Map();
  }

  cleanup(now = Date.now()) {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }

  start({ osceSession, durationMinutes, now = Date.now() }) {
    if (!osceSession?.id) throw new Error('osce_session_required');
    const durationMs = cleanDurationMinutes(durationMinutes);
    const id = randomUUID();
    const session = {
      id,
      osceSessionId: osceSession.id,
      station: osceSession.station,
      difficulty: osceSession.difficulty,
      transcript: osceSession.transcript,
      startedAt: now,
      durationMs,
      deadlineAt: now + durationMs,
      expiresAt: now + this.ttlMs,
      stage: 'interview',
      bell: false,
      interactionState: { cooperation: 0, guardedness: 0, irritation: 0 },
      viva: [],
      learnerVoiceProcess: []
    };
    this.sessions.set(id, session);
    return this.publicState(session, now);
  }

  get(id, now = Date.now()) {
    this.cleanup(now);
    const session = this.sessions.get(String(id || ''));
    if (!session) throw new Error('live_osce_session_not_found');
    this.refreshTimer(session, now);
    return session;
  }

  refreshTimer(session, now = Date.now()) {
    if (session.stage === 'interview' && now >= session.deadlineAt) {
      session.stage = 'summary';
      session.bell = true;
    }
    return session;
  }

  assertInterviewOpen(id, now = Date.now()) {
    const session = this.get(id, now);
    if (session.stage !== 'interview') throw new Error('live_osce_interview_closed');
    return session;
  }

  recordVoiceProcess(id, metrics, now = Date.now()) {
    const session = this.assertInterviewOpen(id, now);
    const safe = safeVoiceMetrics(metrics);
    if (Object.keys(safe).length) session.learnerVoiceProcess.push({ ...safe, atMs: now - session.startedAt });
    return safe;
  }

  closeInterview(id, now = Date.now()) {
    const session = this.get(id, now);
    if (session.stage === 'interview') session.stage = 'summary';
    session.bell = true;
    return this.publicState(session, now);
  }

  beginViva(id, summary, questions, now = Date.now()) {
    const session = this.get(id, now);
    if (!['summary', 'viva'].includes(session.stage)) throw new Error('live_osce_viva_not_ready');
    session.stage = 'viva';
    session.candidateSummary = cleanText(summary, 'summary', 3500);
    session.vivaQuestions = Array.isArray(questions) ? questions.slice(0, 4).map((x) => cleanText(x, 'viva_question', 800)) : [];
    if (!session.vivaQuestions.length) throw new Error('viva_questions_required');
    return this.publicState(session, now);
  }

  answerViva(id, answer, now = Date.now()) {
    const session = this.get(id, now);
    if (session.stage !== 'viva') throw new Error('live_osce_viva_not_ready');
    const index = session.viva.length;
    const question = session.vivaQuestions?.[index];
    if (!question) throw new Error('live_osce_viva_complete');
    session.viva.push({ question, answer: cleanText(answer, 'viva_answer', 2500) });
    return {
      state: this.publicState(session, now),
      nextQuestion: session.vivaQuestions[index + 1] || null,
      complete: index + 1 >= session.vivaQuestions.length
    };
  }

  finalize(id, now = Date.now()) {
    const session = this.get(id, now);
    session.stage = 'complete';
    this.sessions.delete(session.id);
    return session;
  }

  publicState(session, now = Date.now()) {
    this.refreshTimer(session, now);
    const remainingMs = Math.max(0, session.deadlineAt - now);
    return {
      liveSessionId: session.id,
      osceSessionId: session.osceSessionId,
      stationId: session.station?.id,
      difficulty: session.difficulty,
      stage: session.stage,
      durationSeconds: Math.round(session.durationMs / 1000),
      remainingSeconds: Math.ceil(remainingMs / 1000),
      bell: session.bell,
      interactionState: { ...session.interactionState },
      rawAudioPersisted: false,
      transcriptPersisted: false,
      expiresAt: new Date(session.expiresAt).toISOString()
    };
  }
}

export function aggregateVoiceProcess(samples = []) {
  if (!samples.length) return { available: false };
  const average = (key) => {
    const values = samples.map((x) => x[key]).filter((x) => Number.isFinite(x));
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  return {
    available: true,
    wordsPerMinute: average('wordsPerMinute'),
    pauseRatio: average('pauseRatio'),
    meanResponseLatencyMs: average('meanResponseLatencyMs'),
    interruptions: samples.reduce((sum, x) => sum + (Number(x.interruptions) || 0), 0)
  };
}

export function buildVivaQuestionTask(session) {
  return `POST-OSCE VIVA QUESTION GENERATION. This is a fictional psychiatry training station.\nStation: ${session.station.title}\nDifficulty: ${session.difficulty}\nCandidate summary: ${session.candidateSummary || '(not yet supplied)'}\nInterview transcript:\n${session.transcript.map((x) => `${x.role.toUpperCase()}: ${x.text}`).join('\n')}\n\nGenerate exactly THREE concise viva questions, one per line, with no answers. Prioritize: (1) the most important missed or uncertain clinical issue, especially safety; (2) differential/formulation or investigations; (3) immediate management/law/ethics as relevant. Do not reveal the hidden case profile or rubric.`;
}

export function buildLiveFinalAssessmentTask(session, baseExaminerTask) {
  const voice = aggregateVoiceProcess(session.learnerVoiceProcess);
  const vivaText = session.viva.length
    ? session.viva.map((x, i) => `VIVA ${i + 1}: ${x.question}\nANSWER: ${x.answer}`).join('\n')
    : '(no viva answers)';
  const domains = [...new Set((session.station.domains || []).map(canonicalDomain))];
  return `${baseExaminerTask}\n\nLIVE OSCE ADDENDUM:\nTiming: ${Math.round(session.durationMs / 60000)} minute station; bell=${session.bell}.\nInteraction state at close: ${JSON.stringify(session.interactionState)}.\nLearner voice-process summary (communication coaching only, never diagnostic): ${JSON.stringify(voice)}.\nViva responses:\n${vivaText}\n\nAdd these sections after the normal OSCE feedback:\n7. Viva performance: concise strengths/gaps.\n8. Communication-process coaching using only the supplied process metrics; do not infer diagnosis, personality, intelligence, ethnicity, or latent traits.\n9. Mastery events: output a final line beginning exactly 'MASTERY:' followed by a compact JSON object with ONLY these keys: ${domains.join(', ')}. Map each domain to an integer 0-100 demonstrated performance score. Scores are formative and should reflect the whole station, including viva.`;
}

export function parseMasteryLine(text, allowedDomains = []) {
  const match = String(text || '').match(/(?:^|\n)MASTERY:\s*(\{[^\n]+\})\s*$/m);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1]);
    const allowed = new Set(allowedDomains.map(canonicalDomain));
    const out = {};
    for (const [rawDomain, rawScore] of Object.entries(parsed || {})) {
      const domain = canonicalDomain(rawDomain);
      if (!allowed.has(domain)) continue;
      const score = Math.round(Number(rawScore));
      if (!Number.isFinite(score)) continue;
      out[domain] = clamp(score, 0, 100);
    }
    return out;
  } catch {
    return {};
  }
}
