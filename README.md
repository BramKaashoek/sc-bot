# sc-bot

StarCraft II bot on Bun. `bot/` is the bot, `packages/core` is a TypeScript port of [`@node-sc2/core`](https://github.com/node-sc2/core), extended towards python-sc2 parity and consumed as `@sc-bot/core` (see [its readme](packages/core/readme.md)).

```sh
bun install
bun run check-types
bun run test
```

## Play against the built-in AI

### One-time SC2 setup (Linux)

```sh
curl -LO http://blzdistsc2-a.akamaihd.net/Linux/SC2.4.10.zip
unzip -P iagreetotheeula SC2.4.10.zip && mv StarCraftII "StarCraft II"
curl -LO http://blzdistsc2-a.akamaihd.net/MapPacks/Ladder2018Season4.zip
unzip -P iagreetotheeula Ladder2018Season4.zip -d "StarCraft II/Maps"
mkdir -p ~/Documents/"StarCraft II"
echo "executable = $PWD/StarCraft II/Versions/Base75689/SC2_x64" > ~/Documents/"StarCraft II"/ExecuteInfo.txt
```

- The launcher finds SC2 through `~/Documents/StarCraft II/ExecuteInfo.txt`, then the `SC2PATH` env var (install root), then `~/StarCraftII`.
- With `ExecuteInfo.txt`, the install folder must be named `StarCraft II` (with the space): the install root, and so the maps folder, is derived from that path segment (`packages/core/engine/launcher.ts`).
- Check that `Base75689` matches the folder in `StarCraft II/Versions/`.
- Map packs unzip into subfolders, so a map is addressed as `<pack>/<map>`, e.g. `Ladder2018Season4/BlueshiftLE`.

### Run a game

From `bot/`:

```sh
bun run vs:easy      # or vs:medium / vs:hard
DIFFICULTY=veryhard AI_RACE=zerg MAP=Melee/Simple64 bun run dev
```

| Env var      | Default                         | Values                                                                                     |
| ------------ | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `DIFFICULTY` | `medium`                        | `veryeasy`, `easy`, `medium`, `mediumhard`, `hard`, `harder`, `veryhard`, `cheatvision`, `cheatmoney`, `cheatinsane` |
| `AI_RACE`    | `terran`                        | `terran`, `zerg`, `protoss`, `random`                                                      |
| `MAP`        | `Ladder2018Season4/BlueshiftLE` | any `<pack>/<map>` under `StarCraft II/Maps`                                                |

The Linux client is headless. The bot prints a status line every 10 game-seconds and the result at the end. Add `DEBUG=sc2:debug:*` for engine logs.

## Play against a friend's bot

Bot-vs-bot matches run in [AI Arena's local-play-bootstrap](https://github.com/aiarena/local-play-bootstrap) (Docker: headless SC2 plus both bots).

```sh
git clone https://github.com/aiarena/local-play-bootstrap
A=$PWD/local-play-bootstrap

# your bot: a binary named exactly after its folder
cd sc-bot/bot && bun run build
mkdir -p $A/bots/bart_bot && cp dist/sc-bot $A/bots/bart_bot/bart_bot

# their bot: drop their bot folder in
cp -r /path/to/mark_bot $A/bots/mark_bot

# map: flat in the arena's maps folder
cp "StarCraft II/Maps/Ladder2018Season4/BlueshiftLE.SC2Map" $A/maps/

# match: Bot1 ID, name, race, type, Bot2 ID, name, race, type, map
echo '1,bart_bot,T,cpplinux,2,mark_bot,T,python,BlueshiftLE' >> $A/matches

cd $A && docker compose up
```

- `bun run match` (repo root) does it all: pulls the buddy repo (`../sc2_bot`, override with `BUDDY=`), rebuilds and deploys both bots, runs the match and prints `results.json`.
- After the first setup, `bun run arena` in `bot/` rebuilds and redeploys your bot. It assumes `local-play-bootstrap` is cloned next to `sc-bot`.
- Every non-`#` line in `matches` is played. Comment out the bundled example match and finished ones.
- How a bot is started depends on the files in its folder: `run.py` runs with python, `<name>.dll` with dotnet, `<name>.jar` with java, `<name>.js` with node, `<name>.exe` with wine, and a bare `<name>` file runs as a binary. The type column should still match: `python`, `nodejs`, `java`, `dotnetcore`, `cpplinux` (native binary, `linux` is rejected by arenaclient v0.8.0), `wine`.
- Races are `T`, `Z`, `P` or `R`.
- Results go to `results.json`, replays to `replays/` and logs to `logs/` (your bot's stdout/stderr are under `logs/bot_controller1/`).
- To test without a friend, copy the bundled `bots/basic_bot` into the opponent's folder.
- In the arena the bot is started with `--LadderServer`/`--GamePort`/`--StartPort`. It then skips launching SC2 and creating a game and only joins, so the same binary works in both setups.
