#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)

id -u osa-brain >/dev/null 2>&1 || { echo 'osa-brain user is required; run ops/install-brain.sh first' >&2; exit 2; }

install -d -o root -g root -m 0755 /usr/local/lib/osa
install -m 0644 "$ROOT/tools/market-radar.mjs" /usr/local/lib/osa/market-radar.mjs

install -d -o osa-brain -g osa-brain -m 0700 /var/lib/osa-market-radar
install -d -o root -g osa-brain -m 0750 /etc/osa

if [ ! -f /etc/osa/market-radar.env ]; then
  cat >/etc/osa/market-radar.env <<'ENV'
OSA_MARKET_RADAR_BRAIN_URL=http://127.0.0.1:8787
OSA_MARKET_RADAR_STATE=/var/lib/osa-market-radar
OSA_MARKET_RADAR_LOOKBACK_DAYS=14
OSA_MARKET_RADAR_MAX_ITEMS=40
OSA_MARKET_RADAR_HISTORY_RUNS=8
OSA_MARKET_RADAR_FETCH_TIMEOUT_MS=12000
ENV
fi
chown root:osa-brain /etc/osa/market-radar.env
chmod 0640 /etc/osa/market-radar.env

install -m 0644 "$ROOT/ops/systemd/osa-market-radar.service" /etc/systemd/system/osa-market-radar.service
install -m 0644 "$ROOT/ops/systemd/osa-market-radar.timer" /etc/systemd/system/osa-market-radar.timer
systemctl daemon-reload
systemctl enable --now osa-market-radar.timer >/dev/null

echo 'osa-market-radar installed'
systemctl --no-pager --full status osa-market-radar.timer || true
