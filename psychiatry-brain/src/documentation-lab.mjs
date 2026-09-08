const MAX_SOURCE_CHARS = 120_000;
const MAX_DRAFT_CHARS = 45_000;

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

export function buildStructuredNoteTask({ format, language, sourceKind }) {
  const formatInstruction = format === 'soap'
    ? 'Use a psychiatric SOAP structure: Subjective, Objective/MSE, Assessment including differential and risk, Plan.'
    : format === 'board_case'
      ? 'Use an Egyptian Board-style case presentation: identifying data, presenting complaint, HPC, past psychiatric/medical history, medications, substance use, family history, personal/social history, premorbid personality, MSE, risk, differential, 4Ps formulation, investigations, management.'
      : 'Use a comprehensive psychiatric assessment: identifying data, presenting complaint, HPC, past psychiatric history, medical history, medications/allergies if documented, substance use, family history, personal/social/developmental history, premorbid personality, MSE, risk, differential, 4Ps formulation, investigations and management considerations.';
  return `PSYCHIATRIC DOCUMENTATION LAB — SOURCE-FAITHFUL NOTE.\nSource kind: ${sourceKind}. ${languageInstruction(language)}\n${formatInstruction}\n\nRules:\n1. Use ONLY facts explicitly present in CURRENT PSYCHIATRY CONTEXT.\n2. Never convert absent information into a negative. Write 'not documented' or 'not assessed in the supplied material' where clinically important.\n3. Distinguish patient report/collateral report from clinician observation.\n4. MSE must contain only observable or explicitly described findings. Do not infer appearance, rapport, affect, insight, cognition, psychosis, suicidality, or capacity from silence.\n5. Differential diagnosis and formulation may be reasoned, but label them as clinical interpretation rather than source fact.\n6. The 4Ps formulation must explain vulnerability, triggers, maintenance and protective factors; do not merely repeat the history. If a P is unsupported, state that evidence is insufficient.\n7. Risk section must explicitly identify what is documented and what critical information remains unknown.\n8. Do not invent medication doses, investigations, legal status or treatment decisions.\n9. This is educational documentation, not a signed clinical record.\nDo not expose private chain-of-thought.`;
}

export function buildDocumentationAuditTask({ language, hasLearnerDraft }) {
  return `PSYCHIATRIC DOCUMENTATION LAB — EVIDENCE AUDIT.\n${languageInstruction(language)}\nCompare the SOURCE MATERIAL against the GENERATED NOTE${hasLearnerDraft ? ' and the LEARNER DRAFT' : ''}. This is a teaching audit, not a rewrite exercise.\n\nReturn these sections:\n1. Supported documentation — important statements correctly traceable to the source.\n2. Unsupported / over-inferred claims — anything stated more strongly than the source permits.\n3. Missing high-yield domains — clinically important areas absent from the supplied material; label them missing, never negative.\n4. MSE audit — separate direct observation, reported symptoms and inference; flag category errors.\n5. Risk audit — suicide/self-harm, violence, vulnerability/safeguarding, self-neglect, substance/withdrawal, medical risk; report only what is supported and what remains unknown.\n6. 4Ps formulation audit — predisposing, precipitating, perpetuating, protective; grade each as Strong / Partial / Unsupported and explain briefly.\n${hasLearnerDraft ? '7. Learner-vs-model comparison — what the learner captured better, missed, or over-inferred.\n8. ' : '7. '}Top 5 rewrite priorities — concrete skills to improve next time.\n\nNever invent source facts. Never claim that an omitted question was asked. Do not expose private chain-of-thought.`;
}

export async function generateDocumentationLabBundle(rawInput, { ask }) {
  if (typeof ask !== 'function') throw new Error('ask_required');
  const request = sanitizeDocumentationRequest(rawInput);

  const note = await ask({
    task: buildStructuredNoteTask(request),
    context: `SOURCE MATERIAL\n${request.sourceText}`
  });

  const auditContext = [
    `SOURCE MATERIAL\n${request.sourceText}`,
    `GENERATED NOTE\n${note.text}`,
    request.learnerDraft ? `LEARNER DRAFT\n${request.learnerDraft}` : ''
  ].filter(Boolean).join('\n\n---\n\n');

  const audit = await ask({
    task: buildDocumentationAuditTask({ language: request.language, hasLearnerDraft: Boolean(request.learnerDraft) }),
    context: auditContext
  });

  return {
    mode: 'documentation_formulation_lab',
    format: request.format,
    sourceKind: request.sourceKind,
    learnerDraftCompared: Boolean(request.learnerDraft),
    sourcePersisted: false,
    learnerDraftPersisted: false,
    generatedNotePersisted: false,
    rawAudioPersisted: false,
    note: note.text,
    audit: audit.text
  };
}
