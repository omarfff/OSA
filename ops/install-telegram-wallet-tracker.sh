#!/usr/bin/env bash
set -euo pipefail
id osa-telegram >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin osa-telegram
install -d -m 0755 /etc/osa
install -d -m 0755 /usr/local/lib/osa
install -m 0644 tools/telegram-wallet-tracker.mjs /usr/local/lib/osa/telegram-wallet-tracker.mjs
if [[ ! -f /etc/osa/telegram-wallet-tracker.env ]]; then
  umask 077
  cat >/etc/osa/telegram-wallet-tracker.env <<'EOF'
TELEGRAM_BOT_TOKEN=
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
OSA_TELEGRAM_STATE=/var/lib/osa-telegram/state.json
EOF
fi
chmod 0600 /etc/osa/telegram-wallet-tracker.env
install -m 0644 ops/systemd/osa-telegram-wallet-tracker.service /etc/systemd/system/osa-telegram-wallet-tracker.service
systemctl daemon-reload
printf 'Installed but not enabled. Set TELEGRAM_BOT_TOKEN, then: systemctl enable --now osa-telegram-wallet-tracker\n'
