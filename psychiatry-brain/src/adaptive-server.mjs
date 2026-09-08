import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askPsychiatryBrain, loadStudyKnowledge } from './server.mjs';
import { LearnerStore, dueReviews, masterySummary, pickAdaptiveDomain } from './learning.mjs';
import { OsceSessionStore, buildActorTask, buildExaminerTask, listStations, osceMetadata } from './osce.mjs';
import { VoiceOsceStore, actorDelivery, sanitizeVoiceObservation, describeLearnerVoice, voiceExaminerContext, voiceOsceCapabilities } from './voice-osce.mjs';
import {
  LiveOsceStore,
  actorAdaptationDirective,
  buildVivaQuestionTask,
  buildLiveFinalAssessmentTask,
  canonicalDomain,
  parseMasteryLine
} from './live-osce.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const DEFAULT_BIND = process.env.PSYCHIATRY_BRAIN_BIND || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.PSYCHIATRY_BRAIN_PORT || 8791);
const DEFAULT_STATE_DIR = process.env.PSYCHIATRY_BRAIN_STATE_DIR || path.join(ROOT, 'state');
const OLLAMA_URL = process.env.PSYCHIATRY_OLLAMA_URL || 'http://127.0.0.1:11434';
const MAX_BODY = 64 * 1024;

function validateLoopback(urlText) {
  const url = new URL(urlText);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('ollama_must_be_loopback');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid_ollama_scheme');
  return url.origin;
}

async function readJson(req) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY) throw new Error('request_too_large');
    parts.push(part);
  }
  if (!parts.length) return {};
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

function cleanTopic(value) {
  const topic = String(value || '').trim();
  if (topic.length > 180) throw new Error('topic_too_long');
  return topic;
}

function parseVivaQuestions(text) {
  const rows = String(text || '')
    .split('\n')
    .map((x) => x.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
  if (rows.length === 3) return rows;
  return [
    'What is your leading diagnosis and the most important differentials?',
    'What additional assessment or investigations are required and why?',
    'What is your immediate management and safety plan, including law or capacity issues if relevant?'
  ];
}

function difficultyNumber(value) {
  if (value === 'board') return 5;
  if (value === 'r1') return 3;
  return 2;
}

export function buildStudyTask({ mode = 'adaptive', topic = '', state, now = new Date() } = {}) {
  const selectedMode = String(mode || 'adaptive').trim().toLowerCase();
  const allowed = new Set(['adaptive', 'diagnostic', 'teach', 'viva', 'mcq', 'review', 'case']);
  if (!allowed.has(selectedMode)) throw new Error('study_mode_invalid');

  const requestedTopic = cleanTopic(topic);
  const weakDomain = pickAdaptiveDomain(state);
  const due = dueReviews(state, now, 6);
  const dueText = due.length
    ? due.map((x) => `${x.domain}/${x.skill} (${Math.round(x.mastery * 100)}%)`).join(', ')
    : 'none due yet';
  const target = requestedTopic || weakDomain;

  const common = `Target topic/domain: ${target}. Current weak domain: ${weakDomain}. Due skills: ${dueText}. This is an adaptive learning session. Do not invent real patient facts. If a clinical case is used and no de-identified real case was supplied, label it explicitly as a fictional exam vignette.`;

  if (selectedMode === 'diagnostic') {
    return `${common}\nAsk exactly ONE high-yield diagnostic question that discriminates beginner from competent R1 understanding. Do not reveal the answer yet. Prefer applied reasoning over trivia. End with: Confidence 0-100%?`;
  }
  if (selectedMode === 'teach') {
    return `${common}\nTeach one compact concept in no more than 180 words using Arabic explanation with the key psychiatric English terms. Then ask ONE active-recall question and do not answer it.`;
  }
  if (selectedMode === 'viva') {
    return `${common}\nAct as an Egyptian Board psychiatry viva examiner. Ask exactly ONE oral-exam question. Do not give hints or the model answer until the learner commits to an answer.`;
  }
  if (selectedMode === 'mcq') {
    return `${common}\nCreate exactly ONE best-answer psychiatry MCQ with four options (A-D). Make distractors plausible. Do not reveal the correct option or explanation yet. End with: Answer + confidence 0-100%.`;
  }
  if (selectedMode === 'review') {
    return `${common}\nPrioritize a due or weak skill. Ask exactly ONE retrieval question in a different framing from prior practice. Do not reveal the answer yet.`;
  }
  if (selectedMode === 'case') {
    return `${common}\nIf CURRENT PSYCHIATRY CONTEXT contains a de-identified case, ask ONE next-step reasoning question about that case. If it does not, create a clearly labeled fictional exam vignette and ask ONE question. Never imply invented facts belong to a real patient.`;
  }
  return `${common}\nChoose the most educational next action. If the learner has little recorded practice, run a diagnostic question; otherwise prioritize due/weak skills. Ask exactly ONE question and wait for the learner response. Do not reveal the answer yet. End with a confidence request.`;
}

function deliveryTaskSuffix(session) {
  const delivery = actorDelivery(session.station.id);
  return `\n\nVOICE-ACTOR DELIVERY TARGET (content still governed by the hidden station profile): rate=${delivery.rate}; volume=${delivery.volume}; prosody=${delivery.prosody}; response latency target=${delivery.latencyMs}ms; interruptions=${delivery.interruptions}. Performance note: ${delivery.notes}. Do not mention these directions in the spoken reply.`;
}

function liveAdaptationSuffix(adaptation) {
  return `\n\nDYNAMIC INTERACTION STATE: cooperation=${adaptation.state.cooperation}; guardedness=${adaptation.state.guardedness}; irritation=${adaptation.state.irritation}. Adapt delivery only: ${adaptation.directive}. Never alter the hidden clinical facts, diagnosis, risk facts, medication history, investigations, or timeline because of this interaction state.`;
}

export function createAdaptivePsychiatryServer({
  bind = DEFAULT_BIND,
  port = DEFAULT_PORT,
  store = new LearnerStore(DEFAULT_STATE_DIR),
  osceStore = new OsceSessionStore(),
  voiceStore = new VoiceOsceStore(),
  liveStore = new LiveOsceStore(),
  ask = askPsychiatryBrain
} = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(String(bind).toLowerCase())) throw new Error('brain_bind_must_be_loopback');

  return http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    try {
      if (req.method === 'GET' && req.url === '/health') {
        const db = await loadStudyKnowledge();
        const state = await store.load();
        let ollamaOk = false;
        try {
          const base = validateLoopback(OLLAMA_URL);
          const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
          ollamaOk = response.ok;
        } catch {
          ollamaOk = false;
        }
        const payload = {
          service: 'osa-psychiatry-adaptive-brain',
          ok: db.files.length > 0 && ollamaOk,
          isolated: true,
          adaptiveLearning: true,
          osceRoleplay: true,
          voiceOsce: true,
          liveOsce: true,
          liveOsceTimingMinutes: { min: 7, default: 8, max: 10 },
          liveOsceViva: true,
          liveOsceMasteryAutoUpdate: true,
          dynamicActorInteraction: true,
          voiceOsceCapabilities,
          osceStations: listStations().length,
          patientNarrativesPersisted: false,
          osceTranscriptsPersisted: false,
          rawAudioPersisted: false,
          knowledgeFiles: db.files.length,
          attempts: state.attempts || 0,
          ollamaOk
        };
        res.statusCode = payload.ok ? 200 : 503;
        res.end(JSON.stringify(payload));
        return;
      }

      if (req.method === 'GET' && req.url === '/osce/stations') {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, stations: listStations() }));
        return;
      }

      if (req.method === 'POST' && req.url === '/osce/start') {
        const body = await readJson(req);
        const session = osceStore.start({ stationId: body.stationId || 'random', difficulty: body.difficulty || 'r1' });
        voiceStore.start(session.sessionId, session.station.id);
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          ...session,
          voice: {
            enabled: true,
            actorDelivery: actorDelivery(session.station.id),
            capabilities: voiceOsceCapabilities
          }
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/osce/turn') {
        const body = await readJson(req);
        const session = osceStore.appendLearner(body.sessionId, body.message);
        const task = buildActorTask(session) + deliveryTaskSuffix(session);
        const answer = await ask({ task, context: 'Fictional psychiatry OSCE simulation. Do not use or infer any real patient data.' });
        osceStore.appendActor(session.id, answer.text);
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          reply: answer.text,
          actorDelivery: actorDelivery(session.station.id),
          session: osceMetadata(osceStore.get(session.id))
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/osce/voice/turn') {
        const body = await readJson(req);
        const packet = sanitizeVoiceObservation(body);
        const session = osceStore.appendLearner(body.sessionId, packet.transcript);
        voiceStore.append(session.id, packet);
        const task = buildActorTask(session) + deliveryTaskSuffix(session);
        const answer = await ask({ task, context: 'Fictional psychiatry Voice OSCE. Acoustic measures are communication observations only and must never be used to diagnose the learner.' });
        osceStore.appendActor(session.id, answer.text);
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          reply: answer.text,
          actorDelivery: actorDelivery(session.station.id),
          learnerVoiceObservation: describeLearnerVoice(packet.observed),
          rawAudioPersisted: false,
          transcriptPersisted: false,
          session: osceMetadata(osceStore.get(session.id))
        }));
        return;
      }

      if (req.method === 'POST' && (req.url === '/osce/finish' || req.url === '/osce/voice/finish')) {
        const body = await readJson(req);
        const session = osceStore.get(body.sessionId);
        const voiceSummary = voiceStore.summary(session.id);
        const task = `${buildExaminerTask(session, body.summary || '')}\n\n${voiceExaminerContext(voiceSummary)}`;
        const answer = await ask({ task, context: 'Formative fictional psychiatry OSCE marking. Score only demonstrated performance. Voice features are communication observations, not diagnostic evidence.' });
        const finished = osceStore.finish(session.id);
        const finalVoice = voiceStore.finish(session.id);
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          station: finished.station.title,
          formative: true,
          transcriptPersisted: false,
          rawAudioPersisted: false,
          voiceCommunication: finalVoice,
          feedback: answer.text
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/osce/live/start') {
        const body = await readJson(req);
        const publicOsce = osceStore.start({ stationId: body.stationId || 'random', difficulty: body.difficulty || 'r1' });
        const osce = osceStore.get(publicOsce.sessionId);
        voiceStore.start(osce.id, osce.station.id);
        const live = liveStore.start({ osceSession: osce, durationMinutes: body.durationMinutes });
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          station: publicOsce.station,
          opening: publicOsce.station.opening,
          actorDelivery: actorDelivery(osce.station.id),
          live,
          instructions: 'Interview the actor until the bell. Then submit a concise summary to start viva.'
        }));
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/osce/live/status')) {
        const url = new URL(req.url, `http://${DEFAULT_BIND}:${DEFAULT_PORT}`);
        const liveSessionId = url.searchParams.get('sessionId');
        const live = liveStore.get(liveSessionId);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, live: liveStore.publicState(live) }));
        return;
      }

      if (req.method === 'POST' && req.url === '/osce/live/turn') {
        const body = await readJson(req);
        const live = liveStore.assertInterviewOpen(body.liveSessionId);
        let message = String(body.message || '').trim();
        let voicePacket = null;
        let liveMetrics = {};
        if (body.transcript != null) {
          voicePacket = sanitizeVoiceObservation(body);
          message = voicePacket.transcript;
          voiceStore.append(live.osceSessionId, voicePacket);
          liveMetrics = {
            wordsPerMinute: voicePacket.observed.wordsPerMinute,
            pauseRatio: voicePacket.observed.pauseRatio,
            meanResponseLatencyMs: voicePacket.observed.responseLatencyMs,
            interruptions: voicePacket.observed.interruptionCount
          };
          liveStore.recordVoiceProcess(live.id, liveMetrics);
        }
        if (!message) throw new Error('message_required');
        const osce = osceStore.appendLearner(live.osceSessionId, message);
        const adaptation = actorAdaptationDirective(live, liveMetrics);
        const task = buildActorTask(osce) + deliveryTaskSuffix(osce) + liveAdaptationSuffix(adaptation);
        const answer = await ask({ task, context: 'Full Live fictional psychiatry OSCE. Keep hidden clinical facts stable. Dynamic behavior may change only interaction style. Voice process is coaching data, never diagnostic evidence.' });
        osceStore.appendActor(osce.id, answer.text);
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          reply: answer.text,
          actorDelivery: actorDelivery(osce.station.id),
          interaction: adaptation,
          learnerVoiceObservation: voicePacket ? describeLearnerVoice(voicePacket.observed) : null,
          live: liveStore.publicState(liveStore.get(live.id)),
          rawAudioPersisted: false,
          transcriptPersisted: false
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/osce/live/close') {
        const body = await readJson(req);
        const live = liveStore.closeInterview(body.liveSessionId);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, live, bell: true }));
        return;
      }

      if (req.method === 'POST' && req.url === '/osce/live/viva/start') {
        const body = await readJson(req);
        liveStore.closeInterview(body.liveSessionId);
        const live = liveStore.get(body.liveSessionId);
        const summary = String(body.summary || '').trim();
        if (!summary) throw new Error('summary_required');
        live.candidateSummary = summary;
        const task = buildVivaQuestionTask(live);
        const answer = await ask({ task, context: 'Generate only post-station viva questions for a fictional psychiatry OSCE. No answers, no hidden-profile disclosure.' });
        const questions = parseVivaQuestions(answer.text);
        const state = liveStore.beginViva(live.id, summary, questions);
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          live: state,
          question: questions[0],
          totalQuestions: questions.length
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/osce/live/viva/answer') {
        const body = await readJson(req);
        const result = liveStore.answerViva(body.liveSessionId, body.answer);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, ...result }));
        return;
      }

      if (req.method === 'POST' && req.url === '/osce/live/finalize') {
        const body = await readJson(req);
        const live = liveStore.get(body.liveSessionId);
        if (live.stage !== 'viva') throw new Error('live_osce_viva_not_ready');
        if (live.vivaQuestions?.length && live.viva.length < live.vivaQuestions.length) throw new Error('live_osce_viva_incomplete');
        const osce = osceStore.get(live.osceSessionId);
        const baseTask = buildExaminerTask(osce, live.candidateSummary || '');
        const task = buildLiveFinalAssessmentTask(live, baseTask);
        const answer = await ask({ task, context: 'Final formative Full Live psychiatry OSCE assessment. Voice measures are communication-process observations only. Return the requested MASTERY JSON line.' });
        const allowedDomains = (osce.station.domains || []).map(canonicalDomain);
        const mastery = parseMasteryLine(answer.text, allowedDomains);
        const skill = `osce_${osce.station.id.replace(/-/g, '_')}`;
        let state = await store.load();
        for (const [domain, scorePct] of Object.entries(mastery)) {
          state = await store.record({
            domain,
            skill,
            scorePct,
            difficulty: difficultyNumber(osce.difficulty)
          });
        }
        const voiceSummary = voiceStore.summary(osce.id);
        osceStore.finish(osce.id);
        voiceStore.finish(osce.id);
        const finishedLive = liveStore.finalize(live.id);
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          station: finishedLive.station.title,
          formative: true,
          feedback: answer.text,
          masteryApplied: mastery,
          masterySummary: masterySummary(state),
          voiceCommunication: voiceSummary,
          bell: finishedLive.bell,
          transcriptPersisted: false,
          rawAudioPersisted: false
        }));
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/progress')) {
        const state = await store.load();
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          summary: masterySummary(state),
          due: dueReviews(state, new Date(), 30),
          nextDomain: pickAdaptiveDomain(state)
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/progress/attempt') {
        const body = await readJson(req);
        const state = await store.record({
          domain: body.domain,
          skill: body.skill,
          correct: body.correct,
          scorePct: body.scorePct,
          confidence: body.confidence,
          difficulty: body.difficulty,
          responseMs: body.responseMs
        });
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          summary: masterySummary(state),
          due: dueReviews(state, new Date(), 10),
          nextDomain: pickAdaptiveDomain(state)
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/study') {
        const body = await readJson(req);
        const state = await store.load();
        const task = buildStudyTask({ mode: body.mode, topic: body.topic, state });
        const answer = await ask({ task, context: body.context || '' });
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          mode: body.mode || 'adaptive',
          targetDomain: body.topic || pickAdaptiveDomain(state),
          ...answer
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/ask') {
        const body = await readJson(req);
        const answer = await ask({ task: body.task, context: body.context || '' });
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, ...answer }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    } catch (err) {
      const message = String(err?.message || err);
      const badRequest = /(?:required|invalid|not_allowed|too_long|request_too_large|not_found|turn_limit|closed|not_ready|incomplete|complete)/.test(message);
      res.statusCode = badRequest ? 400 : 500;
      res.end(JSON.stringify({ ok: false, error: message }));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAdaptivePsychiatryServer();
  server.listen(DEFAULT_PORT, DEFAULT_BIND, () => {
    process.stdout.write(JSON.stringify({
      ok: true,
      service: 'osa-psychiatry-adaptive-brain',
      bind: DEFAULT_BIND,
      port: DEFAULT_PORT,
      isolated: true,
      adaptiveLearning: true,
      osceRoleplay: true,
      voiceOsce: true,
      liveOsce: true,
      patientNarrativesPersisted: false,
      osceTranscriptsPersisted: false,
      rawAudioPersisted: false
    }) + '\n');
  });
}
