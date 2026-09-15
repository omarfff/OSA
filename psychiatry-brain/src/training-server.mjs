import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askPsychiatryBrain } from './server.mjs';
import { createAdaptivePsychiatryServer } from './adaptive-server.mjs';
import { LearnerStore } from './learning.mjs';
import { generateEvidenceReasoningBundle } from './evidence-reasoning.mjs';
import { generateDocumentationLabBundle } from './documentation-lab-v2.mjs';
import { generateConsultantChallenge, generateConsultantFeedback } from './consultant-mode.mjs';
import { caseCorpusStats, generateUnknownPublishedCase, revealPublishedCase } from './case-corpus.mjs';
import { generateVisualInfographic, listVisualInfographics, readVisualSvg, visualCapabilities } from './visual-cortex.mjs';

const DEFAULT_BIND = process.env.PSYCHIATRY_BRAIN_BIND || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.PSYCHIATRY_BRAIN_PORT || 8791);
const DEFAULT_STATE_DIR = process.env.PSYCHIATRY_BRAIN_STATE_DIR || '/var/lib/osa-psychiatry-brain';
const DEFAULT_CASE_DIR = process.env.PSYCHIATRY_CASE_CORPUS_DIR || '/var/lib/osa-psychiatry-cases';
const DEFAULT_VISUAL_DIR = process.env.PSYCHIATRY_VISUAL_DIR || path.join(DEFAULT_STATE_DIR, 'visuals');
const MAX_TRAINING_BODY = 220 * 1024;

async function readJson(req, maxBody = MAX_TRAINING_BODY) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > maxBody) throw new Error('request_too_large');
    parts.push(part);
  }
  if (!parts.length) return {};
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

function statusForError(err) {
  const message = String(err?.message || err);
  if (/_(required|invalid|too_long|too_large)$/.test(message) || message === 'too_many_evidence_sources' || message === 'request_too_large') return 400;
  if (message === 'case_not_found' || message === 'case_corpus_no_match' || err?.code === 'ENOENT') return 404;
  if (message.startsWith('unsafe_scope_drift:')) return 422;
  return 500;
}

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export const trainingCapabilities = Object.freeze({
  evidenceBasedReasoning: true,
  evidenceInput: 'structured_source_excerpts',
  hiddenChainOfThoughtExposed: false,
  documentationFormulationLab: true,
  documentationLongSourceChunking: true,
  documentationFormats: ['full_psychiatric', 'soap', 'board_case'],
  consultantMode: true,
  consultantDifficulty: ['r1', 'board', 'consultant'],
  globalPublishedCaseCorpus: true,
  globalCaseCorpusSource: 'Europe PMC open-access case reports',
  globalCaseCorpusInitialTarget: 1000,
  unknownCaseMode: true,
  publishedCaseDebrief: true,
  visualCortex: true,
  visualCortexRenderer: 'local_svg',
  visualCortexDailyAdaptiveGeneration: true,
  visualCortexMedicalQa: true,
  visualCortexExternalImageApiRequired: false,
  sourceHierarchy: ['regulatory', 'guideline', 'local_protocol', 'systematic_review', 'primary_study', 'textbook', 'other'],
  rawAudioPersisted: false,
  caseTextPersisted: false,
  evidenceTextPersisted: false,
  generatedNotesPersisted: false,
  consultantTranscriptsPersisted: false,
  unknownCaseVignettesPersisted: false,
  visualPatientDataUsed: false,
  externalNetworkRetrievalInsideVps: false,
  caseHarvesterNetworkSeparatedFromBrain: true,
  retrievalContract: 'ChatGPT/client retrieves current authorized evidence and sends bounded source excerpts; isolated VPS reasons over supplied evidence.'
});

export function createTrainingPsychiatryServer({
  bind = DEFAULT_BIND,
  port = DEFAULT_PORT,
  ask = askPsychiatryBrain,
  caseDir = DEFAULT_CASE_DIR,
  visualDir = DEFAULT_VISUAL_DIR,
  visualStore = new LearnerStore(DEFAULT_STATE_DIR)
} = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(String(bind).toLowerCase())) throw new Error('brain_bind_must_be_loopback');

  const adaptive = createAdaptivePsychiatryServer({ bind, port, ask });
  const [adaptiveHandler] = adaptive.listeners('request');
  if (typeof adaptiveHandler !== 'function') throw new Error('adaptive_handler_missing');

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/training/capabilities') {
        send(res, 200, { ok: true, isolated: true, ...trainingCapabilities, visualCapabilities });
        return;
      }

      if (req.method === 'GET' && req.url === '/visuals/capabilities') {
        send(res, 200, { ok: true, ...visualCapabilities, renderer: 'local_svg', storage: 'private_local_state' });
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/visuals/list')) {
        const url = new URL(req.url, `http://${DEFAULT_BIND}:${DEFAULT_PORT}`);
        const limit = Number(url.searchParams.get('limit') || 30);
        const visuals = await listVisualInfographics(visualDir, limit);
        send(res, 200, { ok: true, count: visuals.length, visuals });
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/visuals/view')) {
        const url = new URL(req.url, `http://${DEFAULT_BIND}:${DEFAULT_PORT}`);
        const id = url.searchParams.get('id') || '';
        const svg = await readVisualSvg(id, visualDir);
        res.statusCode = 200;
        res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
        res.setHeader('cache-control', 'private, max-age=300');
        res.end(svg);
        return;
      }

      if (req.method === 'POST' && req.url === '/visuals/generate') {
        const body = await readJson(req);
        const state = await visualStore.load();
        const result = await generateVisualInfographic(body, { ask, state, dir: visualDir });
        send(res, 200, { ok: true, ...result });
        return;
      }

      if (req.method === 'GET' && req.url === '/cases/corpus/stats') {
        const stats = await caseCorpusStats(caseDir);
        send(res, 200, { ok: true, ...stats });
        return;
      }

      if (req.method === 'POST' && req.url === '/cases/random') {
        const body = await readJson(req);
        const result = await generateUnknownPublishedCase(body, { ask, caseDir });
        send(res, 200, { ok: true, ...result });
        return;
      }

      if (req.method === 'POST' && req.url === '/cases/reveal') {
        const body = await readJson(req);
        const result = await revealPublishedCase(body, { ask, caseDir });
        send(res, 200, { ok: true, ...result });
        return;
      }

      if (req.method === 'POST' && req.url === '/reasoning/evidence') {
        const body = await readJson(req);
        const bundle = await generateEvidenceReasoningBundle(body, { ask });
        send(res, 200, { ok: true, ...bundle });
        return;
      }

      if (req.method === 'POST' && req.url === '/documentation/formulate') {
        const body = await readJson(req);
        const bundle = await generateDocumentationLabBundle(body, { ask });
        send(res, 200, { ok: true, ...bundle });
        return;
      }

      if (req.method === 'POST' && req.url === '/consultant/challenge') {
        const body = await readJson(req);
        const result = await generateConsultantChallenge(body, { ask });
        send(res, 200, { ok: true, ...result });
        return;
      }

      if (req.method === 'POST' && req.url === '/consultant/feedback') {
        const body = await readJson(req);
        const result = await generateConsultantFeedback(body, { ask });
        send(res, 200, { ok: true, ...result });
        return;
      }

      await adaptiveHandler(req, res);
    } catch (err) {
      send(res, statusForError(err), { ok: false, error: String(err?.message || err) });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createTrainingPsychiatryServer();
  server.listen(DEFAULT_PORT, DEFAULT_BIND, () => {
    process.stdout.write(JSON.stringify({
      ok: true,
      service: 'osa-psychiatry-training-brain',
      bind: DEFAULT_BIND,
      port: DEFAULT_PORT,
      isolated: true,
      evidenceBasedReasoning: true,
      documentationFormulationLab: true,
      consultantMode: true,
      globalPublishedCaseCorpus: true,
      unknownCaseMode: true,
      visualCortex: true,
      visualRenderer: 'local_svg'
    }) + '\n');
  });
}
