import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { envHasBotToken } from '../tools/autopilot-watchdog.mjs';

test('telegram token detector rejects placeholders and accepts real values', () => {
  assert.equal(envHasBotToken('TELEGRAM_BOT_TOKEN=<unset>'), false);
  assert.equal(envHasBotToken('TELEGRAM_BOT_TOKEN='), false);
  assert.equal(envHasBotToken('TELEGRAM_BOT_TOKEN="123456:abcDEF"'), true);
});

test('autopilot systemd unit uses isolated installed runtime path', () => {
  const unit = fs.readFileSync('ops/systemd/osa-autopilot-watchdog.service', 'utf8');
  assert.match(unit, /\/usr\/local\/lib\/osa\/autopilot-watchdog\.mjs/);
  assert.doesNotMatch(unit, /\/opt\/osa\/gitops/);
  assert.match(unit, /ProtectSystem=strict/);
});


test('autopilot monitors local Ollama and OSA Brain services', () => {
  const code = fs.readFileSync('tools/autopilot-watchdog.mjs', 'utf8');
  assert.match(code, /ollama\.service/);
  assert.match(code, /osa-brain\.service/);
  assert.match(code, /127\.0\.0\.1:8787/);
});
