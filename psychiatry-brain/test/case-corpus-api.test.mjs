import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTrainingPsychiatryServer } from '../src/training-server.mjs';

async function withServer(fn) {
  const caseDir = await mkdtemp(path.join(os.tmpdir(), 'psy-case-api-'));
  const row = {
    caseId: 'epmc:PMC333', source: 'Europe PMC', pmcid: 'PMC333', pmid: '333', doi: '10.1000/333',
    title: 'A case report of psychosis', journal: 'Open Psychiatry', year: 2026, license: 'CC BY',
    domains: ['psychosis'], publishedAbstract: 'This case report describes an adult with hallucinations, persecutory delusions, social withdrawal, functional decline and poor sleep. The publication discusses psychiatric assessment, differential diagnosis, treatment and outcome in sufficient detail for an educational vignette.',
    sourceUrl: 'https://europepmc.org/article/PMC/333'
  };
  await writeFile(path.join(caseDir, 'index.jsonl'), `${JSON.stringify(row)}\n`);
  await writeFile(path.join(caseDir, 'stats.json'), JSON.stringify({ count: 1, byDomain: { psychosis: 1 }, updatedAt: new Date().toISOString() }));

  const ask = async ({ task }) => {
    if (task.includes('UNKNOWN CASE MODE')) return { text: 'Fictional case opening. What would you assess next?' };
    if (task.includes('PUBLISHED CASE DEBRIEF')) return { text: 'Source-grounded debrief. One harder viva question.' };
    return { text: 'stub' };
  };
  const server = createTrainingPsychiatryServer({ bind: '127.0.0.1', port: 0, ask, caseDir });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function post(base, url, body) {
  const response = await fetch(`${base}${url}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test('case corpus stats endpoint reports availability', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/cases/corpus/stats`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.available, true);
    assert.equal(body.count, 1);
  });
});

test('random published case stays source-hidden until reveal', async () => {
  await withServer(async (base) => {
    const random = await post(base, '/cases/random', { domain: 'psychosis', difficulty: 'board', seed: 'x' });
    assert.equal(random.status, 200);
    assert.equal(random.body.ok, true);
    assert.equal(random.body.sourceHiddenUntilDebrief, true);
    assert.equal(random.body.vignettePersisted, false);
    assert.equal(random.body.source, undefined);

    const reveal = await post(base, '/cases/reveal', {
      caseId: random.body.caseId,
      learnerAnswer: 'I would assess psychosis, substance use and medical mimics.',
      difficulty: 'board'
    });
    assert.equal(reveal.status, 200);
    assert.equal(reveal.body.source.pmcid, 'PMC333');
    assert.equal(reveal.body.learnerAnswerPersisted, false);
  });
});

test('training capabilities advertise separated global case harvester', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/training/capabilities`);
    const body = await response.json();
    assert.equal(body.globalPublishedCaseCorpus, true);
    assert.equal(body.globalCaseCorpusInitialTarget, 1000);
    assert.equal(body.unknownCaseMode, true);
    assert.equal(body.caseHarvesterNetworkSeparatedFromBrain, true);
  });
});
