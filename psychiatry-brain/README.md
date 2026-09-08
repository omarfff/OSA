# Psychiatry Study Brain

This directory is an intentionally isolated knowledge domain for Dr. Omar Saad Alkhateeb's psychiatry training and study workflow.

## Hard boundary

- This domain MUST NOT load or inherit OSA commercial, revenue, payments, wallets, property, trading, bounty, sales, or infrastructure knowledge.
- Runtime context is built only from `psychiatry-brain/knowledge/`.
- Cross-domain retrieval is denied by default.
- Patient material must be de-identified before use.
- The adaptive learner state persists only performance metadata; patient narratives are not persisted.

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

## Learning style

The learner prefers video-first teaching, minimal reading, Arabic/English overlays, highly structured explanations, daily tasks, high-yield clinical patterns, and heavy question practice.

## Adaptive learning loop

The adaptive server implements:

`diagnose -> teach gap -> retrieve -> feedback -> record -> space -> re-test`

Tracked domains include MSE, risk, formulation, psychosis, mood, anxiety/OCD/trauma, addiction, child/adolescent, geriatric psychiatry, psychopharmacology, emergency psychiatry, psychotherapy, and law/ethics.

The learner state stores only educational performance fields such as correctness, confidence, mastery, streak, and next review time. It does not store patient narratives.

## Runtime

`src/context.mjs` loads only this directory's knowledge files.

`src/adaptive-server.mjs` is the default service entry point and keeps the original `/ask` behavior while adding adaptive learning endpoints.

Run:

```bash
cd psychiatry-brain
npm test
npm start
```

### API

- `GET /health` - isolated service and adaptive-engine status.
- `POST /ask` - normal psychiatry-only question answering.
- `POST /study` - adaptive study modes: `adaptive`, `diagnostic`, `teach`, `viva`, `mcq`, `review`, `case`.
- `POST /progress/attempt` - record performance metadata for one skill.
- `GET /progress` - mastery map, due reviews, and next weak domain.

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

The service remains loopback-only and is not connected to the main OSA commercial knowledge loader.
