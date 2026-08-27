import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizePlan, validateBrainUrl } from '../tools/osa-brain-operator.mjs';

test('brain operator accepts loopback only', () => {
  assert.equal(validateBrainUrl('http://127.0.0.1:8787').hostname, '127.0.0.1');
  assert.throws(() => validateBrainUrl('https://example.com'), /brain_loopback_required/);
  assert.throws(() => validateBrainUrl('http://127.0.0.1:8787/secret'), /invalid_brain_url/);
});

test('brain operator output records bounded non-binding authority', () => {
  const plan = normalizePlan({ ok: true, text: 'Draft the next evidence-first offer.', model: 'local', latency_ms: 10 });
  assert.equal(plan.binding_actions, false);
  assert.equal(plan.authority, 'analysis_and_drafts_only');
  assert.match(plan.plan, /evidence-first/);
});

test('brain operator systemd unit is hardened and local', () => {
  const unit = fs.readFileSync('ops/systemd/osa-brain-operator.service', 'utf8');
  assert.match(unit, /127\.0\.0\.1:8787/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /ReadWritePaths=\/var\/lib\/osa-brain-operator/);
  assert.doesNotMatch(unit, /\/opt\/osa\/gitops/);
});
