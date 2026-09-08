import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_DOMAINS = [
  'mse',
  'risk',
  'formulation',
  'psychosis',
  'mood',
  'anxiety_ocd_trauma',
  'addiction',
  'child_adolescent',
  'geriatric',
  'psychopharmacology',
  'emergency',
  'psychotherapy',
  'law_ethics'
];

const DAY_MS = 86_400_000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function emptyLearnerState(now = new Date()) {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    attempts: 0,
    domains: Object.fromEntries(DEFAULT_DOMAINS.map((domain) => [domain, {
      mastery: 0,
      attempts: 0,
      correct: 0,
      streak: 0,
      lastSeenAt: null,
      nextReviewAt: now.toISOString(),
      confidenceCalibration: null,
      skills: {}
    }]))
  };
}

function assertToken(value, field) {
  const token = String(value || '').trim().toLowerCase();
  if (!token || token.length > 80 || !/^[a-z0-9_\-]+$/.test(token)) {
    throw new Error(`${field}_invalid`);
  }
  return token;
}

export function sanitizeAttempt(input = {}) {
  const domain = assertToken(input.domain, 'domain');
  const skill = assertToken(input.skill || 'general', 'skill');
  if (!DEFAULT_DOMAINS.includes(domain)) throw new Error('domain_not_allowed');
  if (typeof input.correct !== 'boolean') throw new Error('correct_required');
  const confidence = input.confidence == null ? null : clamp(Number(input.confidence), 0, 100);
  if (confidence != null && !Number.isFinite(confidence)) throw new Error('confidence_invalid');
  const difficulty = input.difficulty == null ? 3 : clamp(Math.round(Number(input.difficulty)), 1, 5);
  if (!Number.isFinite(difficulty)) throw new Error('difficulty_invalid');
  const responseMs = input.responseMs == null ? null : clamp(Math.round(Number(input.responseMs)), 0, 3_600_000);
  if (responseMs != null && !Number.isFinite(responseMs)) throw new Error('response_ms_invalid');
  return { domain, skill, correct: input.correct, confidence, difficulty, responseMs };
}

function reviewIntervalDays({ correct, streak, mastery, difficulty }) {
  if (!correct) return 1;
  const base = [1, 3, 7, 14, 30, 60, 90][clamp(streak - 1, 0, 6)];
  const masteryFactor = 0.8 + mastery * 0.8;
  const difficultyFactor = 1.2 - ((difficulty - 1) * 0.1);
  return clamp(Math.round(base * masteryFactor * difficultyFactor), 1, 120);
}

export function recordAttempt(state, rawAttempt, now = new Date()) {
  const attempt = sanitizeAttempt(rawAttempt);
  const next = structuredClone(state || emptyLearnerState(now));
  const domain = next.domains[attempt.domain] || emptyLearnerState(now).domains[attempt.domain];
  const skill = domain.skills[attempt.skill] || {
    mastery: 0,
    attempts: 0,
    correct: 0,
    streak: 0,
    lastSeenAt: null,
    nextReviewAt: now.toISOString(),
    confidenceCalibration: null
  };

  const target = attempt.correct ? 1 : 0;
  const learningRate = skill.attempts < 5 ? 0.34 : 0.20;
  const difficultyWeight = 0.9 + ((attempt.difficulty - 1) * 0.05);
  skill.mastery = clamp(skill.mastery + ((target - skill.mastery) * learningRate * difficultyWeight), 0, 1);
  skill.attempts += 1;
  skill.correct += attempt.correct ? 1 : 0;
  skill.streak = attempt.correct ? skill.streak + 1 : 0;
  skill.lastSeenAt = now.toISOString();

  if (attempt.confidence != null) {
    const confidence01 = attempt.confidence / 100;
    const calibration = 1 - Math.abs(confidence01 - target);
    skill.confidenceCalibration = skill.confidenceCalibration == null
      ? calibration
      : (skill.confidenceCalibration * 0.75) + (calibration * 0.25);
  }

  const days = reviewIntervalDays({
    correct: attempt.correct,
    streak: skill.streak,
    mastery: skill.mastery,
    difficulty: attempt.difficulty
  });
  skill.nextReviewAt = new Date(now.getTime() + (days * DAY_MS)).toISOString();
  domain.skills[attempt.skill] = skill;

  const skills = Object.values(domain.skills);
  const attempts = skills.reduce((sum, item) => sum + item.attempts, 0);
  const correct = skills.reduce((sum, item) => sum + item.correct, 0);
  domain.attempts = attempts;
  domain.correct = correct;
  domain.mastery = skills.length
    ? skills.reduce((sum, item) => sum + item.mastery, 0) / skills.length
    : 0;
  domain.streak = Math.max(0, ...skills.map((item) => item.streak));
  domain.lastSeenAt = now.toISOString();
  domain.nextReviewAt = skills.length
    ? skills.map((item) => item.nextReviewAt).sort()[0]
    : now.toISOString();
  const calibrated = skills.filter((item) => item.confidenceCalibration != null);
  domain.confidenceCalibration = calibrated.length
    ? calibrated.reduce((sum, item) => sum + item.confidenceCalibration, 0) / calibrated.length
    : null;

  next.domains[attempt.domain] = domain;
  next.attempts = Object.values(next.domains).reduce((sum, item) => sum + item.attempts, 0);
  next.updatedAt = now.toISOString();
  return next;
}

export function dueReviews(state, now = new Date(), limit = 20) {
  const rows = [];
  for (const [domainName, domain] of Object.entries(state?.domains || {})) {
    for (const [skillName, skill] of Object.entries(domain.skills || {})) {
      const due = Date.parse(skill.nextReviewAt || 0) <= now.getTime();
      if (!due) continue;
      rows.push({
        domain: domainName,
        skill: skillName,
        mastery: Number(skill.mastery.toFixed(3)),
        attempts: skill.attempts,
        streak: skill.streak,
        nextReviewAt: skill.nextReviewAt
      });
    }
  }
  return rows
    .sort((a, b) => a.mastery - b.mastery || Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt))
    .slice(0, clamp(Number(limit) || 20, 1, 100));
}

export function masterySummary(state) {
  const domains = Object.entries(state?.domains || {}).map(([name, item]) => ({
    domain: name,
    masteryPct: Math.round((item.mastery || 0) * 100),
    attempts: item.attempts || 0,
    accuracyPct: item.attempts ? Math.round((item.correct / item.attempts) * 100) : null,
    calibrationPct: item.confidenceCalibration == null ? null : Math.round(item.confidenceCalibration * 100),
    nextReviewAt: item.nextReviewAt
  }));
  const practiced = domains.filter((x) => x.attempts > 0);
  const overallMasteryPct = practiced.length
    ? Math.round(practiced.reduce((sum, x) => sum + x.masteryPct, 0) / practiced.length)
    : 0;
  return { overallMasteryPct, attempts: state?.attempts || 0, domains };
}

export function pickAdaptiveDomain(state) {
  const domains = masterySummary(state).domains;
  const unpracticed = domains.filter((x) => x.attempts === 0);
  if (unpracticed.length) return unpracticed[0].domain;
  return [...domains].sort((a, b) => a.masteryPct - b.masteryPct || a.attempts - b.attempts)[0]?.domain || 'mse';
}

export class LearnerStore {
  constructor(stateDir, filename = 'learner-state.json') {
    if (!stateDir) throw new Error('state_dir_required');
    this.stateDir = path.resolve(stateDir);
    this.file = path.join(this.stateDir, filename);
  }

  async load() {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed?.version === 1 ? parsed : emptyLearnerState();
    } catch (err) {
      if (err?.code === 'ENOENT' || err instanceof SyntaxError) return emptyLearnerState();
      throw err;
    }
  }

  async save(state) {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, this.file);
  }

  async record(rawAttempt, now = new Date()) {
    const state = await this.load();
    const next = recordAttempt(state, rawAttempt, now);
    await this.save(next);
    return next;
  }
}
