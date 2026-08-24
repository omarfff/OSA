# OSA Architecture and Infrastructure
OSA uses two active planes. Product/Data/Commercial plane: Supabase `pkctqxeydfuiupadaoov`, storing usage, MCP/procurement distribution, pricing/benchmarks, leads/deals, payment reconciliation and offer events. Control/Execution/Security plane: Supabase `jpnlmpqqtiwisxcsjwbm` + VPS `hostinger-osa-1` / hostname `srv1914056`, owning tasks, RAW SSH/direct execution, policy, approvals, alerts and infrastructure state.

Canonical repo is `omarfff/OSA`, checkout `/opt/osa/gitops/OSA`. GitOps can reset uncommitted edits; safest mutation is isolated temp clone/branch -> patch -> npm ci -> tests/chaos/audit -> commit -> push -> fast-forward main -> verify remote SHA -> deploy committed code. Preferred direct execution is `osa_ssh_bridge_submit('exec',...)`. RAW SSH/OIDC is real but can lose reports; stuck-job reapers exist. Verify inner command rc and actual effects rather than trusting wrapper state alone.

SSH password auth is disabled, root is key/certificate only, fail2ban is enabled. Never expose credential file contents, private keys, tokens, service-role keys or wallet secrets.

VPS resource class: 1 vCPU, ~3.8 GiB RAM, 1 GiB swap, no GPU, ~48 GB disk. Local AI: Ollama loopback `127.0.0.1:11434`, `qwen3.5:0.8b`; OSA Brain loopback `127.0.0.1:8787`. The Brain is advisory only and has no direct shell, secret, payment, trading, signing or fund-movement authority.
