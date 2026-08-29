#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SECRET=/etc/osa/secrets/superteam-agent.env

command -v python3 >/dev/null 2>&1 || { echo 'python3 is required' >&2; exit 2; }
test -f "$SECRET" || { echo 'Superteam agent credential is missing' >&2; exit 3; }
[[ $(stat -c '%a' "$SECRET") == 600 ]] || { echo 'Superteam agent credential must be mode 600' >&2; exit 4; }
curl --max-time 3 -fsS http://127.0.0.1:8787/health >/dev/null

id -u osa-superteam >/dev/null 2>&1 || useradd --system --home /var/lib/osa-superteam-agent --shell /usr/sbin/nologin osa-superteam
install -d -o root -g root -m 0755 /usr/local/lib/osa
install -d -o osa-superteam -g osa-superteam -m 0750 /var/lib/osa-superteam-agent
install -o root -g root -m 0755 "$ROOT/tools/superteam_agent_worker.py" /usr/local/lib/osa/superteam_agent_worker.py
install -m 0644 "$ROOT/ops/systemd/osa-superteam-agent.service" /etc/systemd/system/osa-superteam-agent.service
install -m 0644 "$ROOT/ops/systemd/osa-superteam-agent.timer" /etc/systemd/system/osa-superteam-agent.timer

systemctl daemon-reload
systemctl enable --now osa-superteam-agent.timer >/dev/null
systemctl start osa-superteam-agent.service
test -s /var/lib/osa-superteam-agent/latest.json
test -s /var/lib/osa-superteam-agent/heartbeat.json
systemctl is-active --quiet osa-superteam-agent.timer
