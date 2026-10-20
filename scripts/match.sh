#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARENA="${ARENA:-$ROOT/../local-play-bootstrap}"
BUDDY="${BUDDY:-$ROOT/../sc2_bot}"
REPLAYS_REPO="${REPLAYS_REPO:-$ROOT/../sc-bot-replays}"

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
STARTED="$(mktemp)"
trap 'rm -f "$STARTED"' EXIT
docker compose up --abort-on-container-exit || true
tail -n 20 results.json

# the arena names replays by match id, which restarts at 1 every run, so prefix a timestamp
STAMP="$(date +%Y-%m-%d_%H%M%S)"
find replays -maxdepth 1 -name '*.SC2Replay' -newer "$STARTED" -print0 |
    while IFS= read -r -d '' replay; do
        cp "$replay" "$REPLAYS_REPO/${STAMP}_$(basename "$replay")"
    done

git -C "$REPLAYS_REPO" pull --ff-only --quiet
git -C "$REPLAYS_REPO" add -- '*.SC2Replay'
if ! git -C "$REPLAYS_REPO" diff --cached --quiet; then
    git -C "$REPLAYS_REPO" commit --quiet -m "replays $STAMP"
    git -C "$REPLAYS_REPO" push --quiet
    echo "pushed replays to $(git -C "$REPLAYS_REPO" remote get-url origin)"
fi
