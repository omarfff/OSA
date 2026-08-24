#!/usr/bin/env bash
set -euo pipefail
install -d -m 0755 /usr/local/lib/osa
install -m 0644 tools/autopilot-watchdog.mjs /usr/local/lib/osa/autopilot-watchdog.mjs
install -d -m 0700 /var/lib/osa-autopilot
install -m 0644 ops/systemd/osa-autopilot-watchdog.service /etc/systemd/system/osa-autopilot-watchdog.service
install -m 0644 ops/systemd/osa-autopilot-watchdog.timer /etc/systemd/system/osa-autopilot-watchdog.timer
systemctl daemon-reload
systemctl enable --now osa-autopilot-watchdog.timer
systemctl start osa-autopilot-watchdog.service
