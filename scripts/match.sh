#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARENA="${ARENA:-$ROOT/../local-play-bootstrap}"
BUDDY="${BUDDY:-$ROOT/../sc2_bot}"

git -C "$BUDDY" -c pull.rebase=false pull --ff-only --autostash
(cd "$ROOT/bot" && bun run arena)

# keep the vendored sc2/ lib from basic_bot; the buddy repo only carries its own sources
rsync -a --exclude .git --exclude sc2 "$BUDDY/" "$ARENA/bots/mark_bot/"

cd "$ARENA"
# the arena comments out each match once played, so rewrite it every run
cat > matches <<MATCHES
# Bot1 ID, Bot1 name, Bot1 race, Bot1 type, Bot2 ID, Bot2 name, Bot2 race, Bot2 type, Map
1,bart_bot,T,cpplinux,2,mark_bot,T,python,${MAP:-BlueshiftLE}
MATCHES
docker compose up --abort-on-container-exit
tail -n 20 results.json
