#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/ops/bounty-hunter"
APP=/opt/osa-bounty-hunter
STATE=/var/lib/osa-bounty-hunter
ENV_FILE=/etc/osa-bounty-hunter.env
SERVICE_SRC="$ROOT/ops/systemd/osa-bounty-hunter.service"
SERVICE_DST=/etc/systemd/system/osa-bounty-hunter.service

for f in "$SRC/bounty_hunter.py" "$SRC/requirements.txt" "$SRC/.env.example" "$SRC/test_bounty_hunter.py" "$SERVICE_SRC"; do
  [[ -f "$f" ]] || { echo "Missing required file: $f" >&2; exit 2; }
done

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends python3 python3-venv python3-pip git bubblewrap ca-certificates

if ! id osa-bounty >/dev/null 2>&1; then
  useradd --system --home-dir "$STATE" --create-home --shell /usr/sbin/nologin osa-bounty
fi

install -d -o root -g root -m 0755 "$APP"
install -d -o osa-bounty -g osa-bounty -m 0700 "$STATE" "$STATE/workspaces" "$STATE/approvals"
install -o root -g root -m 0755 "$SRC/bounty_hunter.py" "$APP/bounty_hunter.py"
install -o root -g root -m 0644 "$SRC/requirements.txt" "$APP/requirements.txt"
install -o root -g root -m 0644 "$SRC/test_bounty_hunter.py" "$APP/test_bounty_hunter.py"

if [[ ! -f "$ENV_FILE" ]]; then
  install -o root -g root -m 0600 "$SRC/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE with safe defaults and blank secrets." >&2
else
  chmod 0600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
  echo "Preserved existing $ENV_FILE." >&2
fi

if [[ ! -x "$APP/.venv/bin/python" ]]; then
  python3 -m venv "$APP/.venv"
fi
"$APP/.venv/bin/python" -m pip install --disable-pip-version-check --upgrade pip setuptools wheel
"$APP/.venv/bin/python" -m pip install --disable-pip-version-check --requirement "$APP/requirements.txt"
"$APP/.venv/bin/python" -m pip check

cd "$APP"
"$APP/.venv/bin/python" -m pytest -q "$APP/test_bounty_hunter.py"

install -o root -g root -m 0644 "$SERVICE_SRC" "$SERVICE_DST"
systemd-analyze verify "$SERVICE_DST"
systemctl daemon-reload
systemctl enable --now osa-bounty-hunter.service
sleep 2
systemctl --no-pager --full status osa-bounty-hunter.service || true

echo
echo "Installed. Configure secrets only in: $ENV_FILE"
echo "Then restart: sudo systemctl restart osa-bounty-hunter.service"
echo "Logs: sudo journalctl -u osa-bounty-hunter.service -f"
echo "Financial approval: sudo -u osa-bounty /opt/osa-bounty-hunter/.venv/bin/python /opt/osa-bounty-hunter/bounty_hunter.py approve <proposal-id>"
