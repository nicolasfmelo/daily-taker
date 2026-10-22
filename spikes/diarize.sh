#!/usr/bin/env bash
# Spike: does OpenRouter's elevenlabs/scribe-v2 support diarize=true?
# Usage: bash spikes/diarize.sh [filename] [diarize: true|omit] [out.json]
# Requires DAILY_TAKER_OP_KEY in the environment (never printed).
set -u
cd "$(dirname "$0")/.."
FILENAME="${1:-recording.ogg}"
DIARIZE="${2:-true}"
OUT="${3:-spikes/out.json}"
case "$FILENAME" in
  *.opus) MIME="audio/opus" ;;
  *) MIME="audio/ogg" ;;
esac
ARGS=(-F "file=@spikes/clip.ogg;filename=${FILENAME};type=${MIME}"
      -F "model=elevenlabs/scribe-v2"
      -F "response_format=verbose_json"
      -F "timestamp_granularities[]=word"
      -F "language=pt")
[ "$DIARIZE" = "true" ] && ARGS+=(-F "diarize=true")
curl -sS -o "$OUT" -w '%{http_code}\n' \
  -H "Authorization: Bearer ${DAILY_TAKER_OP_KEY}" \
  "${ARGS[@]}" \
  https://openrouter.ai/api/v1/audio/transcriptions
