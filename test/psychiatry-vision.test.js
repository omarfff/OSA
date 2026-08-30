import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('psychiatry vision worker preserves observable-only safety invariants', () => {
  const r = spawnSync('python3', ['tools/psychiatry_vision.py', '--self-test'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"self_test": "passed"/);
});
