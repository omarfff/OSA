import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyLearnerState } from '../src/learning.mjs';
import { createTrainingPsychiatryServer } from '../src/training-server.mjs';

function visualAsk() {
  return async ({ task }) => {
    if (task.includes('BUILD INFOGRAPHIC CONTENT')) {
      return { text: JSON.stringify({
        title: 'MSE Essentials | أساسيات فحص الحالة العقلية',
        subtitle: 'See it → describe it → interpret carefully',
        sections: [
          { heading: 'Appearance', bullets: ['Describe grooming and behaviour'], memoryHook: 'See first' },
          { heading: 'Speech', bullets: ['Rate, volume, quantity and spontaneity'], memoryHook: 'Hear next' },
          { heading: 'Mood & Affect', bullets: ['Mood is reported; affect is observed'], memoryHook: 'Say vs see' },
          { heading: 'Thought', bullets: ['Separate form from content'], memoryHook: 'How vs what' }
        ],
        redFlags: ['Always assess risk separately'],
        footer: 'Same structure. Different patients.'
      }) };
    }
    if (task.includes('MEDICAL QA')) {
      return { text: JSON.stringify({ verdict: 'pass', accuracy: 96, levelFit: 96, clarity: 96, issues: [], reason: 'Appropriate foundation visual' }) };
    }
    return { text: 'stub' };
  };
}

async function withServer(fn) {
  const visualDir = await mkdtemp(path.join(os.tmpdir(), 'visual-api-'));
  const visualStore = { load: async () => emptyLearnerState(new Date('2026-09-16T00:00:00Z')) };
  const server = createTrainingPsychiatryServer({ bind: '127.0.0.1', port: 0, ask: visualAsk(), visualDir, visualStore, caseDir: visualDir });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); await once(server, 'close'); }
}

async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

test('visual capabilities expose local renderer and learner adaptation', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/visuals/capabilities`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.localSvgRendering, true);
    assert.equal(body.externalImageApiRequired, false);
    assert.equal(body.masteryDriven, true);
  });
});

test('server generates, lists and serves an accepted SVG infographic', async () => {
  await withServer(async (base) => {
    const generated = await post(base, '/visuals/generate', { topic: 'MSE basics', domain: 'mse', level: 'foundation' });
    assert.equal(generated.response.status, 200);
    assert.equal(generated.body.accepted, true);
    assert.equal(generated.body.metadata.format, 'svg');
    const id = generated.body.metadata.id;

    const listResponse = await fetch(`${base}/visuals/list?limit=5`);
    const list = await listResponse.json();
    assert.equal(list.count, 1);
    assert.equal(list.visuals[0].id, id);

    const image = await fetch(`${base}/visuals/view?id=${encodeURIComponent(id)}`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await image.text(), /<svg/);
  });
});
