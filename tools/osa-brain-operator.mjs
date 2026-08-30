import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BRAIN_URL = process.env.OSA_BRAIN_URL || 'http://127.0.0.1:8787';
const STATE_DIR = process.env.OSA_BRAIN_OPERATOR_STATE || '/var/lib/osa-brain-operator';
const AUTOPILOT_STATUS = process.env.OSA_AUTOPILOT_STATUS || '/var/lib/osa-autopilot/status.json';
const MAX_INPUT_BYTES = 64 * 1024;
const BRAIN_TIMEOUT_MS = 300_000;

export function validateBrainUrl(raw = BRAIN_URL) {
  const url = new URL(String(raw));
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('brain_loopback_required');
  if (url.username || url.password || (url.pathname && url.pathname !== '/')) throw new Error('invalid_brain_url');
  return url;
}

async function readJson(file) {
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_INPUT_BYTES) return { unavailable: 'file_too_large' };
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    return { unavailable: err?.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
}

function boundedText(value, max = 12000) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

export function normalizePlan(payload = {}) {
  if (!payload?.ok || typeof payload?.text !== 'string') throw new Error('invalid_brain_response');
  const text = boundedText(payload.text);
  if (!text) throw new Error('empty_brain_plan');
  return {
    at: new Date().toISOString(),
    state: 'planned',
    mode: 'operator',
    model: boundedText(payload.model, 120),
    plan: text,
    memory_sources: Array.isArray(payload.memory_sources) ? payload.memory_sources.map((x) => boundedText(x, 160)).filter(Boolean).slice(0, 20) : [],
    experience_sources: Array.isArray(payload.experience_sources) ? payload.experience_sources.map((x) => boundedText(x, 160)).filter(Boolean).slice(0, 20) : [],
    latency_ms: Number.isFinite(Number(payload.latency_ms)) ? Number(payload.latency_ms) : null,
    authority: 'analysis_and_drafts_only',
    binding_actions: false,
  };
}

export async function runBrainOperator({ fetchImpl = fetch, now = new Date() } = {}) {
  const brain = validateBrainUrl();
  const context = {
    observed_at: now.toISOString(),
    watchdog: await readJson(AUTOPILOT_STATUS),
    authority: {
      allowed: ['analyze verified state', 'prioritize safe reversible work', 'draft copy', 'identify evidence gaps'],
      forbidden: ['execute shell commands', 'submit external forms', 'publish content', 'move funds', 'sign transactions', 'handle secrets', 'bypass access controls'],
    },
  };
  const response = await fetchImpl(new URL('/v1/think', brain), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(BRAIN_TIMEOUT_MS),
    body: JSON.stringify({
      mode: 'operator',
      task: 'Review the verified OSA runtime state. Produce the single highest-value safe reversible next action toward verified external revenue, followed by the evidence needed to verify completion. Do not invent live leads, payments, defects, or completed actions. Do not request approval unless the action is binding or sensitive.',
      context,
    }),
  });
  if (!response.ok) throw new Error(`brain_http_${response.status}`);
  const plan = normalizePlan(await response.json());
  await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = path.join(STATE_DIR, 'latest.json.tmp');
  const dst = path.join(STATE_DIR, 'latest.json');
  await fs.writeFile(tmp, JSON.stringify(plan, null, 2), { mode: 0o600 });
  await fs.rename(tmp, dst);
  await fs.appendFile(path.join(STATE_DIR, 'history.jsonl'), JSON.stringify(plan) + '\n', { mode: 0o600 });
  return plan;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try { process.stdout.write(JSON.stringify(await runBrainOperator()) + '\n'); }
  catch (err) { process.stderr.write(JSON.stringify({ ok: false, error: String(err?.message || err) }) + '\n'); process.exitCode = 1; }
}
