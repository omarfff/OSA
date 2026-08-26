import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSuperteamOutput, runContinuity, sanitizeListing, validateLocalBrainUrl } from '../tools/local-continuity.mjs';

test('continuity brain URL is loopback-only', () => {
  assert.equal(validateLocalBrainUrl('http://127.0.0.1:8787').hostname, '127.0.0.1');
  assert.throws(() => validateLocalBrainUrl('https://127.0.0.1:8787'), /loopback_http_required/);
  assert.throws(() => validateLocalBrainUrl('http://example.com:8787'), /loopback_only/);
});

test('superteam parser keeps only non-sensitive public listing fields', () => {
  const parsed = parseSuperteamOutput(JSON.stringify({
    ok: true,
    current_count: 1,
    listings: [{ id: 'a', title: 'Build X', deadline: '2099-01-01', agentAccess: 'AGENT_ALLOWED', secret: 'must-not-survive' }],
  }));
  assert.equal(parsed.current_count, 1);
  assert.equal(parsed.listings[0].title, 'Build X');
  assert.equal('secret' in parsed.listings[0], false);
  assert.deepEqual(sanitizeListing({ slug: 'x', token: 'hidden' }), { slug: 'x' });
});

test('continuity writes grounded local report without treating Brain as proof', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'osa-cont-'));
  const wd = path.join(dir, 'watchdog.json');
  await fsp.writeFile(wd, JSON.stringify({ at: '2026-08-26T00:00:00Z', services: { brain: 'active' }, warnings: [], actions: [] }));
  try {
    const report = await runContinuity(Date.parse('2026-08-26T01:00:00Z'), {
      stateDir: dir,
      watchdogPath: wd,
      runSuperteam: async () => ({ ok: true, current_count: 0, listings: [] }),
      think: async () => ({ text: 'Continue safe local work.', model: 'fake', grounding_repaired: false, grounding_unsupported: [], latency_ms: 1 }),
    });
    assert.equal(report.codex_required, false);
    assert.equal(report.brain_advice_is_execution_proof, false);
    assert.equal(report.context.superteam.current_count, 0);
    assert.equal(report.brain.text, 'Continue safe local work.');
    const saved = JSON.parse(await fsp.readFile(path.join(dir, 'continuity.json'), 'utf8'));
    assert.equal(saved.mode, 'local_continuity');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('continuity systemd unit is local and hardened', () => {
  const unit = fs.readFileSync('ops/systemd/osa-local-continuity.service', 'utf8');
  const timer = fs.readFileSync('ops/systemd/osa-local-continuity.timer', 'utf8');
  assert.match(unit, /127\.0\.0\.1:8787/);
  assert.match(unit, /NoNewPrivileges=yes/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /\/usr\/local\/lib\/osa\/local-continuity\.mjs/);
  assert.match(timer, /OnUnitActiveSec=15min/);
});

test('installer verifies live Brain and timer state', () => {
  const install = fs.readFileSync('ops/install-local-continuity.sh', 'utf8');
  assert.match(install, /127\.0\.0\.1:8787\/health/);
  assert.match(install, /systemctl enable --now osa-local-continuity\.timer/);
  assert.match(install, /test -s \/var\/lib\/osa-continuity\/continuity\.json/);
});

test('continuity tolerates transient Brain busy/error without killing the timer run', () => {
  const source = fs.readFileSync('tools/local-continuity.mjs', 'utf8');
  const unit = fs.readFileSync('ops/systemd/osa-local-continuity.service', 'utf8');
  assert.doesNotMatch(source, /report\.errors\.length.*exitCode/);
  assert.match(source, /AbortSignal\.timeout\(135000\)/);
  assert.match(unit, /TimeoutStartSec=180/);
});
