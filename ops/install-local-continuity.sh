#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
curl --max-time 3 -fsS http://127.0.0.1:8787/health >/dev/null
install -d -o root -g root -m 0755 /usr/local/lib/osa
install -d -o root -g root -m 0700 /var/lib/osa-continuity
install -m 0644 "$ROOT/tools/local-continuity.mjs" /usr/local/lib/osa/local-continuity.mjs
install -m 0644 "$ROOT/ops/systemd/osa-local-continuity.service" /etc/systemd/system/osa-local-continuity.service
install -m 0644 "$ROOT/ops/systemd/osa-local-continuity.timer" /etc/systemd/system/osa-local-continuity.timer
systemctl daemon-reload
systemctl enable --now osa-local-continuity.timer >/dev/null
systemctl start osa-local-continuity.service
test -s /var/lib/osa-continuity/continuity.json
systemctl is-active --quiet osa-local-continuity.timer
