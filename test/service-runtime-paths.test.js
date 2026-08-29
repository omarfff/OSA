import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const [name, unit, runner] of [
  ['media','ops/systemd/osa-media-worker.service','/usr/local/lib/osa/media-worker.mjs'],
  ['telegram','ops/systemd/osa-telegram-wallet-tracker.service','/usr/local/lib/osa/telegram-wallet-tracker.mjs'],
  ['superteam','ops/systemd/osa-superteam-agent.service','/usr/local/lib/osa/superteam_agent_worker.py'],
]) {
  test(`${name} service runs from installed runtime path`, () => {
    const s = fs.readFileSync(unit, 'utf8');
    assert.match(s, new RegExp(runner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(s, /WorkingDirectory=\/opt\/osa\/gitops/);
  });
}
