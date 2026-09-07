# Psychiatry Study Brain

This directory is an intentionally isolated knowledge domain for Dr. Omar Saad Alkhateeb's psychiatry training and study workflow.

## Hard boundary

- This domain MUST NOT load or inherit OSA commercial, revenue, payments, wallets, property, trading, bounty, sales, or infrastructure knowledge.
- Runtime context is built only from `psychiatry-brain/knowledge/`.
- Cross-domain retrieval is denied by default.
- Patient material must be de-identified before persistence.

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

## Learning style

The learner prefers video-first teaching, minimal reading, Arabic/English overlays, highly structured explanations, daily tasks, high-yield clinical patterns, and heavy question practice.

## Runtime

`src/context.mjs` loads only this directory's knowledge files and produces the system context for a psychiatry-only model session.

Run:

```bash
cd psychiatry-brain
npm test
node src/context.mjs
```

The output is a psychiatry-only context bundle. It is not connected to the main OSA commercial knowledge loader.
