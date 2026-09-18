# Gemini Opportunity Pipeline

## Decision record

Work-Type: direct-blocker

Revenue-Impact: blocker

External-Evidence: the owner observed that Gemini was reported connected while OSA produced no opportunities, deals, or income; live diagnostics then showed four consecutive research jobs failing because `/v1/research` returned not_found, the Gemini provider override was discarded, and automatic patch preparation was disabled

Why-Now: the revenue system was presenting model connectivity as progress even though research and execution stopped before producing a source-backed opportunity or tested deliverable

Kill-Criteria: stop expanding infrastructure after grounded live research completes successfully and qualified bounties can produce one tested review-ready patch; keep external claims human-gated and use resulting market evidence to choose the next change

Risk-Exception: none

## Operating rule

Gemini connectivity is not a commercial outcome. OSA may report progress only when the corresponding stage has independent evidence:

- discovery: current official sources and search metadata;
- qualification: open task, exact reward, claim path, competition, payout rail, and eligibility evidence;
- production: a local patch plus allow-listed test evidence;
- external commitment: owner-reviewed claim or submission;
- revenue: independently verified settlement.

The daily research job searches the live public web rather than treating a fixed watchlist as the market. Seed URLs are starting points only. It rejects vague, unpaid, claimed, expired, points-only, speculative, security-sensitive, or upfront-payment work.

The bounty worker prepares before claiming. Gemini or another configured OSA router provider may analyze and generate the candidate patch. The systemd boundary forces `AUTO_PREPARE_FIX=true`, `AUTO_ATTEMPT=false`, and `FINANCIAL_BROADCAST_ENABLED=false`.
