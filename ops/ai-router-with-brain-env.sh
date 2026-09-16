#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROVIDER_ORDER_OVERRIDE=${OSA_AI_PROVIDER_ORDER_OVERRIDE:-}
MAX_OUTPUT_OVERRIDE=${OSA_AI_MAX_OUTPUT_TOKENS_OVERRIDE:-}
ENV_FILE=${OSA_BRAIN_ENV_FILE:-/etc/osa/brain.env}
if [[ -r "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
export OSA_GEMINI_API_KEY="${OSA_GEMINI_API_KEY:-${GEMINI_API_KEY:-}}"
export OSA_GEMINI_MODEL="${OSA_GEMINI_MODEL:-${GEMINI_MODEL:-gemini-3.8-flash}}"
exec /usr/bin/node "$ROOT/tools/ai-router.mjs" "$@"
