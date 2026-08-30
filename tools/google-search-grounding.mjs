import fs from 'node:fs/promises';
import path from 'node:path';

const API_ORIGIN = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_USAGE_FILE = '/var/lib/osa-brain/google-search-usage.json';

function failure(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function enabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function usableKey(value) {
  const key = String(value || '').trim();
  return key.length >= 20 && !/^(replace|changeme|example|your[-_])/i.test(key);
}

export function googleSearchStatus(env = process.env) {
  return {
    enabled: enabled(env.OSA_GOOGLE_SEARCH_ENABLED),
    configured: usableKey(env.GEMINI_API_KEY),
    model: String(env.OSA_GOOGLE_SEARCH_MODEL || DEFAULT_MODEL),
    daily_limit: boundedInt(env.OSA_GOOGLE_SEARCH_DAILY_LIMIT, 100, 1, 5000),
  };
}

function validateModel(value) {
  const model = String(value || DEFAULT_MODEL).trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(model)) throw failure('invalid_google_search_model', 400);
  return model;
}

async function reserveUsage(file, dailyLimit, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  let state = { day, count: 0 };
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (parsed?.day === day && Number.isInteger(parsed?.count) && parsed.count >= 0) state = parsed;
  } catch (err) {
    if (err?.code !== 'ENOENT') throw failure('google_search_usage_unreadable', 500);
  }
  if (state.count >= dailyLimit) throw failure('google_search_daily_limit_reached', 429);
  const next = { day, count: state.count + 1, daily_limit: dailyLimit, updated_at: now.toISOString() };
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o750 });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
  await fs.rename(tmp, file);
  return next;
}

async function adjustUsage(file, reserved, actualQueries) {
  const extra = Math.max(0, Number(actualQueries || 1) - 1);
  if (!extra) return reserved;
  const next = { ...reserved, count: reserved.count + extra, updated_at: new Date().toISOString() };
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
  await fs.rename(tmp, file);
  return next;
}

function responseText(candidate) {
  return (candidate?.content?.parts || []).map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim();
}

function groundedSources(metadata = {}) {
  const seen = new Set(); const sources = [];
  for (const chunk of metadata?.groundingChunks || []) {
    const uri = String(chunk?.web?.uri || '').trim();
    let parsed;
    try { parsed = new URL(uri); } catch { continue; }
    if (!['http:', 'https:'].includes(parsed.protocol) || seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    sources.push({ title: String(chunk?.web?.title || parsed.hostname).trim().slice(0, 240), url: parsed.href });
    if (sources.length >= 20) break;
  }
  return sources;
}

export async function googleSearchGrounded({
  query,
  env = process.env,
  fetchImpl = fetch,
  usageFile = env.OSA_GOOGLE_SEARCH_USAGE_FILE || DEFAULT_USAGE_FILE,
  now = new Date(),
} = {}) {
  const status = googleSearchStatus(env);
  if (!status.enabled) throw failure('google_search_disabled', 503);
  if (!status.configured) throw failure('google_search_not_configured', 503);
  const cleanQuery = String(query || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleanQuery.length < 3) throw failure('research_query_required', 400);
  if (cleanQuery.length > 4000) throw failure('research_query_too_large', 413);
  const model = validateModel(status.model);
  const usage = await reserveUsage(usageFile, status.daily_limit, now);
  const endpoint = new URL(`/v1beta/models/${encodeURIComponent(model)}:generateContent`, API_ORIGIN);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': String(env.GEMINI_API_KEY).trim() },
    signal: AbortSignal.timeout(boundedInt(env.OSA_GOOGLE_SEARCH_TIMEOUT_MS, 120000, 5000, 300000)),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `Research this request using current Google Search. Answer with verifiable facts, distinguish uncertainty, and rely on the returned sources: ${cleanQuery}` }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1400 },
    }),
  });
  if (!response.ok) throw failure(`google_search_http_${response.status}`, response.status === 429 ? 429 : 502);
  const payload = await response.json();
  const candidate = payload?.candidates?.[0];
  const answer = responseText(candidate);
  if (!answer) throw failure('empty_google_search_response', 502);
  const metadata = candidate?.groundingMetadata || {};
  const searchQueries = (metadata?.webSearchQueries || []).map(String).filter(Boolean).slice(0, 10);
  const finalUsage = await adjustUsage(usageFile, usage, Math.max(1, searchQueries.length));
  return {
    answer,
    model,
    sources: groundedSources(metadata),
    search_queries: searchQueries,
    grounded: Array.isArray(metadata?.groundingChunks) && metadata.groundingChunks.length > 0,
    usage: { day: finalUsage.day, estimated_search_queries: finalUsage.count, daily_limit: finalUsage.daily_limit },
  };
}
