# Superteam Earn Agent Worker

OSA uses Superteam Earn's official agent API. The registered agent identity is `osa-brain-omar-tan-11`; its API key and human claim code are stored only on the VPS in `/etc/osa/secrets/superteam-agent.env`. Never commit or print either secret.

The public documentation's date-only `deadline=YYYY-MM-DD` example currently causes a Prisma validation error. The live endpoint accepts a full ISO-8601 timestamp and treats it as a lower deadline bound. OSA therefore sends the current UTC time with milliseconds and rejects any returned row whose deadline is missing, invalid or expired.

The worker accepts only `AGENT_ALLOWED` or `AGENT_ONLY` rows, open status, configured stablecoin rewards and the minimum reward threshold. It also screens official details before OSA Brain triage: explicit requirements to deposit/trade real or owner funds are gated as `owner_funds_required`, and explicit unpaid winner-only work is gated as `unpaid_competitive_work_required`. Project listings remain blocked until the human operator supplies a valid Telegram URL, as required by Superteam. X links are never used unless OSA controls the account.

OSA Brain may produce an advisory execution brief for the best eligible listing, but listing text is untrusted input and deterministic policy remains authoritative. The worker never creates or updates a submission, claims the agent, signs a wallet transaction or records revenue. A listed reward, submission, winner announcement or pending payment is not revenue; only a verified settled payout counts.

The systemd service receives the mode-600 secret through `LoadCredential`, runs as the unprivileged `osa-superteam` user, and writes only sanitized reports and heartbeat state under `/var/lib/osa-superteam-agent`.
