#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "install.sh must run as root" >&2
  exit 1
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="osa-psychiatry"
LIB_DIR="/usr/local/lib/osa-psychiatry"
SHARE_DIR="/usr/local/share/osa-psychiatry"
KNOWLEDGE_DIR="$SHARE_DIR/knowledge"
STATE_DIR="/var/lib/osa-psychiatry-brain"
UNIT="/etc/systemd/system/osa-psychiatry-brain.service"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$STATE_DIR" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -o root -g "$SERVICE_USER" -m 0750 "$LIB_DIR" "$SHARE_DIR" "$KNOWLEDGE_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$STATE_DIR"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/server.mjs" "$LIB_DIR/server.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/learning.mjs" "$LIB_DIR/learning.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/osce.mjs" "$LIB_DIR/osce.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/adaptive-server.mjs" "$LIB_DIR/adaptive-server.mjs"

find "$KNOWLEDGE_DIR" -maxdepth 1 -type f -name '*.md' -delete
for file in "$SRC_DIR"/knowledge/*.md; do
  install -o root -g "$SERVICE_USER" -m 0640 "$file" "$KNOWLEDGE_DIR/$(basename "$file")"
done

cat > "$UNIT" <<'UNITEOF'
[Unit]
Description=OSA Isolated Adaptive Psychiatry Study Brain
After=network.target ollama.service osa-ollama-loopback.service
Wants=ollama.service

[Service]
Type=simple
User=osa-psychiatry
Group=osa-psychiatry
WorkingDirectory=/var/lib/osa-psychiatry-brain
Environment=PSYCHIATRY_BRAIN_BIND=127.0.0.1
Environment=PSYCHIATRY_BRAIN_PORT=8791
Environment=PSYCHIATRY_BRAIN_MODEL=qwen3.5:0.8b
Environment=PSYCHIATRY_OLLAMA_URL=http://127.0.0.1:11434
Environment=PSYCHIATRY_BRAIN_KNOWLEDGE_DIR=/usr/local/share/osa-psychiatry/knowledge
Environment=PSYCHIATRY_BRAIN_STATE_DIR=/var/lib/osa-psychiatry-brain
ExecStart=/usr/bin/node /usr/local/lib/osa-psychiatry/adaptive-server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectProc=invisible
ProcSubset=pid
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectClock=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictRealtime=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
IPAddressDeny=any
IPAddressAllow=localhost
ReadOnlyPaths=/usr/local/lib/osa-psychiatry /usr/local/share/osa-psychiatry
ReadWritePaths=/var/lib/osa-psychiatry-brain
InaccessiblePaths=-/usr/local/share/osa-brain -/var/lib/osa-brain -/opt/osa/gitops/OSA/knowledge -/opt/osa/workspace -/opt/osa-laborx-v2 -/opt/osa-swarm
UMask=0077

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable --now osa-psychiatry-brain.service
systemctl restart osa-psychiatry-brain.service
sleep 2
systemctl is-active --quiet osa-psychiatry-brain.service
curl -fsS --max-time 10 http://127.0.0.1:8791/health
printf '\n'
