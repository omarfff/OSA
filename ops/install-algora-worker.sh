#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)

command -v python3 >/dev/null 2>&1 || { echo 'python3 is required' >&2; exit 2; }
curl --max-time 3 -fsS http://127.0.0.1:8787/health >/dev/null

id -u osa-bounty >/dev/null 2>&1 || useradd --system --home /var/lib/osa-algora-worker --shell /usr/sbin/nologin osa-bounty
install -d -o root -g root -m 0755 /usr/local/lib/osa
install -d -o root -g osa-bounty -m 0750 /etc/osa-algora
install -d -o osa-bounty -g osa-bounty -m 0750 /var/lib/osa-algora-worker
install -o root -g root -m 0755 "$ROOT/tools/algora_worker.py" /usr/local/lib/osa/algora_worker.py

if [[ ! -f /etc/osa-algora/worker.env ]]; then
  cat >/etc/osa-algora/worker.env <<'ENV'
OSA_ALGORA_LIMIT=8
OSA_ALGORA_MIN_USD=100
OSA_ALGORA_MAX_ATTEMPTS=5
OSA_ALGORA_MAX_COMMENTS=80
OSA_ALGORA_MAX_AGE_DAYS=45
OSA_ALGORA_MIN_STARS=25
OSA_ALGORA_ALLOWED_LANGUAGES=Python,JavaScript,TypeScript,Shell,Go,Rust
OSA_ALGORA_GITHUB_QUERY=is:issue is:open commenter:algora-pbc[bot] comments:<25
OSA_BRAIN_URL=http://127.0.0.1:8787
ENV
fi
chown root:osa-bounty /etc/osa-algora/worker.env
chmod 0640 /etc/osa-algora/worker.env

install -m 0644 "$ROOT/ops/systemd/osa-algora-worker.service" /etc/systemd/system/osa-algora-worker.service
install -m 0644 "$ROOT/ops/systemd/osa-algora-worker.timer" /etc/systemd/system/osa-algora-worker.timer
systemctl daemon-reload
systemctl enable --now osa-algora-worker.timer >/dev/null
systemctl start osa-algora-worker.service
test -s /var/lib/osa-algora-worker/latest.json
systemctl is-active --quiet osa-algora-worker.timer
