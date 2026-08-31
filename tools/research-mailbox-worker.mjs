import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_SUPABASE_TIMEOUT_MS = 30_000;
const DEFAULT_BRAIN_TIMEOUT_MS = 240_000;

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function validateSupabaseUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('supabase_https_required');
  if (url.username || url.password) throw new Error('supabase_credentials_in_url');
  if (!/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)) throw new Error('invalid_supabase_host');
  url.pathname = '/'; url.search = ''; url.hash = '';
  return url;
}

export function validateBrainUrl(value) {
  const url = new URL(String(value || 'http://127.0.0.1:8787'));
  if (url.protocol !== 'http:' || !['127.0.0.1', '::1', 'localhost'].includes(url.hostname.toLowerCase())) throw new Error('brain_loopback_only');
  if (url.username || url.password) throw new Error('brain_credentials_not_allowed');
  return url;
}

export function workerConfig(env = process.env) {
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (key.length < 20 || /\s/.test(key)) throw new Error('supabase_publishable_key_required');
  const workerId = String(env.OSA_RESEARCH_WORKER_ID || `${os.hostname()}:research`).trim();
  if (!/^[a-zA-Z0-9:._-]{3,100}$/.test(workerId)) throw new Error('invalid_worker_id');
  return {
    supabaseUrl: validateSupabaseUrl(env.SUPABASE_URL),
    publishableKey: key,
    brainUrl: validateBrainUrl(env.OSA_BRAIN_URL || 'http://127.0.0.1:8787'),
    tokenFile: String(env.OSA_RESEARCH_WORKER_TOKEN_FILE || '/etc/osa/research-worker.token'),
    workerId,
    pollMs: boundedInt(env.OSA_RESEARCH_POLL_MS, 15_000, 5_000, 300_000),
    supabaseTimeoutMs: boundedInt(env.OSA_RESEARCH_SUPABASE_TIMEOUT_MS, DEFAULT_SUPABASE_TIMEOUT_MS, 5_000, 120_000),
    brainTimeoutMs: boundedInt(env.OSA_RESEARCH_BRAIN_TIMEOUT_MS, DEFAULT_BRAIN_TIMEOUT_MS, 30_000, 300_000),
  };
}

export async function readWorkerToken(file) {
  const token = String(await fs.readFile(file, 'utf8')).trim();
  if (token.length < 48 || /\s/.test(token)) throw new Error('invalid_worker_token');
  return token;
}

function supabaseHeaders(config, token) {
  return {
    apikey: config.publishableKey,
    authorization: `Bearer ${config.publishableKey}`,
    'content-type': 'application/json',
    'x-osa-worker-token': token,
  };
}

function safeSources(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(); const sources = [];
  for (const item of value) {
    let url;
    try {
      const parsed = new URL(String(item?.url || ''));
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      url = parsed.href;
    } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url); sources.push({ title: String(item?.title || new URL(url).hostname).slice(0, 240), url });
    if (sources.length >= 20) break;
  }
  return sources;
}

export function normalizeResearchResult(value = {}) {
  return {
    answer: String(value?.answer || '').slice(0, 50_000),
    sources: safeSources(value?.sources),
    search_queries: Array.isArray(value?.search_queries) ? value.search_queries.map(String).map((x) => x.slice(0, 500)).slice(0, 10) : [],
    provider: String(value?.provider || '').slice(0, 100),
    model: String(value?.model || '').slice(0, 100),
    grounded: Boolean(value?.grounded),
    source_backed: Boolean(value?.source_backed),
    usage: value?.usage && typeof value.usage === 'object' && !Array.isArray(value.usage) ? value.usage : {},
  };
}

async function rpc(config, token, name, body, fetchImpl) {
  const endpoint = new URL(`/rest/v1/rpc/${name}`, config.supabaseUrl);
  const response = await fetchImpl(endpoint, {
    method: 'POST', headers: supabaseHeaders(config, token),
    body: JSON.stringify(body), signal: AbortSignal.timeout(config.supabaseTimeoutMs),
  });
  if (!response.ok) throw new Error(`supabase_${name}_http_${response.status}`);
  return response.status === 204 ? null : response.json();
}

export async function claimResearchJob(config, token, fetchImpl = fetch) {
  const rows = await rpc(config, token, 'osa_claim_research_job', { p_worker_id: config.workerId }, fetchImpl);
  const job = Array.isArray(rows) ? rows[0] : rows;
  if (!job?.id) return null;
  const query = String(job.query || '').trim();
  if (query.length < 3 || query.length > 4000) throw new Error('claimed_query_invalid');
  return { id: String(job.id), query };
}

async function askBrain(config, query, fetchImpl) {
  const endpoint = new URL('/v1/research', config.brainUrl);
  const response = await fetchImpl(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(config.brainTimeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) throw new Error(String(body?.error || `brain_http_${response.status}`).slice(0, 300));
  return normalizeResearchResult(body);
}

export async function finishResearchJob(config, token, jobId, success, result, fetchImpl = fetch) {
  const payload = success ? normalizeResearchResult(result) : { error: String(result?.error || result || 'research_failed').slice(0, 2000) };
  return rpc(config, token, 'osa_finish_research_job', {
    p_job_id: jobId, p_worker_id: config.workerId, p_success: Boolean(success), p_result: payload,
  }, fetchImpl);
}

export async function runOne(config, token, fetchImpl = fetch) {
  const job = await claimResearchJob(config, token, fetchImpl);
  if (!job) return { processed: false };
  try {
    const result = await askBrain(config, job.query, fetchImpl);
    await finishResearchJob(config, token, job.id, true, result, fetchImpl);
    return { processed: true, id: job.id, success: true, source_count: result.sources.length, provider: result.provider };
  } catch (err) {
    const error = String(err?.message || err).slice(0, 2000);
    try { await finishResearchJob(config, token, job.id, false, { error }, fetchImpl); } catch {}
    return { processed: true, id: job.id, success: false, error };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runLoop(env = process.env, deps = {}) {
  const config = workerConfig(env);
  const token = await readWorkerToken(config.tokenFile);
  const fetchImpl = deps.fetchImpl || fetch;
  for (;;) {
    try {
      const result = await runOne(config, token, fetchImpl);
      if (result.processed) process.stdout.write(`${JSON.stringify(result)}\n`);
      else await sleep(config.pollMs);
    } catch (err) {
      process.stderr.write(`${JSON.stringify({ ok: false, error: String(err?.message || err).slice(0, 300) })}\n`);
      await sleep(Math.max(config.pollMs, 15_000));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) await runLoop();
