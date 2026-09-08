# Psychiatry Study Brain

This directory is an intentionally isolated knowledge domain for Dr. Omar Saad Alkhateeb's psychiatry training and study workflow.

## Hard boundary

- This domain MUST NOT load or inherit OSA commercial, revenue, payments, wallets, property, trading, bounty, sales, or infrastructure knowledge.
- Runtime context is built only from `psychiatry-brain/knowledge/`.
- Cross-domain retrieval is denied by default.
- Patient material must be de-identified before use.
- The adaptive learner state persists only performance metadata; patient narratives are not persisted.
- Built-in OSCE stations are fictional and their transcripts are memory-only for the life of the session.
- Voice OSCE does not persist raw audio and does not use voice features as stand-alone medical or personality inference.
- Full Live OSCE stores only graded educational performance in the durable mastery map; interview/viva transcripts remain memory-only.
- Uploaded/extracted guideline or textbook source text used for document simulation is request-scoped and is not written into learner state or knowledge files.
- Evidence excerpts, de-identified case text, learner drafts, generated notes, and Consultant Mode dialogue are request-scoped and are not persisted by the new training engines.
- The VPS remains network-isolated. Current external evidence retrieval happens in an authorized ChatGPT/client/plugin layer and only bounded source excerpts are passed into Psychiatry Brain.

## Purpose

The Psychiatry Study Brain is designed to support:

1. Egyptian Psychiatry Fellowship / Egyptian Board study.
2. First-year psychiatry residency competence.
3. PCE / SCFHS psychiatry preparation and later Prometric/equivalency-style review.
4. Arab Board psychiatry knowledge and exam readiness where relevant.
5. DSM-5-TR diagnostic reasoning, MSE, risk assessment, formulation, psychopharmacology, and emergency psychiatry.
6. Case-based learning, MCQs, EMI-style questions, sequential reasoning, and rapid revision.
7. Arabic/Egyptian-Arabic clinical notes -> professional academic English psychiatric documentation.
8. Structured observation of speech, prosody, behavior, psychomotor activity, and non-verbal clinical signs when audio/video is provided.
9. Psychiatry AI/R&D ideas, evaluation frameworks, inventions, devices, patents, and investment concepts.
10. Adaptive mastery tracking, confidence calibration, retrieval practice, and spaced review.
11. Session-based simulated-patient roleplay and formative psychiatry OSCE practice.
12. Voice-ready OSCE delivery and learner communication coaching.
13. Full Live timed OSCE with dynamic actor interaction, bell/timeout, post-station viva, and automatic mastery updates.
14. Source-grounded conversion of uploaded guideline/textbook chapters into high-yield summaries and difficult Egyptian Fellowship/Board simulation questions.
15. Evidence-based clinical reasoning with source hierarchy, patient modifiers, safety/monitoring, uncertainty, and auditable evidence trails.
16. Psychiatric documentation and 4Ps formulation training with source-faithfulness audits and learner-draft comparison.
17. Consultant-style oral defence that challenges one decision at a time with: `What evidence supports your decision?`

## Learning style

The learner prefers video-first teaching, minimal reading, Arabic/English overlays, highly structured explanations, daily tasks, high-yield clinical patterns, and heavy question practice.

## Adaptive learning loop

The adaptive server implements:

`diagnose -> teach gap -> retrieve -> feedback -> record -> space -> re-test`

Tracked domains include MSE, risk, formulation, psychosis, mood, anxiety/OCD/trauma, addiction, child/adolescent, geriatric psychiatry, psychopharmacology, emergency psychiatry, psychotherapy, and law/ethics.

The learner state stores only educational performance fields such as correctness, graded score, confidence, mastery, streak, and next review time. It does not store patient narratives.

## Evidence-Based Clinical Reasoning

The evidence engine implements:

`case facts -> focused clinical question -> evidence hierarchy -> patient modifiers -> recommendation -> alternatives -> safety/monitoring -> uncertainty -> evidence trail -> consultant viva`

Evidence sources are supplied as bounded structured excerpts. Supported source classes are `regulatory`, `guideline`, `local_protocol`, `systematic_review`, `primary_study`, `textbook`, and `other`. The engine ranks the supplied sources for navigation, but does not invent freshness, authority, doses, contraindications, thresholds, interactions, or monitoring rules.

If no external evidence excerpt is supplied, the result explicitly sets `externalEvidenceRequired: true`. Local Psychiatry Brain knowledge can still be used as a learning scaffold, but current high-stakes clinical claims must be verified against an authoritative current source.

The engine deliberately does **not** expose hidden chain-of-thought. It teaches an auditable rationale: documented patient facts, what each source supports, why the recommendation is conditional, alternatives, safety/monitoring, conflicts, and unresolved uncertainty.

## Documentation & Formulation Lab

The documentation engine implements:

`source transcript/notes -> structured psychiatric note -> source evidence audit -> MSE category audit -> risk-gap audit -> 4Ps quality audit -> learner-vs-model comparison -> rewrite priorities`

Supported note formats are `full_psychiatric`, `soap`, and `board_case`. Supported source kinds are `fictional_transcript`, `deidentified_transcript`, and `deidentified_case_notes`.

Core truth rules:

- absence of documentation is not a negative finding;
- patient report, collateral report, and direct observation are different evidence classes;
- MSE must not infer appearance, rapport, affect, insight, cognition, psychosis, suicidality, or capacity from silence;
- differential diagnosis and 4Ps formulation are interpretations, not source facts;
- unsupported predisposing, precipitating, perpetuating, or protective factors are labeled insufficient rather than invented;
- raw audio, source text, learner draft, generated note, and audit text are not persisted.

The preferred educational workflow is learner-first: the resident writes a draft, then the AI creates an independent structured note and audits both against the same source.

## Consultant Mode

Consultant Mode is stateless and uses two steps:

`learner commits to decision -> one hard challenge -> learner defends -> source-linked formative feedback -> one harder next challenge`

The challenge targets the highest-value weakness: diagnostic justification, dangerous differential, risk, contraindication, interaction, renal/hepatic modifier, monitoring, capacity/law, alternative treatment, or evidence quality. When no current external evidence is supplied, the consultant asks what authoritative source needs verification rather than fabricating a current recommendation.

## OSCE / roleplay loop

The OSCE engine implements:

`station stem -> actor roleplay -> learner-led interview -> finish -> rubric feedback -> targeted retrieval`

Initial stations include depression with suicide-risk assessment, acute mania, first-episode psychosis, alcohol withdrawal, delirium, capacity/treatment refusal, OCD, and child ADHD via parent collateral.

Difficulty levels are `foundation`, `r1`, and `board`. The actor keeps the hidden case profile private during the station and answers in natural Egyptian Arabic by default, switching to English when the learner does. OSCE scoring is formative rather than an official examination result.

## Voice OSCE

Voice OSCE adds a transport-neutral speech layer without making the core server depend on a commercial speech provider. A voice-capable client can transcribe the learner locally or through an authorized speech service and submit the transcript plus optional acoustic-process metrics.

Actor replies include delivery directives such as rate, volume, prosody, response latency, and interruptibility so a speech renderer can make simulated mania, depression, guarded psychosis, withdrawal, or delirium sound behaviorally distinct without changing the hidden clinical facts.

Learner acoustic metrics are used only for communication coaching: pacing, therapeutic pauses, interruptions, and processing time. They are not used to diagnose the learner or infer personality, deception, dangerousness, intelligence, ethnicity, or competence.

Raw audio is not persisted by Psychiatry Brain. OSCE transcripts remain memory-only and are removed at finish/expiry.

## Full Live OSCE

Full Live OSCE implements:

`start -> 7-10 minute timed interview -> dynamic actor -> bell -> candidate summary -> 3-question viva -> final formative assessment -> mastery update -> session deletion`

The default station length is 8 minutes. Once the deadline is reached, the interview stage closes and the service returns a bell state; further interview turns are rejected.

The actor can become more cooperative, guarded, brief, or mildly irritated based on the learner's interaction style. This changes only delivery/engagement. Hidden clinical facts, risk facts, diagnosis, timeline, tests, medication history, and other station facts remain fixed.

After the interview, the learner submits a concise summary. The engine generates three targeted viva questions, waits for the learner's answers, then performs final formative marking. Domain scores are written automatically into the existing mastery engine as graded 0-100 educational events. No patient narrative or viva transcript is written to learner state.

## File / PDF -> simulation workflow

The server-side engine accepts **extracted text** from an uploaded PDF or other study file. PDF parsing can happen in the client/file-analysis layer; Psychiatry Brain receives the extracted chapter text and does not persist it.

Pipeline:

`uploaded file -> extract text -> chunk/coverage map -> source-grounded micro-summaries -> high-yield synthesis -> difficult question batches`

Defaults:

- 10 questions.
- `board` difficulty.
- `sba` format with four options A-D.
- Arabic explanation with key English psychiatric terms.
- Clinical explanation for every option, not only the correct answer.
- Questions must be supported by the supplied source text; the model is instructed not to fill source gaps from general knowledge.
- Long source passages are paraphrased rather than reproduced.
- Source text and generated question text are request-scoped and are not written into the durable learner state.

Supported formats: `sba`, `viva`, and `mixed`.

## Runtime

`src/context.mjs` loads only this directory's knowledge files.

`src/adaptive-server.mjs` preserves the existing adaptive learning, OSCE, Voice OSCE, Full Live OSCE, and document-simulation behavior.

`src/training-server.mjs` is the default service entry point. It wraps the adaptive server without replacing its existing routes, and adds EBP reasoning, documentation/formulation, Consultant Mode, and training capability endpoints.

Run:

```bash
cd psychiatry-brain
npm test
npm start
```

### API

- `GET /health` - existing isolated adaptive service and capability status.
- `GET /training/capabilities` - EBP/documentation/consultant capability and persistence contract.
- `POST /ask` - normal psychiatry-only question answering.
- `POST /study` - adaptive study modes: `adaptive`, `diagnostic`, `teach`, `viva`, `mcq`, `review`, `case`.
- `POST /documents/simulate` - convert extracted study-file text into a grounded summary plus difficult simulation questions.
- `POST /reasoning/evidence` - run the Evidence-Based Clinical Reasoning pipeline over a de-identified/fictional case and bounded evidence excerpts.
- `POST /documentation/formulate` - create a source-faithful psychiatric note and evidence/formulation audit, optionally compared with a learner draft.
- `POST /consultant/challenge` - ask exactly one senior-level challenge after the learner commits to a decision.
- `POST /consultant/feedback` - grade the learner's defence against case facts and supplied evidence and return one harder next challenge.
- `POST /progress/attempt` - record binary or graded performance metadata for one skill.
- `GET /progress` - mastery map, due reviews, and next weak domain.
- `GET /osce/stations` - list public OSCE station stems without hidden case profiles or rubrics.
- `POST /osce/start` - start a fictional OSCE session and return actor voice-delivery directives.
- `POST /osce/turn` - text OSCE turn.
- `POST /osce/voice/turn` - voice-ready turn using transcript plus optional acoustic-process metrics.
- `POST /osce/finish` - finish standard text/voice-ready OSCE and delete memory-only session state.
- `POST /osce/voice/finish` - explicit Voice OSCE finish alias.
- `POST /osce/live/start` - start a timed Full Live OSCE; accepts `durationMinutes` from 7-10.
- `GET /osce/live/status?sessionId=...` - timer/stage/bell status.
- `POST /osce/live/turn` - timed text or transcript+voice-metrics interview turn with dynamic actor adaptation.
- `POST /osce/live/close` - manually ring the bell and close the interview stage.
- `POST /osce/live/viva/start` - submit candidate summary and receive first of three viva questions.
- `POST /osce/live/viva/answer` - answer the current viva question and receive the next one.
- `POST /osce/live/finalize` - final marking, automatic mastery-map update, and deletion of in-memory session data.

Example Evidence-Based Clinical Reasoning request:

```json
{
  "caseText": "De-identified patient with severe depression and chronic kidney disease...",
  "question": "Which antidepressant strategy is most appropriate given renal impairment?",
  "evidenceSources": [
    {
      "title": "Current guideline excerpt",
      "type": "guideline",
      "authority": "NICE",
      "date": "current verified date",
      "text": "<bounded relevant excerpt>"
    }
  ],
  "language": "bilingual"
}
```

Example Documentation Lab request:

```json
{
  "sourceKind": "deidentified_case_notes",
  "sourceText": "<de-identified case material>",
  "learnerDraft": "<learner's first draft>",
  "format": "board_case",
  "language": "bilingual"
}
```

Example Consultant challenge request:

```json
{
  "caseText": "<de-identified or fictional case>",
  "learnerDecision": "My diagnosis and management decision is...",
  "evidenceSources": [
    {
      "title": "Guideline excerpt",
      "type": "guideline",
      "text": "<bounded evidence>"
    }
  ],
  "difficulty": "board"
}
```

Example document simulation request:

```json
{
  "title": "Maudsley chapter - antipsychotics",
  "sourceText": "<extracted chapter text>",
  "questionCount": 10,
  "difficulty": "board",
  "format": "sba",
  "language": "bilingual",
  "focus": "prescribing decisions and monitoring"
}
```

Example Full Live start:

```json
{
  "stationId": "acute-mania",
  "difficulty": "r1",
  "durationMinutes": 8
}
```

Example Full Live voice-ready turn:

```json
{
  "liveSessionId": "...",
  "transcript": "How many hours have you been sleeping?",
  "wordsPerMinute": 145,
  "responseLatencyMs": 700,
  "pauseRatio": 0.22,
  "interruptionCount": 0
}
```

Example graded performance event supported by the mastery engine:

```json
{
  "domain": "risk",
  "skill": "osce_depression_suicide_risk",
  "scorePct": 78,
  "difficulty": 3
}
```

The service remains loopback-only and is not connected to the main OSA commercial knowledge loader.
