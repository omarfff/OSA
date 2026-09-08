# Defensive Security Engineering Lessons

Source basis: *The Antivirus Hacker's Handbook* (Joxean Koret, Elias Bachaalany). This file records defensive engineering lessons only. It does not authorize malware development, AV evasion, credential theft, unauthorized exploitation, denial of service, or bypassing security controls.

## Scope boundary

- Keep this knowledge in the OSA/security domain only.
- Never import this material into `psychiatry-brain/` or medical learner state.
- Offensive examples from the source may be read for threat-model understanding, but must not be turned into autonomous attack workflows.

## 1. Treat every external parser as a hostile-input boundary

File parsers, archive handlers, document readers, protocol decoders, browser helpers, upload processors and similar components should be assumed to receive malformed or adversarial inputs.

OSA rule:
- Parse untrusted content in a separate low-privilege worker where feasible.
- Do not let parser output directly trigger shell, payment, secret access or privileged control-plane actions.
- Fail closed on malformed input and enforce hard size, time, recursion and decompression limits.

## 2. Privilege separation beats broad hardening

Privileged components should do the minimum work that requires privilege. Complex parsing, transformation and content analysis should run in lower-privilege processes or sandboxes.

OSA rule:
- Keep root/control-plane functionality thin.
- High-privilege services should broker narrowly-scoped actions rather than execute arbitrary content-derived instructions.
- Separate network/file intake from privileged execution.

## 3. Inventory attack surface explicitly

The source separates local and remote attack surfaces and stresses that exposed services, parsers, drivers, consoles, update endpoints and plug-ins all expand risk.

OSA rule:
Maintain a current attack-surface register for:
- public HTTP endpoints,
- webhooks,
- file/document upload paths,
- browser automation,
- SSH/control-plane bridges,
- update/deployment paths,
- plug-ins/connectors,
- scheduled workers,
- payment-related endpoints.

Every new external interface must have an owner, purpose, authentication mode, input-trust level and rollback/disable path.

## 4. Fuzz the components that consume hostile input

Fuzzing is most valuable around parsers and protocol handlers, especially those that process many formats or legacy inputs.

OSA rule:
- Add bounded fuzz/property tests to parsers and serializers in CI where practical.
- Use safe synthetic corpora and isolated test processes.
- Record crashes, timeouts, memory blowups and pathological recursion as defects.
- Fuzzing must target OSA-owned code or explicitly authorized test targets only.

## 5. Use memory-safe components when performance permits

Complex parser logic written in unsafe native code carries a larger memory-corruption risk. Memory-safe or managed languages reduce this class of failure.

OSA rule:
- Prefer memory-safe languages for new parsers, orchestration, API handlers and content-processing workers unless a measured performance requirement justifies native code.
- Keep native code small and isolated when unavoidable.

## 6. Plug-ins and dynamic loaders are supply-chain boundaries

Plug-ins expand functionality but also increase trust and loading complexity.

OSA rule:
- Explicitly allowlist plug-ins/connectors.
- Pin versions or verify provenance where supported.
- Never load executable extensions from user-controlled paths.
- Treat plug-in output as untrusted data until validated.
- Remove unused integrations instead of leaving dormant code paths active.

## 7. Update and deployment paths must be authenticated

Update systems are security-critical. Weak verification of update material can turn a defensive product into an execution path.

OSA rule:
- Deploy only from expected repository/ref/commit provenance.
- Verify the remote SHA before treating deployment as successful.
- Do not execute unsigned or unverified downloaded code as part of update logic.
- Keep rollback available for production changes.
- Never treat transport encryption alone as sufficient proof of artifact authenticity.

## 8. Remove old and unreachable code

Legacy functionality, forgotten parsers, abandoned endpoints and dormant compatibility paths increase attack surface while receiving little testing.

OSA rule:
- Delete dead code after confirming no production dependency.
- Disable stale services and endpoints rather than merely hiding them.
- Maintain an explicit deprecation/removal path for obsolete components.

## 9. Do not rely on obscurity or hidden backdoors

Secret debug switches, hidden administrative behaviors and undocumented privileged paths should be assumed discoverable eventually.

OSA rule:
- No hidden bypasses for authentication, approvals or safety gates.
- Debug/test controls must be explicit, access-controlled and disabled in production by default.
- Recovery paths should be auditable rather than secret.

## 10. Security testing must be isolated

The source repeatedly recommends virtualized/isolate environments for reverse engineering and fuzzing.

OSA rule:
- Run destructive or malformed-input testing in disposable isolated environments.
- Never point fuzzers or failure-injection tests at production data, wallets, payments, customer systems or unrelated third-party services.
- Keep test secrets synthetic.

## 11. Security claims require verification, not labels

A product calling itself secure is not evidence. Actual architecture, mitigations, privilege model, parser safety and update integrity must be inspected and tested.

OSA rule:
- Security status is based on observed controls and tests, not marketing labels or model assertions.
- Model output is never proof that a security action occurred.
- Verify effects independently after changes.

## 12. OSA defensive checklist derived from these lessons

For every new component, ask:
1. What untrusted input can reach it?
2. What privilege does it run with?
3. Can it be sandboxed or split into a low-privilege worker?
4. What parser/decoder libraries are involved?
5. What limits prevent decompression, recursion, memory or CPU exhaustion?
6. Can malformed inputs be fuzzed safely in CI?
7. What plug-ins or external code are loaded?
8. How is update/deployment provenance verified?
9. Is any debug, legacy or dormant code path still active?
10. What independent check proves the security control actually works?

## Safety interpretation

When this source describes evasion, reverse engineering, exploitation or denial of service, use those sections to improve threat models and defenses. Do not operationalize them against systems without explicit authorization.