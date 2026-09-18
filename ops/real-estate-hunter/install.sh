#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "install.sh must run as root" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_USER="osa-real-estate-hunter"
LIB_DIR="/usr/local/lib/osa-real-estate-hunter"
STATE_DIR="/var/lib/osa-real-estate-hunter"
UNIT="/etc/systemd/system/osa-real-estate-hunter.service"
TIMER="/etc/systemd/system/osa-real-estate-hunter.timer"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$STATE_DIR" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -o root -g root -m 0755 "$LIB_DIR" "$LIB_DIR/src" "$LIB_DIR/tools"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$STATE_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$STATE_DIR/browser-profile" "$STATE_DIR/evidence"

rm -rf "$LIB_DIR/src/real-estate-hunter"
cp -a "$ROOT_DIR/src/real-estate-hunter" "$LIB_DIR/src/real-estate-hunter"
install -o root -g root -m 0644 "$ROOT_DIR/tools/real-estate-hunter.mjs" "$LIB_DIR/tools/real-estate-hunter.mjs"
chown -R root:root "$LIB_DIR/src/real-estate-hunter" "$LIB_DIR/tools"
find "$LIB_DIR/src/real-estate-hunter" -type f -exec chmod 0644 {} +

command -v agent-browser >/dev/null
sudo -u "$SERVICE_USER" env HOME="$STATE_DIR" agent-browser install >/dev/null

/usr/bin/node --check "$LIB_DIR/tools/real-estate-hunter.mjs"
/usr/bin/node -e "import('file://$LIB_DIR/src/real-estate-hunter/autopilot.js').then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})"

cat > "$UNIT" <<UNITEOF
[Unit]
Description=OSA Saudi Real Estate Hunter
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$STATE_DIR
Environment=OSA_REAL_ESTATE_STATE_DIR=$STATE_DIR
Environment=OSA_REAL_ESTATE_LATEST=$STATE_DIR/latest.json
Environment=OSA_REAL_ESTATE_HISTORY=$STATE_DIR/history.jsonl
Environment=OSA_REAL_ESTATE_BROWSER_BINARY=/usr/local/bin/agent-browser
Environment=OSA_REAL_ESTATE_WAIT_MS=1800
ExecStart=/usr/bin/node $LIB_DIR/tools/real-estate-hunter.mjs
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
ReadWritePaths=$STATE_DIR
UMask=0077

[Install]
WantedBy=multi-user.target
UNITEOF

cat > "$TIMER" <<UNITEOF
[Unit]
Description=Run OSA Real Estate Hunter hourly

[Timer]
OnBootSec=7min
OnUnitActiveSec=1h
RandomizedDelaySec=300
Persistent=true
Unit=osa-real-estate-hunter.service

[Install]
WantedBy=timers.target
UNITEOF

systemctl daemon-reload
systemctl enable --now osa-real-estate-hunter.timer
systemctl start osa-real-estate-hunter.service
systemctl is-enabled --quiet osa-real-estate-hunter.timer
systemctl is-active --quiet osa-real-estate-hunter.timer

echo "Real Estate Hunter installed. Latest results: $STATE_DIR/latest.json"
