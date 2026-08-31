import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { googleSearchGrounded, googleSearchStatus } from '../tools/google-search-grounding.mjs';

test('Google grounding is disabled and secret-free by default', () => {
  const status = googleSearchStatus({});
  assert.equal(status.enabled, false);
  assert.equal(status.configured, false);
  assert.equal(JSON.stringify(status).includes('api'), false);
});

test('Google grounding uses the official tool and returns sources without putting the key in the URL', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osa-google-'));
  let seenUrl; let seen;
  const key = 'test-google-key-that-is-long-enough';
  const fakeFetch = async (url, options) => {
    seenUrl = String(url); seen = options;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Grounded answer' }] }, groundingMetadata: { webSearchQueries: ['current fact', 'official source'], groundingChunks: [{ web: { title: 'Official source', uri: 'https://example.com/fact' } }] } }] }) };
  };
  try {
    const out = await googleSearchGrounded({
      query: 'What changed today?', fetchImpl: fakeFetch, usageFile: path.join(dir, 'usage.json'),
      env: { OSA_GOOGLE_SEARCH_ENABLED: 'true', GEMINI_API_KEY: key, OSA_GOOGLE_SEARCH_DAILY_LIMIT: '2' },
    });
    assert.equal(seenUrl.includes(key), false);
    assert.equal(seen.headers['x-goog-api-key'], key);
    assert.deepEqual(JSON.parse(seen.body).tools, [{ google_search: {} }]);
    assert.equal(out.answer, 'Grounded answer');
    assert.deepEqual(out.sources, [{ title: 'Official source', url: 'https://example.com/fact' }]);
    assert.equal(out.grounded, true);
    assert.equal(out.usage.estimated_search_queries, 2);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('Google grounding enforces a persistent daily cost limit', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osa-google-'));
  const usageFile = path.join(dir, 'usage.json');
  const env = { OSA_GOOGLE_SEARCH_ENABLED: 'true', GEMINI_API_KEY: 'test-google-key-that-is-long-enough', OSA_GOOGLE_SEARCH_DAILY_LIMIT: '1' };
  const fakeFetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'One' }] }, groundingMetadata: {} }] }) });
  try {
    await googleSearchGrounded({ query: 'first query', env, fetchImpl: fakeFetch, usageFile });
    await assert.rejects(() => googleSearchGrounded({ query: 'second query', env, fetchImpl: fakeFetch, usageFile }), /daily_limit_reached/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('quota exhaustion falls back to bounded web results and Gemini synthesis', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osa-google-'));
  const calls = [];
  const html = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fbounty">Official bounty</a><a class="result__snippet">Reward is USD 500 &amp; applications are open.</a></div>`;
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return { ok: false, status: 429 };
    if (String(url).includes('duckduckgo.com')) return { ok: true, status: 200, text: async () => html };
    if (String(url).includes('news.google.com')) return { ok: true, status: 200, text: async () => '<rss><channel></channel></rss>' };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'The bounty is open [1].' }] } }] }) };
  };
  try {
    const out = await googleSearchGrounded({
      query: 'Find an open bounty', fetchImpl: fakeFetch, usageFile: path.join(dir, 'usage.json'),
      env: { OSA_GOOGLE_SEARCH_ENABLED: 'true', GEMINI_API_KEY: 'test-google-key-that-is-long-enough' },
    });
    assert.equal(out.answer, 'The bounty is open [1].');
    assert.equal(out.provider, 'web-search+gemini');
    assert.equal(out.source_backed, true);
    assert.equal(out.grounded, false);
    assert.deepEqual(out.sources, [{ title: 'Official bounty', url: 'https://example.com/bounty' }]);
    const synthesis = JSON.parse(calls.at(-1).options.body);
    assert.equal(synthesis.tools, undefined);
    assert.match(synthesis.contents[0].parts[0].text, /untrusted data/i);
    assert.match(synthesis.contents[0].parts[0].text, /https:\/\/example\.com\/bounty/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('web fallback can be explicitly disabled', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osa-google-'));
  try {
    await assert.rejects(() => googleSearchGrounded({
      query: 'Do not fall back', usageFile: path.join(dir, 'usage.json'),
      env: { OSA_GOOGLE_SEARCH_ENABLED: 'true', OSA_WEB_SEARCH_FALLBACK_ENABLED: 'false', GEMINI_API_KEY: 'test-google-key-that-is-long-enough' },
      fetchImpl: async () => ({ ok: false, status: 429 }),
    }), /google_search_http_429/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
