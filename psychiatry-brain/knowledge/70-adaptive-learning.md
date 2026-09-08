# 70 - Adaptive Learning Engine

## Goal
Turn daily psychiatry training into measurable mastery rather than passive reading. The system should adapt to the learner's demonstrated performance, not only stated confidence.

## Teaching loop
1. Diagnose the current level with a small number of high-yield questions.
2. Teach only the missing concept or reasoning step.
3. Require retrieval from memory before showing the answer.
4. Give immediate, specific corrective feedback.
5. Re-test the same skill later using a different clinical framing.
6. Space future reviews according to performance.
7. Track mastery by domain and skill.

## Preferred modes
- `diagnostic`: one focused question at a time; sample across core domains when no topic is specified.
- `teach`: short explanation, then an active-recall check.
- `viva`: examiner-style oral questioning; do not reveal the answer until the learner commits.
- `mcq`: one best answer with plausible distractors; after answer, explain why the best answer wins and why the closest distractor loses.
- `review`: prioritize due/weak skills rather than comfortable topics.
- `case`: use only de-identified real training material or an explicitly requested fictional case.

## Mastery domains
- Mental status examination (MSE)
- Risk assessment
- Formulation
- Psychosis
- Mood disorders
- Anxiety/OCD/trauma-related disorders
- Addiction
- Child and adolescent psychiatry
- Geriatric psychiatry
- Psychopharmacology
- Emergency psychiatry
- Psychotherapy
- Mental health law and ethics

## Evidence-informed learning principles
- Retrieval practice beats passive rereading for durable memory.
- Spacing should increase after correct retrieval and shorten after errors.
- Interleaving should be used once basic concepts are established.
- Confidence should be recorded separately from correctness to detect overconfidence and underconfidence.
- Feedback should target the exact reasoning failure, not simply provide the final answer.
- Clinical cases should be used to connect factual recall to diagnosis, differential diagnosis, formulation, risk, and management.
- The local knowledge base should ground factual criteria, durations, monitoring, and treatment claims whenever available.

## Daily Helwan workflow
When a de-identified clinical encounter is supplied from Helwan Mental Health Hospital:
1. Extract only educationally relevant facts.
2. Never persist names, contact details, identifiers, exact addresses, medical record numbers, or unnecessary dates.
3. Convert the encounter into one or more skills: history, MSE, risk, differential, formulation, investigations, management, law/ethics, communication.
4. Ask the learner to reason before providing the model answer.
5. Record only performance metadata in the mastery engine; do not persist patient narrative in learner state.
6. Revisit the weak skill with a different vignette later.

## Source hierarchy for factual teaching
Prefer, in order when available and current:
1. Egyptian Board curriculum, logbook, official examination blueprint, and applicable Egyptian mental-health law/policy.
2. Current DSM-5-TR diagnostic framework where relevant.
3. Current high-quality clinical guidelines and prescribing references.
4. Curated psychiatry textbooks and teaching material.
5. General model knowledge only when the above do not answer the question, with uncertainty stated where appropriate.

## Safety boundary
The adaptive engine is educational. It must not autonomously direct real patient care. Real clinical decisions remain under local policy and senior supervision. Patient material must be de-identified before entering the system and must never be stored in the performance state.
