import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeResearchResult, runOne, validateBrainUrl, validateSupabaseUrl, workerConfig } from '../tools/research-mailbox-worker.mjs';

const config = workerConfig({
  SUPABASE_URL: 'https://project-ref.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key_long_enough',
  OSA_BRAIN_URL: 'http://127.0.0.1:8787',
  OSA_RESEARCH_WORKER_ID: 'test:worker',
});

test('research worker restricts Supabase and Brain endpoints', () => {
  assert.equal(validateSupabaseUrl('https://abc.supabase.co').hostname, 'abc.supabase.co');
  assert.throws(() => validateSupabaseUrl('http://abc.supabase.co'), /https_required/);
  assert.throws(() => validateSupabaseUrl('https://example.com'), /invalid_supabase_host/);
  assert.equal(validateBrainUrl('http://127.0.0.1:8787').hostname, '127.0.0.1');
  assert.throws(() => validateBrainUrl('https://example.com'), /loopback_only/);
});

test('research result keeps bounded public evidence only', () => {
  const out = normalizeResearchResult({
    answer: 'Answer', provider: 'web-search+gemini', model: 'gemini', source_backed: true,
    sources: [{ title: 'One', url: 'https://example.com/a', secret: 'drop' }, { url: 'file:///etc/passwd' }],
    search_queries: ['query'], usage: { day: '2026-08-31' }, secret: 'drop',
  });
  assert.equal(out.sources.length, 1);
  assert.deepEqual(out.sources[0], { title: 'One', url: 'https://example.com/a' });
  assert.equal('secret' in out, false);
});

test('worker claims, researches locally, and stores result without sending token to Brain', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('osa_claim_research_job')) return { ok: true, status: 200, json: async () => ([{ id: '11111111-1111-4111-8111-111111111111', query: 'Find a paid task' }]) };
    if (String(url).includes('/v1/research')) return { ok: true, status: 200, json: async () => ({ ok: true, answer: 'Found [1].', provider: 'web-search+gemini', source_backed: true, sources: [{ title: 'Task', url: 'https://example.com/task' }] }) };
    if (String(url).includes('osa_finish_research_job')) return { ok: true, status: 200, json: async () => true };
    throw new Error('unexpected_url');
  };
  const out = await runOne(config, 'worker-token-that-is-long-enough-for-tests-1234567890', fetchImpl);
  assert.equal(out.success, true);
  assert.equal(out.source_count, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers['x-osa-worker-token'].startsWith('worker-token'), true);
  assert.equal('x-osa-worker-token' in calls[1].options.headers, false);
  const finished = JSON.parse(calls[2].options.body);
  assert.equal(finished.p_result.answer, 'Found [1].');
});

test('research mailbox unit and installer are hardened and secret-free', () => {
  const unit = fs.readFileSync('ops/systemd/osa-research-mailbox.service', 'utf8');
  const install = fs.readFileSync('ops/install-research-mailbox.sh', 'utf8');
  const sql = fs.readFileSync('ops/sql/create-research-mailbox.sql', 'utf8');
  assert.match(unit, /User=osa-brain/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /NoNewPrivileges=yes/);
  assert.match(install, /chmod 0640/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /security invoker/gi);
  assert.match(sql, /for update skip locked/i);
  assert.doesNotMatch(sql, /service_role[_-]?key/i);
});

test('daily opportunity scan is deduplicated and source-verification focused', () => {
  const sql = fs.readFileSync('ops/sql/schedule-research-mailbox.sql', 'utf8');
  assert.match(sql, /osa-daily-paid-opportunity-scan/);
  assert.match(sql, /on conflict \(dedupe_key\)/i);
  assert.match(sql, /official direct task URL/i);
  assert.match(sql, /No sufficiently verified task found today/);
  assert.match(sql, /revoke all .*service_role/i);
});
