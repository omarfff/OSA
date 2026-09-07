import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadPsychiatryContext, psychiatryKnowledgeRoot } from '../src/context.mjs';

test('loads psychiatry-only knowledge bundle', async () => {
  const context = await loadPsychiatryContext();
  assert.match(context, /PSYCHIATRY STUDY BRAIN/);
  assert.match(context, /DSM-5-TR/);
  assert.match(context, /Mental Status Examination/);
  assert.match(context, /Egyptian Psychiatry Fellowship/);
});

test('knowledge root is physically isolated from repository root knowledge directory', () => {
  const root = psychiatryKnowledgeRoot();
  assert.equal(path.basename(root), 'knowledge');
  assert.equal(path.basename(path.dirname(root)), 'psychiatry-brain');
});

test('commercial context is explicitly denied', async () => {
  const context = await loadPsychiatryContext();
  assert.match(context, /commercial\/revenue\/payment\/wallet\/trading\/property/);
  assert.match(context, /Cross-domain retrieval is denied|Never import, retrieve/);
});
