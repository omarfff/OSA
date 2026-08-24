import http from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_MODEL = process.env.OSA_BRAIN_MODEL || 'qwen3.5:0.8b';
const DEFAULT_OLLAMA_URL = process.env.OSA_OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_BIND = process.env.OSA_BRAIN_BIND || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.OSA_BRAIN_PORT || 8787);
const MAX_BODY = 64 * 1024;
const MODES = new Set(['operator', 'media', 'sales', 'diagnose']);

export function validateLoopbackUrl(raw) {
  const u = new URL(String(raw || ''));
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (u.protocol !== 'http:') throw new Error('loopback_http_required');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('loopback_only');
  if (u.username || u.password) throw new Error('credentials_not_allowed');
  return u;
}

export function systemPrompt(mode = 'operator') {
  const common = 'You are OSA Brain, a small private model running locally on the OSA VPS. Use only facts in the supplied context. Never invent revenue, customers, payments, credentials, or completed actions. Never request or reveal secrets. Never execute tools, shell commands, transfers, trades, signatures, or binding actions; you only reason and draft.';
  if (mode === 'media') return `${common} Write one concise spoken-English AI news narration, 65-105 words, factual, original, no headings, no markdown, no hype, and no facts beyond the context. End with one practical implication for AI agents, reliability, machine commerce, or payments.`;
  if (mode === 'sales') return `${common} Draft concise evidence-first B2B copy. Mention only observed evidence. No fake urgency, bulk-spam language, guarantees, or invented metrics. Plain text only.`;
  if (mode === 'diagnose') return `${common} Diagnose the provided runtime evidence. Distinguish code defects from environment/tooling faults. Give the safest reversible next action and explicitly say if human approval is required.`;
  return `${common} Act as an operations analyst. Give a short summary, the highest-value next action, the main risk, and whether owner approval is required.`;
}

function contextText(context) {
  const text = typeof context === 'string' ? context : JSON.stringify(context ?? {});
  return text.slice(0, 12000);
}

export async function askBrain({ task, context = {}, mode = 'operator', fetchImpl = fetch, ollamaUrl = DEFAULT_OLLAMA_URL, model = DEFAULT_MODEL } = {}) {
  const cleanMode = MODES.has(mode) ? mode : 'operator';
  const cleanTask = String(task || '').trim().slice(0, 3000);
  if (!cleanTask) throw new Error('task_required');
  const base = validateLoopbackUrl(ollamaUrl);
  const endpoint = new URL('/api/chat', base);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      options: { num_predict: cleanMode === 'media' ? 180 : 220, temperature: cleanMode === 'sales' ? 0.35 : 0.2, num_ctx: 4096 },
      messages: [
        { role: 'system', content: systemPrompt(cleanMode) },
        { role: 'user', content: `TASK:\n${cleanTask}\n\nCONTEXT:\n${contextText(context)}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`ollama_http_${response.status}`);
  const payload = await response.json();
  const text = String(payload?.message?.content || '').trim();
  if (!text) throw new Error('empty_model_response');
  return { text, model, mode: cleanMode };
}

async function ollamaHealth(fetchImpl = fetch, ollamaUrl = DEFAULT_OLLAMA_URL) {
  try {
    const base = validateLoopbackUrl(ollamaUrl);
    const res = await fetchImpl(new URL('/api/tags', base), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, status: res.status, modelPresent: false };
    const body = await res.json();
    const names = (body?.models || []).map((x) => String(x?.name || x?.model || ''));
    return { ok: true, status: res.status, modelPresent: names.some((x) => x === DEFAULT_MODEL || x.startsWith(`${DEFAULT_MODEL}:`)), models: names.slice(0, 10) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), modelPresent: false };
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('body_too_large'), { statusCode: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('invalid_json'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

export function createBrainServer({ bind = DEFAULT_BIND, port = DEFAULT_PORT } = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(String(bind).toLowerCase())) throw new Error('brain_bind_must_be_loopback');
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('invalid_port');
  let busy = false;
  return http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (req.method === 'GET' && req.url === '/health') {
      const health = await ollamaHealth();
      res.statusCode = health.ok && health.modelPresent ? 200 : 503;
      res.end(JSON.stringify({ ok: res.statusCode === 200, service: 'osa-brain', model: DEFAULT_MODEL, ollama: health }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/think') {
      if (busy) { res.statusCode = 429; res.end(JSON.stringify({ ok: false, error: 'brain_busy' })); return; }
      busy = true; const started = Date.now();
      try {
        const body = await readJsonBody(req);
        const answer = await askBrain({ task: body.task, context: body.context, mode: body.mode });
        res.statusCode = 200; res.end(JSON.stringify({ ok: true, ...answer, latency_ms: Date.now() - started }));
      } catch (err) {
        res.statusCode = Number(err?.statusCode || 500);
        res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
      } finally { busy = false; }
      return;
    }
    res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });
}

async function main() {
  const server = createBrainServer();
  server.listen(DEFAULT_PORT, DEFAULT_BIND, () => process.stdout.write(JSON.stringify({ ok: true, service: 'osa-brain', bind: DEFAULT_BIND, port: DEFAULT_PORT, model: DEFAULT_MODEL }) + '\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
