# Runtime Services
OSA Host Autopilot Watchdog runs about every 5 minutes. It monitors media freshness, Telegram token/service state, disk, Ollama and Brain, and may restart safe services. It reports health; it does not invent business state.

OSA Brain: `osa-brain.service`, loopback port 8787, Ollama `qwen3.5:0.8b`. Keep bounded single concurrency/context/output; thinking disabled for routine tasks. Use for drafting, summarization, classification, media narration and diagnosis. Model output is untrusted analysis until checked.

OSA Brain Operator: `osa-brain-operator.timer` runs every 15 minutes. It gathers verified local watchdog state, asks OSA Brain for one revenue-focused safe reversible next action, and persists the plan plus evidence requirements under `/var/lib/osa-brain-operator`. It has analysis/drafting authority only: it cannot submit forms, publish, transfer funds, sign, execute shell commands, handle secrets or bypass access controls.

Media Worker: public RSS -> original/factual narration -> local espeak-ng -> ffmpeg vertical MP4. It may use OSA Brain and falls back to deterministic copy. Media is marketing support, not revenue. No auto-publishing without an authorized external account/connector.

Telegram Solana Wallet Tracker: installed, tracks public Solana addresses and sends informational alerts only. It never trades or moves funds. It remains inactive until authorized BotFather token is provided; never log or echo token.

Revenue Bot Swarm runs hourly at ChatGPT automation layer and inspects leads/offer events/replies/payment, payment readiness, AI/Telegram/media/watchdog health, programming defects, controlled lead discovery and safe commercial actions while suppressing duplicate/no-change noise.
