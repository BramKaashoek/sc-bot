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
bun run vs:easy      # or vs:medium / vs:hard / vs:harder / vs:veryhard
DIFFICULTY=veryhard AI_RACE=zerg MAP=Melee/Simple64 bun run dev
```

| Env var      | Default                         | Values                                                                                     |
| ------------ | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `DIFFICULTY` | `medium`                        | `veryeasy`, `easy`, `medium`, `mediumhard`, `hard`, `harder`, `veryhard`, `cheatvision`, `cheatmoney`, `cheatinsane` |
| `AI_RACE`    | `terran`                        | `terran`, `zerg`, `protoss`, `random`                                                      |
| `MAP`        | `Ladder2018Season4/BlueshiftLE` | any `<pack>/<map>` under `StarCraft II/Maps`                                                |
| `SC2_HOST`   | unset (launch SC2 locally)      | host of an already running SC2 to connect to; `.SC2Map` is appended to `MAP`               |
| `SC2_PORT`   | `5000`                          | port of that SC2                                                                           |
| `REALTIME`   | unset                           | any value runs the game in SC2's realtime mode                                             |
| `DELAY`      | unset                           | ms to sleep between steps (core steps 4 game loops at a time) to slow the game down        |

The Linux client is headless. The bot prints a status line every 10 game-seconds and the result at the end. Add `DEBUG=sc2:debug:*` for engine logs.

## Watch a game on Windows (WSL)

The bot runs in WSL and drives the retail Windows SC2 client, which renders the game.

### One-time setup

1. Install StarCraft II through Battle.net (free), start it once and log in.
2. Download [Ladder2018Season4](http://blzdistsc2-a.akamaihd.net/MapPacks/Ladder2018Season4.zip) (password `iagreetotheeula`) and extract it so the map ends up at `C:\Program Files (x86)\StarCraft II\Maps\Ladder2018Season4\BlueshiftLE.SC2Map`.
3. Install WSL with Ubuntu from PowerShell. `--web-download` avoids the Microsoft Store download, which tends to hang:

    ```powershell
    wsl --install --web-download -d Ubuntu
    ```

    If it reports that Ubuntu already exists but it won't start, run `wsl --unregister Ubuntu` and install again.

4. In Ubuntu, keep the repo in the Linux home (not under `/mnt/c`, which is slow):

    ```sh
    sudo apt update && sudo apt install -y unzip
    curl -fsSL https://bun.sh/install | bash && source ~/.bashrc
    git clone https://github.com/BramKaashoek/sc-bot.git ~/sc-bot
    cd ~/sc-bot && bun install
    ```

### Run

From the repo root in Ubuntu:

```sh
bun run vs:watch            # hard, normal speed
bun run vs:watch harder 2   # difficulty, speed multiplier
```

`scripts/watch.sh` starts the newest `SC2_x64.exe` in a window, listening on `0.0.0.0:5000`, waits for it, then runs the bot with `SC2_HOST` set to the Windows host IP and a `DELAY` computed from the speed. When the game ends it kills every `SC2_x64.exe`, including one you have open yourself.

- The first time, Windows Firewall asks about `SC2_x64.exe`. Allow it on Public networks too, because the WSL network adapter counts as Public. If the bot can't connect, this is the usual cause.
- SC2 installed somewhere else: set `SC2_WIN_DIR` to the install root as a WSL path, e.g. `SC2_WIN_DIR="/mnt/d/StarCraft II"`.
- High speeds come out a bit slower than asked, because the bot's own step time comes on top of `DELAY`.
- On Windows 10, WSL can only reach Windows through the host IP, which is why SC2 listens on `0.0.0.0`.

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
- `bun run build` in `bot/` builds the single binary for ladder submission (`bun build --compile index.ts --outfile dist/sc-bot`).
