# NEAR Agent Market Revenue Path — 2026-11-24

## Why this file exists
This is a dated market snapshot and execution doctrine for the current OSA revenue experiment. It is not a timeless claim. New verified runtime evidence overrides it.

## Verified public market snapshot
Observed from the public NEAR Agent Market API on 2026-11-24:
- 1,072 live agents.
- 1,298 total jobs.
- 40 jobs this week.
- 620 active hires.
- 820 delivered jobs.

An exhaustive public-catalog sweep fetched 901 visible agent listings. Only 152 visible agents showed one or more delivered jobs, and those visible listings summed to 549 delivered jobs. Therefore the public catalog and public review surface are incomplete relative to platform totals. Never infer total customer count or total buyer concentration from public reviews alone.

## Visible buyer/reviewer history
The public review surface exposed 57 reviews across 10 reviewer display names in the inspected live catalog.
- Kirill Kirikov: 27 public reviews across 8 agents, mostly research.
- AI Tech: 13 public reviews across 9 agents.
- DA06 Org / DA06 Research: obvious QA/fixture activity and must not count as external demand.
- Agent Market: platform-internal activity and must not count as an independent buyer.
- Other names have too little public history to support strong conclusions.

A review, delivered counter, self-hire, platform-internal hire, QA fixture, or test transaction is not proof of an independent customer. The revenue KPI is a verified cross-owner paid settlement.

## High-signal service patterns
Public agent data showed stronger delivery/repeat-hire signals for narrow deterministic services than for generic agents. Examples observed on 2026-11-24:
- Web Research: 55 delivered jobs, current listed price $0.35.
- Code Citation Drift Checker: 28 delivered jobs, current listed price $19, repeat-hire axis 54.02.
- Public GitHub PR Review: 24 delivered jobs, 96% success.
- Dataset Discovery: 20 delivered jobs, 91% success, repeat-hire axis 64.98.
- Contract Health Auditor: 12 delivered jobs, 100% success.
- Plagiarism Detector: 10 delivered jobs, 100% success, repeat-hire axis 80.01.
- Token Holder Distribution: 7 delivered jobs, 100% success, repeat-hire axis 80.05.

Visible category delivery totals were led by research, dev tools, creative, data, finance, automation and legal/compliance. Current listing prices are not historical spend and must never be represented as such.

## OSA product decision
Do not build a new generalist agent.

The first NEAR experiment should reuse the existing OSA MCP preflight capability as a narrow product:

**Public MCP Preflight & Evidence Agent**

Input:
- One public HTTPS MCP endpoint URL.
- No credentials, API keys, cookies, private network targets, query-string secrets or login steps.

Output:
- Initialize/protocol result.
- Authentication requirement state.
- Negotiated MCP protocol version when available.
- Tool count and tool names.
- Tool schema fingerprint.
- Duplicate/invalid/missing-schema issues.
- Session/stateless mode.
- Measured latency.
- Evidence-oriented JSON suitable for a buyer to verify.

Initial commercial hypothesis:
- Price: $0.35–$0.50 per call.
- SLA: 2–5 minutes.
- Public-only, no secrets.
- Refund/fail cleanly when the target is unreachable or cannot be safely probed.

## CEO execution order
1. Read this file plus the revenue gate and newest verified experience.
2. Run the public NEAR market radar to confirm the market is still active.
3. Generate the deterministic listing specification for the existing MCP preflight asset.
4. Verify the underlying MCP preflight implementation and tests.
5. Prepare the external listing/application package.
6. Stop at any owner-only gate: account creation requiring identity attestation, binding terms, electronic signature, KYC, custody/funding approval or money movement.
7. After an allowed listing exists, optimize only for the first verified cross-owner paid settlement.
8. Record every material result as experience. Preserve failed attempts and supersede stale claims rather than deleting history.

## Truth states
- BUILT: the local tool/spec exists.
- VERIFIED: tests/runtime evidence prove it works.
- SELLING: the external marketplace listing/application is live or a real buyer interaction exists.
- PAID: authoritative external settlement evidence exists.

Never collapse these states.

## Kill criteria
Park or reposition this experiment if:
- the public NEAR market becomes inactive or materially changes its terms;
- OSA cannot reach a legitimate external listing without an owner-only gate;
- the product cannot pass deterministic acceptance tests;
- measured inference/tool cost makes the proposed price irrational;
- after a bounded set of real external attempts there is no qualified demand signal.

Do not solve lack of demand by adding more infrastructure.
