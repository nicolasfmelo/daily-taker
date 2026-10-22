#!/usr/bin/env bash
# Roda todos os tests/*_test.js; sai com código ≠ 0 se algum falhar.
cd "$(dirname "$0")/.." || exit 1

status=0
for f in tests/*_test.js; do
    echo "== $f"
    TZ=America/Sao_Paulo GJS_PATH=src:tests gjs "$f" || status=1
done
exit $status
