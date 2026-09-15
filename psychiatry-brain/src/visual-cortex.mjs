import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { masterySummary, pickAdaptiveDomain } from './learning.mjs';

const DEFAULT_VISUAL_DIR = process.env.PSYCHIATRY_VISUAL_DIR || '/var/lib/osa-psychiatry-brain/visuals';
const LEVELS = new Set(['foundation', 'r1', 'board']);
const LANGUAGES = new Set(['arabic', 'english', 'bilingual']);
const MAX_TOPIC = 180;
const MAX_SECTIONS = 6;
const MAX_BULLETS = 5;

const DOMAIN_TITLES = {
  mse: 'Mental State Examination',
  risk: 'Psychiatric Risk Assessment',
  formulation: '4Ps Case Formulation',
  psychosis: 'Psychosis & Schizophrenia',
  mood: 'Mood Disorders',
  anxiety_ocd_trauma: 'Anxiety, OCD & Trauma',
  addiction: 'Substance Use Disorders',
  child_adolescent: 'Child & Adolescent Psychiatry',
  geriatric: 'Geriatric Psychiatry',
  psychopharmacology: 'Psychopharmacology',
  emergency: 'Psychiatric Emergencies',
  psychotherapy: 'Psychotherapy Skills',
  law_ethics: 'Law, Ethics & Capacity'
};

const DOMAIN_TOPICS = {
  mse: ['MSE structure', 'Mood vs affect', 'Thought form vs thought content', 'Perception and hallucination assessment'],
  risk: ['Suicide risk assessment', 'Violence risk assessment', 'Vulnerability and safeguarding', 'Medical and substance-related risk'],
  formulation: ['4Ps formulation', 'Biopsychosocial formulation', 'From history to formulation'],
  psychosis: ['First-episode psychosis', 'Schizophrenia differentials', 'Psychosis vs delirium', 'Negative symptoms'],
  mood: ['MDD vs bipolar disorder', 'Mania vs hypomania', 'Depression red flags', 'Bipolar course patterns'],
  anxiety_ocd_trauma: ['GAD vs panic disorder', 'OCD cycle', 'PTSD symptom clusters', 'Social anxiety vs panic'],
  addiction: ['Alcohol vs opioid withdrawal', 'Cannabis and psychosis', 'Stimulant intoxication', 'Substance use assessment'],
  child_adolescent: ['ADHD vs anxiety', 'Autism core features', 'Adolescent depression', 'Conduct disorder basics'],
  geriatric: ['Delirium vs dementia vs depression', 'Late-life depression', 'Cognitive assessment basics'],
  psychopharmacology: ['Antipsychotic adverse-effect map', 'Lithium monitoring concepts', 'Clozapine safety concepts', 'Antidepressant class map'],
  emergency: ['Agitation approach', 'Catatonia vs NMS vs serotonin syndrome', 'Alcohol withdrawal red flags', 'Suicidal patient priorities'],
  psychotherapy: ['CBT core model', 'Motivational interviewing basics', 'Supportive psychotherapy skills'],
  law_ethics: ['Capacity assessment', 'Consent basics', 'Confidentiality and safeguarding']
};

const FALLBACK_HEADINGS = ['Core pattern', 'Differentiate', 'Assessment', 'Memory hooks'];
const STRUCTURAL_WORDS = new Set(['title','subtitle','sections','heading','icon','bullets','memoryhook','redflags','footer','brain','eye','speech','heart','warning','pill','clock','shield','compare']);

function clamp(n, min, max) { return Math.min(max, Math.max(min, Number(n) || 0)); }
function cleanText(value, max = 500) { return String(value || '').replace(/\r/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }
function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function slug(value) {
  return String(value || 'visual').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'visual';
}
function parseJsonPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const candidates = [fenced, start >= 0 && end > start ? raw.slice(start, end + 1) : null, raw].filter(Boolean);
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* continue */ }
    try {
      const repaired = candidate.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
      return JSON.parse(repaired);
    } catch { /* continue */ }
  }
  return null;
}

function fragmentsFromText(text) {
  const raw = String(text || '');
  const fragments = [];
  const quoted = [...raw.matchAll(/["“]([^"”\n]{4,150})["”]/g)].map((m) => cleanText(m[1], 140));
  const lines = raw.split(/\n+/).map((line) => cleanText(line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/^[\[\]{}(),]+|[\[\]{}(),]+$/g, '')
    .replace(/^\s*"?[A-Za-z_]+"?\s*:\s*/, ''), 140));
  for (const item of [...quoted, ...lines]) {
    const lower = item.toLowerCase().replace(/[^a-z]/g, '');
    if (!item || item.length < 4 || item.length > 140) continue;
    if (STRUCTURAL_WORDS.has(lower)) continue;
    if (/^(strict json|psychiatry visual cortex|topic:|domain:|learner level:|rules:)/i.test(item)) continue;
    if (!fragments.includes(item)) fragments.push(item);
    if (fragments.length >= 24) break;
  }
  return fragments;
}

function deriveSpecFromText(rawText, target) {
  const fragments = fragmentsFromText(rawText);
  const safeDefaults = [
    `Recognize the core pattern of ${target.topic}`,
    'Compare it with the closest clinical alternative',
    'Identify the most important assessment questions',
    'Link the pattern to one memorable retrieval cue',
    'Separate observed facts from clinical inference',
    'Review safety and missing information before concluding'
  ];
  const pool = [...fragments, ...safeDefaults].slice(0, 20);
  const sections = FALLBACK_HEADINGS.map((heading, index) => ({
    heading,
    icon: index === 0 ? 'brain' : index === 1 ? 'compare' : index === 2 ? 'shield' : 'brain',
    bullets: pool.filter((_, i) => i % FALLBACK_HEADINGS.length === index).slice(0, MAX_BULLETS),
    memoryHook: index === 3 ? `Recall: ${target.topic}` : ''
  }));
  return {
    title: `${DOMAIN_TITLES[target.domain] || target.domain} | ${target.topic}`,
    subtitle: target.level === 'foundation' ? 'Recognize → Describe → Remember' : 'Recognize → Differentiate → Apply safely',
    sections,
    redFlags: [],
    footer: 'Same structure. Better recognition. Better decisions.'
  };
}

function normalizeSpec(raw, target, rawText = '') {
  const fallbackTitle = `${DOMAIN_TITLES[target.domain] || target.domain} — ${target.topic}`;
  const sections = Array.isArray(raw?.sections) ? raw.sections.slice(0, MAX_SECTIONS).map((s, i) => ({
    heading: cleanText(s?.heading || `Section ${i + 1}`, 90),
    icon: cleanText(s?.icon || 'brain', 20),
    bullets: (Array.isArray(s?.bullets) ? s.bullets : []).slice(0, MAX_BULLETS).map((x) => cleanText(x, 120)).filter(Boolean),
    memoryHook: cleanText(s?.memoryHook || '', 120)
  })).filter((s) => s.bullets.length) : [];
  if (sections.length < 3) return deriveSpecFromText(rawText, target);
  return {
    title: cleanText(raw?.title || fallbackTitle, 150),
    subtitle: cleanText(raw?.subtitle || 'Recognize → Differentiate → Assess safely', 150),
    sections,
    redFlags: (Array.isArray(raw?.redFlags) ? raw.redFlags : []).slice(0, 4).map((x) => cleanText(x, 120)).filter(Boolean),
    footer: cleanText(raw?.footer || 'Same structure. Better recognition. Better decisions.', 150)
  };
}

export function inferVisualLevel(state, domain) {
  const row = masterySummary(state).domains.find((x) => x.domain === domain);
  const mastery = row?.masteryPct ?? 0;
  if ((row?.attempts ?? 0) < 3 || mastery < 35) return 'foundation';
  if (mastery < 75) return 'r1';
  return 'board';
}

export function selectVisualTarget(state, input = {}, now = new Date()) {
  const requestedDomain = cleanText(input.domain, 80).toLowerCase();
  const domain = DOMAIN_TITLES[requestedDomain] ? requestedDomain : pickAdaptiveDomain(state);
  const levelInput = cleanText(input.level, 30).toLowerCase();
  const level = LEVELS.has(levelInput) ? levelInput : inferVisualLevel(state, domain);
  const languageInput = cleanText(input.language, 30).toLowerCase();
  const language = LANGUAGES.has(languageInput) ? languageInput : 'bilingual';
  const topicInput = cleanText(input.topic, MAX_TOPIC);
  const topics = DOMAIN_TOPICS[domain] || [DOMAIN_TITLES[domain] || domain];
  const variant = Number.isFinite(Number(input.variant)) ? Math.abs(Math.floor(Number(input.variant))) : Math.floor(now.getTime() / 86_400_000);
  const topic = topicInput || topics[variant % topics.length];
  const summary = masterySummary(state).domains.find((x) => x.domain === domain);
  return { domain, level, language, topic, masteryPct: summary?.masteryPct ?? 0, attempts: summary?.attempts ?? 0 };
}

export function buildVisualContentTask(target, { includeManagement = false, evidenceText = '' } = {}) {
  const managementRule = includeManagement && evidenceText
    ? 'Management may be included only when explicitly supported by the supplied evidence excerpt. Cite it as SOURCE in the text.'
    : 'Do not include drug doses, exact monitoring intervals, or treatment recommendations. Focus on recognition, differentiation, assessment, risk, and memory hooks.';
  const levelRule = target.level === 'foundation'
    ? 'Use very simple beginner language, 4 core sections, and memorable contrasts.'
    : target.level === 'r1'
      ? 'Use early-residency clinical reasoning: recognition, differential diagnosis, risk, and next assessment steps.'
      : 'Use board-level discriminators, exam traps, and concise high-yield distinctions without unsupported treatment claims.';
  return `PSYCHIATRY VISUAL CORTEX — BUILD INFOGRAPHIC CONTENT.\nTopic: ${target.topic}. Domain: ${target.domain}. Learner level: ${target.level}. Mastery: ${target.masteryPct}%. Language: ${target.language}.\n${levelRule}\n${managementRule}\nUse CURRENT PSYCHIATRY CONTEXT only. Never invent a diagnostic criterion, duration, dose, contraindication, or guideline recommendation. No hidden chain-of-thought.\nReturn STRICT JSON only with this shape:\n{\n  "title":"short bilingual or requested-language title",\n  "subtitle":"one-line recognition goal",\n  "sections":[{"heading":"...","icon":"brain|eye|speech|heart|warning|pill|clock|shield|compare","bullets":["..."],"memoryHook":"..."}],\n  "redFlags":["..."],\n  "footer":"one short learning message"\n}\nRules: 4-6 sections, max 5 bullets each, max 14 words per bullet, max 4 red flags, concise enough to fit one poster.`;
}

export function buildVisualReviewTask(target, spec) {
  return `PSYCHIATRY VISUAL CORTEX — MEDICAL QA.\nLearner target: ${target.level}, ${target.domain}, mastery ${target.masteryPct}%.\nReview the infographic below for accuracy and learner-level fit. Do not add new medical facts. Reject unsupported diagnostic durations, medication doses, exact monitoring intervals, treatment recommendations, false equivalence, dangerous omissions, or content too advanced for the learner.\nPrefer this one-line format if JSON is difficult: PASS accuracy=90 levelFit=90 clarity=90. Otherwise: REVISE accuracy=NN levelFit=NN clarity=NN reason=...\nJSON is also accepted: {"verdict":"pass|revise","accuracy":0-100,"levelFit":0-100,"clarity":0-100,"issues":["..."],"reason":"..."}\nINFOGRAPHIC:\n${JSON.stringify(spec)}`;
}

function numberAfter(text, keys) {
  for (const key of keys) {
    const match = String(text || '').match(new RegExp(`${key}\\s*[:=]?\\s*(\\d{1,3})`, 'i'));
    if (match) return clamp(match[1], 0, 100);
  }
  return null;
}

function normalizeReview(raw, rawText = '') {
  if (raw && typeof raw === 'object') {
    const verdict = String(raw.verdict || '').toLowerCase() === 'pass' ? 'pass' : 'revise';
    return {
      verdict,
      accuracy: clamp(raw.accuracy, 0, 100),
      levelFit: clamp(raw.levelFit, 0, 100),
      clarity: clamp(raw.clarity, 0, 100),
      issues: (Array.isArray(raw.issues) ? raw.issues : []).slice(0, 6).map((x) => cleanText(x, 180)).filter(Boolean),
      reason: cleanText(raw.reason || '', 300)
    };
  }
  const text = cleanText(rawText, 3000);
  const explicitRevise = /\b(revise|reject|unsafe|incorrect|inaccurate|fail)\b/i.test(text);
  const explicitPass = /\b(pass|approved|accurate|appropriate|acceptable)\b/i.test(text) && !explicitRevise;
  const accuracy = numberAfter(text, ['accuracy']) ?? (explicitPass ? 85 : 0);
  const levelFit = numberAfter(text, ['level\s*fit', 'levelfit']) ?? (explicitPass ? 85 : 0);
  const clarity = numberAfter(text, ['clarity']) ?? (explicitPass ? 85 : 0);
  return {
    verdict: explicitPass ? 'pass' : 'revise',
    accuracy,
    levelFit,
    clarity,
    issues: explicitRevise ? [cleanText(text, 180)] : [],
    reason: explicitPass ? 'QA passed in plain-text fallback format.' : cleanText(text, 300)
  };
}

function wrapText(text, maxChars = 34) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) { line = word; continue; }
    if ((line + ' ' + word).length <= maxChars) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

const PALETTE = ['#e8f2ff','#fff0f4','#fff7db','#e9fbf1','#f0edff','#fff0e5'];

function sectionSvg(section, i, x, y, w, h) {
  const lines = [];
  lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="${PALETTE[i % PALETTE.length]}" stroke="#c6d4e4" stroke-width="2"/>`);
  lines.push(`<text x="${x + 28}" y="${y + 52}" font-size="28" font-weight="700" fill="#123b67">${xmlEscape(section.heading)}</text>`);
  let cy = y + 96;
  for (const bullet of section.bullets) {
    const wrapped = wrapText(bullet, 42);
    lines.push(`<circle cx="${x + 30}" cy="${cy - 8}" r="6" fill="#2367a9"/>`);
    wrapped.forEach((t, idx) => lines.push(`<text x="${x + 52}" y="${cy + idx * 25}" font-size="21" fill="#152638">${xmlEscape(t)}</text>`));
    cy += 30 + (wrapped.length - 1) * 24;
    if (cy > y + h - 70) break;
  }
  if (section.memoryHook) {
    const hook = wrapText(`Memory: ${section.memoryHook}`, 44);
    lines.push(`<rect x="${x + 20}" y="${y + h - 72}" width="${w - 40}" height="52" rx="14" fill="#ffffff" fill-opacity="0.78"/>`);
    hook.slice(0, 2).forEach((t, idx) => lines.push(`<text x="${x + 34}" y="${y + h - 43 + idx * 21}" font-size="17" font-weight="600" fill="#6b5200">${xmlEscape(t)}</text>`));
  }
  return lines.join('\n');
}

export function renderVisualSvg(spec, target, review) {
  const width = 1600;
  const cols = 3;
  const gap = 24, margin = 36;
  const cardW = Math.floor((width - margin * 2 - gap * (cols - 1)) / cols);
  const cardH = 360;
  const headerH = 170;
  const sectionMarkup = spec.sections.map((section, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    return sectionSvg(section, i, margin + col * (cardW + gap), headerH + row * (cardH + gap), cardW, cardH);
  }).join('\n');
  const rows = Math.ceil(spec.sections.length / cols);
  const riskY = headerH + rows * (cardH + gap) + 4;
  const redFlags = spec.redFlags.length ? spec.redFlags : ['Check immediate safety and medical causes when clinically relevant.'];
  const riskText = redFlags.map((r, i) => `<text x="${margin + 42}" y="${riskY + 56 + i * 30}" font-size="20" fill="#7b1010">! ${xmlEscape(r)}</text>`).join('\n');
  const svgHeight = Math.max(1100, riskY + 190);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}">\n<rect width="100%" height="100%" fill="#ffffff"/>\n<rect x="0" y="0" width="${width}" height="150" fill="#eef6ff"/>\n<circle cx="78" cy="68" r="38" fill="#8fc5ff"/><text x="78" y="79" text-anchor="middle" font-size="30" font-weight="800" fill="#0b3d75">PSY</text>\n<text x="138" y="64" font-size="42" font-weight="800" fill="#0b3d75">${xmlEscape(spec.title)}</text>\n<text x="140" y="108" font-size="24" fill="#30597f">${xmlEscape(spec.subtitle)}</text>\n<text x="1540" y="62" font-size="18" text-anchor="end" fill="#30597f">${xmlEscape(target.level.toUpperCase())} • mastery ${target.masteryPct}%</text>\n<text x="1540" y="93" font-size="16" text-anchor="end" fill="#57748e">Visual Cortex • QA ${Math.round((review.accuracy + review.levelFit + review.clarity) / 3)}%</text>\n${sectionMarkup}\n<rect x="${margin}" y="${riskY + 12}" width="${width - margin * 2}" height="${Math.max(90, 50 + redFlags.length * 30)}" rx="20" fill="#fff0f0" stroke="#f0b4b4" stroke-width="2"/>\n<text x="${margin + 28}" y="${riskY + 42}" font-size="25" font-weight="800" fill="#9a1d1d">Red flags / safety</text>\n${riskText}\n<rect x="0" y="${svgHeight - 70}" width="${width}" height="70" fill="#0b3d75"/>\n<text x="${width / 2}" y="${svgHeight - 28}" text-anchor="middle" font-size="22" font-weight="700" fill="#ffffff">${xmlEscape(spec.footer)} • Educational use — verify current guidance for treatment decisions.</text>\n</svg>`;
}

async function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, file);
}

async function reviewWithFallback(ask, target, spec) {
  let response = await ask({
    task: buildVisualReviewTask(target, spec),
    context: 'Medical QA for educational infographic. Do not invent new facts.'
  });
  let parsed = parseJsonPayload(response.text);
  let review = normalizeReview(parsed, response.text);
  if (review.verdict === 'revise' && !/\b(revise|reject|unsafe|incorrect|inaccurate|fail)\b/i.test(response.text || '')) {
    response = await ask({
      task: 'MEDICAL QA FORMAT REPAIR. Review the supplied infographic only. Return exactly ONE line: PASS accuracy=NN levelFit=NN clarity=NN, or REVISE accuracy=NN levelFit=NN clarity=NN reason=short reason. Do not add medical facts.',
      context: JSON.stringify(spec)
    });
    parsed = parseJsonPayload(response.text);
    review = normalizeReview(parsed, response.text);
  }
  return review;
}

export async function generateVisualInfographic(rawInput, { ask, state, dir = DEFAULT_VISUAL_DIR, now = new Date() } = {}) {
  if (typeof ask !== 'function') throw new Error('ask_required');
  const target = selectVisualTarget(state, rawInput, now);
  const includeManagement = rawInput?.includeManagement === true;
  const evidenceText = cleanText(rawInput?.evidenceText || '', 10_000);
  const content = await ask({
    task: buildVisualContentTask(target, { includeManagement, evidenceText }),
    context: evidenceText ? `SOURCE EVIDENCE\n${evidenceText}` : 'Adaptive visual learning. No patient-specific data.'
  });
  const spec = normalizeSpec(parseJsonPayload(content.text), target, content.text);
  const review = await reviewWithFallback(ask, target, spec);
  const score = Math.round((review.accuracy + review.levelFit + review.clarity) / 3);
  const accepted = review.verdict === 'pass' && review.accuracy >= 80 && review.levelFit >= 75 && review.clarity >= 75;
  if (!accepted) return { mode: 'visual_cortex', accepted: false, persisted: false, target, review, score, spec };

  const id = `${now.toISOString().replace(/[:.]/g, '-')}-${slug(target.domain)}-${crypto.randomBytes(3).toString('hex')}`;
  const svg = renderVisualSvg(spec, target, review);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const metadata = {
    id,
    createdAt: now.toISOString(),
    topic: target.topic,
    domain: target.domain,
    level: target.level,
    masteryPct: target.masteryPct,
    attempts: target.attempts,
    language: target.language,
    qa: review,
    qaScore: score,
    format: 'svg',
    localGenerated: true,
    externalImageApiRequired: false,
    patientDataUsed: false,
    evidenceTextPersisted: false,
    formattingFallbackUsed: parseJsonPayload(content.text) == null
  };
  await atomicWrite(path.join(dir, `${id}.svg`), svg);
  await atomicWrite(path.join(dir, `${id}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
  return { mode: 'visual_cortex', accepted: true, persisted: true, metadata, svg };
}

export async function listVisualInfographics(dir = DEFAULT_VISUAL_DIR, limit = 30) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const files = (await readdir(dir)).filter((x) => x.endsWith('.json')).sort().reverse().slice(0, clamp(Number(limit) || 30, 1, 100));
  const rows = [];
  for (const file of files) {
    try { rows.push(JSON.parse(await readFile(path.join(dir, file), 'utf8'))); } catch { /* ignore corrupt metadata */ }
  }
  return rows;
}

export async function readVisualSvg(id, dir = DEFAULT_VISUAL_DIR) {
  const safe = cleanText(id, 160);
  if (!/^[a-zA-Z0-9_-]+$/.test(safe)) throw new Error('visual_id_invalid');
  return readFile(path.join(dir, `${safe}.svg`), 'utf8');
}

export const visualCapabilities = Object.freeze({
  adaptiveTopicSelection: true,
  learnerLevelFit: ['foundation', 'r1', 'board'],
  localSvgRendering: true,
  externalImageApiRequired: false,
  medicalQaBeforePersistence: true,
  masteryDriven: true,
  bilingualVisuals: true,
  patientDataRequired: false,
  treatmentClaimsNeedEvidence: true,
  smallModelFormattingFallback: true,
  malformedJsonDoesNotBypassMedicalQa: true
});
