#!/usr/bin/env bash
set -euo pipefail
command -v ffmpeg >/dev/null || { echo 'ffmpeg missing' >&2; exit 2; }
command -v espeak-ng >/dev/null || { echo 'espeak-ng missing' >&2; exit 2; }
id osa-media >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin osa-media
install -d -m 0755 /etc/osa
install -d -m 0755 /usr/local/lib/osa
install -m 0644 tools/media-worker.mjs /usr/local/lib/osa/media-worker.mjs
if [[ ! -f /etc/osa/media-worker.env ]]; then
  umask 077
  cat >/etc/osa/media-worker.env <<'EOF'
OSA_MEDIA_OUTBOX=/var/lib/osa-media/outbox
OSA_MEDIA_STATE=/var/lib/osa-media/state.json
OSA_MEDIA_VOICE=en-us
OSA_MEDIA_SPEAK_RATE=158
# OSA_MEDIA_FEEDS=https://techcrunch.com/category/artificial-intelligence/feed/,https://www.theverge.com/rss/ai-artificial-intelligence/index.xml
EOF
fi
chmod 0600 /etc/osa/media-worker.env
install -m 0644 ops/systemd/osa-media-worker.service /etc/systemd/system/osa-media-worker.service
install -m 0644 ops/systemd/osa-media-worker.timer /etc/systemd/system/osa-media-worker.timer
systemctl daemon-reload
systemctl enable --now osa-media-worker.timer
systemctl start osa-media-worker.service
