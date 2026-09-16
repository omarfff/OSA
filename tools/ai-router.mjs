#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

function clean(value, max = 4000) {
  return String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);
}

function outputLimit(env, fallback = 400) {
  const n = Number(env.OSA_AI_MAX_OUTPUT_TOKENS || fallback);
  return Math.max(64, Math.min(Number.isFinite(n) ? Math.trunc(n) : fallback, 8192));
}

function parseOrder(raw) {
  const allowed = new Set(['ollama', 'openai_compatible', 'gemini']);
  const order = String(raw || 'ollama,openai_compatible,gemini').split(',').map((x) => x.trim()).filter((x) => allowed.has(x));
  return [...new Set(order.length ? order : ['ollama'])];
}

function validateOllamaUrl(raw) {
  const u = new URL(raw || 'http://127.0.0.1:11434');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('ollama_must_be_loopback_http');
  if (u.username || u.password) throw new Error('ollama_credentials_in_url_rejected');
  return u;
}

function validateRemoteBase(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:') throw new Error('remote_ai_https_required');
  if (u.username || u.password) throw new Error('remote_credentials_in_url_rejected');
  return u;
}

export function providerStatus(env = process.env) {
  const rows = {
    ollama: {
      configured: Boolean(env.OSA_OLLAMA_URL || env.OSA_BRAIN_MODEL || true),
      model: clean(env.OSA_BRAIN_MODEL || 'qwen3.5:0.8b', 200),
      endpoint: clean(env.OSA_OLLAMA_URL || 'http://127.0.0.1:11434', 300),
    },
    openai_compatible: {
      configured: Boolean(env.OSA_AI_REMOTE_URL && env.OSA_AI_REMOTE_MODEL && env.OSA_AI_REMOTE_API_KEY),
      model: clean(env.OSA_AI_REMOTE_MODEL || '', 200),
      endpoint: clean(env.OSA_AI_REMOTE_URL || '', 300),
      api_key_present: Boolean(env.OSA_AI_REMOTE_API_KEY),
    },
    gemini: {
      configured: Boolean(env.OSA_GEMINI_API_KEY && env.OSA_GEMINI_MODEL),
      model: clean(env.OSA_GEMINI_MODEL || '', 200),
      api_key_present: Boolean(env.OSA_GEMINI_API_KEY),
    },
  };
  return { order: parseOrder(env.OSA_AI_PROVIDER_ORDER), providers: rows };
}

async function callOllama({ messages, fetchImpl, env, signal }) {
  const base = validateOllamaUrl(env.OSA_OLLAMA_URL || 'http://127.0.0.1:11434');
  const endpoint = new URL('/api/chat', base);
  const model = clean(env.OSA_BRAIN_MODEL || 'qwen3.5:0.8b', 200);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({ model, stream: false, think: false, messages, options: { temperature: 0.15, num_predict: outputLimit(env, 320) } }),
  });
  if (!response.ok) throw new Error(`ollama_http_${response.status}`);
  const payload = await response.json();
  const text = clean(payload?.message?.content || '', 12000);
  if (!text) throw new Error('ollama_empty_response');
  return { provider: 'ollama', model, text };
}

async function callOpenAICompatible({ messages, fetchImpl, env, signal }) {
  if (!env.OSA_AI_REMOTE_URL || !env.OSA_AI_REMOTE_MODEL || !env.OSA_AI_REMOTE_API_KEY) throw new Error('openai_compatible_not_configured');
  const base = validateRemoteBase(env.OSA_AI_REMOTE_URL);
  const endpoint = new URL('/v1/chat/completions', base);
  const model = clean(env.OSA_AI_REMOTE_MODEL, 200);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OSA_AI_REMOTE_API_KEY}`,
    },
    signal,
    body: JSON.stringify({ model, messages, temperature: 0.15, max_tokens: outputLimit(env, 400) }),
  });
  if (!response.ok) throw new Error(`openai_compatible_http_${response.status}`);
  const payload = await response.json();
  const text = clean(payload?.choices?.[0]?.message?.content || '', 12000);
  if (!text) throw new Error('openai_compatible_empty_response');
  return { provider: 'openai_compatible', model, text };
}

async function callGemini({ messages, fetchImpl, env, signal }) {
  if (!env.OSA_GEMINI_API_KEY || !env.OSA_GEMINI_MODEL) throw new Error('gemini_not_configured');
  const model = clean(env.OSA_GEMINI_MODEL, 200);
  const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`);
  endpoint.searchParams.set('key', env.OSA_GEMINI_API_KEY);
  const system = messages.filter((m) => m.role === 'system').map((m) => clean(m.content, 8000)).join('\n\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: clean(m.content, 12000) }],
  }));
  const body = { contents, generationConfig: { temperature: 0.15, maxOutputTokens: outputLimit(env, 400) } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`gemini_http_${response.status}`);
  const payload = await response.json();
  const text = clean(payload?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join(' ') || '', 12000);
  if (!text) throw new Error('gemini_empty_response');
  return { provider: 'gemini', model, text };
}

export async function routeChat({ messages, fetchImpl = fetch, env = process.env, timeoutMs = 60000 } = {}) {
  if (!Array.isArray(messages) || !messages.length) throw new Error('messages_required');
  const normalized = messages.slice(-20).map((m) => ({ role: ['system', 'user', 'assistant'].includes(m?.role) ? m.role : 'user', content: clean(m?.content, 12000) })).filter((m) => m.content);
  if (!normalized.length) throw new Error('nonempty_messages_required');
  const status = providerStatus(env);
  const failures = [];
  for (const provider of status.order) {
    const configured = status.providers[provider]?.configured;
    if (!configured) { failures.push({ provider, error: 'not_configured' }); continue; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('ai_provider_timeout')), Math.max(1000, Math.min(Number(timeoutMs) || 60000, 180000)));
    try {
      let result;
      if (provider === 'ollama') result = await callOllama({ messages: normalized, fetchImpl, env, signal: controller.signal });
      else if (provider === 'openai_compatible') result = await callOpenAICompatible({ messages: normalized, fetchImpl, env, signal: controller.signal });
      else result = await callGemini({ messages: normalized, fetchImpl, env, signal: controller.signal });
      clearTimeout(timer);
      return { ok: true, ...result, failures };
    } catch (err) {
      clearTimeout(timer);
      failures.push({ provider, error: String(err?.message || err).slice(0, 240) });
    }
  }
  return { ok: false, error: 'all_ai_providers_failed', failures };
}

async function main() {
  const [cmd = 'status', ...rest] = process.argv.slice(2);
  if (cmd === 'status') {
    console.log(JSON.stringify({ ok: true, ...providerStatus() }, null, 2));
    return;
  }
  if (cmd === 'ask') {
    const prompt = clean(rest.join(' '), 12000);
    if (!prompt) throw new Error('prompt_required');
    const result = await routeChat({ messages: [
      { role: 'system', content: 'You are an OSA support model. Be concise, factual, and never invent runtime state, payments, credentials, or completed actions.' },
      { role: 'user', content: prompt },
    ] });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  throw new Error('usage: ai-router.mjs [status|ask <prompt>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    process.exitCode = 1;
  });
}
