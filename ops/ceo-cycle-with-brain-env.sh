#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=${OSA_BRAIN_ENV_FILE:-/etc/osa/brain.env}
if [[ -r "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
export OSA_GEMINI_API_KEY="${OSA_GEMINI_API_KEY:-${GEMINI_API_KEY:-}}"
export OSA_GEMINI_MODEL="${OSA_GEMINI_MODEL:-${GEMINI_MODEL:-gemini-3.8-flash}}"
export OSA_CEO_AI_PROVIDER_ORDER="${OSA_CEO_AI_PROVIDER_ORDER:-gemini,ollama,anthropic,openai_compatible}"
export OSA_CEO_MAX_OUTPUT_TOKENS="${OSA_CEO_MAX_OUTPUT_TOKENS:-280}"
exec /usr/bin/node "$ROOT/tools/ceo-cycle.mjs" "$@"
