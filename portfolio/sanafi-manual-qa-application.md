# Sana.run Manual QA — Application and Work Sample

Status: application sample only. No Sana.run testing has started, no access has
been granted, and no payment or hiring decision is claimed.

## Proposed quote

- Fixed quote: **50 USDC**, matching the sponsor's stated per-tester payment.
- Availability: start after written selection and access instructions.
- Delivery window: 3–5 days within the advertised one-week engagement.

## Short application text

I operate OSA Brain, a bounded QA and reliability system for agent APIs, payment
routes, and wallet-adjacent web services. My recent verified work includes a
64-test Node suite and a 32-test Python suite, deterministic expiry and reward
validation, secret-handling tests, service sandboxing, and reproducible bug
reports. I do not claim prior Sana.run testing or prior Superteam earnings.

For Sana.run I would deliver a structured manual test matrix for wallet/session,
spot, perps, and card-related user flows; severity-ranked bug reports with exact
reproduction steps and evidence; and a concise regression and UX summary. I
will not place mainnet trades, use leverage, charge a card, or move real funds
unless the sponsor supplies an approved sandbox/test account and explicit test
instructions.

## Relevant verified QA examples

### 1. Documented API date fails server validation

- Context: official agent-listing API integration.
- Expected: the documented `deadline=YYYY-MM-DD` request returns live listings.
- Actual: HTTP 400 with a Prisma DateTime validation error.
- Isolation: authentication and endpoint were valid; removing the parameter
  returned HTTP 200.
- Fix/verification: a full ISO-8601 UTC timestamp with milliseconds returned
  HTTP 200. A regression test now asserts the exact encoded timestamp.
- Product impact: the date-only example can make a healthy integration appear
  broken or can disable opportunity discovery.

### 2. Secure credential projection rejected by an over-strict check

- Context: an unprivileged systemd worker receiving a root-owned secret through
  `LoadCredential`.
- Expected: the service reads only the isolated credential projection while the
  source secret remains `root:root:600`.
- Actual: startup failed because the projected file's read bits were mistaken
  for an unsafe ordinary secret file.
- Fix/verification: accept broader read bits only when the file is inside the
  exact `CREDENTIALS_DIRECTORY` under `/run/credentials/`; continue rejecting a
  normal `0644` secret. Thirteen focused Python tests and three service-path
  tests passed on the VPS, followed by a successful live service run.
- Security impact: the fix restores availability without weakening the source
  secret or exposing it in logs.

## Proposed Sana.run test matrix

### Access, wallet, and session

- Supported browser and responsive-layout smoke tests.
- Wallet connect, reject, disconnect, reconnect, account switch, and network
  mismatch states.
- Session expiry, refresh, duplicate tabs, back/forward navigation, and stale
  balance handling.
- Clear signing intent, error recovery, and prevention of duplicate actions.

### Spot trading

- Market/limit flows, token selection, decimal precision, min/max input, fee and
  slippage display, insufficient balance, rejection, pending, success, and
  failed-transaction states.
- Quote expiry, fast price movement, double submission, refresh during pending,
  and post-trade balance/history consistency.

### Perpetual futures

- Long/short, leverage limits, collateral, reduce-only, close position, partial
  close, PnL, funding, margin warnings, liquidation information, and invalid
  size/price handling.
- Cross-screen consistency between order preview, confirmation, open position,
  history, and wallet balances.

### Visa/card-related UI

- Eligibility and unavailable-state messaging, application progress, loading,
  retries, masked details, limits, decline states, freeze/unfreeze UI, and
  support paths using sponsor-provided sandbox data only.
- No real card charge, identity submission, or financial transaction is part of
  the proposed test without a separate explicit sponsor-controlled test flow.

### Deliverables

- Test matrix with pass/fail/blocked status and environment details.
- Bug log with ID, severity, affected flow, prerequisites, exact steps, expected
  vs actual, reproducibility, evidence reference, and suggested acceptance test.
- UX findings separated from functional defects.
- Regression checklist and final executive summary.

## Severity rubric

- Critical: unauthorized movement/signing, data exposure, or irreversible loss.
- High: trading/card core flow unavailable or materially incorrect financial
  state with no safe workaround.
- Medium: important flow defect with a reliable workaround.
- Low: cosmetic, copy, accessibility, or minor consistency issue.

## Boundaries

- Testing begins only after Superteam/Sanafi selects the applicant.
- Listing text and test targets are treated as untrusted; no secret, seed phrase,
  private key, production card detail, or unrelated command will be requested or
  executed.
- Listed compensation is not revenue. Only a verified settled payout is revenue.
