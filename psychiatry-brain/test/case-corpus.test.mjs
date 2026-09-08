import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  caseCorpusStats,
  sanitizeCaseSelection,
  selectPublishedCase,
  buildUnknownCaseTask,
  generateUnknownPublishedCase,
  revealPublishedCase
} from '../src/case-corpus.mjs';

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'psy-corpus-'));
  const row = {
    caseId: 'epmc:PMC222',
    source: 'Europe PMC',
    pmcid: 'PMC222',
    pmid: '222',
    doi: '10.1000/222',
    title: 'A case report of bipolar mania with psychosis',
    journal: 'Open Psychiatry',
    year: 2025,
    license: 'CC BY',
    domains: ['mood', 'psychosis'],
    publishedAbstract: 'This published case report describes an adult with decreased need for sleep, elevated mood, grandiosity, pressured speech and psychotic symptoms. The report discusses assessment, differential diagnosis, treatment and clinical outcome.',
    sourceUrl: 'https://europepmc.org/article/PMC/222'
  };
  await writeFile(path.join(dir, 'index.jsonl'), `${JSON.stringify(row)}\n`);
  await writeFile(path.join(dir, 'stats.json'), JSON.stringify({ count: 1, byDomain: { mood: 1, psychosis: 1 }, updatedAt: '2026-09-08T00:00:00Z' }));
  return { dir, row };
}

test('selection validates domain and difficulty', () => {
  assert.deepEqual(sanitizeCaseSelection({ domain: 'mood', difficulty: 'board' }), { domain: 'mood', difficulty: 'board', yearFrom: null });
  assert.throws(() => sanitizeCaseSelection({ domain: 'surgery' }), /case_domain_invalid/);
});

test('unknown case prompt explicitly hides publication diagnosis and identifiers', () => {
  const task = buildUnknownCaseTask({ difficulty: 'board' });
  assert.match(task, /Do not reveal the article title/i);
  assert.match(task, /final diagnosis/i);
  assert.match(task, /fictionalized/i);
  assert.match(task, /Do NOT give the answer/i);
});

test('corpus stats and selection use only matching domain', async () => {
  const { dir } = await fixture();
  const stats = await caseCorpusStats(dir);
  assert.equal(stats.available, true);
  assert.equal(stats.count, 1);
  const picked = await selectPublishedCase({ domain: 'mood', seed: 'fixed' }, { caseDir: dir });
  assert.equal(picked.record.caseId, 'epmc:PMC222');
  await assert.rejects(() => selectPublishedCase({ domain: 'addiction' }, { caseDir: dir }), /case_corpus_no_match/);
});

test('unknown published case response hides source metadata until debrief', async () => {
  const { dir } = await fixture();
  const calls = [];
  const ask = async ({ task, context }) => {
    calls.push({ task, context });
    return { text: 'Fictionalized vignette without diagnosis. What is your leading differential?' };
  };
  const result = await generateUnknownPublishedCase({ domain: 'mood', difficulty: 'r1', seed: 'fixed' }, { ask, caseDir: dir });
  assert.equal(result.mode, 'unknown_published_case');
  assert.equal(result.sourceHiddenUntilDebrief, true);
  assert.equal(Object.hasOwn(result, 'title'), false);
  assert.equal(Object.hasOwn(result, 'doi'), false);
  assert.equal(result.vignettePersisted, false);
  assert.match(calls[0].context, /published case report/i);
});

test('debrief reveals provenance only after learner commits', async () => {
  const { dir } = await fixture();
  const ask = async () => ({ text: 'Source-grounded debrief and one harder viva question.' });
  const result = await revealPublishedCase({ caseId: 'epmc:PMC222', learnerAnswer: 'Bipolar mania is my leading diagnosis.', difficulty: 'board' }, { ask, caseDir: dir });
  assert.equal(result.mode, 'published_case_debrief');
  assert.equal(result.source.pmcid, 'PMC222');
  assert.equal(result.source.license, 'CC BY');
  assert.equal(result.learnerAnswerPersisted, false);
  assert.equal(result.debriefPersisted, false);
});
