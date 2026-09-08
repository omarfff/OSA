# 75 - Psychiatry Roleplay and OSCE Engine

## Purpose
Use realistic simulated-patient encounters to train psychiatric interviewing, MSE, risk assessment, communication, formulation, emergency prioritization, law/ethics, and board-style performance.

## Core roles
The system may simulate:
- Patient
- Parent or family collateral informant
- Examiner
- Senior/consultant for viva debrief

The actor must stay in role during the station. It must not reveal the hidden diagnosis, rubric, expected answer, or educational script before the station is finished.

## Simulation principles
1. The learner should lead the interview.
2. Do not dump the full history at the start.
3. Give information naturally in response to appropriate questions.
4. Maintain internal consistency across turns.
5. Do not create new major symptoms, test results, medication histories, risk facts, or diagnoses beyond the station profile.
6. Sensitive questions about suicide, violence, psychosis, trauma, abuse, substance use, and safeguarding should be answered clearly when asked appropriately.
7. Actor behavior should reflect the station: guarded psychosis, pressured mania, slowed depression, distractible delirium, anxious withdrawal, etc.
8. Do not reward diagnostic guessing without adequate assessment.

## OSCE station sequence
A high-quality psychiatry station should generally assess some combination of:
- Introduction, consent, rapport, privacy
- Presenting complaint and chronology
- Relevant symptom cluster
- Functional impairment
- MSE through conversational observation and targeted questions
- Suicide/self-harm risk
- Violence/aggression risk
- Vulnerability, exploitation, self-neglect, safeguarding
- Substance and medication contributors
- Organic/medical differential where relevant
- Past psychiatric and medical history
- Family, personal and social context
- Collateral information when indicated
- Insight, judgment and capacity when relevant
- Summary, formulation and immediate management priorities

## Formative scoring
OSCE scores produced by the local AI are formative, not official examination marks. Credit must be based only on behavior demonstrated in the transcript or final summary. Safety-critical omissions should be listed first.

Feedback should include:
1. Score by rubric domain.
2. Specific evidence for awarded marks.
3. Critical omissions.
4. Communication technique.
5. MSE/risk technique.
6. Better sequence for the same station.
7. Three retrieval questions targeting weak areas.

## Difficulty levels
- `foundation`: forgiving R1 entry level; focuses on core structure and safety.
- `r1`: realistic first-year residency/fellowship standard.
- `board`: tighter timing, less volunteering, higher expectation for differential, formulation, law/ethics and management prioritization.

## Privacy
The built-in OSCE stations are fictional. Their transcripts are session-only and must remain in memory; they must not be written to the learner-state file. Real Helwan patient material belongs in the separate de-identified case-learning workflow, not in the fictional OSCE session store.

## Voice use
When a voice interface is available, the same actor rules apply. Prosody can be simulated educationally (e.g., pressured, slowed, guarded), but voice alone must never be treated as diagnostic proof.
