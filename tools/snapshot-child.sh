#!/usr/bin/env bash
# Recebe apenas a raiz isolada e o comando; o segredo nunca passa por argv.
set -euo pipefail
work="$1"
shift
if [ -f "$work/api-key" ]; then
    IFS= read -r -d '' DAILY_TAKER_OP_KEY < "$work/api-key" || true
    export DAILY_TAKER_OP_KEY
    rm -f -- "$work/api-key"
fi
exec "$@"
