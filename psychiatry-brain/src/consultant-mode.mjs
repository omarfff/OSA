import { sanitizeEvidenceSources, renderEvidenceContext } from './evidence-reasoning.mjs';

const MAX_CASE_CHARS = 30_000;
const MAX_DECISION_CHARS = 12_000;
const MAX_RESPONSE_CHARS = 12_000;

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

function sanitizeBase(input = {}) {
  const caseText = cleanRequired(input.caseText, 'case_text', MAX_CASE_CHARS);
  const learnerDecision = cleanRequired(input.learnerDecision, 'learner_decision', MAX_DECISION_CHARS);
  const evidenceSources = sanitizeEvidenceSources(input.evidenceSources);
  const difficulty = String(input.difficulty || 'board').trim().toLowerCase();
  if (!['r1', 'board', 'consultant'].includes(difficulty)) throw new Error('difficulty_invalid');
  const focus = cleanOptional(input.focus || '', 400);
  return { caseText, learnerDecision, evidenceSources, difficulty, focus };
}

export function sanitizeConsultantChallengeRequest(input = {}) {
  return sanitizeBase(input);
}

export function sanitizeConsultantFeedbackRequest(input = {}) {
  const base = sanitizeBase(input);
  const learnerResponse = cleanRequired(input.learnerResponse, 'learner_response', MAX_RESPONSE_CHARS);
  return { ...base, learnerResponse };
}

export function buildConsultantChallengeTask({ difficulty, focus, hasEvidence }) {
  return `CONSULTANT MODE — PSYCHIATRY ORAL DEFENCE.\nDifficulty: ${difficulty}. ${focus ? `Focus: ${focus}.` : ''}\nThe learner has committed to a clinical decision. Act like a demanding but educational senior psychiatry consultant.\n\nRules:\n- Ask exactly ONE challenge question, then stop and wait for the learner.\n- Do not give the answer or hint.\n- Choose the highest-value weakness among: diagnostic justification, suicide/violence/medical risk, differential, contraindication, interaction, dose/renal-hepatic modifier, monitoring, capacity/law, alternative treatment, or evidence quality.\n- ${hasEvidence ? 'If evidence sources are supplied, make the challenge answerable from those sources and identify no unsupported facts.' : 'No external evidence source is supplied; challenge the learner to identify what evidence/guideline must be checked rather than inventing a current recommendation.'}\n- Never invent missing case facts.\n- The challenge should force the learner to defend WHY, not recite trivia.\n- End exactly with: "What evidence supports your decision?"\nDo not expose private chain-of-thought.`;
}

export function buildConsultantFeedbackTask({ difficulty, focus, hasEvidence }) {
  return `CONSULTANT MODE — FORMATIVE FEEDBACK AFTER DEFENCE.\nDifficulty: ${difficulty}. ${focus ? `Focus: ${focus}.` : ''}\nAssess the learner's stated decision and answer against the documented case and supplied evidence.\n\nReturn exactly:\n1. Verdict: Strong / Partially supported / Unsafe or unsupported.\n2. What the learner did well — max 3 bullets.\n3. What is weak or unsupported — max 4 bullets.\n4. Evidence check — cite supplied source IDs such as [S1] for every source-derived correction. If no external source was provided, state what current guideline/regulatory source must be verified instead of inventing it.\n5. Safety check — identify any missed high-stakes issue from documented facts; do not invent risks.\n6. Better consultant-level answer — concise, auditable rationale, not hidden chain-of-thought.\n7. Next challenge — exactly ONE harder follow-up question, without the answer.\n\nNever fabricate doses, thresholds, contraindications, diagnoses, findings or guideline claims. ${hasEvidence ? 'Stay source-grounded when correcting evidence claims.' : 'Treat local knowledge as a study scaffold and clearly label current-source verification needs.'}`;
}

export async function generateConsultantChallenge(rawInput, { ask }) {
  if (typeof ask !== 'function') throw new Error('ask_required');
  const request = sanitizeConsultantChallengeRequest(rawInput);
  const evidence = renderEvidenceContext(request.evidenceSources);
  const answer = await ask({
    task: buildConsultantChallengeTask({
      difficulty: request.difficulty,
      focus: request.focus,
      hasEvidence: request.evidenceSources.length > 0
    }),
    context: `CASE\n${request.caseText}\n\nLEARNER DECISION\n${request.learnerDecision}\n\nEVIDENCE SOURCES\n${evidence}`
  });
  return {
    mode: 'consultant_challenge',
    difficulty: request.difficulty,
    sourceGrounded: request.evidenceSources.length > 0,
    externalEvidenceRequired: request.evidenceSources.length === 0,
    casePersisted: false,
    learnerDecisionPersisted: false,
    challengePersisted: false,
    challenge: answer.text
  };
}

export async function generateConsultantFeedback(rawInput, { ask }) {
  if (typeof ask !== 'function') throw new Error('ask_required');
  const request = sanitizeConsultantFeedbackRequest(rawInput);
  const evidence = renderEvidenceContext(request.evidenceSources);
  const answer = await ask({
    task: buildConsultantFeedbackTask({
      difficulty: request.difficulty,
      focus: request.focus,
      hasEvidence: request.evidenceSources.length > 0
    }),
    context: `CASE\n${request.caseText}\n\nLEARNER DECISION\n${request.learnerDecision}\n\nLEARNER DEFENCE\n${request.learnerResponse}\n\nEVIDENCE SOURCES\n${evidence}`
  });
  return {
    mode: 'consultant_feedback',
    difficulty: request.difficulty,
    sourceGrounded: request.evidenceSources.length > 0,
    externalEvidenceRequired: request.evidenceSources.length === 0,
    casePersisted: false,
    learnerDecisionPersisted: false,
    learnerResponsePersisted: false,
    feedbackPersisted: false,
    feedback: answer.text
  };
}
