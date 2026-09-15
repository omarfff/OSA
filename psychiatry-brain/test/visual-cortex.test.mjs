import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyLearnerState, recordAttempt } from '../src/learning.mjs';
import {
  inferVisualLevel,
  selectVisualTarget,
  buildVisualContentTask,
  renderVisualSvg,
  generateVisualInfographic,
  listVisualInfographics,
  visualCapabilities
} from '../src/visual-cortex.mjs';

function passingAsk() {
  let calls = 0;
  return async ({ task }) => {
    calls += 1;
    if (task.includes('BUILD INFOGRAPHIC CONTENT')) {
      return { text: JSON.stringify({
        title: 'Mood vs Affect | المزاج والانفعال',
        subtitle: 'Describe what the patient reports and what you observe',
        sections: [
          { heading: 'Mood', icon: 'heart', bullets: ['Subjective emotional state reported by the patient', 'Ask directly about mood'], memoryHook: 'Mood = what they say' },
          { heading: 'Affect', icon: 'eye', bullets: ['Observed emotional expression during interview', 'Describe range and reactivity'], memoryHook: 'Affect = what you see' },
          { heading: 'Compare', icon: 'compare', bullets: ['Mood and affect may be congruent or incongruent', 'Document both separately'], memoryHook: 'Say it, then see it' },
          { heading: 'Clinical habit', icon: 'brain', bullets: ['Use neutral descriptive language', 'Do not infer unobserved findings'], memoryHook: 'Describe before diagnosing' }
        ],
        redFlags: ['Do not infer suicidality from affect alone'],
        footer: 'See it. Say it. Understand it.'
      }) };
    }
    if (task.includes('MEDICAL QA')) {
      return { text: JSON.stringify({ verdict: 'pass', accuracy: 95, levelFit: 94, clarity: 93, issues: [], reason: 'Concise and appropriate' }) };
    }
    return { text: '{}' };
  };
}

function rejectingAsk() {
  return async ({ task }) => {
    if (task.includes('BUILD INFOGRAPHIC CONTENT')) {
      return { text: JSON.stringify({
        title: 'Unsafe visual', subtitle: 'test',
        sections: [
          { heading: 'A', bullets: ['Claim one'] },
          { heading: 'B', bullets: ['Claim two'] },
          { heading: 'C', bullets: ['Claim three'] }
        ], redFlags: [], footer: 'test'
      }) };
    }
    return { text: JSON.stringify({ verdict: 'revise', accuracy: 40, levelFit: 90, clarity: 90, issues: ['Unsupported treatment claim'], reason: 'Needs correction' }) };
  };
}

test('visual level adapts to learner mastery', () => {
  let state = emptyLearnerState(new Date('2026-09-16T00:00:00Z'));
  assert.equal(inferVisualLevel(state, 'mood'), 'foundation');
  for (let i = 0; i < 10; i += 1) {
    state = recordAttempt(state, { domain: 'mood', skill: 'mdd_bipolar', scorePct: 100, difficulty: 4 }, new Date(`2026-09-${String(16 + Math.min(i, 10)).padStart(2, '0')}T00:00:00Z`));
  }
  assert.ok(['r1', 'board'].includes(inferVisualLevel(state, 'mood')));
});

test('adaptive target defaults to weakest domain and bilingual output', () => {
  const state = emptyLearnerState(new Date('2026-09-16T00:00:00Z'));
  const target = selectVisualTarget(state, {}, new Date('2026-09-16T00:00:00Z'));
  assert.equal(target.domain, 'mse');
  assert.equal(target.level, 'foundation');
  assert.equal(target.language, 'bilingual');
});

test('visual prompt blocks unsupported treatment details by default', () => {
  const target = { topic: 'MDD vs bipolar', domain: 'mood', level: 'r1', masteryPct: 45, language: 'bilingual' };
  const task = buildVisualContentTask(target, {});
  assert.match(task, /Do not include drug doses/i);
  assert.match(task, /Never invent a diagnostic criterion/i);
  assert.match(task, /STRICT JSON/i);
});

test('SVG renderer creates a real image document', () => {
  const svg = renderVisualSvg({
    title: 'Test', subtitle: 'Test visual',
    sections: [
      { heading: 'One', bullets: ['A'], memoryHook: 'one' },
      { heading: 'Two', bullets: ['B'], memoryHook: 'two' },
      { heading: 'Three', bullets: ['C'], memoryHook: 'three' }
    ], redFlags: ['Safety first'], footer: 'Learn'
  }, { level: 'foundation', masteryPct: 0 }, { accuracy: 95, levelFit: 95, clarity: 95 });
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<svg/);
  assert.match(svg, /Safety first/);
});

test('accepted visual is written privately with metadata after QA', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'visual-cortex-'));
  const state = emptyLearnerState(new Date('2026-09-16T00:00:00Z'));
  const result = await generateVisualInfographic({ topic: 'Mood vs affect', domain: 'mse' }, {
    ask: passingAsk(), state, dir, now: new Date('2026-09-16T00:00:00Z')
  });
  assert.equal(result.accepted, true);
  assert.equal(result.persisted, true);
  assert.equal(result.metadata.externalImageApiRequired, false);
  assert.equal(result.metadata.patientDataUsed, false);
  const saved = await readFile(path.join(dir, `${result.metadata.id}.svg`), 'utf8');
  assert.match(saved, /Mood vs Affect/);
  const rows = await listVisualInfographics(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qaScore, 94);
});

test('failed medical QA is never persisted', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'visual-cortex-reject-'));
  const state = emptyLearnerState();
  const result = await generateVisualInfographic({ topic: 'Unsafe topic', domain: 'mood' }, { ask: rejectingAsk(), state, dir });
  assert.equal(result.accepted, false);
  assert.equal(result.persisted, false);
  const rows = await listVisualInfographics(dir);
  assert.equal(rows.length, 0);
});

test('capabilities declare local drawing without an image API', () => {
  assert.equal(visualCapabilities.localSvgRendering, true);
  assert.equal(visualCapabilities.externalImageApiRequired, false);
  assert.equal(visualCapabilities.medicalQaBeforePersistence, true);
});
