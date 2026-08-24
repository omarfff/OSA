import test from 'node:test';
import assert from 'node:assert/strict';
import { addWallet, createEmptyState, isValidSolanaAddress, parseCommand, removeWallet } from '../tools/telegram-wallet-tracker.mjs';

test('validates Solana public keys without a dependency', () => {
  assert.equal(isValidSolanaAddress('11111111111111111111111111111111'), true);
  assert.equal(isValidSolanaAddress('abc'), false);
  assert.equal(isValidSolanaAddress('0'.repeat(32)), false);
});

test('tracks and removes wallets idempotently', () => {
  const state = createEmptyState();
  const addr = '11111111111111111111111111111111';
  assert.deepEqual(addWallet(state, 42, addr, 'system'), { ok: true });
  assert.deepEqual(addWallet(state, 42, addr, 'system'), { ok: true, duplicate: true });
  assert.equal(state.chats['42'].wallets.length, 1);
  assert.deepEqual(removeWallet(state, 42, addr), { ok: true });
  assert.deepEqual(removeWallet(state, 42, addr), { ok: false });
});

test('parses Telegram commands safely', () => {
  assert.deepEqual(parseCommand('/track@osa_bot 11111111111111111111111111111111 whale'), {
    command: '/track', args: ['11111111111111111111111111111111', 'whale']
  });
});
