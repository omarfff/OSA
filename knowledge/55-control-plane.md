# Control Plane, RAW SSH and Deployment Knowledge
The control plane uses Supabase project `jpnlmpqqtiwisxcsjwbm`, VPS tasks, SSH bridge, RAW SSH/direct job tables, infrastructure registry, policy/approval state, and cron reapers.

Preferred live execution is the SSH bridge because it is fast and currently reliable. RAW SSH is a real root path through GitHub Actions OIDC and short-lived SSH certificates, but workflow/report delivery can fail after a claim. Therefore a stuck RAW SSH reaper marks claimed/running jobs failed after timeout and expires pending jobs that miss their window. Never infer success from a claimed state.

Special GitHub branch `osa-ssh-dispatch` is infrastructure-sensitive and should not be casually deleted. It contains the RAW SSH dispatch workflow triggered by controlled changes to the raw SSH trigger file. Preserve it unless a deliberate migration replaces it.

Git pushes from VPS must use the dedicated GitHub deploy key through explicit `GIT_SSH_COMMAND` and strict host-key checking. Never print key contents. Connector-side GitHub writes have previously returned 403 despite read access; deploy-key Git over SSH is the dependable fallback.

The canonical checkout is protected/managed and can erase uncommitted changes. Complex changes should be built in an isolated clone under `/tmp`, fully tested, committed and pushed, then main fast-forwarded and the canonical checkout synchronized to committed main before installation.

SSH hardening includes no password authentication, root key/certificate-only login, reduced auth attempts/grace/startup pressure and fail2ban. Do not weaken this merely to make automation easier.
