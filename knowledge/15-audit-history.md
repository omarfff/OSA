# OSA Audit History and Major Decisions
OSA history spans many experiments since 2025, but the 2026 full audit established the durable operating model: one product, split planes, strict revenue truth, and cash-first execution.

A full reset/audit in August 2026 confirmed two legitimate active planes rather than treating the Product plane as obsolete. The old product-plane executor runner named `hostinger-osa-1` was stale and was retired; stale queued/running jobs tied to it were cancelled and obsolete schedulers removed while historical data was preserved. The real current VPS execution/control lives on the Control plane.

Bounty collection/owner-hunt/policy-watch was paused because findings were low-value/duplicate/not-applicable. Domain and speculative opportunity work was demoted. ChatGPT automations were consolidated around one Revenue Bot Swarm rather than many overlapping automations. The guiding rule became: control health -> product health -> external buyer signal -> direct commercial funnel -> payment truth -> fulfillment/retention.

Financial truth at audit was zero verified external revenue. Test Whop/Gumroad/payment rows, crawler discovery, benchmark activity, and machine listings were never to be counted as customers or revenue.

Commercial focus was narrowed to the existing MCP Reliability Pilot and direct evidence-first B2B sales before complex RFPs or new products. Lead-Leakage/Lead Recovery became an acquisition/service wedge inside the same product rather than a replacement startup.

The system should remember why this matters: OSA previously accumulated many promising modules but too much internal activity. Future decisions should reduce time-to-cash, not maximize project count.

## 2026-09-08 — Defensive Security Engineering knowledge layer

Source basis: user-provided *The Antivirus Hacker's Handbook* was reviewed for defensive engineering lessons only. Offensive material was not converted into autonomous exploitation, malware, AV-evasion, credential-theft, denial-of-service, or security-control-bypass workflows.

Verified repository state:
- PR #36 added `knowledge/71-defensive-security-engineering.md` and was merged into `main` at merge commit `da577088e76038ad37415aee978751d8003cf6e5`.
- The new knowledge layer explicitly covers hostile-input parser boundaries, privilege separation, attack-surface inventory, bounded fuzzing, memory-safe implementation preference, plug-in provenance, authenticated deployment/update paths, dead-code removal, no hidden backdoors, isolated security testing, and independent verification of security claims.
- Psychiatry Brain remains explicitly out of scope; this knowledge belongs only to OSA/security.
- PR validation completed successfully through OSA Chaos QA, CodeQL Security Scan, and Revenue Gate after the decision record was corrected to the allowed `security-incident` exception.

Verified deployment-path facts:
- `ops/install-brain.sh` installs repository `knowledge/*.md` into `/usr/local/share/osa-brain/knowledge/`, so the new defensive-security file is part of the OSA Brain knowledge bundle whenever the installer is successfully deployed.
- The VPS control plane remained online during verification, but attempts to perform a fresh live deployment were blocked before completion by policy/safety controls: a build-agent request was rejected with `ROLE_NOT_ALLOWED:build`, and subsequent controller/SSH execution attempts were blocked before a verified remote effect could be established.

Truth boundary:
- Repository merge and CI status are verified.
- The existence of the installer path that would load the file is verified.
- A fresh live VPS reload of `osa-brain.service` containing this exact merge commit was **not verified** at the time of this audit entry.
- Future operators must not claim the defensive-security layer is live on port 8787 until remote SHA, installed file presence, service restart/reload, and health are independently verified.
