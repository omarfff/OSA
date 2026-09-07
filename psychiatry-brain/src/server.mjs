import http from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const DEFAULT_KNOWLEDGE_DIR = process.env.PSYCHIATRY_BRAIN_KNOWLEDGE_DIR || path.join(ROOT, 'knowledge');
const DEFAULT_BIND = process.env.PSYCHIATRY_BRAIN_BIND || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.PSYCHIATRY_BRAIN_PORT || 8791);
const DEFAULT_MODEL = process.env.PSYCHIATRY_BRAIN_MODEL || 'qwen3.5:0.8b';
const OLLAMA_URL = process.env.PSYCHIATRY_OLLAMA_URL || 'http://127.0.0.1:11434';
const MAX_BODY = 64 * 1024;
const MAX_CONTEXT = 4500;
const CHUNK_SIZE = 1050;

const SYSTEM_PROMPT = `You are Psychiatry Study Brain, a private local educational AI for a psychiatry resident/fellow. This service is strictly isolated from OSA commercial, revenue, payments, wallets, trading, property, bounties, sales, procurement, and infrastructure knowledge. Never request or retrieve those domains. Use only the psychiatry study knowledge supplied in this service, the current user task, and current psychiatry context.

TASK DISCIPLINE — HIGHEST PRIORITY:
- Answer the exact task that was asked. Do not automatically expand into a full curriculum template.
- If the user asks for a definition or comparison, answer only that definition/comparison unless more detail is requested.
- Honor requested length and format. If asked for two concise lines, return two concise lines.
- NEVER create a fictional patient, age, history, symptoms, diagnosis, risk level, treatment plan, differential, mini-case, or examination finding unless the task explicitly asks for a case/example or actual case data are supplied in CURRENT PSYCHIATRY CONTEXT.
- Absence of a fact is not evidence that it is negative. Do not say suicide/violence risk is low, moderate, or high unless case data sufficient for that assessment are provided.
- If retrieved notes contain examples unrelated to the task, ignore those examples.
- If a factual criterion, duration, dose, interaction, or guideline point is uncertain or not grounded in the supplied study knowledge, state that it needs verification rather than inventing it.

Primary goals: Egyptian Psychiatry Fellowship/Board study, first-year residency competence, PCE/SCFHS psychiatry preparation, later Prometric/equivalency-style revision, and relevant Arab Board preparation. Teaching should be video-first when resources are discussed, high-yield, structured, minimal-reading, and bilingual Arabic/English when helpful. Use DSM-5-TR terminology when appropriate and distinguish it from older terminology.

Clinical reasoning rules: never invent history, MSE findings, risk negatives, physical findings, investigations, diagnoses, medication doses, or treatment response. Separate observed/reported facts from inference. For real or explicitly requested clinical cases, prioritize suicide/self-harm risk, violence, delirium, intoxication/withdrawal, catatonia, severe agitation, medical mimics, medication toxicity, and safeguarding. Missing high-risk data must be labeled not documented. Real patient care remains under local policy and senior supervision.

Documentation rules: when converting Arabic/Egyptian-Arabic notes to English, preserve meaning exactly, use professional psychiatric terminology, structure clearly, and mark unclear or absent information rather than guessing. For audio/video descriptions, describe observable speech, prosody, psychomotor and behavior features first; then give cautious possible significance and alternatives. Never diagnose from voice, face, accent, or demographic traits alone.

Exam rules: emphasize clinical pattern recognition, differential diagnosis, why the correct answer is correct, why the closest alternative is wrong, duration/impairment criteria, medication adverse effects/monitoring, risk, and exam traps when the user is actually asking an exam/case question. Never treat obsolete question-bank terminology as current truth without labeling it.

R&D rules: distinguish an idea from a validated tool or patentable invention. For psychiatry AI/device ideas, discuss clinical problem, measurable signal, safety, validation, ethics/regulatory burden, prior art, and clinician-in-the-loop needs.`;

let cache = { dir: null, chunks: [], files: [], loadedAt: 0 };

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function terms(text) {
  return new Set(normalize(text).split(/\s+/).filter((x) => x.length >= 2));
}

function chunkFile(name, text) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (!clean) return [];
  const out = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);
    if (end < clean.length) {
      const nl = clean.lastIndexOf('\n', end);
      if (nl > start + Math.floor(CHUNK_SIZE * 0.55)) end = nl;
    }
    out.push({ source: name, text: clean.slice(start, end).trim() });
    start = end;
    while (start < clean.length && /\s/.test(clean[start])) start += 1;
  }
  return out;
}

export async function loadStudyKnowledge(knowledgeDir = DEFAULT_KNOWLEDGE_DIR, { force = false } = {}) {
  const dir = path.resolve(knowledgeDir);
  if (!force && cache.dir === dir && cache.chunks.length) return cache;
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const chunks = [];
  const files = [];
  for (const entry of entries) {
    const text = await readFile(path.join(dir, entry.name), 'utf8');
    files.push(entry.name);
    chunks.push(...chunkFile(entry.name, text));
  }
  cache = { dir, chunks, files, loadedAt: Date.now() };
  return cache;
}

export async function retrieveStudyKnowledge(query, { knowledgeDir = DEFAULT_KNOWLEDGE_DIR, topK = 5, maxChars = MAX_CONTEXT } = {}) {
  const db = await loadStudyKnowledge(knowledgeDir);
  const q = terms(query);
  const scored = db.chunks.map((chunk, index) => {
    const c = terms(chunk.text);
    let overlap = 0;
    for (const t of q) if (c.has(t)) overlap += 1;
    const queryNorm = normalize(query);
    const phraseBonus = queryNorm && normalize(chunk.text).includes(queryNorm.slice(0, 80)) ? 3 : 0;
    return { ...chunk, index, score: overlap + phraseBonus };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const chosen = [];
  let used = 0;
  for (const item of scored) {
    if (chosen.length >= topK) break;
    if (item.score <= 0 && chosen.length >= 2) break;
    const rendered = `[${item.source}]\n${item.text}`;
    if (used + rendered.length > maxChars && chosen.length) continue;
    chosen.push(rendered);
    used += rendered.length;
  }
  return {
    text: chosen.join('\n\n---\n\n'),
    sources: [...new Set(chosen.map((x) => x.match(/^\[([^\]]+)\]/)?.[1]).filter(Boolean))]
  };
}

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

function caseWasRequested(task, context) {
  const corpus = `${task}\n${typeof context === 'string' ? context : JSON.stringify(context ?? {})}`;
  return /\b(patient|case|vignette|scenario|example|mini-case)\b|مريض|مريضة|حالة|سيناريو|مثال/i.test(corpus);
}

export function responseViolations({ task, context = '', text }) {
  const violations = [];
  const answer = String(text || '');
  const taskText = String(task || '');

  if (!caseWasRequested(taskText, context)) {
    if (/\b(?:the patient presents|the patient reports|patient presents with|a \d{1,3}[- ]year[- ]old|mini-case|working diagnosis)\b/i.test(answer)) {
      violations.push('invented_case');
    }
    if (/\b(?:suicide|violence) risk\s*:\s*(?:high|moderate|medium|low)\b/i.test(answer)) {
      violations.push('invented_risk_level');
    }
  }

  const asksTwoLines = /(?:two|2)\s+(?:concise\s+)?lines|سطرين/i.test(taskText);
  if (asksTwoLines) {
    const nonEmptyLines = answer.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    if (nonEmptyLines.length > 3 || answer.length > 650) violations.push('length_scope_drift');
  }

  return [...new Set(violations)];
}

function buildUserMessage(cleanTask, retrieval, runtimeContext, repair = false) {
  const repairRule = repair
    ? '\nREPAIR MODE: The previous candidate violated the task boundary. Start over. Do not mention or reconstruct any patient/case unless the TASK explicitly contains one. Obey the requested length exactly.'
    : '';
  return `TASK — ANSWER THIS EXACTLY:\n${cleanTask}${repairRule}\n\nRELEVANT PSYCHIATRY STUDY KNOWLEDGE (facts only; ignore unrelated examples):\n${retrieval.text || '(none retrieved)'}\n\nCURRENT PSYCHIATRY CONTEXT:\n${runtimeContext || '(none)'}\n\nFINAL RESPONSE CONTRACT:\n1. Answer only the TASK.\n2. Do not create missing clinical facts.\n3. Do not add a case, diagnosis, risk assessment, differential, or treatment plan unless requested.\n4. If uncertain, say what needs verification.\n5. Follow the requested length/format.`;
}

export async function askPsychiatryBrain({ task, context = '', fetchImpl = fetch, knowledgeDir = DEFAULT_KNOWLEDGE_DIR, model = DEFAULT_MODEL } = {}) {
  const cleanTask = String(task || '').trim();
  if (!cleanTask) throw new Error('task_required');
  const runtimeContext = typeof context === 'string' ? context : JSON.stringify(context ?? {});
  const retrieval = await retrieveStudyKnowledge(`${cleanTask}\n${runtimeContext}`, { knowledgeDir });
  const base = validateLoopback(OLLAMA_URL);

  const infer = async (repair = false) => {
    const response = await fetchImpl(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        options: { num_predict: 450, temperature: 0.05, num_ctx: 4096 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(cleanTask, retrieval, runtimeContext, repair) }
        ]
      }),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) throw new Error(`ollama_http_${response.status}`);
    const body = await response.json();
    const text = String(body?.message?.content || '').trim();
    if (!text) throw new Error('empty_model_response');
    return text;
  };

  let text = await infer(false);
  let violations = responseViolations({ task: cleanTask, context: runtimeContext, text });
  let repaired = false;
  if (violations.length) {
    text = await infer(true);
    repaired = true;
    violations = responseViolations({ task: cleanTask, context: runtimeContext, text });
  }
  if (violations.length) {
    throw new Error(`unsafe_scope_drift:${violations.join(',')}`);
  }

  return { text, model, sources: retrieval.sources, scope_repaired: repaired };
}

async function health() {
  try {
    const db = await loadStudyKnowledge();
    const base = validateLoopback(OLLAMA_URL);
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const body = res.ok ? await res.json() : {};
    const names = (body?.models || []).map((x) => String(x?.name || x?.model || ''));
    const modelPresent = names.some((x) => x === DEFAULT_MODEL || x.startsWith(`${DEFAULT_MODEL}:`));
    return {
      ok: res.ok && modelPresent && db.files.length > 0,
      model: DEFAULT_MODEL,
      modelPresent,
      knowledgeFiles: db.files.length,
      chunks: db.chunks.length,
      isolated: true,
      scopeGuard: true
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), isolated: true, scopeGuard: true };
  }
}

export function createPsychiatryBrainServer({ bind = DEFAULT_BIND, port = DEFAULT_PORT } = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(String(bind).toLowerCase())) throw new Error('brain_bind_must_be_loopback');
  return http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (req.method === 'GET' && req.url === '/health') {
      const status = await health();
      res.statusCode = status.ok ? 200 : 503;
      res.end(JSON.stringify({ service: 'osa-psychiatry-brain', ...status }));
      return;
    }
    if (req.method === 'POST' && req.url === '/ask') {
      try {
        const body = await readJson(req);
        const answer = await askPsychiatryBrain({ task: body.task, context: body.context });
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, ...answer }));
      } catch (err) {
        const message = String(err?.message || err);
        res.statusCode = message === 'task_required' ? 400 : message.startsWith('unsafe_scope_drift:') ? 422 : 500;
        res.end(JSON.stringify({ ok: false, error: message }));
      }
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPsychiatryBrainServer();
  server.listen(DEFAULT_PORT, DEFAULT_BIND, () => {
    process.stdout.write(JSON.stringify({ ok: true, service: 'osa-psychiatry-brain', bind: DEFAULT_BIND, port: DEFAULT_PORT, model: DEFAULT_MODEL, isolated: true, scopeGuard: true }) + '\n');
  });
}
