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

## Learning style

The learner prefers video-first teaching, minimal reading, Arabic/English overlays, highly structured explanations, daily tasks, high-yield clinical patterns, and heavy question practice.

## Adaptive learning loop

The adaptive server implements:

`diagnose -> teach gap -> retrieve -> feedback -> record -> space -> re-test`

Tracked domains include MSE, risk, formulation, psychosis, mood, anxiety/OCD/trauma, addiction, child/adolescent, geriatric psychiatry, psychopharmacology, emergency psychiatry, psychotherapy, and law/ethics.

The learner state stores only educational performance fields such as correctness, graded score, confidence, mastery, streak, and next review time. It does not store patient narratives.

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

`src/adaptive-server.mjs` is the default service entry point and keeps the original `/ask` behavior while adding adaptive learning, OSCE, Voice OSCE, Full Live OSCE, and document-simulation endpoints.

Run:

```bash
cd psychiatry-brain
npm test
npm start
```

### API

- `GET /health` - isolated service and capability status.
- `POST /ask` - normal psychiatry-only question answering.
- `POST /study` - adaptive study modes: `adaptive`, `diagnostic`, `teach`, `viva`, `mcq`, `review`, `case`.
- `POST /documents/simulate` - convert extracted study-file text into a grounded summary plus difficult simulation questions.
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
