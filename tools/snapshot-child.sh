#!/usr/bin/env bash
# Executado dentro do compositor: recebe só o caminho tmpfs, nunca o segredo no argv.
set -euo pipefail
key_file="$1"
shift
cleanup() {
    [ -z "$key_file" ] || rm -f -- "$key_file"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -n "$key_file" ]; then
    IFS= read -r -d '' DAILY_TAKER_OP_KEY < "$key_file" || true
    cleanup
    key_file=''
    export DAILY_TAKER_OP_KEY
fi
exec "$@"
