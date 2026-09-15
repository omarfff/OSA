# Psychiatry Visual Cortex

## Purpose
The Visual Cortex turns weak or due psychiatry skills into compact bilingual visual learning artifacts. It is an adaptive teaching layer, not a decorative image generator.

## Adaptive rule
Choose visual difficulty from demonstrated learner performance:
- **Foundation**: little practice or low mastery. Use recognition, definitions, simple contrasts and memory hooks.
- **R1**: intermediate mastery. Add clinical discrimination, risk, differential diagnosis and next assessment steps.
- **Board**: high mastery. Add exam traps, subtle discriminators and consultant-style distinctions.

The system should prefer the weakest psychiatry domain from the existing mastery map unless the learner explicitly requests a topic.

## Visual content rules
Each visual should normally contain:
1. A short title and one-line learning goal.
2. Four to six compact sections.
3. No more than five bullets per section.
4. A memory hook or contrast where useful.
5. A small red-flag/safety area when clinically relevant.
6. A footer reminding the learner that current treatment decisions require current guidance.

Arabic explanation with core English psychiatric terminology is the default learner format.

## Medical QA gate
A generated visual is not saved to the learner library until a second pass checks:
- medical accuracy,
- suitability for the learner's current level,
- visual/text clarity,
- unsupported diagnostic criteria or durations,
- unsupported medication doses, monitoring intervals or treatment recommendations,
- dangerous omissions or false equivalence.

If the QA gate fails, discard the visual rather than teaching a questionable fact.

## Treatment and evidence
Routine automatically generated visuals should focus on recognition, differentiation, assessment, MSE, risk and memory structure. Exact treatment recommendations, doses, monitoring thresholds or guideline-specific claims require a bounded current evidence excerpt supplied for that visual.

Maudsley/textbooks may support concepts, but current regulatory information and current guidelines take priority for current prescribing decisions.

## Privacy
Visual generation should never require identifiable patient data. Use the learner mastery map, psychiatry study knowledge, fictional cases or de-identified learning material only. Do not persist evidence excerpts or patient narrative in visual metadata.

## Rendering
The baseline renderer is local SVG. This lets the VPS create real image files without a GPU, external image API, or public internet access. A richer external image provider can be added later as an optional renderer, but must not weaken the medical QA or privacy gate.

## Daily loop
The daily worker may create up to three accepted visuals from weak/due domains. Rejected drafts do not count. Visuals should support later retrieval practice rather than replace questions, cases, OSCEs or consultant feedback.
