import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('psychiatry voice worker measures signal without identity or diagnosis',()=>{const r=spawnSync('python3',['tools/psychiatry_voice.py','--self-test'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"self_test": "passed"/);});
