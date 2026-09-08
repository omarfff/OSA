import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EUROPE_PMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const DEFAULT_DIR = process.env.PSYCHIATRY_CASE_CORPUS_DIR || '/var/lib/osa-psychiatry-cases';
const PAGE_SIZE = 100;
const MIN_ABSTRACT_CHARS = 180;
const MAX_ABSTRACT_CHARS = 8_000;

const SEARCH_QUERIES = [
  '("case report" OR "case series") AND (psychiatr* OR "mental health") AND OPEN_ACCESS:y AND IN_EPMC:y',
  '("case report" OR "case series") AND (schizophrenia OR psychosis OR catatonia OR delirium) AND OPEN_ACCESS:y AND IN_EPMC:y',
  '("case report" OR "case series") AND (depression OR bipolar OR mania OR suicid*) AND OPEN_ACCESS:y AND IN_EPMC:y',
  '("case report" OR "case series") AND (addiction OR "substance use" OR alcohol OR opioid OR cannabis OR stimulant) AND OPEN_ACCESS:y AND IN_EPMC:y',
  '("case report" OR "case series") AND (OCD OR PTSD OR anxiety OR dissociative OR "eating disorder") AND OPEN_ACCESS:y AND IN_EPMC:y',
  '("case report" OR "case series") AND (ADHD OR autism OR adolescent OR child OR geriatric OR dementia OR neuropsychiatr*) AND OPEN_ACCESS:y AND IN_EPMC:y'
];

const DOMAIN_PATTERNS = [
  ['psychosis', /schizophren|psychosis|psychotic|delusion|hallucination|catatonia/i],
  ['mood', /depress|bipolar|mania|manic|mood disorder/i],
  ['addiction', /addiction|substance|alcohol|opioid|cannabis|stimulant|methamphetamine|cocaine/i],
  ['anxiety_ocd_trauma', /anxiety|panic|obsessive|ocd|post.?traumatic|ptsd|dissociat/i],
  ['child_adolescent', /child|adolesc|pediatric|paediatric|adhd|autis/i],
  ['geriatric', /geriat|older adult|elderly|dementia|neurocognitive/i],
  ['emergency', /delirium|agitation|suicid|self.?harm|withdrawal|overdose|neuroleptic malignant|serotonin syndrome/i],
  ['psychopharmacology', /clozapine|lithium|valproate|antipsychotic|antidepressant|psychotropic|adverse effect|drug interaction/i],
  ['liaison', /renal|kidney|hepatic|liver|cardiac|cancer|neurolog|endocrine|autoimmune|pregnan|postpartum|medical comorbid/i]
];

function stripMarkup(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBool(value) {
  return value === true || value === 'Y' || value === 'y' || value === 'true';
}

function publicationTypes(item) {
  const raw = item?.pubTypeList?.pubType;
  if (Array.isArray(raw)) return raw.map(String);
  if (raw) return [String(raw)];
  return [];
}

export function classifyCaseDomains(text) {
  const corpus = String(text || '');
  return DOMAIN_PATTERNS.filter(([, pattern]) => pattern.test(corpus)).map(([domain]) => domain);
}

export function normalizeEuropePmcCase(item) {
  const title = stripMarkup(item?.title);
  const abstract = stripMarkup(item?.authorManuscript || item?.abstractText || item?.abstract || '');
  const pmcid = String(item?.pmcid || '').trim();
  const pmid = String(item?.pmid || item?.id || '').trim();
  const doi = String(item?.doi || '').trim();
  const journal = stripMarkup(item?.journalTitle || item?.journalInfo?.journal?.title || '');
  const license = stripMarkup(item?.license || '');
  const types = publicationTypes(item);
  const source = String(item?.source || '').trim();
  const year = Number(item?.pubYear || String(item?.firstPublicationDate || '').slice(0, 4)) || null;
  const combined = `${title} ${abstract}`;

  if (!pmcid) return null;
  if (!normalizeBool(item?.isOpenAccess) && item?.isOpenAccess != null) return null;
  if (source === 'PPR' || types.some((x) => /preprint/i.test(x))) return null;
  if (abstract.length < MIN_ABSTRACT_CHARS) return null;
  if (!/case report|case series|case presentation|case study/i.test(combined)) return null;

  const domains = classifyCaseDomains(combined);
  if (!domains.length) return null;

  return {
    caseId: `epmc:${pmcid}`,
    source: 'Europe PMC',
    pmcid,
    pmid: pmid || null,
    doi: doi || null,
    title,
    journal: journal || null,
    year,
    license: license || null,
    publicationTypes: types.slice(0, 8),
    domains,
    publishedAbstract: abstract.slice(0, MAX_ABSTRACT_CHARS),
    openAccess: true,
    preprint: false,
    patientIdentifiersStored: false,
    authorAffiliationsStored: false,
    managementNeedsCurrentVerification: true,
    sourceUrl: `https://europepmc.org/article/PMC/${pmcid.replace(/^PMC/i, '')}`
  };
}

async function loadExisting(dir) {
  try {
    const text = await readFile(path.join(dir, 'index.jsonl'), 'utf8');
    const rows = text.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
    return new Map(rows.map((row) => [row.caseId, row]));
  } catch (err) {
    if (err?.code === 'ENOENT') return new Map();
    throw err;
  }
}

async function writeAtomic(dir, rows, extra = {}) {
  await mkdir(dir, { recursive: true, mode: 0o750 });
  const indexTmp = path.join(dir, 'index.jsonl.tmp');
  const statsTmp = path.join(dir, 'stats.json.tmp');
  const indexPath = path.join(dir, 'index.jsonl');
  const statsPath = path.join(dir, 'stats.json');
  const ordered = [...rows].sort((a, b) => (b.year || 0) - (a.year || 0) || a.caseId.localeCompare(b.caseId));
  await writeFile(indexTmp, ordered.map((x) => JSON.stringify(x)).join('\n') + '\n', { mode: 0o640 });
  const byDomain = {};
  for (const row of ordered) for (const domain of row.domains || []) byDomain[domain] = (byDomain[domain] || 0) + 1;
  const stats = {
    count: ordered.length,
    source: 'Europe PMC open-access psychiatric case reports',
    rawFullTextStored: false,
    patientIdentifiersStored: false,
    authorAffiliationsStored: false,
    updatedAt: new Date().toISOString(),
    byDomain,
    ...extra
  };
  await writeFile(statsTmp, JSON.stringify(stats, null, 2) + '\n', { mode: 0o640 });
  await rename(indexTmp, indexPath);
  await rename(statsTmp, statsPath);
  return stats;
}

async function fetchPage(query, cursorMark = '*', fetchImpl = fetch) {
  const url = new URL(EUROPE_PMC_BASE);
  url.searchParams.set('query', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('resultType', 'core');
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  url.searchParams.set('cursorMark', cursorMark);
  const response = await fetchImpl(url, {
    headers: { 'user-agent': 'osa-psychiatry-case-corpus/1.0 educational-open-access-harvester' },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`europe_pmc_http_${response.status}`);
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function harvestOpenPsychiatryCases({
  target = 1000,
  maxNew = target,
  dir = DEFAULT_DIR,
  fetchImpl = fetch,
  delayMs = 380
} = {}) {
  target = Math.max(1, Math.min(5000, Number(target) || 1000));
  maxNew = Math.max(1, Math.min(2000, Number(maxNew) || target));
  const existing = await loadExisting(dir);
  const before = existing.size;
  let added = 0;
  let requests = 0;

  for (const query of SEARCH_QUERIES) {
    if (existing.size >= target || added >= maxNew) break;
    let cursor = '*';
    const seenCursors = new Set();
    for (let page = 0; page < 100; page += 1) {
      if (existing.size >= target || added >= maxNew) break;
      if (seenCursors.has(cursor)) break;
      seenCursors.add(cursor);
      const body = await fetchPage(query, cursor, fetchImpl);
      requests += 1;
      const results = body?.resultList?.result || [];
      if (!results.length) break;
      for (const item of results) {
        const row = normalizeEuropePmcCase(item);
        if (!row || existing.has(row.caseId)) continue;
        existing.set(row.caseId, row);
        added += 1;
        if (existing.size >= target || added >= maxNew) break;
      }
      const next = body?.nextCursorMark;
      if (!next || next === cursor) break;
      cursor = next;
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  const stats = await writeAtomic(dir, [...existing.values()], {
    target,
    addedThisRun: added,
    previousCount: before,
    apiRequestsThisRun: requests
  });
  return stats;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = Number(process.argv[2] || 1000);
  const maxNew = Number(process.argv[3] || target);
  harvestOpenPsychiatryCases({ target, maxNew })
    .then((stats) => process.stdout.write(JSON.stringify({ ok: true, ...stats }) + '\n'))
    .catch((err) => {
      process.stderr.write(JSON.stringify({ ok: false, error: String(err?.message || err) }) + '\n');
      process.exitCode = 1;
    });
}
