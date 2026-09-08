import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeDocumentSimulationRequest,
  splitDocumentText,
  selectCoverageChunks,
  buildQuestionBatchTask,
  generateDocumentSimulationBundle
} from '../src/document-simulation.mjs';

test('document request defaults to 10 board-level SBA questions and validates format', () => {
  const req = sanitizeDocumentSimulationRequest({ sourceText: 'A'.repeat(800) });
  assert.equal(req.questionCount, 10);
  assert.equal(req.difficulty, 'board');
  assert.equal(req.format, 'sba');
  assert.equal(req.language, 'bilingual');
  assert.throws(() => sanitizeDocumentSimulationRequest({ sourceText: 'abc', format: 'essay' }), /format_invalid/);
});

test('document chunking preserves broad source coverage', () => {
  const text = Array.from({ length: 15 }, (_, i) => `SECTION ${i + 1}\n${'x'.repeat(900)}`).join('\n\n');
  const chunks = splitDocumentText(text, { chunkChars: 2200 });
  assert.ok(chunks.length >= 5);
  const selected = selectCoverageChunks(chunks, 4);
  assert.equal(selected[0].index, 0);
  assert.equal(selected.at(-1).index, chunks.at(-1).index);
  assert.equal(new Set(selected.map((x) => x.index)).size, selected.length);
});

test('question task explicitly forbids unsupported outside knowledge', () => {
  const task = buildQuestionBatchTask({
    title: 'Guideline chapter', count: 2, difficulty: 'board', language: 'bilingual', format: 'sba', chunkIndex: 1, chunkCount: 4
  });
  assert.match(task, /Every tested fact must be supported/i);
  assert.match(task, /Do NOT use general model knowledge/i);
  assert.match(task, /explain clinically why EACH/i);
});

test('bundle generation uses source chunks and marks source as non-persistent', async () => {
  const calls = [];
  const ask = async ({ task, context }) => {
    calls.push({ task, context });
    if (/SYNTHESIZE A HIGH-YIELD/.test(task)) return { text: 'Final grounded summary.' };
    if (/SOURCE-GROUNDED STUDY SUMMARY/.test(task)) return { text: 'Chunk summary.' };
    return { text: 'Q. Clinical question\nA. option\nB. option\nC. option\nD. option\nCorrect: A\nExplanations: source-grounded.' };
  };
  const sourceText = Array.from({ length: 8 }, (_, i) => `UNIT ${i + 1}: clinically relevant source statement ${'z'.repeat(1200)}`).join('\n\n');
  const bundle = await generateDocumentSimulationBundle({
    title: 'Test guideline',
    sourceText,
    questionCount: 10,
    difficulty: 'board',
    format: 'sba'
  }, { ask });

  assert.equal(bundle.questionCount, 10);
  assert.equal(bundle.questionBatches.reduce((n, x) => n + x.count, 0), 10);
  assert.equal(bundle.groundedOnly, true);
  assert.equal(bundle.sourcePersisted, false);
  assert.equal(bundle.rawPdfPersisted, false);
  assert.equal(bundle.questionsPersisted, false);
  assert.ok(bundle.summaryCoverageUnits.length > 1);
  assert.ok(bundle.questionCoverageUnits.length > 1);
  assert.ok(calls.every((x) => !/revenue|wallet|trading/i.test(x.task)));
});
