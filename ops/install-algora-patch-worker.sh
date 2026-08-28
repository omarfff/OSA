#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
command -v docker >/dev/null
ollama list | awk 'NR>1{print $1}' | grep -qx 'qwen2.5-coder:1.5b'
docker image inspect node:20-alpine >/dev/null
install -d -o root -g root -m 0755 /usr/local/lib/osa
install -o root -g root -m 0755 "$ROOT/tools/algora_patch_worker.py" /usr/local/lib/osa/algora_patch_worker.py
install -d -o root -g root -m 0700 /var/lib/osa-algora-patches
install -m 0644 "$ROOT/ops/systemd/osa-algora-patch-worker.service" /etc/systemd/system/
install -m 0644 "$ROOT/ops/systemd/osa-algora-patch-worker.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now osa-algora-patch-worker.timer >/dev/null
systemctl start osa-algora-patch-worker.service
systemctl is-active --quiet osa-algora-patch-worker.timer
