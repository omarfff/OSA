import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeEvidenceReasoningRequest,
  buildClinicalQuestionTask,
  buildEvidenceSynthesisTask,
  generateEvidenceReasoningBundle
} from '../src/evidence-reasoning.mjs';
import {
  sanitizeDocumentationRequest,
  splitDocumentationSource,
  buildStructuredNoteTask,
  buildDocumentationAuditTask,
  generateDocumentationLabBundle
} from '../src/documentation-lab-v2.mjs';
import {
  buildConsultantChallengeTask,
  buildConsultantFeedbackTask,
  generateConsultantChallenge,
  generateConsultantFeedback
} from '../src/consultant-mode.mjs';

function stubAskCollector() {
  const calls = [];
  const ask = async ({ task, context }) => {
    calls.push({ task, context });
    if (task.includes('CLINICAL QUESTION')) return { text: '1. Clinical question\n2. Decision variables\n3. Missing information' };
    if (task.includes('SOURCE EXTRACTION FOR EVIDENCE')) return { text: '[S1] renal function modifies prescribing.' };
    if (task.includes('AUDITABLE DECISION SUPPORT')) return { text: 'A. Clinical question\nB. Patient modifiers\nC. Evidence map [S1]\nD. Recommendation' };
    if (task.includes('SOURCE FACT EXTRACTION')) return { text: '[Unit 1] Patient reports insomnia.' };
    if (task.includes('SOURCE-FAITHFUL NOTE')) return { text: 'Presenting complaint: documented.\nRisk: not documented.' };
    if (task.includes('EVIDENCE AUDIT')) return { text: '1. Supported documentation\n2. Unsupported claims: none.' };
    if (task.includes('ORAL DEFENCE')) return { text: 'Which current guideline supports this choice?\nWhat evidence supports your decision?' };
    if (task.includes('FORMATIVE FEEDBACK')) return { text: '1. Verdict: Partially supported\n4. Evidence check: [S1]\n7. Next challenge: monitoring?' };
    return { text: 'stub' };
  };
  return { ask, calls };
}

test('evidence request ranks authoritative sources and keeps case bounded', () => {
  const request = sanitizeEvidenceReasoningRequest({
    caseText: 'De-identified patient with depression and chronic kidney disease.',
    evidenceSources: [
      { title: 'Textbook', type: 'textbook', text: 'older background' },
      { title: 'Guideline', type: 'guideline', text: 'current recommendation' },
      { title: 'Regulatory', type: 'regulatory', text: 'product safety information' }
    ]
  });
  assert.deepEqual(request.sources.map((x) => x.type), ['regulatory', 'guideline', 'textbook']);
  assert.equal(request.caseText.includes('kidney'), true);
});

test('EBP prompts require auditable rationale rather than hidden chain-of-thought', () => {
  const q = buildClinicalQuestionTask({ question: '', language: 'bilingual', focus: '' });
  const s = buildEvidenceSynthesisTask({ language: 'bilingual', hasExternalEvidence: true });
  assert.match(q, /Do not expose private chain-of-thought/i);
  assert.match(s, /auditable clinical rationale/i);
  assert.match(s, /cite its source ID/i);
  assert.match(s, /If sources conflict/i);
});

test('evidence reasoning compresses source first and returns non-persistent grounded bundle', async () => {
  const { ask, calls } = stubAskCollector();
  const bundle = await generateEvidenceReasoningBundle({
    caseText: 'De-identified patient with severe depression and CKD.',
    evidenceSources: [{ title: 'Renal prescribing guideline', type: 'guideline', text: 'Dose adjustment depends on renal function.' }]
  }, { ask });
  assert.equal(bundle.sourceGrounded, true);
  assert.equal(bundle.externalEvidenceRequired, false);
  assert.equal(bundle.casePersisted, false);
  assert.equal(bundle.evidenceTextPersisted, false);
  assert.equal(bundle.evidenceDigestPersisted, false);
  assert.equal(bundle.hiddenChainOfThoughtExposed, false);
  assert.equal(calls.length, 3);
  assert.match(calls[1].task, /SOURCE EXTRACTION FOR EVIDENCE/);
  assert.match(calls[1].context, /AUTHORITATIVE SOURCE EXCERPT S1/);
  assert.match(calls[2].context, /SOURCE-GROUNDED EVIDENCE DIGEST/);
  assert.match(calls[2].context, /\[S1\]/);
});

test('evidence reasoning without external sources explicitly asks for current retrieval', async () => {
  const { ask } = stubAskCollector();
  const bundle = await generateEvidenceReasoningBundle({ caseText: 'Fictional exam case.' }, { ask });
  assert.equal(bundle.sourceGrounded, false);
  assert.equal(bundle.externalEvidenceRequired, true);
});

test('documentation lab refuses to treat absent data as negative and supports learner comparison', () => {
  const request = sanitizeDocumentationRequest({
    sourceText: 'Patient reports low mood. No other domains documented.',
    learnerDraft: 'Low mood. Suicide risk low.',
    format: 'board_case',
    sourceKind: 'deidentified_case_notes'
  });
  const noteTask = buildStructuredNoteTask(request);
  const auditTask = buildDocumentationAuditTask({ language: request.language, hasLearnerDraft: true });
  assert.match(noteTask, /Absence of documentation is not/i);
  assert.match(noteTask, /MSE must contain only observable/i);
  assert.match(auditTask, /Learner-vs-model comparison/i);
  assert.match(auditTask, /state what remains unknown/i);
});

test('documentation chunking covers long source instead of truncating first pages', () => {
  const source = Array.from({ length: 80 }, (_, i) => `Section ${i + 1}. ${'clinical source text '.repeat(20)}`).join('\n\n');
  const chunks = splitDocumentationSource(source, { chunkChars: 1200 });
  assert.ok(chunks.length > 3);
  assert.match(chunks[0].text, /Section 1/);
  assert.match(chunks.at(-1).text, /Section 80/);
});

test('documentation bundle extracts facts first and never persists transcript, draft, note or raw audio', async () => {
  const { ask, calls } = stubAskCollector();
  const bundle = await generateDocumentationLabBundle({
    sourceText: 'Fictional transcript: patient reports insomnia.',
    learnerDraft: 'Insomnia reported.',
    sourceKind: 'fictional_transcript'
  }, { ask });
  assert.equal(bundle.sourcePersisted, false);
  assert.equal(bundle.sourceFactDigestPersisted, false);
  assert.equal(bundle.learnerDraftPersisted, false);
  assert.equal(bundle.generatedNotePersisted, false);
  assert.equal(bundle.rawAudioPersisted, false);
  assert.equal(bundle.sourceUnits, 1);
  assert.deepEqual(bundle.sourceCoverageUnits, [1]);
  assert.equal(calls.length, 3);
  assert.match(calls[0].task, /SOURCE FACT EXTRACTION/);
  assert.match(calls[0].context, /SOURCE UNIT 1\/1/);
  assert.match(calls[1].context, /SOURCE-DERIVED FACT UNITS/);
  assert.match(calls[2].context, /LEARNER DRAFT/);
});

test('consultant mode asks one evidence challenge then gives source-linked formative feedback', async () => {
  const challengeTask = buildConsultantChallengeTask({ difficulty: 'board', focus: '', hasEvidence: true });
  const feedbackTask = buildConsultantFeedbackTask({ difficulty: 'board', focus: '', hasEvidence: true });
  assert.match(challengeTask, /Ask exactly ONE challenge question/i);
  assert.match(challengeTask, /What evidence supports your decision\?/);
  assert.match(feedbackTask, /Better consultant-level answer/i);
  assert.match(feedbackTask, /cite supplied source IDs/i);

  const { ask } = stubAskCollector();
  const challenge = await generateConsultantChallenge({
    caseText: 'Fictional case with depression and renal impairment.',
    learnerDecision: 'I would choose treatment X after renal review.',
    evidenceSources: [{ title: 'Guideline', type: 'guideline', text: 'Renal status changes prescribing decisions.' }]
  }, { ask });
  assert.equal(challenge.casePersisted, false);
  assert.equal(challenge.sourceGrounded, true);

  const feedback = await generateConsultantFeedback({
    caseText: 'Fictional case with depression and renal impairment.',
    learnerDecision: 'I would choose treatment X after renal review.',
    learnerResponse: 'Because the guideline requires renal consideration.',
    evidenceSources: [{ title: 'Guideline', type: 'guideline', text: 'Renal status changes prescribing decisions.' }]
  }, { ask });
  assert.equal(feedback.learnerResponsePersisted, false);
  assert.equal(feedback.feedbackPersisted, false);
});
