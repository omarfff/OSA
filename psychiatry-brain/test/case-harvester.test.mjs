import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  classifyCaseDomains,
  normalizeEuropePmcCase,
  harvestOpenPsychiatryCases
} from '../src/case-harvester.mjs';

test('psychiatry case classifier covers major clinical domains', () => {
  const domains = classifyCaseDomains('A case report of schizophrenia with clozapine adverse effects and renal disease.');
  assert.equal(domains.includes('psychosis'), true);
  assert.equal(domains.includes('psychopharmacology'), true);
  assert.equal(domains.includes('liaison'), true);
});

test('normalizer accepts open-access peer-reviewed psychiatric case report and drops author affiliations', () => {
  const row = normalizeEuropePmcCase({
    pmcid: 'PMC12345',
    pmid: '98765',
    doi: '10.1000/example',
    title: 'A case report of catatonia in severe depression',
    abstractText: 'This case report describes an adult with severe depression who developed catatonia and required a structured psychiatric and medical assessment. The report discusses differential diagnosis, treatment course, and outcome in sufficient clinical detail for educational review.',
    journalTitle: 'Example Psychiatry Journal',
    pubYear: '2025',
    isOpenAccess: 'Y',
    source: 'MED',
    license: 'CC BY 4.0',
    pubTypeList: { pubType: ['Case Reports', 'Journal Article'] },
    authorList: { author: [{ fullName: 'Should Not Persist', affiliation: 'Should Not Persist' }] }
  });
  assert.ok(row);
  assert.equal(row.caseId, 'epmc:PMC12345');
  assert.equal(row.openAccess, true);
  assert.equal(row.preprint, false);
  assert.equal(row.patientIdentifiersStored, false);
  assert.equal(row.authorAffiliationsStored, false);
  assert.equal(Object.hasOwn(row, 'authorList'), false);
  assert.equal(JSON.stringify(row).includes('Should Not Persist'), false);
});

test('normalizer rejects preprints and non-psychiatric records', () => {
  const base = {
    pmcid: 'PMC999',
    title: 'A case report',
    abstractText: 'This case report contains enough words to pass the length gate but describes only an orthopedic fracture and surgical hardware without any psychiatric or mental health presentation whatsoever. Additional nonpsychiatric detail is included to ensure the abstract is long enough for validation.',
    isOpenAccess: 'Y'
  };
  assert.equal(normalizeEuropePmcCase(base), null);
  assert.equal(normalizeEuropePmcCase({ ...base, title: 'A case report of psychosis', source: 'PPR' }), null);
});

test('harvester writes a deduplicated corpus and stats without raw full text', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'psy-cases-'));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        resultList: {
          result: [{
            pmcid: 'PMC111',
            pmid: '111',
            title: 'Psychosis in a young adult: a case report',
            abstractText: 'This case report describes a young adult presenting with hallucinations, delusions, insomnia and functional deterioration. Medical causes were assessed and the report discusses psychiatric differential diagnosis, treatment and follow-up in enough detail to support educational case reasoning.',
            journalTitle: 'Open Psychiatry',
            pubYear: '2024',
            isOpenAccess: 'Y',
            source: 'MED',
            license: 'CC BY'
          }]
        },
        nextCursorMark: null
      })
    };
  };
  const stats = await harvestOpenPsychiatryCases({ target: 1, maxNew: 1, dir, fetchImpl, delayMs: 0 });
  assert.equal(stats.count, 1);
  assert.equal(stats.rawFullTextStored, false);
  assert.equal(stats.patientIdentifiersStored, false);
  assert.equal(calls, 1);
  const index = await readFile(path.join(dir, 'index.jsonl'), 'utf8');
  assert.match(index, /epmc:PMC111/);
});
