import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecision, evaluateDecision } from '../tools/revenue-gate.mjs';

function check(text) { return evaluateDecision(parseDecision(text)); }

const direct = `Work-Type: revenue-action
Revenue-Impact: direct
External-Evidence: named buyer replied and requested checkout
Why-Now: next step can produce payment
Kill-Criteria: stop after buyer declines or pays
Risk-Exception: none`;

test('direct revenue action with evidence passes', () => {
  assert.equal(check(direct).ok, true);
});

test('pre-payment infrastructure with no revenue impact is parked', () => {
  const r = check(`Work-Type: infrastructure
Revenue-Impact: none
External-Evidence: none
Why-Now: improve architecture
Kill-Criteria: when complete
Risk-Exception: none`);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /parked/);
});

test('claimed blocker without external evidence fails', () => {
  const r = check(`Work-Type: direct-blocker
Revenue-Impact: blocker
External-Evidence: none
Why-Now: needed for sale
Kill-Criteria: fix one defect
Risk-Exception: none`);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /external-evidence/);
});

test('real security incident can pass without revenue impact', () => {
  const r = check(`Work-Type: safety-incident
Revenue-Impact: none
External-Evidence: production secret exposure alert INC-42
Why-Now: active credential risk
Kill-Criteria: rotate and verify exposure closed
Risk-Exception: security-incident`);
  assert.equal(r.ok, true);
});

test('missing kill criteria fails', () => {
  const r = check(direct.replace('Kill-Criteria: stop after buyer declines or pays', 'Kill-Criteria:'));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /kill-criteria/);
});
