#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "install.sh must run as root" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_USER="osa-car-hunter"
LIB_DIR="/usr/local/lib/osa-car-hunter"
STATE_DIR="/var/lib/osa-car-hunter"
UNIT="/etc/systemd/system/osa-car-hunter.service"
TIMER="/etc/systemd/system/osa-car-hunter.timer"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$STATE_DIR" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -o root -g root -m 0755 "$LIB_DIR" "$LIB_DIR/src"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$STATE_DIR"
rm -rf "$LIB_DIR/src/car-hunter"
cp -a "$ROOT_DIR/src/car-hunter" "$LIB_DIR/src/car-hunter"
install -o root -g root -m 0644 "$ROOT_DIR/tools/car-hunter-autopilot.mjs" "$LIB_DIR/car-hunter-autopilot.mjs"
chown -R root:root "$LIB_DIR/src/car-hunter"
find "$LIB_DIR/src/car-hunter" -type f -exec chmod 0644 {} +

cat > "$UNIT" <<UNITEOF
[Unit]
Description=OSA BMW/Mercedes Car Deal Hunter
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$STATE_DIR
Environment=OSA_CAR_HUNTER_STATE=$STATE_DIR/state.json
Environment=OSA_CAR_HUNTER_LATEST=$STATE_DIR/latest.json
Environment=OSA_CAR_HUNTER_MAX_ADS=16
Environment=OSA_CAR_HUNTER_DELAY_MS=2000
ExecStart=/usr/bin/node $LIB_DIR/car-hunter-autopilot.mjs
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
Description=Run OSA Car Hunter every 30 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min
RandomizedDelaySec=180
Persistent=true
Unit=osa-car-hunter.service

[Install]
WantedBy=timers.target
UNITEOF

systemctl daemon-reload
systemctl enable --now osa-car-hunter.timer
systemctl start osa-car-hunter.service
systemctl is-enabled --quiet osa-car-hunter.timer
systemctl is-active --quiet osa-car-hunter.timer

echo "Car Hunter installed. Latest results: $STATE_DIR/latest.json"
