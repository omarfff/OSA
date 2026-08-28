#!/usr/bin/env bash
set -euo pipefail

umask 077

APP_ID=${OSA_GITHUB_APP_ID:?OSA_GITHUB_APP_ID is required}
INSTALLATION_ID=${OSA_GITHUB_APP_INSTALLATION_ID:?OSA_GITHUB_APP_INSTALLATION_ID is required}
PRIVATE_KEY_FILE=${OSA_GITHUB_APP_PRIVATE_KEY_FILE:-/etc/osa/secrets/github-app-private-key.pem}
TOKEN_ENV_FILE=${OSA_GITHUB_APP_TOKEN_ENV_FILE:-/run/osa-github-app/token.env}

[[ $EUID -eq 0 ]] || { echo 'root is required' >&2; exit 2; }
[[ $APP_ID =~ ^[0-9]+$ ]] || { echo 'invalid app id' >&2; exit 2; }
[[ $INSTALLATION_ID =~ ^[0-9]+$ ]] || { echo 'invalid installation id' >&2; exit 2; }
[[ -r $PRIVATE_KEY_FILE ]] || { echo 'private key is not readable' >&2; exit 2; }
openssl pkey -in "$PRIVATE_KEY_FILE" -check -noout >/dev/null 2>&1

b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

now=$(date +%s)
issued_at=$((now - 60))
expires_at=$((now + 540))
header=$(printf '%s' '{"alg":"RS256","typ":"JWT"}' | b64url)
payload=$(printf '{"iat":%s,"exp":%s,"iss":"%s"}' "$issued_at" "$expires_at" "$APP_ID" | b64url)
unsigned="$header.$payload"
signature=$(printf '%s' "$unsigned" | openssl dgst -sha256 -sign "$PRIVATE_KEY_FILE" | b64url)
jwt="$unsigned.$signature"

response=$(curl --fail-with-body --silent --show-error \
  --connect-timeout 5 --max-time 20 \
  -X POST \
  -H "Authorization: Bearer $jwt" \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens")

token=$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
token_expires_at=$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["expires_at"])')
[[ $token == ghs_* ]] || { echo 'unexpected GitHub token format' >&2; exit 3; }

install -d -o root -g root -m 0700 "$(dirname "$TOKEN_ENV_FILE")"
tmp_file=$(mktemp "${TOKEN_ENV_FILE}.tmp.XXXXXX")
trap 'shred -u "$tmp_file" 2>/dev/null || true' EXIT
printf 'OSA_ALGORA_GITHUB_TOKEN=%s\n' "$token" > "$tmp_file"
chown root:root "$tmp_file"
chmod 0600 "$tmp_file"
mv -f "$tmp_file" "$TOKEN_ENV_FILE"
trap - EXIT

unset token response jwt signature unsigned payload header
printf 'github_app_token_refreshed app_id=%s installation_id=%s expires_at=%s\n' \
  "$APP_ID" "$INSTALLATION_ID" "$token_expires_at"
