# 76 - Voice OSCE and Communication Coaching

## Purpose
Extend simulated psychiatry OSCE practice from text-only roleplay to voice-ready encounters while keeping clinical interpretation conservative and privacy-preserving.

## Core rule
Voice is an **observable communication channel**, not a diagnostic shortcut. Never diagnose depression, mania, psychosis, anxiety, personality, intoxication, neurodevelopmental disorder, deception, dangerousness, or competence from voice features alone.

## Actor delivery
Each fictional station can expose a delivery envelope for a speech client/TTS layer:
- speech rate;
- volume;
- prosodic style;
- response latency;
- interruptibility/overlap tendency;
- short performance notes.

Examples:
- simulated mania may use rapid/pressured/interruptive delivery;
- simulated depression may use slower, softer delivery with longer pauses;
- simulated psychosis may be guarded and hesitant;
- simulated delirium may fluctuate in attention/coherence.

These are properties of the fictional actor script, not inferences from real patients.

## Learner voice observations
A voice-capable client may send a transcript plus optional acoustic-process metrics such as:
- words per minute;
- response latency;
- mean pause duration;
- pause ratio;
- interruption/overlap count;
- average volume estimate;
- self-correction count.

The local server uses these only for **communication coaching** such as pacing, allowing therapeutic silence, avoiding excessive interruptions, and giving a distressed patient processing time.

## Limits
Acoustic metrics may be distorted by microphone quality, automatic gain control, compression, background noise, accent, language, device processing, speech-recognition errors, or network delay. Feedback must acknowledge these limitations.

## Privacy
- Raw audio is not stored by the Psychiatry Brain Voice OSCE adapter.
- OSCE transcripts are memory-only and are deleted when the session ends/expires.
- Durable learner state stores educational performance metadata only.
- Do not submit identifiable real-patient recordings to the simulator.

## API workflow
1. `POST /osce/start` returns station stem plus actor delivery directives.
2. A voice client captures speech locally or through an authorized transcription layer.
3. `POST /osce/voice/turn` sends the learner transcript plus optional acoustic-process metrics.
4. The actor replies with text plus delivery directives for speech rendering.
5. `POST /osce/voice/finish` returns OSCE feedback plus formative communication coaching.

## Training target
Use Voice OSCE to train:
- rapport and therapeutic stance;
- concise open and closed questioning;
- handling silence;
- non-confrontational psychosis interviewing;
- containment of pressured/disorganized interviews;
- direct but empathic suicide-risk questions;
- difficult conversations and capacity discussions;
- board-style verbal summaries and management plans.
