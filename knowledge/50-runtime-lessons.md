# Runtime and Programming Lessons Learned
Important fixed bugs: Node 22 custom DNS lookup failed the `options.all=true` callback contract; negative transactionEvidence could cause NaN TrustScore; free->$paid drift was skipped because zero was false; first-hop HTTPS->HTTP downgrade logic was wrong; mapped IPv6 private/loopback/metadata could bypass lead-audit private-IP checks; malformed JSON and invalid query selectors/limits needed proper 4xx; remote successful payloads needed JSON/object validation; `/best` needed candidate truncation visibility.

Known resilience lesson: `req.setTimeout` is inactivity-based, not necessarily an absolute end-to-end deadline. Verify current main and a slow-drip smoke before assuming an absolute live deadline is deployed.

Bridge tasks may lose `node_modules`; run `npm ci` in the same verification task before imports/server tests. A missing Express after an isolated task can be environment absence, not source regression.

Use `set -e`/`&&` for mutation scripts. Otherwise a failed patch assertion can be followed by later success and create false confidence.

Local-AI systemd lesson: `MemoryDenyWriteExecute=true` broke Node/V8 with SIGTRAP. `--jitless` then broke fetch/undici because WebAssembly was unavailable. Correct Brain configuration keeps other sandboxing but uses `MemoryDenyWriteExecute=false`, while service remains unprivileged, loopback-only and tool-less.

GitHub connector writes may 403 even while reads work; use VPS deploy key when needed. Verify remote main SHA after every production merge. Canonical GitOps may erase uncommitted work; build complex changes in an isolated clone.
