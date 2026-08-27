#!/usr/bin/env bash
set -euo pipefail
install -d -m 0755 /usr/local/lib/osa
install -m 0644 tools/osa-brain-operator.mjs /usr/local/lib/osa/osa-brain-operator.mjs
install -d -m 0700 /var/lib/osa-brain-operator
install -m 0644 ops/systemd/osa-brain-operator.service /etc/systemd/system/osa-brain-operator.service
install -m 0644 ops/systemd/osa-brain-operator.timer /etc/systemd/system/osa-brain-operator.timer
systemctl daemon-reload
systemctl enable --now osa-brain-operator.timer
systemctl start osa-brain-operator.service
