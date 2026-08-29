#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="0.35.1"
command -v node >/dev/null
command -v npm >/dev/null
npm install -g "agent-browser@${VERSION}"
agent-browser install --with-deps
install -d -m 0700 /opt/osa/browser-profiles /etc/osa /usr/local/lib/osa
for site in laborx linkedin layer3 superteam algora github; do install -d -m 0700 "/opt/osa/browser-profiles/$site"; done
install -m 0755 "$ROOT/tools/osa-browser-runtime.mjs" /usr/local/lib/osa/osa-browser-runtime.mjs
install -m 0644 "$ROOT/ops/browser/sites.json" /usr/local/lib/osa/browser-sites.json
if [[ ! -s /etc/osa/browser-runtime.env ]]; then
  key="$(openssl rand -hex 32)"; umask 077
  printf 'AGENT_BROWSER_ENCRYPTION_KEY=%s\nOSA_BROWSER_PROFILE_ROOT=/opt/osa/browser-profiles\nOSA_BROWSER_SITE_REGISTRY=/usr/local/lib/osa/browser-sites.json\n' "$key" > /etc/osa/browser-runtime.env
fi
chmod 0600 /etc/osa/browser-runtime.env
cat > /usr/local/bin/osa-browser <<'WRAP'
#!/usr/bin/env bash
set -euo pipefail
set -a; source /etc/osa/browser-runtime.env; set +a
exec node /usr/local/lib/osa/osa-browser-runtime.mjs "$@"
WRAP
chmod 0755 /usr/local/bin/osa-browser
/usr/local/bin/osa-browser health
