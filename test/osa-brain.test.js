import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { askBrain, createBrainServer, knowledgeStatus, retrieveKnowledge, systemPrompt, validateLoopbackUrl } from '../tools/osa-brain.mjs';

test('brain only accepts loopback Ollama URLs', () => {
  assert.equal(validateLoopbackUrl('http://127.0.0.1:11434').hostname, '127.0.0.1');
  assert.throws(() => validateLoopbackUrl('https://127.0.0.1:11434'), /loopback_http_required/);
  assert.throws(() => validateLoopbackUrl('http://example.com:11434'), /loopback_only/);
  assert.throws(() => validateLoopbackUrl('http://u:p@127.0.0.1:11434'), /credentials_not_allowed/);
});

test('brain system prompt forbids direct high-risk execution', () => {
  const p = systemPrompt('operator');
  assert.match(p, /Never execute tools, shell commands, transfers, trades, signatures/);
  assert.match(p, /newer verified runtime evidence always overrides/);
  assert.match(systemPrompt('media'), /65-105 words/);
});

test('askBrain sends bounded local inference request', async () => {
  let seen;
  const fakeFetch = async (_url, opts) => { seen = JSON.parse(opts.body); return { ok: true, json: async () => ({ message: { content: 'READY' } }) }; };
  const out = await askBrain({ task: 'health', context: { a: 1 }, fetchImpl: fakeFetch, knowledgeDir: '/path/that/does/not/exist' });
  assert.equal(out.text, 'READY'); assert.equal(seen.think, false); assert.equal(seen.options.num_ctx, 4096);
  assert.match(seen.messages[1].content, /PERSISTENT OSA MEMORY/);
});

test('persistent knowledge retrieves relevant OSA memory', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'osa-kb-'));
  try {
    await fsp.writeFile(path.join(dir, 'payments.md'), '# Payments\nx402 mainnet requires a verified receiving address and production facilitator.');
    await fsp.writeFile(path.join(dir, 'media.md'), '# Media\nMedia worker makes vertical videos from RSS.');
    const hit = await retrieveKnowledge('What blocks x402 production payments?', { knowledgeDir: dir, topK: 2 });
    assert.match(hit.text, /verified receiving address/); assert.ok(hit.sources.includes('payments.md'));
    const status = await knowledgeStatus(dir); assert.equal(status.ok, true); assert.equal(status.files, 2); assert.ok(status.chunks >= 2);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('askBrain injects memory and keeps runtime context separate', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'osa-kb-'));
  try {
    await fsp.writeFile(path.join(dir, 'ops.md'), '# Revenue truth\nVerified revenue is zero until settlement evidence exists.');
    let seen; const fakeFetch = async (_url, opts) => { seen = JSON.parse(opts.body); return { ok: true, json: async () => ({ message: { content: 'OK' } }) }; };
    const out = await askBrain({ task: 'revenue truth', context: { runtime: 'payment pending' }, knowledgeDir: dir, fetchImpl: fakeFetch });
    const user = seen.messages[1].content;
    assert.match(user, /PERSISTENT OSA MEMORY/); assert.match(user, /settlement evidence/); assert.match(user, /VERIFIED\/RUNTIME CONTEXT/); assert.ok(out.memory_sources.includes('ops.md'));
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('brain server refuses public bind and unit uses isolated runtime', () => {
  assert.throws(() => createBrainServer({ bind: '0.0.0.0', port: 8787 }), /loopback/);
  const unit = fs.readFileSync('ops/systemd/osa-brain.service', 'utf8');
  assert.match(unit, /127\.0\.0\.1|brain\.env/); assert.match(unit, /\/usr\/local\/lib\/osa\/osa-brain\.mjs/); assert.doesNotMatch(unit, /\/opt\/osa\/gitops/); assert.match(unit, /ProtectSystem=strict/); assert.doesNotMatch(unit, /MemoryDenyWriteExecute=true/);
});

test('repository knowledge pack has coverage and no obvious credential material', async () => {
  const names = fs.readdirSync('knowledge').filter((x) => x.endsWith('.md'));
  assert.ok(names.length >= 9);
  const text = names.map((x) => fs.readFileSync(path.join('knowledge', x), 'utf8')).join('\n');
  assert.match(text, /Agent Trust Oracle/); assert.match(text, /x402/); assert.match(text, /Lead Recovery Sprint/); assert.match(text, /Ollama/);
  assert.doesNotMatch(text, /-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----/); assert.doesNotMatch(text, /\b(?:ghp_|github_pat_|sk-[A-Za-z0-9]{20})/); assert.doesNotMatch(text, /\bSA\d{22}\b/);
  const hit = await retrieveKnowledge('why canonical git edits disappear', { knowledgeDir: 'knowledge', topK: 3 });
  assert.match(hit.text, /GitOps/);
});

test('brain installer restarts an already-running service after updating runtime or memory', () => {
  const installer = fs.readFileSync('ops/install-brain.sh', 'utf8');
  assert.match(installer, /systemctl restart osa-brain\.service/);
});

test('experience memory records and retrieves verified owner feedback', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const fsp = await import('node:fs/promises');
  const { appendExperience, retrieveExperiences, experienceStatus, normalizeExperience } = await import('../tools/osa-brain.mjs');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'osa-exp-'));
  const file = path.join(dir, 'experiences.jsonl');
  await appendExperience({ kind: 'owner_feedback', summary: 'Prefer execution over manual website steps', evidence: 'Owner explicitly requested autonomous execution', lesson: 'Use connected tools first', tags: ['autonomy','owner'] }, { experienceFile: file });
  const got = await retrieveExperiences('autonomy execution website', { experienceFile: file });
  assert.match(got.text, /Prefer execution over manual website steps/);
  assert.equal((await experienceStatus(file)).count, 1);
  assert.throws(() => normalizeExperience({ kind: 'owner_feedback', summary: 'key sk-abcdefghijklmnop' }), /sensitive_material_rejected/);
});

test('brain installer deploys experience ledger and learning CLI', () => {
  const install = fs.readFileSync('ops/install-brain.sh', 'utf8');
  assert.match(install, /experiences\.jsonl/);
  assert.match(install, /osa-brain-learn\.mjs/);
  assert.match(install, /OSA_BRAIN_EXPERIENCE_FILE/);
});

test('watchdog writes only verified remediation events into experience memory', () => {
  const watchdog = fs.readFileSync('tools/autopilot-watchdog.mjs', 'utf8');
  assert.match(watchdog, /runtime_lesson/);
  assert.match(watchdog, /report\.actions\.length/);
  assert.match(watchdog, /EXPERIENCE_FILE/);
});

test('grounding guard detects invented operational identifiers', async () => {
  const { unsupportedOperationalIdentifiers } = await import('../tools/osa-brain.mjs');
  assert.deepEqual(unsupportedOperationalIdentifiers('Run `osa_fix_unverified_buyer_logic` now', 'safe reversible task'), ['osa_fix_unverified_buyer_logic']);
  assert.deepEqual(unsupportedOperationalIdentifiers('Use `osa-brain.service`', 'verified service osa-brain.service is active'), []);
});

test('askBrain repairs a draft that invents an unsupported script name', async () => {
  let calls = 0;
  const fakeFetch = async (_url, opts) => {
    calls += 1;
    const body = JSON.parse(opts.body);
    assert.equal(body.think, false);
    if (calls === 1) return { ok: true, json: async () => ({ message: { content: 'Run `osa_fix_unverified_buyer_logic` now.' } }) };
    return { ok: true, json: async () => ({ message: { content: 'Execute the safe reversible task automatically, verify it, record the outcome, and escalate only if it becomes sensitive or binding.' } }) };
  };
  const { askBrain } = await import('../tools/osa-brain.mjs');
  const out = await askBrain({ task: 'How should a safe reversible task be handled?', context: { verified_runtime: 'No binding approval is needed.' }, fetchImpl: fakeFetch, knowledgeDir: new URL('../knowledge', import.meta.url).pathname });
  assert.equal(calls, 2);
  assert.equal(out.grounding_repaired, true);
  assert.doesNotMatch(out.text, /osa_fix_unverified_buyer_logic/);
});

test('brain installer waits for real HTTP readiness after restart', () => {
  const install = fs.readFileSync('ops/install-brain.sh', 'utf8');
  assert.match(install, /readiness check failed/);
  assert.match(install, /127\.0\.0\.1:\$\{PORT\}\/health/);
  assert.match(install, /for _ in \$\(seq 1 30\)/);
});
