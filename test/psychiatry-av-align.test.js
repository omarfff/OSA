import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('psychiatry AV aligner fails closed and emits candidate attribution only', () => {
  const r=spawnSync('python3',['tools/psychiatry_av_align.py','--self-test'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"self_test": "passed"/);
});
