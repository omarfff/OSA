#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ "$(id -u)" -eq 0 ] || { echo 'Run as root.' >&2; exit 2; }
[ -s /etc/osa/research-worker.env ] || { echo 'Research worker environment is missing.' >&2; exit 3; }
[ -s /etc/osa/research-worker.token ] || { echo 'Research worker token is missing.' >&2; exit 4; }
id -u osa-brain >/dev/null 2>&1 || { echo 'osa-brain user is missing.' >&2; exit 5; }
curl --max-time 3 -fsS http://127.0.0.1:8787/health >/dev/null
install -d -o root -g root -m 0755 /usr/local/lib/osa
install -m 0644 "$ROOT/tools/research-mailbox-worker.mjs" /usr/local/lib/osa/research-mailbox-worker.mjs
install -m 0644 "$ROOT/ops/systemd/osa-research-mailbox.service" /etc/systemd/system/osa-research-mailbox.service
chown root:osa-brain /etc/osa/research-worker.env /etc/osa/research-worker.token
chmod 0640 /etc/osa/research-worker.env /etc/osa/research-worker.token
systemctl daemon-reload
systemctl enable --now osa-research-mailbox.service >/dev/null
for _ in $(seq 1 20); do
  systemctl is-active --quiet osa-research-mailbox.service && exit 0
  sleep 0.25
done
systemctl status osa-research-mailbox.service --no-pager >&2 || true
exit 6
