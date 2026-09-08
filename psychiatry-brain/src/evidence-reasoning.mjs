const MAX_CASE_CHARS = 8_000;
const MAX_QUESTION_CHARS = 1_000;
const MAX_SOURCE_TEXT_CHARS = 8_000;
const MAX_TOTAL_EVIDENCE_CHARS = 32_000;
const MAX_SOURCES = 4;

const SOURCE_TYPES = new Set([
  'guideline',
  'regulatory',
  'systematic_review',
  'primary_study',
  'textbook',
  'local_protocol',
  'other'
]);

const SOURCE_PRIORITY = {
  regulatory: 1,
  guideline: 2,
  local_protocol: 3,
  systematic_review: 4,
  primary_study: 5,
  textbook: 6,
  other: 7
};

function cleanRequired(value, field, maxChars) {
  const text = String(value || '').replace(/\r/g, '').trim();
  if (!text) throw new Error(`${field}_required`);
  if (text.length > maxChars) throw new Error(`${field}_too_long`);
  return text;
}

function cleanOptional(value, maxChars) {
  const text = String(value || '').replace(/\r/g, '').trim();
  if (text.length > maxChars) throw new Error('field_too_long');
  return text;
}

function cleanLanguage(value) {
  const language = String(value || 'bilingual').trim().toLowerCase();
  if (!['arabic', 'english', 'bilingual'].includes(language)) throw new Error('language_invalid');
  return language;
}

function languageInstruction(language) {
  if (language === 'arabic') return 'اكتب بالعربية الواضحة مع إبقاء أسماء الأدوية والمصطلحات النفسية القياسية بالإنجليزية عند الحاجة.';
  if (language === 'english') return 'Write in concise professional medical English.';
  return 'Use concise Arabic explanation with the key psychiatric and pharmacology terms in English.';
}

export function sanitizeEvidenceSources(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error('evidence_sources_invalid');
  if (input.length > MAX_SOURCES) throw new Error('too_many_evidence_sources');
  let total = 0;
  const sources = input.map((raw, index) => {
    const title = cleanRequired(raw?.title || `Evidence source ${index + 1}`, 'source_title', 220);
    const type = String(raw?.type || 'other').trim().toLowerCase();
    if (!SOURCE_TYPES.has(type)) throw new Error('source_type_invalid');
    const text = cleanRequired(raw?.text, 'source_text', MAX_SOURCE_TEXT_CHARS);
    total += text.length;
    if (total > MAX_TOTAL_EVIDENCE_CHARS) throw new Error('evidence_too_large');
    const date = cleanOptional(raw?.date || '', 40);
    const authority = cleanOptional(raw?.authority || '', 160);
    return {
      id: `S${index + 1}`,
      title,
      type,
      priority: SOURCE_PRIORITY[type] || SOURCE_PRIORITY.other,
      date,
      authority,
      text
    };
  });
  return sources.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function sanitizeEvidenceReasoningRequest(input = {}) {
  const caseText = cleanRequired(input.caseText, 'case_text', MAX_CASE_CHARS);
  const question = cleanOptional(input.question || '', MAX_QUESTION_CHARS);
  const language = cleanLanguage(input.language);
  const focus = cleanOptional(input.focus || '', 500);
  const sources = sanitizeEvidenceSources(input.evidenceSources);
  return { caseText, question, language, focus, sources };
}

export function renderEvidenceContext(sources) {
  if (!sources?.length) return '(No external evidence source was supplied. Do not fabricate current guideline claims.)';
  return sources.map((source) => {
    const meta = [source.type, source.authority, source.date].filter(Boolean).join(' | ');
    return `[${source.id}] ${source.title}${meta ? ` (${meta})` : ''}\n${source.text}`;
  }).join('\n\n---\n\n');
}

export function buildClinicalQuestionTask({ question, language, focus = '' }) {
  return `EVIDENCE-BASED PSYCHIATRY TRAINING — CLINICAL QUESTION.\n${languageInstruction(language)}\nUse only the patient facts in CURRENT PSYCHIATRY CONTEXT. Do not invent negatives, diagnoses, laboratory values, doses, or comorbidities. ${question ? `The learner supplied this draft question: ${question}` : 'Derive the most decision-relevant clinical question from the case.'} ${focus ? `Educational focus: ${focus}.` : ''}\nReturn exactly:\n1. Clinical question — one precise sentence, PICO-style when appropriate.\n2. Decision variables — 3-6 patient-specific modifiers that materially affect the decision and are actually present in the case.\n3. Missing information — only high-impact information that is not documented and would change the decision.\nDo not provide the treatment answer yet. Do not expose private chain-of-thought.`;
}

export function buildSourceExtractionTask({ source, language, decisionContext = '' }) {
  return `SOURCE EXTRACTION FOR EVIDENCE-BASED PSYCHIATRY.\nSource ID: ${source.id}. Source title: ${source.title}. Source type: ${source.type}. ${source.authority ? `Authority: ${source.authority}.` : ''} ${source.date ? `Date: ${source.date}.` : ''}\n${languageInstruction(language)}\nDecision context: ${decisionContext || 'psychiatry clinical decision'}.\nExtract ONLY what this source explicitly supports that is relevant to the decision. Do not add outside knowledge. Preserve uncertainty and exceptions. Maximum 120 words. Use compact bullets and prefix every bullet with [${source.id}]. Prioritize recommendations, contraindications, interactions, patient modifiers, monitoring, thresholds, and evidence limitations when actually present. Do not expose private chain-of-thought.`;
}

export async function buildEvidenceDigest(sources, { ask, decisionContext = '', language = 'bilingual' } = {}) {
  if (typeof ask !== 'function') throw new Error('ask_required');
  if (!sources?.length) return { text: '(No external evidence digest available.)', items: [] };
  const items = [];
  for (const source of sources) {
    const answer = await ask({
      task: buildSourceExtractionTask({ source, language, decisionContext }),
      context: `AUTHORITATIVE SOURCE EXCERPT ${source.id}\n${source.text}`,
      maxPredict: 220,
      numCtx: 4096
    });
    items.push({ id: source.id, title: source.title, type: source.type, priority: source.priority, text: answer.text });
  }
  return {
    text: items.map((item) => `[${item.id}] ${item.title} (${item.type})\n${item.text}`).join('\n\n---\n\n'),
    items
  };
}

export function buildEvidenceSynthesisTask({ language, focus = '', hasExternalEvidence }) {
  return `EVIDENCE-BASED PSYCHIATRY TRAINING — AUDITABLE DECISION SUPPORT.\n${languageInstruction(language)}\n${focus ? `Educational focus: ${focus}.` : ''}\nEvidence mode: ${hasExternalEvidence ? 'source-grounded evidence digest supplied in CURRENT PSYCHIATRY CONTEXT' : 'no external current evidence supplied; use the local psychiatry study knowledge only as a learning scaffold and explicitly require current-source verification before a clinical claim'}.\n\nRules:\n- Do NOT reveal a hidden chain-of-thought. Give a concise, auditable clinical rationale instead.\n- Separate patient facts, source-supported claims, and inference.\n- Every evidence claim from supplied sources must cite its source ID in square brackets, e.g. [S1].\n- If sources conflict, expose the conflict rather than silently reconciling it.\n- Prefer current regulatory/guideline material over lower-priority sources when both address the same decision, but never invent freshness or authority that was not supplied.\n- Never invent a dose, threshold, contraindication, interaction, monitoring interval, or recommendation not supported by supplied evidence or retrievable psychiatry study knowledge.\n- For real patient care, label any unresolved high-stakes point for senior/local-policy verification.\n\nReturn these sections:\nA. Clinical question\nB. Patient modifiers\nC. Evidence map — source-by-source, with what each source actually supports\nD. Recommendation — concise and conditional on the documented facts\nE. Alternatives — why the closest alternatives may be less suitable or when they become suitable\nF. Safety & monitoring\nG. Uncertainty / conflicting evidence / missing data\nH. Evidence trail — 3-7 short source-linked statements\nI. Consultant viva — exactly 3 questions that test whether the learner can defend the decision with evidence.`;
}

export async function generateEvidenceReasoningBundle(rawInput, { ask }) {
  if (typeof ask !== 'function') throw new Error('ask_required');
  const request = sanitizeEvidenceReasoningRequest(rawInput);

  const questionResult = await ask({
    task: buildClinicalQuestionTask(request),
    context: `DE-IDENTIFIED OR FICTIONAL CASE FOR EDUCATION\n${request.caseText}`,
    maxPredict: 300,
    numCtx: 4096
  });

  const digest = await buildEvidenceDigest(request.sources, {
    ask,
    decisionContext: questionResult.text,
    language: request.language
  });

  const synthesis = await ask({
    task: buildEvidenceSynthesisTask({
      language: request.language,
      focus: request.focus,
      hasExternalEvidence: request.sources.length > 0
    }),
    context: `CASE\n${request.caseText}\n\nCLINICAL-QUESTION WORKUP\n${questionResult.text}\n\nSOURCE-GROUNDED EVIDENCE DIGEST\n${digest.text}`,
    maxPredict: 700,
    numCtx: 8192
  });

  return {
    mode: 'evidence_based_clinical_reasoning',
    sourceGrounded: request.sources.length > 0,
    externalEvidenceRequired: request.sources.length === 0,
    sourceHierarchy: request.sources.map(({ id, title, type, priority, date, authority }) => ({ id, title, type, priority, date, authority })),
    evidenceDigestUnits: digest.items.map(({ id, title, type }) => ({ id, title, type })),
    casePersisted: false,
    evidenceTextPersisted: false,
    evidenceDigestPersisted: false,
    hiddenChainOfThoughtExposed: false,
    clinicalQuestion: questionResult.text,
    synthesis: synthesis.text
  };
}
