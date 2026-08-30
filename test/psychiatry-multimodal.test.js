import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('psychiatry multimodal fusion requires repeated candidate alignment and never diagnoses',()=>{const r=spawnSync('python3',['tools/psychiatry_multimodal.py','--self-test'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"self_test": "passed"/);});
