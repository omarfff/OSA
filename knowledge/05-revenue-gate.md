# OSA Revenue-First Execution Gate

## Objective function
OSA optimizes for the next verified external cash event, then successful fulfillment, then repeat payment, under minimum safe execution. Technical capability is a means, not the KPI.

## Truth states
- BUILT: code or configuration exists.
- VERIFIED: behavior was proven with external/runtime evidence.
- SELLING: a real external buyer, contract, application, proposal, or active commercial conversation exists.
- PAID: external settlement is verified by authoritative payment evidence.

Never collapse these states. BUILT is not VERIFIED; VERIFIED is not SELLING; SELLING is not PAID.

## Work classes and default priority
1. REVENUE_ACTION: contact, application, proposal, follow-up, negotiation, checkout request, delivery, retention.
2. DIRECT_BLOCKER: the smallest technical fix that directly unblocks a named external revenue action.
3. SAFETY_INCIDENT: active secret exposure, unauthorized-access risk, data-loss risk, legal/compliance requirement, or production outage affecting a real user/buyer.
4. PRODUCT/INFRA EXPANSION: new platform, payment rail, chain, browser framework, autonomy layer, watchdog, hardening, dashboard, agent, or generalized architecture.

Before the first verified external payment, PRODUCT/INFRA EXPANSION is frozen by default. It may proceed only when it is the minimum fix for a DIRECT_BLOCKER or a SAFETY_INCIDENT.

## Minimum Safe Execution
Security is a guardrail, not the mission. Never weaken secret protection, authorization boundaries, legal/identity gates, or irreversible financial controls. Beyond those minimum controls, additional hardening must be justified by current exposure, a real incident, or a named external deal blocker.

## Manual-first rule
A bounded human step is acceptable when it is legal, safe, and dramatically faster than automating it. Prove the money path first; automate repeated work after demand is observed. Do not spend hours eliminating seconds of human setup while verified external revenue is zero.

## Platform rule
Do not add a new earning platform merely because it offers rewards. The current platform/path must first be either exercised with real submissions/interactions sufficient to learn from the market, or proven unusable/ineligible with evidence. When a platform offers fewer than 20 eligible opportunities, exhaust the eligible high-fit queue instead of inventing a quota.

Prize pools, points, quests, faucets, testnet balances, crawler hits, account creation, generated applications and internal test payments are not revenue.

## Payment rule
Keep one working receive/settlement path per real buyer need. Do not add chains, wallets, reconciliation layers, off-ramps, or payment protocols until a payer requests them or the current rail blocks a real payment.

## Freeze rule
Once infrastructure works sufficiently for the current commercial action, freeze it. Reopen only for a measured failure that blocks a real buyer, delivery, settlement, or a safety incident.

## WIP limit
Until first verified payment: one primary revenue path and at most one backup. Everything else is parked.

## Kill criteria
- Up to 20 targeted real outbound attempts with no qualified reply: change message/offer/segment before more build work.
- 50 targeted real outbound attempts with no qualified commercial signal: kill or materially reposition that segment/offer.
- A platform that cannot reach a real submission after one bounded setup/debug window is parked unless expected value clearly justifies more work.
- A payment/infrastructure task with no named buyer/blocker is frozen.
- A feature with no external demand evidence is not a pre-payment priority.

## Decision record for new work
Every non-trivial task must answer:
- Work-Type: revenue-action | direct-blocker | safety-incident | product | infrastructure | payment | platform | browser | autonomy | maintenance
- Revenue-Impact: direct | blocker | fulfillment | retention | none
- External-Evidence: named buyer/lead/application/incident/payment evidence, or `none`
- Why-Now: why this beats the next revenue action
- Kill-Criteria: what stops further work
- Risk-Exception: none | security-incident | legal | data-loss | production-outage

If Revenue-Impact is `none` and Risk-Exception is `none`, the task is parked before first verified payment.

## Control-plane enforcement
While `pre_first_payment=true` in the OSA control plane, VPS tasks using `git_write`, `migrate`, `payment_config`, or `browser_commit` are rejected unless their metadata supplies `revenue_impact`, `external_evidence`, `why_now`, `kill_criteria`, and `risk_exception`. A documented safety exception may pass with external incident/legal/production evidence. This makes the gate active even when work is initiated outside a pull request.
