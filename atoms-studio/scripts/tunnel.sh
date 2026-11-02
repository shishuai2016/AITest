#!/usr/bin/env bash
# Start a Cloudflare Quick Tunnel for the local Atoms Studio server.
# Usage: ./scripts/tunnel.sh [port]
# Override the binary with CLOUDFLARED_BIN=/path/to/cloudflared.
set -u
PORT="${1:-${PORT:-4318}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/data/tunnel.log"
URL_FILE="$ROOT/data/public-url.txt"
mkdir -p "$ROOT/data"

BIN="${CLOUDFLARED_BIN:-}"
if [ -z "$BIN" ]; then
  BIN="$(command -v cloudflared 2>/dev/null || true)"
fi
if [ -z "$BIN" ] && [ -x "$ROOT/data/bin/cloudflared" ]; then
  BIN="$ROOT/data/bin/cloudflared"
fi
if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
  echo "cloudflared not found. Install it with: brew install cloudflared" >&2
  echo "or set CLOUDFLARED_BIN to a cloudflared binary." >&2
  exit 1
fi

: > "$LOG"
while true; do
  echo "[$(date '+%F %T')] starting tunnel -> http://127.0.0.1:$PORT" | tee -a "$LOG"
  "$BIN" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate --protocol http2 2>&1 | while IFS= read -r line; do
    echo "$line" | tee -a "$LOG"
    url="$(printf '%s' "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -n 1)"
    if [ -n "$url" ]; then
      printf '%s' "$url" > "$URL_FILE"
      echo "[$(date '+%F %T')] public URL: $url" | tee -a "$LOG"
    fi
  done
  echo "[$(date '+%F %T')] tunnel exited, restarting in 5s" | tee -a "$LOG"
  sleep 5
done
