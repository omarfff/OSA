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

## Learning style

The learner prefers video-first teaching, minimal reading, Arabic/English overlays, highly structured explanations, daily tasks, high-yield clinical patterns, and heavy question practice.

## Adaptive learning loop

The adaptive server implements:

`diagnose -> teach gap -> retrieve -> feedback -> record -> space -> re-test`

Tracked domains include MSE, risk, formulation, psychosis, mood, anxiety/OCD/trauma, addiction, child/adolescent, geriatric psychiatry, psychopharmacology, emergency psychiatry, psychotherapy, and law/ethics.

The learner state stores only educational performance fields such as correctness, confidence, mastery, streak, and next review time. It does not store patient narratives.

## OSCE / roleplay loop

The OSCE engine implements:

`station stem -> actor roleplay -> learner-led interview -> finish -> rubric feedback -> targeted retrieval`

Initial stations include depression with suicide-risk assessment, acute mania, first-episode psychosis, alcohol withdrawal, delirium, capacity/treatment refusal, OCD, and child ADHD via parent collateral.

Difficulty levels are `foundation`, `r1`, and `board`. The actor keeps the hidden case profile private during the station and answers in natural Egyptian Arabic by default, switching to English when the learner does. OSCE scoring is formative rather than an official examination result.

## Voice OSCE

Voice OSCE adds a transport-neutral speech layer without making the core server depend on a commercial speech provider. A voice-capable client can transcribe the learner locally or through an authorized speech service and submit the transcript plus optional acoustic-process metrics.

Actor replies include delivery directives such as rate, volume, prosody, response latency, and interruptibility so a speech renderer can make simulated mania, depression, guarded psychosis, withdrawal, or delirium sound behaviorally distinct without changing the hidden clinical facts.

Learner acoustic metrics are used only for communication coaching: pacing, therapeutic pauses, interruptions, and processing time. They are not used to diagnose the learner or infer personality, deception, dangerousness, or competence.

Raw audio is not persisted by Psychiatry Brain. OSCE transcripts remain memory-only and are removed at finish/expiry.

## Runtime

`src/context.mjs` loads only this directory's knowledge files.

`src/adaptive-server.mjs` is the default service entry point and keeps the original `/ask` behavior while adding adaptive learning, OSCE, and Voice OSCE endpoints.

Run:

```bash
cd psychiatry-brain
npm test
npm start
```

### API

- `GET /health` - isolated service, adaptive-engine, OSCE, and Voice OSCE status.
- `POST /ask` - normal psychiatry-only question answering.
- `POST /study` - adaptive study modes: `adaptive`, `diagnostic`, `teach`, `viva`, `mcq`, `review`, `case`.
- `POST /progress/attempt` - record performance metadata for one skill.
- `GET /progress` - mastery map, due reviews, and next weak domain.
- `GET /osce/stations` - list public OSCE station stems without hidden case profiles or rubrics.
- `POST /osce/start` - start a fictional OSCE session and return actor voice-delivery directives.
- `POST /osce/turn` - text OSCE turn.
- `POST /osce/voice/turn` - voice-ready turn using transcript plus optional acoustic-process metrics.
- `POST /osce/finish` - finish either text or voice-ready OSCE and delete memory-only session state.
- `POST /osce/voice/finish` - explicit Voice OSCE finish alias with communication coaching.

Example study request:

```json
{
  "mode": "diagnostic",
  "topic": "mse"
}
```

Example performance event:

```json
{
  "domain": "mse",
  "skill": "mood_vs_affect",
  "correct": true,
  "confidence": 80,
  "difficulty": 3
}
```

Example OSCE start:

```json
{
  "stationId": "acute-mania",
  "difficulty": "r1"
}
```

Example Voice OSCE turn:

```json
{
  "sessionId": "...",
  "transcript": "How many hours have you been sleeping?",
  "wordsPerMinute": 145,
  "responseLatencyMs": 700,
  "pauseRatio": 0.22,
  "interruptionCount": 0
}
```

The service remains loopback-only and is not connected to the main OSA commercial knowledge loader.
