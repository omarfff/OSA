import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dueReviews,
  emptyLearnerState,
  masterySummary,
  pickAdaptiveDomain,
  recordAttempt,
  sanitizeAttempt
} from '../src/learning.mjs';
import { buildStudyTask } from '../src/adaptive-server.mjs';

test('records mastery without storing patient narrative fields', () => {
  const now = new Date('2026-09-08T12:00:00Z');
  const state = emptyLearnerState(now);
  const next = recordAttempt(state, {
    domain: 'mse',
    skill: 'mood_vs_affect',
    correct: true,
    confidence: 80,
    difficulty: 3,
    patientName: 'SHOULD_NOT_PERSIST',
    notes: 'SHOULD_NOT_PERSIST'
  }, now);

  assert.equal(next.attempts, 1);
  assert.equal(next.domains.mse.attempts, 1);
  assert.ok(next.domains.mse.mastery > 0);
  assert.doesNotMatch(JSON.stringify(next), /SHOULD_NOT_PERSIST/);
});

test('incorrect answer becomes due sooner than repeated correct retrieval', () => {
  const now = new Date('2026-09-08T12:00:00Z');
  let wrong = emptyLearnerState(now);
  wrong = recordAttempt(wrong, { domain: 'risk', skill: 'suicide_assessment', correct: false, confidence: 90 }, now);

  let right = emptyLearnerState(now);
  right = recordAttempt(right, { domain: 'risk', skill: 'suicide_assessment', correct: true, confidence: 80 }, now);
  right = recordAttempt(right, { domain: 'risk', skill: 'suicide_assessment', correct: true, confidence: 80 }, new Date(now.getTime() + 86_400_000));
  right = recordAttempt(right, { domain: 'risk', skill: 'suicide_assessment', correct: true, confidence: 80 }, new Date(now.getTime() + 2 * 86_400_000));

  const wrongDue = Date.parse(wrong.domains.risk.skills.suicide_assessment.nextReviewAt);
  const rightDue = Date.parse(right.domains.risk.skills.suicide_assessment.nextReviewAt);
  assert.ok(rightDue > wrongDue);
});

test('mastery summary exposes domain percentages and adaptive domain', () => {
  const now = new Date('2026-09-08T12:00:00Z');
  let state = emptyLearnerState(now);
  state = recordAttempt(state, { domain: 'mse', skill: 'appearance', correct: true }, now);
  const summary = masterySummary(state);
  assert.equal(summary.attempts, 1);
  assert.ok(summary.domains.find((x) => x.domain === 'mse').masteryPct > 0);
  assert.equal(pickAdaptiveDomain(state), 'risk');
});

test('due reviews prioritizes low mastery skills', () => {
  const now = new Date('2026-09-10T12:00:00Z');
  let state = emptyLearnerState(new Date('2026-09-08T12:00:00Z'));
  state = recordAttempt(state, { domain: 'mse', skill: 'thought_form', correct: false }, new Date('2026-09-08T12:00:00Z'));
  const due = dueReviews(state, now, 10);
  assert.equal(due[0].domain, 'mse');
  assert.equal(due[0].skill, 'thought_form');
});

test('attempt validation only accepts allowed psychiatry domains', () => {
  assert.throws(() => sanitizeAttempt({ domain: 'trading', skill: 'wallet', correct: true }), /domain_not_allowed/);
});

test('study task asks one question and uses weak domain', () => {
  const now = new Date('2026-09-08T12:00:00Z');
  const state = emptyLearnerState(now);
  const task = buildStudyTask({ mode: 'diagnostic', state, now });
  assert.match(task, /exactly ONE/i);
  assert.match(task, /mse/i);
  assert.match(task, /Confidence 0-100%/i);
});
