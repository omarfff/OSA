import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askPsychiatryBrain, loadStudyKnowledge } from './server.mjs';
import { LearnerStore, dueReviews, masterySummary, pickAdaptiveDomain } from './learning.mjs';
import { OsceSessionStore, buildActorTask, buildExaminerTask, listStations, osceMetadata } from './osce.mjs';

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

export function createAdaptivePsychiatryServer({
  bind = DEFAULT_BIND,
  port = DEFAULT_PORT,
  store = new LearnerStore(DEFAULT_STATE_DIR),
  osceStore = new OsceSessionStore(),
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
          osceStations: listStations().length,
          patientNarrativesPersisted: false,
          osceTranscriptsPersisted: false,
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
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, ...session }));
        return;
      }

      if (req.method === 'POST' && req.url === '/osce/turn') {
        const body = await readJson(req);
        const session = osceStore.appendLearner(body.sessionId, body.message);
        const task = buildActorTask(session);
        const answer = await ask({ task, context: 'Fictional psychiatry OSCE simulation. Do not use or infer any real patient data.' });
        osceStore.appendActor(session.id, answer.text);
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          reply: answer.text,
          session: osceMetadata(osceStore.get(session.id))
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/osce/finish') {
        const body = await readJson(req);
        const session = osceStore.get(body.sessionId);
        const task = buildExaminerTask(session, body.summary || '');
        const answer = await ask({ task, context: 'Formative fictional psychiatry OSCE marking. Score only demonstrated performance.' });
        const finished = osceStore.finish(session.id);
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          station: finished.station.title,
          formative: true,
          transcriptPersisted: false,
          feedback: answer.text
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
      const badRequest = /(?:required|invalid|not_allowed|too_long|request_too_large|not_found|turn_limit)/.test(message);
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
      patientNarrativesPersisted: false,
      osceTranscriptsPersisted: false
    }) + '\n');
  });
}
