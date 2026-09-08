#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "install.sh must run as root" >&2
  exit 1
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="osa-psychiatry"
HARVEST_USER="osa-psychiatry-harvest"
CASE_GROUP="osa-psychiatry-data"
LIB_DIR="/usr/local/lib/osa-psychiatry"
SHARE_DIR="/usr/local/share/osa-psychiatry"
KNOWLEDGE_DIR="$SHARE_DIR/knowledge"
STATE_DIR="/var/lib/osa-psychiatry-brain"
CASE_DIR="/var/lib/osa-psychiatry-cases"
UNIT="/etc/systemd/system/osa-psychiatry-brain.service"
HARVEST_UNIT="/etc/systemd/system/osa-psychiatry-case-harvest.service"
HARVEST_TIMER="/etc/systemd/system/osa-psychiatry-case-harvest.timer"

if ! getent group "$CASE_GROUP" >/dev/null 2>&1; then
  groupadd --system "$CASE_GROUP"
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$STATE_DIR" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi
usermod -a -G "$CASE_GROUP" "$SERVICE_USER"

if ! id "$HARVEST_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$CASE_DIR" --shell /usr/sbin/nologin --gid "$CASE_GROUP" "$HARVEST_USER"
fi

install -d -o root -g root -m 0755 "$LIB_DIR"
install -d -o root -g "$SERVICE_USER" -m 0750 "$SHARE_DIR" "$KNOWLEDGE_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$STATE_DIR"
install -d -o "$HARVEST_USER" -g "$CASE_GROUP" -m 0750 "$CASE_DIR"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/server.mjs" "$LIB_DIR/server.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/learning.mjs" "$LIB_DIR/learning.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/osce.mjs" "$LIB_DIR/osce.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/voice-osce.mjs" "$LIB_DIR/voice-osce.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/live-osce.mjs" "$LIB_DIR/live-osce.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/document-simulation.mjs" "$LIB_DIR/document-simulation.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/evidence-reasoning.mjs" "$LIB_DIR/evidence-reasoning.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/documentation-lab.mjs" "$LIB_DIR/documentation-lab.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/documentation-lab-v2.mjs" "$LIB_DIR/documentation-lab-v2.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/consultant-mode.mjs" "$LIB_DIR/consultant-mode.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/case-corpus.mjs" "$LIB_DIR/case-corpus.mjs"
install -o root -g "$CASE_GROUP" -m 0640 "$SRC_DIR/src/case-harvester.mjs" "$LIB_DIR/case-harvester.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/adaptive-server.mjs" "$LIB_DIR/adaptive-server.mjs"
install -o root -g "$SERVICE_USER" -m 0640 "$SRC_DIR/src/training-server.mjs" "$LIB_DIR/training-server.mjs"

find "$KNOWLEDGE_DIR" -maxdepth 1 -type f -name '*.md' -delete
for file in "$SRC_DIR"/knowledge/*.md; do
  install -o root -g "$SERVICE_USER" -m 0640 "$file" "$KNOWLEDGE_DIR/$(basename "$file")"
done

cat > "$UNIT" <<UNITEOF
[Unit]
Description=OSA Isolated Adaptive Psychiatry Training Brain
After=network.target ollama.service osa-ollama-loopback.service
Wants=ollama.service

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
SupplementaryGroups=$CASE_GROUP
WorkingDirectory=$STATE_DIR
Environment=PSYCHIATRY_BRAIN_BIND=127.0.0.1
Environment=PSYCHIATRY_BRAIN_PORT=8791
Environment=PSYCHIATRY_BRAIN_MODEL=qwen3.5:0.8b
Environment=PSYCHIATRY_OLLAMA_URL=http://127.0.0.1:11434
Environment=PSYCHIATRY_BRAIN_KNOWLEDGE_DIR=$KNOWLEDGE_DIR
Environment=PSYCHIATRY_BRAIN_STATE_DIR=$STATE_DIR
Environment=PSYCHIATRY_CASE_CORPUS_DIR=$CASE_DIR
ExecStart=/usr/bin/node $LIB_DIR/training-server.mjs
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
ReadOnlyPaths=$LIB_DIR $SHARE_DIR $CASE_DIR
ReadWritePaths=$STATE_DIR
InaccessiblePaths=-/usr/local/share/osa-brain -/var/lib/osa-brain -/opt/osa/gitops/OSA/knowledge -/opt/osa/workspace -/opt/osa-laborx-v2 -/opt/osa-swarm
UMask=0077

[Install]
WantedBy=multi-user.target
UNITEOF

cat > "$HARVEST_UNIT" <<UNITEOF
[Unit]
Description=Psychiatry Open-Access Global Case Harvester
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$HARVEST_USER
Group=$CASE_GROUP
WorkingDirectory=$CASE_DIR
Environment=PSYCHIATRY_CASE_CORPUS_DIR=$CASE_DIR
ExecStart=/usr/bin/node $LIB_DIR/case-harvester.mjs 5000 250
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
ReadOnlyPaths=$LIB_DIR
ReadWritePaths=$CASE_DIR
UMask=0027

[Install]
WantedBy=multi-user.target
UNITEOF

cat > "$HARVEST_TIMER" <<'UNITEOF'
[Unit]
Description=Weekly Psychiatry Global Case Corpus Refresh

[Timer]
OnCalendar=Sun *-*-* 03:30:00
Persistent=true
RandomizedDelaySec=14400
Unit=osa-psychiatry-case-harvest.service

[Install]
WantedBy=timers.target
UNITEOF

# Initial corpus bootstrap: exactly the requested first milestone, at least 1,000 OA psychiatric case records.
if [ ! -f "$CASE_DIR/stats.json" ] || [ "$(node -e "try{const s=require('$CASE_DIR/stats.json');process.stdout.write(String(s.count||0))}catch{process.stdout.write('0')}")" -lt 1000 ]; then
  timeout 300 runuser -u "$HARVEST_USER" -- env PSYCHIATRY_CASE_CORPUS_DIR="$CASE_DIR" /usr/bin/node "$LIB_DIR/case-harvester.mjs" 1000 1000
fi

systemctl daemon-reload
systemctl enable --now osa-psychiatry-case-harvest.timer
systemctl enable --now osa-psychiatry-brain.service
systemctl restart osa-psychiatry-brain.service
sleep 2
systemctl is-active --quiet osa-psychiatry-brain.service
curl -fsS --max-time 10 http://127.0.0.1:8791/health
printf '\n'
curl -fsS --max-time 10 http://127.0.0.1:8791/training/capabilities
printf '\n'
curl -fsS --max-time 10 http://127.0.0.1:8791/cases/corpus/stats
printf '\n'
