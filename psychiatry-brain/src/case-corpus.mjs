import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CASE_DIR = process.env.PSYCHIATRY_CASE_CORPUS_DIR || '/var/lib/osa-psychiatry-cases';
const ALLOWED_DIFFICULTY = new Set(['foundation', 'r1', 'board', 'consultant']);
const ALLOWED_DOMAINS = new Set(['any', 'psychosis', 'mood', 'addiction', 'anxiety_ocd_trauma', 'child_adolescent', 'geriatric', 'emergency', 'psychopharmacology', 'liaison']);

async function readRows(caseDir = DEFAULT_CASE_DIR) {
  const text = await readFile(path.join(caseDir, 'index.jsonl'), 'utf8');
  return text.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

export async function caseCorpusStats(caseDir = DEFAULT_CASE_DIR) {
  try {
    const raw = await readFile(path.join(caseDir, 'stats.json'), 'utf8');
    const stats = JSON.parse(raw);
    return { available: true, ...stats };
  } catch (err) {
    if (err?.code === 'ENOENT') return { available: false, count: 0, byDomain: {}, updatedAt: null };
    throw err;
  }
}

export function sanitizeCaseSelection(input = {}) {
  const domain = String(input.domain || 'any').trim().toLowerCase();
  const difficulty = String(input.difficulty || 'r1').trim().toLowerCase();
  if (!ALLOWED_DOMAINS.has(domain)) throw new Error('case_domain_invalid');
  if (!ALLOWED_DIFFICULTY.has(difficulty)) throw new Error('case_difficulty_invalid');
  const yearFrom = input.yearFrom == null ? null : Number(input.yearFrom);
  if (yearFrom != null && (!Number.isInteger(yearFrom) || yearFrom < 1950 || yearFrom > 2100)) throw new Error('case_year_invalid');
  return { domain, difficulty, yearFrom };
}

function stableIndex(rows, seedText = '') {
  if (!rows.length) return -1;
  if (!seedText) return Math.floor(Math.random() * rows.length);
  let h = 2166136261;
  for (const ch of String(seedText)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0) % rows.length;
}

export async function selectPublishedCase(input = {}, { caseDir = DEFAULT_CASE_DIR } = {}) {
  const request = sanitizeCaseSelection(input);
  const rows = await readRows(caseDir);
  const filtered = rows.filter((row) => {
    if (request.domain !== 'any' && !(row.domains || []).includes(request.domain)) return false;
    if (request.yearFrom && (!row.year || row.year < request.yearFrom)) return false;
    return Boolean(row.publishedAbstract);
  });
  if (!filtered.length) throw new Error('case_corpus_no_match');
  const idx = stableIndex(filtered, input.seed || '');
  return { request, record: filtered[idx] };
}

export async function getPublishedCase(caseId, { caseDir = DEFAULT_CASE_DIR } = {}) {
  const cleanId = String(caseId || '').trim();
  if (!cleanId) throw new Error('case_id_required');
  const rows = await readRows(caseDir);
  const found = rows.find((row) => row.caseId === cleanId);
  if (!found) throw new Error('case_not_found');
  return found;
}

export function buildUnknownCaseTask({ difficulty = 'r1' } = {}) {
  return `UNKNOWN CASE MODE — PSYCHIATRY TRAINING.\nDifficulty: ${difficulty}.\nUse ONLY the published open-access case abstract in CURRENT PSYCHIATRY CONTEXT as source material. Transform it into a fictionalized, de-identified educational vignette.\n\nRules:\n1. Do not reveal the article title, authors, journal, institution, country, DOI, PMCID, final diagnosis, or definitive outcome.\n2. Remove or generalize identifying geography, institution, occupation/employer, exact calendar dates, and other non-essential unique details.\n3. Keep clinically important facts that are explicitly supported by the source, but do not invent negatives, investigations, symptoms, medication doses, risk findings, or history.\n4. If exact age is not essential, convert it to an age band (for example: adolescent, 20s, 30s, older adult).\n5. Present the case progressively: opening complaint + initial facts only. Do NOT give the answer.\n6. End with exactly one question asking the learner what they want to assess next OR what their leading differential is, whichever best matches the source.\n7. This is a fictionalized teaching case derived from a published case report, not a real-time clinical record.\nDo not expose hidden chain-of-thought.`;
}

export function buildCaseRevealTask({ learnerAnswer = '', difficulty = 'r1' } = {}) {
  return `PUBLISHED CASE DEBRIEF — PSYCHIATRY TRAINING.\nDifficulty: ${difficulty}.\nUse ONLY the supplied published case abstract and learner answer.\n\nReturn exactly:\n1. Source-grounded case summary — concise, de-identified and paraphrased.\n2. Leading diagnosis / differential actually supported by the publication; clearly separate what the report established from what remains uncertain.\n3. What the learner got right.\n4. What the learner missed or over-inferred.\n5. Safety / medical-mimic / drug-interaction issues supported by the report.\n6. What must be checked against CURRENT guideline/regulatory evidence before applying management today, because historical case-report management is not automatically current practice.\n7. One harder viva question; do not answer it.\n\nNever invent missing facts. Do not reproduce long passages from the publication. Do not expose hidden chain-of-thought. Learner answer: ${String(learnerAnswer || '').slice(0, 10_000)}`;
}

export async function generateUnknownPublishedCase(input = {}, { ask, caseDir = DEFAULT_CASE_DIR } = {}) {
  if (typeof ask !== 'function') throw new Error('ask_required');
  const { request, record } = await selectPublishedCase(input, { caseDir });
  const answer = await ask({
    task: buildUnknownCaseTask(request),
    context: `PUBLISHED OPEN-ACCESS CASE ABSTRACT\n${record.publishedAbstract}`,
    maxPredict: 450,
    numCtx: 4096
  });
  return {
    mode: 'unknown_published_case',
    caseId: record.caseId,
    difficulty: request.difficulty,
    domains: record.domains,
    publicationYear: record.year,
    sourceHiddenUntilDebrief: true,
    rawPublicationTextPersistedByTrainingService: false,
    vignettePersisted: false,
    vignette: answer.text
  };
}

export async function revealPublishedCase(input = {}, { ask, caseDir = DEFAULT_CASE_DIR } = {}) {
  if (typeof ask !== 'function') throw new Error('ask_required');
  const record = await getPublishedCase(input.caseId, { caseDir });
  const difficulty = String(input.difficulty || 'r1').toLowerCase();
  if (!ALLOWED_DIFFICULTY.has(difficulty)) throw new Error('case_difficulty_invalid');
  const learnerAnswer = String(input.learnerAnswer || '').trim();
  if (!learnerAnswer) throw new Error('learner_answer_required');
  if (learnerAnswer.length > 10_000) throw new Error('learner_answer_too_long');
  const answer = await ask({
    task: buildCaseRevealTask({ learnerAnswer, difficulty }),
    context: `PUBLISHED OPEN-ACCESS CASE ABSTRACT\n${record.publishedAbstract}`,
    maxPredict: 700,
    numCtx: 6144
  });
  return {
    mode: 'published_case_debrief',
    caseId: record.caseId,
    source: {
      database: record.source,
      title: record.title,
      journal: record.journal,
      year: record.year,
      pmcid: record.pmcid,
      pmid: record.pmid,
      doi: record.doi,
      license: record.license,
      url: record.sourceUrl
    },
    learnerAnswerPersisted: false,
    debriefPersisted: false,
    debrief: answer.text
  };
}
