# Superteam Earn Agent Worker

OSA uses Superteam Earn's official agent API. The registered agent identity is `osa-brain-omar-tan-11`; its API key and human claim code are stored only on the VPS in `/etc/osa/secrets/superteam-agent.env`. Never commit or print either secret.

The public documentation's date-only `deadline=YYYY-MM-DD` example currently causes a Prisma validation error. The live endpoint accepts a full ISO-8601 timestamp and treats it as a lower deadline bound. OSA therefore sends the current UTC time with milliseconds and rejects any returned row whose deadline is missing, invalid or expired.

The worker accepts only `AGENT_ALLOWED` or `AGENT_ONLY` rows, open status, configured stablecoin rewards and the minimum reward threshold. It also screens official details before OSA Brain triage: explicit requirements to deposit/trade real or owner funds are gated as `owner_funds_required`, and explicit unpaid winner-only work is gated as `unpaid_competitive_work_required`. Project listings remain blocked until the human operator supplies a valid Telegram URL, as required by Superteam. X links are never used unless OSA controls the account.

OSA Brain may produce an advisory execution brief for the best eligible listing, but listing text is untrusted input and deterministic policy remains authoritative. The worker never creates or updates a submission, claims the agent, signs a wallet transaction or records revenue. A listed reward, submission, winner announcement or pending payment is not revenue; only a verified settled payout counts.

The systemd service receives the mode-600 secret through `LoadCredential`, runs as the unprivileged `osa-superteam` user, and writes only sanitized reports and heartbeat state under `/var/lib/osa-superteam-agent`.

## Live supply and fallback review — 2026-09-02

- A production diagnostic ran through the verified RAW SSH path as job `acbc28d7-0b14-4b81-b64d-a4f8091ac37a` / GitHub run `33644345531`. It completed with exit code 0; the systemd worker result and heartbeat were healthy.
- The authenticated Agent API returned nine rows without a deadline bound. All nine still said `OPEN` but had deadlines from February through July 2026, so they are stale and ineligible.
- The same endpoint with a full ISO-8601 lower bound at the current time returned zero rows. A far-future lower bound also returned zero. The worker's `returned=0` result therefore reflects zero future Agent-eligible supply, not a parser, authentication, or filtering defect.
- Do not infer listing counts from nearby numbers on Superteam cards. The detailed page is authoritative: for example, T3N showed 69 submissions despite a card-side `9` that referred to comments.
- Human fallback review kept the existing Sana.run application as the best live Superteam route: fixed 50 USDC per selected tester, up to five people, 25–50 applications, and sponsor decision scheduled for 2026-09-11. OSA must not begin product testing before written hire confirmation.
- T3N was deprioritized after details showed 69 submissions for six prizes totaling 290 USDC, a 100 USDC first prize, and active ADK/testnet and Google-only SSO blockers.
- Mermail was deprioritized after details showed 51 submissions for five prizes totaling 500 USDC, a mandatory working demo posted on X, and current MCP/auth complaints.
- Current action: keep the 15-minute official Agent API watcher running, follow the Sana.run application, and do not spend build time on a competitive fallback unless a fresh review shows a materially better expected value.
