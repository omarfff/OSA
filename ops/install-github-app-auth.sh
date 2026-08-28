#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP_ID=${OSA_GITHUB_APP_ID:-4751990}
INSTALLATION_ID=${OSA_GITHUB_APP_INSTALLATION_ID:-157289103}
PRIVATE_KEY_FILE=${OSA_GITHUB_APP_PRIVATE_KEY_FILE:-/etc/osa/secrets/github-app-private-key.pem}

[[ $EUID -eq 0 ]] || { echo 'root is required' >&2; exit 2; }
[[ -f $PRIVATE_KEY_FILE ]] || { echo 'GitHub App private key is missing' >&2; exit 2; }
[[ $(stat -c '%a:%U:%G' "$PRIVATE_KEY_FILE") == 600:root:root ]] || {
  echo 'GitHub App private key must be root:root mode 600' >&2
  exit 2
}

install -d -o root -g root -m 0700 /etc/osa/secrets
install -o root -g root -m 0755 \
  "$ROOT/ops/osa-github-app-token-refresh.sh" \
  /usr/local/sbin/osa-github-app-token-refresh
install -o root -g root -m 0644 \
  "$ROOT/ops/systemd/osa-github-app-token.service" \
  /etc/systemd/system/osa-github-app-token.service
install -d -o root -g root -m 0755 \
  /etc/systemd/system/osa-algora-worker.service.d
install -o root -g root -m 0644 \
  "$ROOT/ops/systemd/osa-algora-worker.service.d/github-app.conf" \
  /etc/systemd/system/osa-algora-worker.service.d/github-app.conf

env_tmp=$(mktemp /etc/osa/github-app.env.tmp.XXXXXX)
trap 'shred -u "$env_tmp" 2>/dev/null || true' EXIT
printf 'OSA_GITHUB_APP_ID=%s\n' "$APP_ID" > "$env_tmp"
printf 'OSA_GITHUB_APP_INSTALLATION_ID=%s\n' "$INSTALLATION_ID" >> "$env_tmp"
printf 'OSA_GITHUB_APP_PRIVATE_KEY_FILE=%s\n' "$PRIVATE_KEY_FILE" >> "$env_tmp"
chown root:root "$env_tmp"
chmod 0600 "$env_tmp"
mv -f "$env_tmp" /etc/osa/github-app.env
trap - EXIT

systemctl daemon-reload
systemctl start osa-github-app-token.service
systemctl restart osa-algora-worker.service
systemctl is-active --quiet osa-algora-worker.timer
test -s /run/osa-github-app/token.env
test -s /var/lib/osa-algora-worker/latest.json
printf 'github_app_auth_installed app_id=%s installation_id=%s\n' "$APP_ID" "$INSTALLATION_ID"
