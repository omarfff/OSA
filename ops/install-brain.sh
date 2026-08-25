#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
command -v ollama >/dev/null 2>&1 || { echo 'ollama is required'; exit 2; }
ollama list | awk 'NR>1{print $1}' | grep -qx 'qwen3.5:0.8b' || { echo 'qwen3.5:0.8b is required'; exit 3; }
id -u osa-brain >/dev/null 2>&1 || useradd --system --home /var/lib/osa-brain --shell /usr/sbin/nologin osa-brain
install -d -o osa-brain -g osa-brain -m 0750 /var/lib/osa-brain
touch /var/lib/osa-brain/experiences.jsonl
chown osa-brain:osa-brain /var/lib/osa-brain/experiences.jsonl
chmod 0600 /var/lib/osa-brain/experiences.jsonl
install -d -o root -g root -m 0755 /usr/local/lib/osa
install -m 0644 "$ROOT/tools/osa-brain.mjs" /usr/local/lib/osa/osa-brain.mjs
install -m 0644 "$ROOT/tools/osa-brain-learn.mjs" /usr/local/lib/osa/osa-brain-learn.mjs
install -d -o root -g osa-brain -m 0750 /usr/local/share/osa-brain/knowledge
rm -f /usr/local/share/osa-brain/knowledge/*.md
install -o root -g osa-brain -m 0640 "$ROOT"/knowledge/*.md /usr/local/share/osa-brain/knowledge/
install -d -o root -g osa-brain -m 0750 /etc/osa
if [ ! -f /etc/osa/brain.env ]; then
  cat >/etc/osa/brain.env <<'ENV'
OSA_BRAIN_MODEL=qwen3.5:0.8b
OSA_OLLAMA_URL=http://127.0.0.1:11434
OSA_BRAIN_BIND=127.0.0.1
OSA_BRAIN_PORT=8787
ENV
fi
chown root:osa-brain /etc/osa/brain.env
grep -q '^OSA_BRAIN_KNOWLEDGE_DIR=' /etc/osa/brain.env || echo 'OSA_BRAIN_KNOWLEDGE_DIR=/usr/local/share/osa-brain/knowledge' >> /etc/osa/brain.env
grep -q '^OSA_BRAIN_EXPERIENCE_FILE=' /etc/osa/brain.env || echo 'OSA_BRAIN_EXPERIENCE_FILE=/var/lib/osa-brain/experiences.jsonl' >> /etc/osa/brain.env
chmod 0640 /etc/osa/brain.env
install -m 0644 "$ROOT/ops/systemd/osa-brain.service" /etc/systemd/system/osa-brain.service
systemctl daemon-reload
systemctl enable osa-brain.service >/dev/null
systemctl restart osa-brain.service
