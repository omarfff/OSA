const MAX_SOURCE_CHARS = 80_000;
const MAX_DRAFT_CHARS = 12_000;
const DEFAULT_CHUNK_CHARS = 6_500;

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

function languageInstruction(language) {
  if (language === 'arabic') return 'اكتب بالعربية الطبية الواضحة، مع المصطلحات النفسية الإنجليزية القياسية عند الحاجة.';
  if (language === 'english') return 'Write in professional academic psychiatric English.';
  return 'Write the formal note in professional psychiatric English, and give teaching/audit feedback in Arabic with key English terms.';
}

export function sanitizeDocumentationRequest(input = {}) {
  const sourceText = cleanRequired(input.sourceText, 'source_text', MAX_SOURCE_CHARS);
  const learnerDraft = cleanOptional(input.learnerDraft || '', MAX_DRAFT_CHARS);
  const format = String(input.format || 'full_psychiatric').trim().toLowerCase();
  if (!['full_psychiatric', 'soap', 'board_case'].includes(format)) throw new Error('format_invalid');
  const language = String(input.language || 'bilingual').trim().toLowerCase();
  if (!['arabic', 'english', 'bilingual'].includes(language)) throw new Error('language_invalid');
  const sourceKind = String(input.sourceKind || 'deidentified_case_notes').trim().toLowerCase();
  if (!['fictional_transcript', 'deidentified_transcript', 'deidentified_case_notes'].includes(sourceKind)) throw new Error('source_kind_invalid');
  return { sourceText, learnerDraft, format, language, sourceKind };
}

export function splitDocumentationSource(text, { chunkChars = DEFAULT_CHUNK_CHARS } = {}) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (!clean) return [];
  const out = [];
  let start = 0;
  let index = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + chunkChars);
    if (end < clean.length) {
      const best = Math.max(clean.lastIndexOf('\n\n', end), clean.lastIndexOf('\n', end), clean.lastIndexOf('. ', end));
      if (best > start + Math.floor(chunkChars * 0.55)) end = best + (clean[best] === '.' ? 1 : 0);
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) out.push({ index, text: chunk });
    index += 1;
    start = end;
    while (start < clean.length && /\s/.test(clean[start])) start += 1;
  }
  return out;
}

export function buildFactExtractionTask({ unit, unitCount, language, sourceKind }) {
  return `PSYCHIATRIC DOCUMENTATION LAB — SOURCE FACT EXTRACTION.\nSource kind: ${sourceKind}. Unit ${unit}/${unitCount}. ${languageInstruction(language)}\nExtract ONLY clinically relevant facts explicitly present in CURRENT PSYCHIATRY CONTEXT. Maximum 140 words. Preserve attribution: patient report, collateral report, or observable clinician description. Cover history, medications, substances, social/family facts, MSE observations and risk facts when actually present. Do not diagnose, formulate, interpret silence, or invent negatives. Prefix each bullet with [Unit ${unit}]. If a domain is absent, omit it rather than calling it negative. Do not expose private chain-of-thought.`;
}

export async function extractDocumentationFacts(request, { ask }) {
  const chunks = splitDocumentationSource(request.sourceText);
  const facts = [];
  for (const chunk of chunks) {
    const answer = await ask({
      task: buildFactExtractionTask({ unit: chunk.index + 1, unitCount: chunks.length, language: request.language, sourceKind: request.sourceKind }),
      context: `SOURCE UNIT ${chunk.index + 1}/${chunks.length}\n${chunk.text}`,
      maxPredict: 240,
      numCtx: 4096
    });
    facts.push({ unit: chunk.index + 1, text: answer.text });
  }
  return { chunks, facts, text: facts.map((x) => `[Unit ${x.unit}]\n${x.text}`).join('\n\n---\n\n') };
}

export function buildStructuredNoteTask({ format, language, sourceKind }) {
  const formatInstruction = format === 'soap'
    ? 'Use a psychiatric SOAP structure: Subjective, Objective/MSE, Assessment including differential and risk, Plan.'
    : format === 'board_case'
      ? 'Use an Egyptian Board-style case presentation: identifying data, presenting complaint, HPC, past psychiatric/medical history, medications, substance use, family history, personal/social history, premorbid personality, MSE, risk, differential, 4Ps formulation, investigations, management.'
      : 'Use a comprehensive psychiatric assessment: identifying data, presenting complaint, HPC, past psychiatric history, medical history, medications/allergies if documented, substance use, family history, personal/social/developmental history, premorbid personality, MSE, risk, differential, 4Ps formulation, investigations and management considerations.';
  return `PSYCHIATRIC DOCUMENTATION LAB — SOURCE-FAITHFUL NOTE.\nSource kind: ${sourceKind}. ${languageInstruction(language)}\n${formatInstruction}\n\nRules:\n1. Use ONLY facts explicitly present in CURRENT PSYCHIATRY CONTEXT, which contains source-derived fact units.\n2. Absence of documentation is not a negative finding. Never convert absent information into a negative. Write 'not documented' or 'not assessed in the supplied material' where clinically important.\n3. Distinguish patient report/collateral report from clinician observation.\n4. MSE must contain only observable or explicitly described findings. Do not infer appearance, rapport, affect, insight, cognition, psychosis, suicidality, or capacity from silence.\n5. Differential diagnosis and formulation may be reasoned, but label them as clinical interpretation rather than source fact.\n6. The 4Ps formulation must explain vulnerability, triggers, maintenance and protective factors; do not merely repeat the history. If a P is unsupported, state that evidence is insufficient.\n7. Risk section must identify what is documented and what critical information remains unknown.\n8. Do not invent medication doses, investigations, legal status or treatment decisions.\n9. This is educational documentation, not a signed clinical record.\nDo not expose private chain-of-thought.`;
}

export function buildDocumentationAuditTask({ language, hasLearnerDraft }) {
  return `PSYCHIATRIC DOCUMENTATION LAB — EVIDENCE AUDIT.\n${languageInstruction(language)}\nCompare the SOURCE-DERIVED FACT UNITS against the GENERATED NOTE${hasLearnerDraft ? ' and the LEARNER DRAFT' : ''}.\nReturn:\n1. Supported documentation — trace important statements to source units.\n2. Unsupported / over-inferred claims.\n3. Missing high-yield domains — missing, never negative.\n4. MSE audit — observation vs report vs inference.\n5. Risk audit — suicide/self-harm, violence, vulnerability/safeguarding, self-neglect, substance/withdrawal, medical risk; state what remains unknown.\n6. 4Ps audit — grade each P Strong / Partial / Unsupported.\n${hasLearnerDraft ? '7. Learner-vs-model comparison.\n8. ' : '7. '}Top 5 rewrite priorities.\nNever invent source facts or claim an omitted question was asked. Do not expose private chain-of-thought.`;
}

export async function generateDocumentationLabBundle(rawInput, { ask }) {
  if (typeof ask !== 'function') throw new Error('ask_required');
  const request = sanitizeDocumentationRequest(rawInput);
  const extracted = await extractDocumentationFacts(request, { ask });

  const note = await ask({
    task: buildStructuredNoteTask(request),
    context: `SOURCE-DERIVED FACT UNITS\n${extracted.text}`,
    maxPredict: 900,
    numCtx: 8192
  });

  const auditContext = [
    `SOURCE-DERIVED FACT UNITS\n${extracted.text}`,
    `GENERATED NOTE\n${note.text}`,
    request.learnerDraft ? `LEARNER DRAFT\n${request.learnerDraft}` : ''
  ].filter(Boolean).join('\n\n---\n\n');

  const audit = await ask({
    task: buildDocumentationAuditTask({ language: request.language, hasLearnerDraft: Boolean(request.learnerDraft) }),
    context: auditContext,
    maxPredict: 750,
    numCtx: 8192
  });

  return {
    mode: 'documentation_formulation_lab',
    format: request.format,
    sourceKind: request.sourceKind,
    learnerDraftCompared: Boolean(request.learnerDraft),
    sourceUnits: extracted.chunks.length,
    sourceCoverageUnits: extracted.facts.map((x) => x.unit),
    sourcePersisted: false,
    sourceFactDigestPersisted: false,
    learnerDraftPersisted: false,
    generatedNotePersisted: false,
    rawAudioPersisted: false,
    note: note.text,
    audit: audit.text
  };
}
