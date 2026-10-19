#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SC2_WIN_DIR="${SC2_WIN_DIR:-/mnt/c/Program Files (x86)/StarCraft II}"
SC2_PORT="${SC2_PORT:-5000}"
DIFFICULTY="${1:-hard}"
SPEED="${2:-1}"

VERSION="$(ls "$SC2_WIN_DIR/Versions" | sort -V | tail -n 1)"
HOST="$(ip route show default | awk '{print $3}')"

trap 'taskkill.exe /IM SC2_x64.exe /F >/dev/null 2>&1 || true' EXIT
(cd "$SC2_WIN_DIR/Support64" && "../Versions/$VERSION/SC2_x64.exe" -listen 0.0.0.0 -port "$SC2_PORT" -displayMode 0 >/dev/null 2>&1 &)

for _ in $(seq 60); do
    (echo >"/dev/tcp/$HOST/$SC2_PORT") 2>/dev/null && break
    sleep 1
done

cd "$ROOT/bot"
# core steps 4 game loops at a time and sleeps DELAY ms between steps; 22.4 loops/s is normal game speed
DELAY="$(awk -v speed="$SPEED" 'BEGIN { print int(4 / 22.4 * 1000 / speed) }')"
SC2_HOST="$HOST" SC2_PORT="$SC2_PORT" DELAY="$DELAY" DIFFICULTY="$DIFFICULTY" bun run index.ts
