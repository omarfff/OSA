import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeKey = `0x${'11'.repeat(32)}`;
const fakeRegistry = '0x0000000000000000000000000000000000000001';

function run(script, extraEnv = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ARBITRUM_RPC_URL: 'https://example.invalid',
      ARBITRUM_DEPLOYER_PRIVATE_KEY: fakeKey,
      ARBITRUM_CONFIRM_TESTNET_TX: '',
      ...extraEnv
    }
  });
}

test('deployment script refuses to transact without explicit testnet authorization', () => {
  const result = run('scripts/arbitrum-deploy.mjs');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ARBITRUM_CONFIRM_TESTNET_TX=YES/);
});

test('receipt script refuses to transact without explicit testnet authorization', () => {
  const result = run('scripts/arbitrum-record.mjs', { OSA_ARBITRUM_REGISTRY: fakeRegistry });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ARBITRUM_CONFIRM_TESTNET_TX=YES/);
});
