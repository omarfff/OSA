import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { askBrain, createBrainServer, systemPrompt, validateLoopbackUrl } from '../tools/osa-brain.mjs';

test('brain only accepts loopback Ollama URLs', () => {
  assert.equal(validateLoopbackUrl('http://127.0.0.1:11434').hostname, '127.0.0.1');
  assert.throws(() => validateLoopbackUrl('https://127.0.0.1:11434'), /loopback_http_required/);
  assert.throws(() => validateLoopbackUrl('http://example.com:11434'), /loopback_only/);
  assert.throws(() => validateLoopbackUrl('http://u:p@127.0.0.1:11434'), /credentials_not_allowed/);
});

test('brain system prompt forbids direct high-risk execution', () => {
  const p = systemPrompt('operator');
  assert.match(p, /Never execute tools, shell commands, transfers, trades, signatures/);
  assert.match(systemPrompt('media'), /65-105 words/);
});

test('askBrain sends bounded local inference request', async () => {
  let seen;
  const fakeFetch = async (_url, opts) => {
    seen = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ message: { content: 'READY' } }) };
  };
  const out = await askBrain({ task: 'health', context: { a: 1 }, fetchImpl: fakeFetch });
  assert.equal(out.text, 'READY');
  assert.equal(seen.think, false);
  assert.equal(seen.options.num_ctx, 4096);
});

test('brain server refuses public bind and unit uses isolated runtime', () => {
  assert.throws(() => createBrainServer({ bind: '0.0.0.0', port: 8787 }), /loopback/);
  const unit = fs.readFileSync('ops/systemd/osa-brain.service', 'utf8');
  assert.match(unit, /127\.0\.0\.1|brain\.env/);
  assert.match(unit, /\/usr\/local\/lib\/osa\/osa-brain\.mjs/);
  assert.doesNotMatch(unit, /\/opt\/osa\/gitops/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.doesNotMatch(unit, /MemoryDenyWriteExecute=true/);
});
