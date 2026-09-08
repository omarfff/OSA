# 85 - Full Live Psychiatry OSCE

## Purpose
Run timed, realistic psychiatry OSCE stations that combine simulated-patient roleplay, voice-process coaching, examiner viva, and automatic adaptive-learning updates.

## Live station lifecycle
`start -> timed interview -> dynamic actor response -> bell/timeout -> candidate summary -> viva -> formative score -> mastery update -> session deletion`

## Timing
- Default station duration: 8 minutes.
- Allowed duration: 7 to 10 minutes.
- The service exposes remaining time and emits a bell state when time reaches zero.
- Once timed out, no further interview turns are accepted; the candidate proceeds to summary/viva.

## Dynamic actor behavior
The simulated patient may adjust cooperation, brevity, guardedness, irritability, or willingness to elaborate based on the learner's interaction style. Adaptation must remain within the fictional station profile and must never invent new major symptoms, risks, diagnoses, tests, or medical history.

Examples:
- respectful validation and open questions may improve engagement in guarded psychosis;
- repeated confrontation may increase guardedness or irritability;
- frequent interruption may shorten answers;
- appropriate silence and empathic reflections may increase disclosure;
- highly pressured or unsafe questioning should not be rewarded.

## Voice-process coaching
Optional process metrics may include speaking rate, pauses, response latency, and interruption count. They are used only for communication coaching and must not be used to infer diagnosis, personality, intelligence, ethnicity, or other latent traits.

## Viva
After the interview closes, the examiner asks short viva questions targeting diagnosis/differential, formulation, risk, investigations, management, law/ethics, and weak areas from the interview. The learner should answer before feedback is shown.

## Scoring and mastery
- OSCE scoring is formative only.
- Safety-critical omissions are surfaced first.
- Only demonstrated performance receives credit.
- After finalization, the service records educational performance metadata into the existing mastery engine using the station's mapped domains.
- Patient narratives, OSCE transcripts, and raw audio are never persisted in learner state.

## Privacy and safety
- Built-in stations are fictional.
- Real clinical material must be de-identified before educational use.
- Raw audio is not persisted by the Psychiatry Brain service.
- Live session transcripts remain in memory only and are deleted after finalization or expiry.
