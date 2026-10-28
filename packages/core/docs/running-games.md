# Running games

The engine is the glue between your agent and a StarCraft II client. `createEngine` builds the [world](resources.md#world) (all resources and data) that every game on that engine shares, `engine.connect()` reaches an SC2 client, and one of the `run*` methods creates or joins a game and drives its step loop: step SC2, read the observation, dispatch events to engine systems, your agent and its systems, flush the queued commands, repeat until the game ends.

Everything resolves with a `[world, results]` tuple: the world as it stood on the last frame, and one `{ playerId, result }` entry per player (`result` is a `GameResult` value from [`constants/enums`](constants.md#constantsenums); the tuple type is exported as `GameResult` too). A game that crashes or loses its connection rejects instead (`ConnectionClosedError`, or the error itself), and never reaches your resources' `onGameEnd` hooks. So does a client that leaves the game without results, with a `GameEndedError`, unless the agent surrendered or the game is a replay.

The usual call order is `createEngine()`, `await engine.connect()`, one `runGame`, `engine.shutdown()`. `runBotVsBot` connects by itself.

## Requirements

- [Bun](https://bun.sh). The package ships its TypeScript source (`main` is `index.ts`), and the tests and scripts use Bun APIs. Inside this monorepo, depend on it with `"@sc-bot/core": "workspace:*"`.
- StarCraft II. The fixtures and live tests use SC2 4.10 (the Linux headless build, the same build AI Arena runs), but any version that speaks the raw API should work.
- The maps you want to play, in the install's `Maps/` (or `maps/`) folder. Official map packs are listed in the [s2client-proto readme](https://github.com/Blizzard/s2client-proto#map-packs).

### Finding StarCraft II

When the engine launches SC2 itself, it looks for the install in this order:

1. `ExecuteInfo.txt`, which the Battle.net client writes: `~/Documents/StarCraft II/ExecuteInfo.txt`, or `~/Library/Application Support/Blizzard/StarCraft II/ExecuteInfo.txt` on macOS. It names the exact executable. The install root is taken from the `StarCraft II` segment of that path, so the folder must carry that name.
2. The `SC2PATH` environment variable, pointing at the install root (the folder containing `Versions/`).
3. `~/StarCraftII` on Linux.

For options 2 and 3 the newest `Versions/Base*` folder is used. If none of them exist, launching throws; so does an install with no `Versions/Base*` folder.

### Finding maps

`runGame('Melee/Simple64', ...)` resolves the map name like this:

- A name containing `SC2Map` is treated as a path and sent to SC2 as a local map, unchanged.
- Otherwise, when the engine launched SC2 itself, it searches `<install>/Maps` and `<install>/maps` for `<name>.SC2Map` (also with whitespace removed), directly or one folder deep. So `Simple64` finds `Maps/Melee/Simple64.SC2Map`. If nothing matches, it logs a warning and asks SC2 for a Battle.net map of that name.
- With `createEngine({ launch: false })`, or under a ladder manager, nothing is searched: the name is sent as a Battle.net map name. If you want a local map in that case, pass its path yourself (it must contain `SC2Map` and be readable by that SC2 process).

## The engine

#### `createEngine(options?: EngineOptions) => Engine & { shutdown(): void }`

Resolves the [config](#config-file), builds the world and mounts the built-in engine systems (frame, units, map, and the chat debug system when `features.chatDebug` is on). It doesn't connect. Throws `NodeSC2Error` for an invalid config (see [Config file](#config-file)). All options are optional:

| Option | Default | Meaning |
|---|---|---|
| `host` | `'127.0.0.1'` | Where SC2 listens |
| `port` | `5000` | |
| `launch` | `true` | Launch SC2 on `connect()` if nothing is listening on the port |
| `force` | `false` | When launching, kill whatever process already listens on the port and start a fresh SC2 instead of reusing it |
| `onGameEnd` | | Called with the `PlayerResult[]` when a game ends, after the resources' `onGameEnd` hooks |
| `client` | | A proto client to use instead of a real connection (the test harness passes a fake one) |
| `config` | `{}` | Inline [config](#config-file): step size, feature toggles and per-resource settings. Overrides the config file. |
| `configFile` | | Path of the [config file](#config-file) to read, or `false` to read none. Without it, `SC_BOT_CONFIG` or `sc-bot.config.json` in the working directory. |

Under a [ladder manager](#ladder-play) `host` and `port` are replaced by the manager's values and nothing is launched.

#### `engine.connect() => Promise<ResponsePing>`

Launches SC2 when `launch` is on and nothing listens on the port, then opens the connection and records the client's build on `world.baseBuild`. It must resolve before `runGame`, `runReplay`, `createGame` or `joinGame`.

#### `engine.shutdown() => void`

Closes the connection. The SC2 client stays running, and the next `connect()` reuses whatever listens on the port (the first launch of SC2 takes a while).

#### `engine.getWorld() => World`

The world this engine runs games in, the same object every handler receives as its first argument.

#### `engine.use(systems: SystemWrapper<EngineObject> | SystemWrapper<EngineObject>[]) => void`

Adds engine systems, built with [`createSystem`](agents.md#systems) and `type: 'engine'`. They run every step, one after the other, after the built-in frame, unit and map systems and before your agent's handlers, and their `setup` runs at each game's setup.

## Playing

#### `engine.runGame(map: string, players: GamePlayer[], options?: RunGameOptions) => Promise<[World, PlayerResult[]]>`

Creates a game, joins it with your agent, and resolves when the game ends. The first entry of `players` that carries an `agent` plays; without one `runGame` rejects with `NodeSC2Error`. The entry's `race` is written to `agent.settings.race`. Rejects with `NodeSC2Error` (`Could not create a game on "<map>" (<error id>): <details>`) when SC2 doesn't move to the game (a map SC2 can't find, for one).

```ts
import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import { AIBuild, Difficulty, GameResultId, Race } from '@sc-bot/core/constants/enums';

const bot = createAgent({
    settings: { race: Race.TERRAN },
    async onStep({ resources }) {
        const { frame, units, actions } = resources.get();
        if (frame.time() > 300 && units.getBases().empty) await actions.surrender();
    },
});

const engine = createEngine();
await engine.connect();

const [world, results] = await engine.runGame(
    'Melee/Simple64',
    [
        createPlayer({ race: Race.TERRAN }, bot),
        createPlayer({ race: Race.ZERG, difficulty: Difficulty.HARD, aiBuild: AIBuild.RUSH }),
    ],
    {
        randomSeed: 42,
        gameTimeLimit: 900,
        saveReplayAs: './last-game.SC2Replay',
    },
);

results.forEach(({ playerId, result }) => console.log(`player ${playerId}: ${GameResultId[result!]}`));
console.log(`ended at ${world.resources.get().frame.timeFormatted()}`);
engine.shutdown();
```

`RunGameOptions` (all optional; `runBotVsBot` takes the same):

| Option | Meaning |
|---|---|
| `realtime` | Run at game speed (default `false`). The engine waits for the game instead of calling `step`. |
| `randomSeed` | Passed to the game, for repeatable built-in AI and game randomness |
| `disableFog` | Reveal the whole map |
| `gameTimeLimit` | In game seconds. Once exceeded, the game is left and every participant is reported as `TIE`. |
| `saveReplayAs` | Write the replay to this path when the game ends |

A `GamePlayer` is `{ type, race, agent?, difficulty?, aiBuild?, playerName? }`, with `type` a `PlayerType` value. `createPlayer(settings, agent?)` builds one: with an agent it is a `PARTICIPANT`, without one a `COMPUTER` (the built-in AI, which can set `difficulty`, `aiBuild` and `playerName`). `settings.race` is required. You can also write the entries by hand: `{ type: PlayerType.PARTICIPANT, race, agent }`.

**Several games on one engine.** `runGame` can be called again once a game has ended, on the same or another map. From the second game on, the world is reset first; what that clears and keeps is in [Per-game reset](resources.md#per-game-reset).

**Leaving.** `actions.surrender()` leaves the game. `runGame` then resolves normally with your player marked `DEFEAT`. If `saveReplayAs` is set, the replay is saved before any leave, including a raw `_client.leaveGame()` (SC2 refuses to save one afterwards).

#### `engine.runBotVsBot(map: string, players: [GamePlayer, GamePlayer], options?: RunGameOptions) => Promise<[GameResult, GameResult]>`

Plays two of your agents against each other. The engine starts a second SC2 client on free ports, creates the game on the first, and both agents play from this one process. Both entries must be `PlayerType.PARTICIPANT` with an `agent`. It connects by itself when the engine isn't connected yet, and kills the second client if the call fails or you interrupt the process with Ctrl-C.

```ts
import { createAgent, createEngine } from '@sc-bot/core';
import { GameResultId, PlayerType, Race } from '@sc-bot/core/constants/enums';

const terran = createAgent({ settings: { race: Race.TERRAN } });
const zerg = createAgent({ settings: { race: Race.ZERG } });

const engine = createEngine();
const [[, results]] = await engine.runBotVsBot(
    'Melee/Simple64',
    [
        { type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent: terran },
        { type: PlayerType.PARTICIPANT, race: Race.ZERG, agent: zerg },
    ],
    { gameTimeLimit: 300, saveReplayAs: './bot-vs-bot.SC2Replay' },
);

for (const agent of [terran, zerg]) {
    const entry = results.find(({ playerId }) => playerId === agent.playerId);
    console.log(`player ${agent.playerId}: ${entry ? GameResultId[entry.result!] : 'no result'}`);
}
engine.shutdown();
```

It resolves with one `[world, results]` tuple per agent (each agent's own world). Both tuples carry the same `results`: one entry per agent, keyed by the `playerId` each agent actually got, sorted by id. Player ids follow the order in which the two clients joined, so look them up by `agent.playerId` rather than by position. A player that surrenders is reported as `DEFEAT` and the other as `VICTORY`. `saveReplayAs` is saved from the first agent's client. The second engine takes the first one's resolved config and reads no config file.

SC2 4.10's joining client can't open a map whose path contains whitespace (every default Windows and macOS install path does). In that case the game is created with the map's path relative to the install's `maps` folder. If that relative path still contains whitespace, or the map isn't under that folder, the map is copied once into `<install>/maps/node-sc2/` with the whitespace removed from its name, and the game uses that copy. Copies are kept, so replays of the game stay playable.

#### `engine.runReplay(observer: Agent, replayPath: string, options?: ReplayOptions) => Promise<[World, PlayerResult[]]>`

Plays a replay with `observer` in place of a player. The agent receives the usual events (`onGameStart`, `onStep`, `onUnitCreated`, ...) from the observed player's point of view, until the replay ends. `ReplayOptions` is `{ observedPlayerId = 1, realtime = false }`. The replay's map is read from the install's `Maps/` folder (or the absolute path the replay names) and sent along when it exists there. Throws an `Error` with SC2's error code when the replay can't be started.

```ts
import { createAgent, createEngine } from '@sc-bot/core';

const observer = createAgent({
    async onStep({ resources }) {
        const { frame, units } = resources.get();
        console.log(frame.timeFormatted(), units.getWorkers(true).amount);
    },
});

const engine = createEngine();
await engine.connect();
await engine.runReplay(observer, './last-game.SC2Replay', { observedPlayerId: 1 });
engine.shutdown();
```

### Lower-level control

#### `engine.createGame(map?: string, playerSetup?: PlayerSetup[], realtime = false, options?: { randomSeed?, disableFog? }) => Promise<ResponseCreateGame | undefined>`

Creates a game on the client; `map` is resolved as under [Finding maps](#finding-maps). The game doesn't start until the players in the setup join. It resolves with `undefined`, without creating anything, under a ladder manager, and (with a console warning) when the client isn't in the launched or ended state. It rejects with `NodeSC2Error` (`Could not create a game on "<map>" ...`) when SC2 doesn't move to the game, so a `createGame` plus `joinGame` caller needs no check of its own.

#### `engine.joinGame(agent: Agent, options?: object) => Promise<[World, PlayerResult[]]>`

Joins the game with `agent` and runs the step loop to the end. `options` is merged into the join request. When the engine finds the game already in progress it resyncs with it, reading your player id from the observation. Throws an `Error` when the agent's `interface.raw` is off (the only interface the engine supports), or when the client is in any state other than launched, game-initialised or in game.

`runGame` is `createGame` followed by `joinGame`, plus the leave and replay-saving handling above. Use the two directly when someone else creates the game.

### Ladder play

When the process is started with `--LadderServer`, `--GamePort` and `--StartPort` (and optionally `--OpponentId`), as ladder managers do, `createEngine` connects to that server instead of launching SC2, `runGame` skips creating the game and only joins it, and the player list is only used to find your agent. At each game's setup the engine sets `agent.opponent.id` to `--OpponentId` when it is passed, replacing an id you set yourself; without it, a preset id is kept. See [`examples/ladder.ts`](../examples/ladder.ts).

## Configuration

### Environment variables

| Variable | Effect |
|---|---|
| `STEP_COUNT` | Game loops per step (default 4). Overrides `gameStep` from the [config](#config-file). |
| `SC_BOT_CONFIG` | Path of the [config file](#config-file), instead of `sc-bot.config.json` in the working directory |
| `DELAY` | Milliseconds to wait before each step, to watch a game slowly |
| `DEBUG` | Logging through the [`debug`](https://github.com/debug-js/debug) package, see [Debugging](#debugging) |
| `SC2PATH` | SC2 install root, see [Finding StarCraft II](#finding-starcraft-ii) |

### Config file

The engine reads an optional JSON file, `sc-bot.config.json` in the working directory (or the path in `SC_BOT_CONFIG`, or the `configFile` option; a relative path is resolved against the working directory). A missing file at the default path is fine. All keys are optional; this is the shape with the defaults:

```json
{
    "gameStep": 4,
    "features": { "chatDebug": false, "eagerMapAnalysis": true },
    "resources": {}
}
```

| Key | Effect |
|---|---|
| `gameStep` | Game loops per step. A positive integer. |
| `features.chatDebug` | Turns on the [chat debug commands](resources.md#chat-commands). |
| `features.eagerMapAnalysis` | Runs [`mapAnalysis`](map.md#mapanalysis) at game start. When `false`, it runs on the first query. |
| `resources.<name>` | Settings for that resource, passed to its `configure()`: `{ "resources": { "mapAnalysis": { "peakRatio": 2.5 }, "memory": { "expireGround": 60 } } }`. |

Other top-level sections are allowed and kept as they are on `world.config`, without validation, for bots and plugins that read their own section. `CoreConfig` is an interface, so a package can add its section by declaration merging.

Sources are applied in this order, later ones winning: the defaults, the file, the inline `createEngine({ config })` option, then the `STEP_COUNT` environment variable (for `gameStep` only). `features` is merged key by key and `resources` per resource name (the keys inside one resource's section are merged too); any other top-level section from a later source replaces the earlier one whole. `createEngine({ config: { gameStep: 2 }, configFile: false })` ignores any file. The result is frozen and available as `world.config`.

`createEngine` throws `NodeSC2Error` when a file named through `SC_BOT_CONFIG` or `configFile` doesn't exist, when the file isn't valid JSON (the message names the path) or doesn't hold a JSON object, when `gameStep` or `STEP_COUNT` isn't a positive integer, or when a feature isn't a boolean. An unknown key under `features` logs a warning. When the `resources.<name>` sections are applied, and what overrides them, is under [Per-game reset](resources.md#per-game-reset).

## Debugging

Logging goes through the `debug` package, enabled with the `DEBUG` environment variable: `DEBUG=sc2:debug:*` is the useful level, `DEBUG=sc2:*` is very verbose. A bot can also turn namespaces on in code with `createDebug.enable('sc2:debug:system')`.

| Namespace | What it logs |
|---|---|
| `sc2:debug:engine` | Create-game requests and responses, join responses, the average step delay of a game, "Queued actions failed" from the flush |
| `sc2:silly:engine` | Errors thrown by the agent's handlers that are `NodeSC2Error`s (the others print as warnings) |
| `sc2:debug:launcher` | SC2 discovery, an existing client on the port, launching |
| `sc2:debug:client` | Responses that arrive out of order or with no pending request |
| `sc2:debug:resources` | Errors thrown by a resource's `onStep` (also a `console.warn` unless a `NodeSC2Error`) or `onGameEnd` hook |
| `sc2:debug:system` | Errors thrown by a system's `onStep` and event handlers |
| `sc2:silly:system` | `NodeSC2Error`s thrown by those handlers, and agent systems skipped by their `stepIncrement` |
| `sc2:debug:state` | Each system's state after a `setState` |
| `sc2:debug:Bot` | The blueprint of a new agent |
| `sc2:debug:Macro` | Agent macro helpers that skip something: an unknown creation ability, no expansion left |
| `sc2:debug:build`, `sc2:silly:build` | Build-order tasks starting, add-on builder misses, build and train errors |
| `sc2:debug:buildOrder` | `parseBuildOrder` input it had to fix, such as a missing supply |
| `sc2:debug:earmark` | New earmarks |
| `sc2:debug:actionManager` | Commands SC2 didn't accept |
| `sc2:debug:frameSystem` | The loop ending on results, units whose command has been outstanding too long |
| `sc2:debug:MapSystem`, `sc2:silly:MapSystem` | New townhalls detected; effects appearing and expiring |
| `sc2:debug:mapAnalysis` | A failed map analysis |
| `sc2:debug:placement` | Placement lookups and user placements that were skipped |
| `sc2:silly:EventChannel` | Every event written, read and consumed |

Some namespaces draw into the game client and need the engine's debug requests to reach SC2 (a client that allows debug commands):

| Namespace | What it draws |
|---|---|
| `sc2:DebugOnScreen` | Your unit counts per category, units lost per alliance and the current earmarks, as screen text |
| `sc2:DebugWidget` | The lines set with `debug.useDebugWidget`, as one screen widget |
| `sc2:DrawDebug` | The build order and its task status, as screen text |
| `sc2:DrawDebugMap` | Expansion regions: mineral line, area fill, hull, townhall spots |
| `sc2:DrawDebugWalls` | The cells of the shortest wall the map system's wall search found |
| `sc2:DrawPlacementMap` | The placement grid |
| `sc2:DebugPathable` | The pathable cells |
| `sc2:DebugWeights` | Path-graph cells with a weight above 1 |

`sc2:DebugOnScreen` is read when the engine is created, so enable it before `createEngine()`.
