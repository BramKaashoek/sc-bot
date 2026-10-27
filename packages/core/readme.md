# @sc-bot/core

`@sc-bot/core` is a framework for writing StarCraft II bots in TypeScript. It started as a fork of [node-sc2](https://github.com/node-sc2/core) and has been extended to cover what a [python-sc2](https://github.com/BurnySc2/python-sc2) (BurnySc2 7.3.0) bot author uses: chainable unit collections, combat math, macro helpers, ramps and walls, per-unit command arbitration with batched sends, bot-vs-bot games, replays and more.

It talks to the game through the raw [s2client-proto](https://github.com/Blizzard/s2client-proto) API, using [`@node-sc2/proto`](https://github.com/node-sc2/proto) as the websocket transport.

This readme walks through everything the library offers. For exhaustive signatures, see the [API reference](docs/api.md); the type definitions in [`types.ts`](types.ts) are the source of truth.

<!-- TOC -->

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Running games](#running-games)
- [Agents](#agents)
- [Events](#events)
- [Systems](#systems)
- [Resources](#resources)
    - [units](#units)
    - [The Units collection](#the-units-collection)
    - [Unit](#unit)
    - [actions](#actions)
    - [map](#map)
    - [frame](#frame)
    - [debug](#debug)
    - [events and data](#events-and-data)
    - [memory](#memory)
    - [spatial](#spatial)
    - [influence](#influence)
    - [pathing](#pathing)
    - [roles](#roles)
    - [squads](#squads)
    - [intel](#intel)
    - [Custom resources](#custom-resources)
- [Utilities](#utilities)
- [Constants](#constants)
- [Where this library differs from python-sc2](#where-this-library-differs-from-python-sc2)
- [Where this library differs from ares-sc2](#where-this-library-differs-from-ares-sc2)
- [Changes compared to node-sc2](#changes-compared-to-node-sc2)
- [Testing](#testing)
- [Known limitations](#known-limitations)
- [Examples](#examples)
- [More documentation](#more-documentation)

<!-- /TOC -->

## Requirements

- [Bun](https://bun.sh). The package ships its TypeScript source (`main` is `index.ts`), and the tests and scripts use Bun APIs. Inside this monorepo, depend on it with `"@sc-bot/core": "workspace:*"`.
- StarCraft II. The fixtures and live tests use SC2 4.10 (the Linux headless build, the same build AI Arena runs), but any version that speaks the raw API should work.
- The maps you want to play, in the install's `Maps/` (or `maps/`) folder. Official map packs are listed in the [s2client-proto readme](https://github.com/Blizzard/s2client-proto#map-packs).

### Finding StarCraft II

When the engine launches SC2 itself, it looks for the install in this order:

1. `ExecuteInfo.txt`, which the Battle.net client writes: `~/Documents/StarCraft II/ExecuteInfo.txt`, or `~/Library/Application Support/Blizzard/StarCraft II/ExecuteInfo.txt` on macOS. It names the exact executable.
2. The `SC2PATH` environment variable, pointing at the install root (the folder containing `Versions/`).
3. `~/StarCraftII` on Linux.

For options 2 and 3 the newest `Versions/Base*` folder is used. If none of them exist, launching throws.

### Finding maps

`runGame('Melee/Simple64', ...)` resolves the map name like this:

- A name containing `SC2Map` is treated as a path and sent to SC2 as a local map, unchanged.
- Otherwise, when the engine launched SC2 itself, it searches `<install>/Maps` and `<install>/maps` for `<name>.SC2Map` (also with whitespace removed), directly or one folder deep. So `Simple64` finds `Maps/Melee/Simple64.SC2Map`. If nothing matches, it logs a warning and asks SC2 for a Battle.net map of that name.
- With `createEngine({ launch: false })`, or under a ladder manager, nothing is searched: the name is sent as a Battle.net map name. If you want a local map in that case, pass its path yourself (it must contain `SC2Map` and be readable by that SC2 process).

## Quick start

The "hello world" of StarCraft bots is a worker rush:

```ts
import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';

const bot = createAgent({
    settings: { race: Race.ZERG },
    async onGameStart({ resources }) {
        const { units, map, actions } = resources.get();
        return actions.attackMove(units.getWorkers(true), map.getLocations().enemy[0]);
    },
});

const engine = createEngine();
await engine.connect();

const [, results] = await engine.runGame('Melee/Simple64', [
    createPlayer({ race: Race.ZERG }, bot),
    createPlayer({ race: Race.PROTOSS, difficulty: Difficulty.MEDIUM }),
]);

console.log(results);
engine.shutdown();
```

Run it with `bun run main.ts`. The first launch of SC2 takes a while; the client is left running afterwards (on port 5000 by default), and the next run reuses whatever SC2 is already listening on that port.

The pieces:

- An **agent** (`createAgent`) is your bot. It receives events such as `onGameStart` and `onStep`.
- Every handler gets the **world** as its first argument: `world.agent` (your agent, with player data like minerals and supply), `world.data` (game data and earmarks) and `world.resources` (the game state, through `resources.get()`).
- The **engine** (`createEngine`) launches or connects to SC2, creates the game and runs the step loop.

## Running games

### `createEngine(options?)`

| Option | Default | Meaning |
|---|---|---|
| `host` | `'127.0.0.1'` | Where SC2 listens |
| `port` | `5000` | |
| `launch` | `true` | Launch SC2 on `connect()` if nothing is listening on the port |
| `force` | `false` | When launching, kill whatever process already listens on the port and start a fresh SC2 instead of reusing it |
| `onGameEnd` | | Called with the `PlayerResult[]` when a game ends |
| `client` | | A proto client to use instead of a real connection (the test harness passes a fake one) |

`engine.connect()` must resolve before anything else. `engine.shutdown()` closes the connection.

### `engine.runGame(map, players, options?)`

Creates a game, joins it with your agent, and resolves with `[world, results]` when the game ends. `results` is an array of `{ playerId, result }`, where `result` is a `GameResult` value (`VICTORY`, `DEFEAT`, `TIE`, `UNDECIDED`).

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
    'Ladder2019Season3/AcropolisLE',
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

`createPlayer(settings, agent?)` builds a player entry: with an agent it is a participant, without one it is a built-in AI. Computer players can set `difficulty`, `aiBuild` (an `AIBuild` value) and `playerName`. You can also write the entries by hand: `{ type: PlayerType.PARTICIPANT, race, agent }`.

Options (all optional):

| Option | Meaning |
|---|---|
| `realtime` | Run at game speed. The engine waits for the game instead of calling `step`. |
| `randomSeed` | Passed to the game, for repeatable built-in AI and game randomness |
| `disableFog` | Reveal the whole map |
| `gameTimeLimit` | In game seconds. Once exceeded, the game is left and every participant is reported as `TIE`. |
| `saveReplayAs` | Write the replay to this path when the game ends |

**Several games on one engine.** `runGame` can be called again once a game has ended, on the same or another map. From the second game on, each game starts with an empty unit store (no enemy memory from the previous game), fresh map caches (combat rally, cached paths), no earmarks, cleared debug drawings, fresh step times and no proposed commands; the first game's setup resets nothing. Every registered resource, including your [custom resources](#custom-resources), is reset in place, so references to the resources stay valid. Every system is unpaused, its `state` goes back to a deep copy of the `state` it was created with and its step timing is reset, and a build system's `buildOptions` (`paused`, `earmarks`) go back to their initial values. The build and unit plugins are applied only once, so a build order still runs once per step.

**Leaving.** `actions.surrender()` leaves the game. `runGame` then resolves normally with your player marked `DEFEAT`. If `saveReplayAs` is set, the replay is saved before any leave, including a raw `_client.leaveGame()` (SC2 refuses to save one afterwards).

### `engine.runBotVsBot(map, [playerA, playerB], options?)`

Plays two of your agents against each other. The engine starts a second SC2 client, creates the game on the first, and both agents play from this one process. It takes the same options as `runGame`, and connects by itself.

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

It resolves with one `[world, results]` tuple per agent. Both tuples carry the same `results`: one entry per agent, keyed by the `playerId` each agent actually got (player ids follow the order in which the two clients joined, so look them up by `agent.playerId` rather than by position). A player that surrenders is reported as `DEFEAT` and the other as `VICTORY`.

SC2 4.10's joining client can't open a map whose path contains whitespace (every default Windows and macOS install path does). In that case the game is created with the map's path relative to the install's `maps` folder. If that relative path still contains whitespace, or the map isn't under that folder, the map is copied once into `<install>/maps/node-sc2/` with the whitespace removed from its name, and the game uses that copy. Copies are kept, so replays of the game stay playable.

### `engine.runReplay(observer, replayPath, options?)`

Plays a replay with an agent as the observer. The agent receives the usual events (`onGameStart`, `onStep`, `onUnitCreated`, ...) from the observed player's point of view, until the replay ends.

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

Options: `observedPlayerId` (whose view to observe, default `1`) and `realtime`.

### Lower-level control

`engine.createGame(map, playerSetup, realtime?, { randomSeed, disableFog }?)` and `engine.joinGame(agent)` are the two halves of `runGame`. Use them when someone else creates the game. `joinGame` resolves with the same `[world, results]` tuple. When the engine finds the game already in progress it resyncs with it, reading your player id from the observation.

### Ladder play

When the process is started with `--LadderServer`, `--GamePort` and `--StartPort` (and optionally `--OpponentId`), as ladder managers do, `createEngine` connects to that server instead of launching SC2, `runGame` skips creating the game and only joins it, and the player list is only used to find your agent. At each game's setup the engine sets `agent.opponent.id` to `--OpponentId` when it is passed, replacing an id you set yourself; without it, a preset id is kept. See [`examples/ladder.ts`](examples/ladder.ts). The `bot/` package in this repo builds a single binary for ladder submission with `bun build --compile index.ts --outfile dist/sc-bot`.

### Environment variables

| Variable | Effect |
|---|---|
| `STEP_COUNT` | Game loops per step (default 4) |
| `DELAY` | Milliseconds to wait before each step, to watch a game slowly |
| `DEBUG` | Logging through the [`debug`](https://github.com/debug-js/debug) package. `DEBUG=sc2:debug:*` is useful; `DEBUG=sc2:*` is very verbose. |
| `SC2PATH` | SC2 install root, see [Finding StarCraft II](#finding-starcraft-ii) |

## Agents

`createAgent(blueprint)` takes an object of event handlers plus a few settings and returns an `Agent`.

```text
createAgent({
    settings: {
        race: Race.RANDOM,                    // requested by joinGame; runGame and runBotVsBot use the player entry's race instead
        commandPriority: 0,                   // see Command arbitration
        skipAvailableAbilitiesQuery: false,   // opt-in, see below
    },
    interface: { raw: true, rawCropToPlayableArea: true },  // SC2APIProtocol.InterfaceOptions
    setup(world) { },                         // synchronous, runs before onGameStart
    ...event handlers                         // see Events
})
```

`interface` must include `raw: true`. You can add `score: true` (for `frame.getScore()`), and `render` / `featureLayer` camera setups; their data is available unprocessed from `frame.getRender()` and `frame.getFeatureLayer()`.

### Settings

- **`commandPriority`**. The priority of the commands the agent's own handlers propose, against those of its systems (see [Command arbitration](#command-arbitration)). Defaults to `0`.
- **`skipAvailableAbilitiesQuery`**. By default the engine asks SC2 every step which abilities each of your units can use. With many units that query is expensive. When `true`, it is skipped. Call `await unit.fetchAvailableAbilities()` for the units you care about; the answer is cached for the current game loop, and the synchronous accessors (`unit.availableAbilities()`, `abilityAvailable()`, `canInject()`, `canBlink()`, `canMove()`) return what was fetched this loop, or nothing. Anything built on those accessors, such as `unit.inject()`, `unit.blink()`, `actions.warpIn` and build-order `ability` tasks, needs the fetch too.

```ts
import { createAgent } from '@sc-bot/core';
import { EFFECT_STIM_MARINE } from '@sc-bot/core/constants/ability';
import { MARINE } from '@sc-bot/core/constants/unit-type';

const bot = createAgent({
    settings: { skipAvailableAbilitiesQuery: true },
    async onStep({ resources }) {
        const { units } = resources.get();
        const fighting = units.getById(MARINE).filter(marine => marine.engagedTargetTag !== '0');

        for (const marine of fighting) {
            const abilities = await marine.fetchAvailableAbilities();
            if (abilities.includes(EFFECT_STIM_MARINE)) await marine.useAbility(EFFECT_STIM_MARINE);
        }
    },
});
```

Without the setting, `fetchAvailableAbilities()` returns the result of the per-step query without asking again.

### Player data

The agent is updated every step with the player fields from the observation: `playerId`, `minerals`, `vespene`, `foodCap`, `foodUsed`, `foodArmy`, `foodWorkers`, `idleWorkerCount`, `armyCount`, `warpGateCount`, `larvaCount`, `powerSources`, `upgradeIds` and `camera`. `agent.race` is the race you actually got (useful with random), and `agent.opponent` holds `{ race, id }` as far as they are known. An `id` set before the game is kept when the race is filled in at game start; under a ladder manager it is `--OpponentId` (see [Ladder play](#ladder-play)).

### Cost, supply and affordability

| Member | Returns |
|---|---|
| `supplyCap`, `supplyUsed`, `supplyLeft`, `supplyArmy`, `supplyWorkers` | Numbers (getters). For Zerg, `supplyUsed`/`supplyArmy` correct the API's rounding of an odd count of half-supply units (zerglings, banelings and their burrowed or cocoon forms). |
| `calculateCost(unitType)` | `{ minerals, vespene }`. Morphs (e.g. a baneling, an orbital command) are net of the unit they consume. |
| `calculateUpgradeCost(upgradeId)` | `{ minerals, vespene }` |
| `calculateSupplyCost(unitType)` | Supply it adds (net for morphs) |
| `canFeed(unitType)` | Enough supply left |
| `canAffordUnit(unitType, checkSupplyCost = true)` | Minerals, gas and (optionally) supply. Ignores earmarks. |
| `canAfford(unitType, earmarkName?)` | Minerals and gas, respecting earmarks (see [events and data](#events-and-data)) |
| `canAffordN(unitType, max = 1)` | How many of `unitType`, up to `max`, you can afford |
| `canAffordUpgrade(upgradeId, earmarkName?)` | Like `canAfford`, for upgrades |
| `hasTechFor(unitType)` | Whether the required tech structure exists and is finished |

### Macro helpers

These follow python-sc2's `BotAI` helpers of the same names:

| Member | What it does |
|---|---|
| `alreadyPending(unitType)` | Count of that unit or structure in production: from orders and from unfinished units |
| `alreadyPendingUpgrade(upgradeId)` | `1` if owned, otherwise the research progress from 0 to 1 |
| `structureTypeBuildProgress(unitType)` | Best build progress among your structures of that type and its equivalents |
| `techRequirementProgress(unitType)` | Progress (0 to 1) of the structure `unitType` requires |
| `workerEnRouteToBuild(unitType)` | Workers on their way to build it |
| `getNextExpansion()` | `Promise<Point2D \| null>`: the expansion location without a townhall of yours that is closest by SC2 ground distance from your start |
| `ownedExpansions()` | `{ location, townhall }[]` |
| `expandNow(unitType?, maxDistance = 10, location?)` | Builds a townhall at the next (or given) expansion |
| `distributeWorkers(resourceRatio = 2)` | Sends idle workers, and workers above saturation, to bases and gas buildings below saturation |
| `train(unitType, amount = 1, closestTo?, trainOnlyIdleBuildings = true)` | Starts up to `amount` units across your production structures, larva and warp gates, using reactors for two at a time and tech labs where required. Resolves with how many were started. |
| `research(upgradeId)` | Starts the upgrade if it is affordable, the required building exists, the previous level is done, and an idle (and, for Protoss, powered) research structure is free. Resolves `false` otherwise. Throws for an upgrade that isn't in the researched-from dictionary. |

```ts
import { createAgent } from '@sc-bot/core';
import { Race } from '@sc-bot/core/constants/enums';
import { MARINE, SCV, SUPPLYDEPOT } from '@sc-bot/core/constants/unit-type';
import { TERRANINFANTRYWEAPONSLEVEL1 } from '@sc-bot/core/constants/upgrade';

const bot = createAgent({
    settings: { race: Race.TERRAN },
    async onStep({ agent, resources }) {
        const { actions, map } = resources.get();

        await agent.distributeWorkers();

        if (agent.supplyLeft < 3 && agent.alreadyPending(SUPPLYDEPOT) === 0 && agent.canAffordUnit(SUPPLYDEPOT)) {
            const spot = await actions.findPlacement(SUPPLYDEPOT, map.getMain().townhallPosition, { maxDistance: 15 });
            if (spot) await actions.build(SUPPLYDEPOT, spot);
        }

        if (agent.supplyWorkers < 22) await agent.train(SCV);
        await agent.train(MARINE, 2);
        await agent.research(TERRANINFANTRYWEAPONSLEVEL1);

        if ((agent.minerals ?? 0) > 400) await agent.expandNow();
    },
});
```

The helpers deduct what they spend from the agent's minerals and gas right away, and `train` also adds the supply it uses to `foodUsed`, so a second call in the same step doesn't spend the same money or supply twice. `train` and `research` also skip structures that already received a command for the current observation (`actions.unitTagsReceivedAction()`), and the worker picked for a build is only taken from idle workers when it hasn't received one. Their commands are proposed like every other command and go out at the end of the step (see [Command arbitration](#command-arbitration)); the money is deducted when they are proposed, even if the command later loses or SC2 rejects it, until the next observation corrects it.

`agent.use(system)` mounts one system or an array of them; see [Systems](#systems).

## Events

Agents and systems react to the game through event handlers named `on` + the event name. Event handlers are called as `(world, data, event)`: `data` depends on the event, and `event` is the raw `SystemEvent` (with `name`, `gameLoop`, and so on). That includes the agent's own `onGameStart` (`data` is `null`) and `onStep` (`data` is the game loop being stepped to); handlers that only take `world` keep working. The exceptions are the system hooks with their own arguments: a unit system's `onStep`, `onNewUnit`, `onUnitIdle`, `onUnitDestroyed` and `idleFunctions`, a build system's `onStep` and `buildComplete` (see [Systems](#systems)), `onStepPaused(world)`, and `onGameStart(world)` of a system mounted after the game started. `event` is optional in the handler types, so you can also call handlers directly with two arguments (in tests, for example). Handlers must return a promise (declare them `async`); the engine waits for all of them before the next step. That backpressure is what keeps a step's commands in that step. If you deliberately want work to span several steps, leave the promise dangling and guard against piling up calls yourself.

| Handler | Fires when | `data` |
|---|---|---|
| `onGameStart` | Once, after setup | |
| `onStep` | Every step for the agent and for build and unit systems; for agent systems, only once more than `stepIncrement` loops have passed since they last ran | Agent systems: the game loop. Build and unit systems get their own arguments (see [Systems](#systems)). |
| `onUpgradeComplete` | An upgrade finished | Upgrade id |
| `onChatReceived` | A chat message arrived | `SC2APIProtocol.ChatReceived` |
| `onUnitCreated` | An own unit with a new tag appears (structures included; fires for the starting units too) | `Unit` |
| `onUnitFinished` | An own unit's build progress reached 1 | `Unit` |
| `onUnitIdle` | A unit's order queue became empty, or a new own unit has no orders | `Unit` |
| `onUnitDamaged` | An own unit lost health or shield | `Unit` |
| `onUnitTookDamage` | Same moment as `onUnitDamaged` | `{ unit, amount }`: health plus shield lost since last frame |
| `onUnitDestroyed` | A tracked unit died (own, enemy or neutral) | `Unit` |
| `onUnitIsTransforming` | A unit's type changed | `Unit` |
| `onUnitTypeChanged` | An own unit's type changed (morphs, sieging, lowering depots) | `{ unit, previousType }` |
| `onUnitHasBurrowed` | A unit burrowed | `Unit` |
| `onUnitHasEngaged` / `onUnitHasDisengaged` / `onUnitHasSwitchedTargets` | A unit's engaged target was set / cleared / changed | `Unit` |
| `onEnemyFirstSeen` | An enemy tag is seen for the first time. A tag that [memory](#memory) forgot and that is seen again doesn't fire it again. | `Unit` |
| `onEnemyUnitEnteredVision` | An enemy is visible now but wasn't last frame (first sightings included) | `Unit` |
| `onEnemyUnitLeftVision` | An enemy was visible last frame but isn't now. It stays in `units` as a ghost until [memory](#memory) forgets it (30 s by default). | `Unit` |
| `onBuildingConstructionStarted` | A new own structure appears unfinished | `Unit` |
| `onBuildingConstructionComplete` | An own structure finishes, or a new one appears already finished | `Unit` |
| `onStructureConstructionStarted` | An own unit is an unfinished structure and wasn't a structure last frame: a new unfinished structure, or a unit that turned into one while keeping its tag. On SC2 4.10 a drone's building gets a new tag (the drone leaves the observation and is reported destroyed when the building finishes), so for drones this fires together with `onBuildingConstructionStarted`, with the building as `data`. | `Unit` |
| `onStructureConstructionComplete` | An own structure finishes, or a structure is first seen already finished (the starting townhall, debug-spawned buildings) | `Unit` |
| `onUnitSpawned` | An own non-structure unit is seen for the first time; once per tag per game, even if it later disappears from the observation (e.g. loaded into a transport) | `Unit` |
| `onNewEffect` / `onExpiredEffect` | An effect (e.g. a storm) appeared / ended | The effect and its effect data |
| `onCommandResults` | The step after proposed commands were flushed, once per flush that had any | `CommandResult[]`: per proposal, whether it was sent (`won`), `dropped` or `rejected` (see [Command arbitration](#command-arbitration)) |
| `onEnemyStrategyDetected` | [intel](#intel) detects a strategy flag for the first time this game, in the same step | `EnemyStrategyDetected`: `{ flag, gameLoop }` |

`onStructureConstructionStarted`, `onStructureConstructionComplete` and `onUnitSpawned` correspond to python-sc2's `on_building_construction_started`, `on_building_construction_complete` and `on_unit_created`. The other events keep node-sc2's behaviour.

```ts
import { createAgent } from '@sc-bot/core';
import type { SystemEvent, Unit, UnitDamage, UnitTypeChange, World } from '@sc-bot/core';
import { UnitTypeId } from '@sc-bot/core/constants/index';

const bot = createAgent({
    async onUnitSpawned(world: World, unit: Unit) {
        console.log(`spawned ${UnitTypeId[unit.unitType]}`);
    },
    async onStructureConstructionComplete({ resources }: World, structure: Unit) {
        if (structure.isGasMine()) {
            const { units, actions } = resources.get();
            const nearby = units.getClosest(structure.pos, units.getMineralWorkers(), 3);
            return actions.mine(nearby, structure);
        }
    },
    async onUnitTypeChanged(world: World, { unit, previousType }: UnitTypeChange) {
        console.log(`${UnitTypeId[previousType]} became ${UnitTypeId[unit.unitType]}`);
    },
    async onUnitTookDamage(world: World, { unit, amount }: UnitDamage, event: SystemEvent) {
        console.log(`${unit.tag} lost ${amount} at loop ${event.gameLoop}`);
    },
    async onEnemyUnitLeftVision(world: World, enemy: Unit) {
        console.log(`${UnitTypeId[enemy.unitType]} left vision, remembered: ${enemy.isMemory()}`);
    },
});
```

### Custom events

`events.write({ name, data })` publishes your own event. Any agent or system with a handler named `on` + the PascalCase name receives it the next time it reads events. Events default to type `'agent'`, which agents and agent, build and unit systems all read.

```ts
import { createAgent, createSystem } from '@sc-bot/core';
import type { Unit, World } from '@sc-bot/core';

const scouting = createSystem({
    name: 'Scouting',
    async onEnemyFirstSeen({ resources }: World, enemy: Unit) {
        if (enemy.isTownhall()) {
            resources.get().events.write({ name: 'enemyTownhallFound', data: enemy });
        }
    },
});

const bot = createAgent({
    async onEnemyTownhallFound(world: World, townhall: Unit) {
        console.log('enemy base at', townhall.pos);
    },
});
bot.use(scouting);
```

## Systems

A system is a reusable piece of a bot: an object of event handlers with its own state, mounted on an agent with `agent.use()`. `createSystem(blueprint, options?)` takes:

```text
createSystem({
    name: 'MySystem',            // required, used in logs
    type: 'agent',               // 'agent' (default), 'build' or 'unit'
    defaultOptions: {
        state: {},               // initial state
        stepIncrement: 8,        // agent systems: skip onStep until more than N game loops have passed;
                                 // defaults to 8 with an explicit type: 'agent', to 2 when type is left out
        commandPriority: 0,      // priority of this system's commands, see Command arbitration
    },
    setup(world) { },            // synchronous, before onGameStart
    ...event handlers
})
```

Inside handlers, `this.state` is the system's state and `this.setState(partial)` shallow-merges into it (or pass a function `current => next`). `this.pause()` and `this.unpause()` stop and resume the system's handlers; while paused, an `onStepPaused(world)` handler, if the system has one, is called each step instead. Each step, mounted systems run concurrently with each other, after the agent's own handlers. The options (`state`, `stepIncrement`, `commandPriority`) can also be passed as `createSystem`'s second argument, which overrides `defaultOptions`.

When two systems command the same unit in one step, the one with the higher `commandPriority` wins; at equal priority, the one mounted first by `agent.use()` wins, and the agent's own handlers beat every system. See [Command arbitration](#command-arbitration).

### Build systems

A system with `type: 'build'` and a `buildOrder` gets the builder plugin. Tasks come from `taskFunctions`:

| Task | Meaning |
|---|---|
| `build(unitType, qty = 1, opts?)` | Build a structure. `opts.near` (a unit type) anchors placement at the first of your units of that type, where the builder uses `findPlacement` (see below); `opts.on` picks the host for an add-on. |
| `train(unitType \| unitType[], qty = 1, opts?)` | Train a unit (a random one of the list each time). Uses warp-in once warp gate research is done. |
| `upgrade(upgradeId)` | Research an upgrade |
| `ability(abilityId, opts?)` | Use an ability on any unit that has it; `opts.target` (a unit type) picks a target |

`build`, `train` and `ability` tasks also accept `opts.skip`: the name of a key in the system's state; when that key is truthy, the task is skipped. `upgrade` takes no options.

A build order is either a plain list of tasks, or a list of `[supply, task]` pairs. With pairs, worker tasks are inserted automatically until the given supply is reached (counting from 12). A `train` task then adds its supply to the count: its unit's supply cost times `qty`, or for a list of unit types the largest supply cost among them. A Zerg `build` task subtracts one, for the drone it consumes.

```ts
import { createAgent, createSystem, taskFunctions } from '@sc-bot/core';
import type { Unit, World } from '@sc-bot/core';
import { Race } from '@sc-bot/core/constants/enums';
import { BARRACKS, BARRACKSTECHLAB, MARINE, REFINERY, SCV, SUPPLYDEPOT } from '@sc-bot/core/constants/unit-type';
import { STIMPACK } from '@sc-bot/core/constants/upgrade';

const { build, train, upgrade } = taskFunctions;

const opener = createSystem({
    name: 'Opener',
    type: 'build',
    buildOrder: [
        [14, build(SUPPLYDEPOT)],
        [16, build(BARRACKS)],
        [16, build(REFINERY)],
        [19, build(BARRACKSTECHLAB, 1, { on: BARRACKS })],
        [20, train(MARINE, 4)],
        [22, upgrade(STIMPACK)],
    ],
    setup(world: World) {
        world.resources.set({
            placer: {
                place: ({ resources }, unitTypeId) => (
                    unitTypeId === SUPPLYDEPOT ? resources.get().map.getMainBaseRamp()?.cornerDepots : undefined
                ),
            },
        });
    },
    async buildComplete() {
        this.setState({ openerDone: true });
    },
});

const pressure = createSystem({
    name: 'Pressure',
    type: 'agent',
    defaultOptions: { state: { waves: 0 }, stepIncrement: 16 },
    async onStep({ resources }: World) {
        const { units, map, actions } = resources.get();
        const marines = units.getById(MARINE).idle;
        if (marines.amount >= 8) {
            this.setState({ waves: this.state.waves + 1 });
            return actions.attackMove(marines, map.getEnemyNatural().townhallPosition);
        }
    },
});

const workers = createSystem({
    name: 'Workers',
    type: 'unit',
    units: [SCV],
    idleFunctions: {
        [SCV]: async ({ resources }: World, scv: Unit) => resources.get().actions.gather(scv),
    },
    async onNewUnit(world: World, scv: Unit) {
        console.log(`now managing ${scv.tag}`);
    },
});

const bot = createAgent({ settings: { race: Race.TERRAN } });
bot.use([opener, pressure, workers]);
```

How the builder places structures:

- Gas buildings go on a free geyser at an owned base (`actions.buildGasMine()`).
- Townhalls go to the first available expansion.
- If a `placer` resource is set (as above) and returns positions for that unit type, one of them that SC2 accepts is used.
- Otherwise it calls `actions.findPlacement` near `opts.near`, or near a point 8 cells from the main townhall towards the map center. Protoss buildings other than pylons are placed around finished pylons; Terran production buildings require room for an add-on.

A build system's `onStep` receives `(world, gameLoop, task, result)`: the current task and the `BuildResult` of this step's attempt. Both are `undefined` while the order is paused or finished. `createSystem` types a `type: 'build'` blueprint as `BuildSystemObject`, so these parameters are typed. `buildComplete(world, gameLoop)` is called once when the last task is done. `this.pauseBuild()` and `this.resumeBuild()` pause the order. When the current task still can't be afforded 1000 game loops after it came up, the builder earmarks its cost (see [events and data](#events-and-data)); `this.earmarkDelay(loops)` changes that delay, and `0` turns earmarking off.

### Unit systems

A system with `type: 'unit'` manages units by type (`units: [...]`) and/or label (`labels: [...]`). It gets:

- `onNewUnit(world, unit)` when a matching unit is created or finished.
- `idleFunctions`: handlers for idle units, keyed by unit type, by label, or `labeled` (any labelled unit). Unmatched idle units fall through to `onUnitIdle`.
- `onUnitDestroyed` only for matching units.
- `onStep(world, { all, unlabeled, labeled })`: the matching finished units, grouped (`UnitSystemUnits`).

## Resources

`world.resources.get()` returns the resources, best destructured:

```text
const { actions, events, frame, map, units, debug, memory, spatial, influence, pathing, roles, squads, intel } = resources.get();
```

Bots and plugins can add their own; see [Custom resources](#custom-resources).

### units

All getters return a [`Units`](#the-units-collection) collection. Most accept an `Alliance` value or a filter object, which is matched field by field against each unit (`units.getAlive({ isFlying: true })`).

| Getter | Returns |
|---|---|
| `getAll(filter?)` | Every unit the engine knows: the current ones, enemies kept as memory, and own and neutral units that died (labelled `dead`) or left the observation. Pass an `Alliance`, a filter object, or a predicate `(unit) => boolean`. |
| `getAlive(filter?)` | Units present in the current observation |
| `getById(unitType \| unitType[], filter = { alliance: SELF })` | Units of those types |
| `getByType(unitType \| unitType[])` | Live units of those types, any alliance |
| `getByTag(tag)` / `getByTag(tags)` | A `Unit` or `undefined`; for an array, the known units as `Units` |
| `getClosest(position, units, n = 1)` | The `n` closest of `units` (also works for power sources). It sorts the whole list; for range queries use [`spatial`](#spatial). |
| `getArmyValue(alliance = SELF, { includePending = false, includeGhosts = true })` | Minerals plus gas of the combat units (`isCombatUnit()`), each at its type's full cost. For `ENEMY` it reads [memory](#memory), ghosts included unless `includeGhosts: false`; for `SELF` with `includePending` it also counts units in production (structure orders, two for a reactor, and eggs). Throws `NodeSC2Error` for any other alliance. |
| `getBases(filter = { alliance: SELF })` | Townhalls |
| `getWorkers(includeBusy = false)` | Own workers of your race. By default skips workers that `actions.build` sent off until SC2 reports their order back (or 250 game loops pass). |
| `getIdle()` | Own units with an empty order queue |
| `getIdleWorkers()`, `getMineralWorkers()`, `getConstructingWorkers()` | Subsets of own workers |
| `getCombatUnits(filter = SELF)`, `getRangedCombatUnits()` | Army units (own by default) |
| `getStructures(filter = { alliance: SELF })`, `getUnfinished(filter?)`, `inProgress(unitType)` | Structures; unfinished units |
| `getProductionUnits(unitType)` | Your live units whose type can produce `unitType` |
| `getUpgradeFacilities(upgradeId)` | Your live units whose type can research it |
| `getPendingAt(unitType \| unitType[], position, maxDistance = 1)` | Your unfinished units of those types within `maxDistance` of `position`, plus workers ordered to build one there |
| `getMineralFields(filter?)`, `getGasGeysers(filter?)`, `getGasMines(filter = SELF)` | Resources and gas buildings |
| `getEnemyUnits()`, `getEnemyStructures()` | Enemies in the current observation (non-structures / structures) |
| `getDestructables()`, `getWatchtowers()`, `getLarva()` | Neutral rocks, xel'naga towers, larva |
| `withLabel(label)`, `withCurrentOrders(abilityId)` | Units carrying a label; units with that ability in their order queue |
| `clone()` | A data-only deep copy of every unit, keyed by tag |

**Enemy memory.** An enemy that leaves vision stays in `units` with its last known state, as a ghost. `getAll(Alliance.ENEMY)` includes it, `getAlive` doesn't. `unit.isMemory()` is `true` for it and `unit.age()` gives the seconds since it was last seen. Ghosts expire after 30 seconds by default and are dropped earlier when their last position is visible again (burrowed ones are kept until they expire); see [memory](#memory). Enemies whose death SC2 reports are removed right away.

### The Units collection

`Units` is a subclass of `Array<Unit>`, so it works anywhere a `Unit[]` does. `filter`, `slice`, `concat`, `splice`, `reverse` and `sort` return `Units` again, so calls chain. `map` and `flatMap` return a `Units` only when the callback returns units; `units.map(unit => unit.tag)` is a plain `string[]`.

```ts
import type { World } from '@sc-bot/core';
import { MARAUDER, MARINE } from '@sc-bot/core/constants/unit-type';

export async function onStep({ resources }: World) {
    const { units, map, actions } = resources.get();
    const army = units.getById([MARINE, MARAUDER]).ready;
    const enemies = units.getEnemyUnits().visible;
    if (army.empty) return;

    const front = army.closestTo(map.getEnemyMain().townhallPosition);
    const threats = enemies.closerThan(12, front).sortedByDistanceTo(front);
    const stragglers = army.idle.furtherThan(15, army.center);

    if (threats.exists) {
        await actions.attackMove(army, threats.first.pos);
    } else if (stragglers.exists) {
        await actions.move(stragglers.take(8), front.pos);
    }
}
```

Where a `position` is taken, it is a `Unit` or a `Point2D`; distances are center to center.

```text
// properties
amount, empty, exists, first, random, center, tags
ready, notReady, idle, flying, notFlying, structures, notStructures, selected, visible
mineralFields, gathering, returning, collecting, preferIdle

// set operations and selection
copy(), union(other), intersection(other), difference(other)
findByTag(tag) -> Unit | undefined;  byTag(tag) -> Unit (throws if missing)
take(count), randomGroupOf(count), randomOr(fallback)
tagsIn(tags), tagsNotIn(tags)
ofType(types), excludeType(types), sameTech(types), sameUnit(types)
sorted(key, reverse = false)

// distance
closestTo(position), furthestTo(position)
closestDistanceTo(position), furthestDistanceTo(position)
closerThan(distance, position), furtherThan(distance, position)
inDistanceBetween(position, min, max)
closestNUnits(position, count), furthestNUnits(position, count)
nClosestToDistance(position, distance, count), nFurthestToDistance(position, distance, count)
inDistanceOfGroup(other, distance), inClosestDistanceToGroup(other)
sortedByDistanceTo(position, reverse = false)
inAttackRangeOf(unit, bonusDistance = 0)
```

`first`, `random`, `center`, `closestTo`, `furthestTo` and the `*DistanceTo` methods throw on an empty collection; check `exists` first, or use `randomOr`. `flying` counts units lifted by a graviton beam. `gathering` and `collecting` include MULEs.

**Testing note.** Because the getters (and `map` on their results) return `Units` instead of plain arrays, `expect(units.getWorkers()).toStrictEqual([...])` and `assert.deepStrictEqual` fail against a plain array (the prototypes differ). `toEqual` works.

`Units` is exported from `@sc-bot/core`; `Units.from(unitArray)` wraps a plain array.

### Unit

A `Unit` is the proto `SC2APIProtocol.Unit` (tag, unitType, alliance, pos, health, shield, energy, orders, buffIds, buildProgress, ...) plus the methods below. The same object is updated in place every step.

```text
// identity and state
is(unitType), isWorker(), isTownhall(), isStructure(), isGasMine(), isMineralField(), isCombatUnit()
isEnemy(), isFinished(), isCurrent(), isIdle(), isCloaked(), isSnapshot(), isMemory(), age()
isMoving(), isAttacking(), isPatrolling(), isRepairing(), isHolding(), isTransforming()
isGathering(type?), isReturning(), isCollecting(), isConstructing(), isConstructingScv()
isCarryingMinerals(), isCarryingVespene(), isCarryingResource(), isUsingAbility(abilityIds)
isFlyingOrGravitoned()

// attributes
isLight(), isArmored(), isBiological(), isMechanical(), isMassive(), isPsionic()

// buffs, add-ons, harvesting
buffs() -> Set<number>, hasBuff(buffId)
hasAddOn(), hasReactor(), hasTechLab(), addOnPosition(), addOnLandPosition()
surplusHarvesters()   // assigned minus ideal

// combat
groundDps(), airDps(), groundRange(), airRange(), sightRange(), movementSpeed()
realSpeed()           // with speed upgrades, creep and speed-changing buffs
weaponReady(), canShootUp()
distanceToWeaponReady()   // how far it can move before its weapon is ready again
targetInRange(target, bonusDistance = 0)
inAbilityCastRange(abilityId, target, bonusDistance = 0)
calculateDamageVsTarget(target, ignoreArmor = false, includeOverkillDamage = true) -> [damage, weaponSpeed, weaponRange]
calculateDpsVsTarget(target, ignoreArmor = false, includeOverkillDamage = true)
isFacing(other, angleError = 0.05)

// abilities and commands
availableAbilities(), abilityAvailable(abilityId), fetchAvailableAbilities()
canInject(), canBlink(), canMove()
useAbility(abilityId, { target?, queue? }), inject(target?), blink(target, opts?), burrow(opts?), toggle(opts?)

// labels and data
addLabel(name, value), hasLabel(name), getLabel(name), removeLabel(name), hasNoLabels(), labels
data(), typeData(unitType), getLife()   // health as a percentage
```

`burrow()` burrows any unit that can, and `toggle()` switches any two-way morph (siege mode, depots, burrow, phasing, ...). Buff time is in the properties `buffDurationRemain` and `buffDurationMax`; upgrade levels are in `attackUpgradeLevel`, `armorUpgradeLevel` and `shieldUpgradeLevel`.

The combat math follows python-sc2: armor and shield armor, upgrade levels, attribute bonuses, guardian shield, shredder missile, stim, and range and attack-speed upgrades. Upgrade-dependent bonuses only apply to your own units, because enemy upgrades aren't observable.

```ts
import type { Unit, World } from '@sc-bot/core';
import { STIMPACK } from '@sc-bot/core/constants/buff';
import { MARINE } from '@sc-bot/core/constants/unit-type';

export async function microMarines({ resources }: World) {
    const { units, actions } = resources.get();
    const enemies = units.getEnemyUnits();
    if (enemies.empty) return;

    for (const marine of units.getById(MARINE)) {
        const targets = enemies.inAttackRangeOf(marine);
        if (targets.empty || !marine.weaponReady()) continue;

        const bestTarget: Unit = targets.sorted(enemy => marine.calculateDpsVsTarget(enemy), true).first;
        const [damage, weaponSpeed, range] = marine.calculateDamageVsTarget(bestTarget);
        console.log(damage, weaponSpeed, range, marine.hasBuff(STIMPACK), marine.realSpeed());
        await actions.attack([marine], bestTarget);
    }
}
```

On SC2 versions before 5.0.4 (base build 82457, which includes 4.10) the API misreports `displayType`. There, `isSnapshot()` (and the `visible` filter) fall back to the visibility grid, as python-sc2 does.

### actions

`actions` sends commands and queries. The unit command methods (`attack` to `do` below, plus `stop`, `holdPosition`, `repair` and `returnResource`) don't send right away: they propose the command and resolve with no value. The engine sends every proposal of the step in one request after all systems have run, one command set per unit (see [Command arbitration](#command-arbitration)). Given an empty unit list they do nothing. A method still rejects at once when its preconditions fail (`BuildError`, `TrainError`, `GatherError`, `ActionManagerError`); what happened to the command itself arrives the next step as an `onCommandResults` event.

| Method | What it does |
|---|---|
| `attack(units, target, queue?)` | Attack a unit. Rejects (`ActionManagerError`) without a target unit. |
| `attackMove(units, position?, queue?)` | Attack-move. The position defaults to the first possible enemy start location; rejects (`ActionManagerError`) when there is neither. |
| `move(units, target, queue?)`, `smart(units, target, queue?)` | Move to / right-click a position or unit |
| `patrol(units, [from, to] \| to, queue?)` | Patrol |
| `stop`, `holdPosition`, `returnResource` `(units, queue?)` | |
| `repair(units, target, queue?)` | |
| `gather(worker, mineralField?, queue = true)` | Mine. Without a field, picks one at the closest undersaturated base (or the closest base). Rejects (`GatherError`) for a non-worker or when there is nothing to mine. |
| `mine(workers, gasBuilding, queue = true)` | Harvest gas |
| `build(unitType, positionOrTarget?, worker?)` | Build. Picks a worker when none is given. Rejects (`BuildError`) without tech or money. |
| `buildGasMine()` | Build a gas building on a free geyser at an owned base |
| `train(unitType, producer?)` | Train; finds an idle producer when none is given. Rejects (`TrainError`). |
| `upgrade(upgradeId, facility?)` | Research |
| `warpIn(unitType, { nearPosition?, maxQty?, highground? })` | Warp in at power fields. Rejects when nothing is affordable, no warp gate is ready, or no point is free. |
| `swapBuildings(a, b)` | Lift two Terran buildings and land each in the other's spot. Sent immediately, step by step; resolves after both land commands, rejects if either can't lift or isn't finished. |
| `do(abilityId, tags, { target?, queue? })` | Any ability |
| `toggleAutocast(units, abilityId)` | Sent immediately |
| `chatSend(message, teamOnly = false)` | Sent immediately |
| `surrender()` | Leave the game; `runGame` resolves with your `DEFEAT` (see [Running games](#running-games)) |
| `canPlace(unitType, positions)` | One random placeable position from the list (at most 10 are checked, sampled at random), or `false` |
| `findPlacement(unitType, near, options?)` | The closest placeable position, searching outward in rings, or `false` |
| `sendAction(commands)`, `sendQuery(query)` | Raw `ActionRawUnitCommand`s, sent immediately, and `RequestQuery` |

`findPlacement` options: `maxDistance = 20`, `placementStep = 2`, `randomAlternative = true` (pick randomly among the valid candidates of the closest ring, instead of the single closest) and `addonPlace = false` (also require room for a Terran add-on).

The error classes are exported from `@sc-bot/core`: `BuildError`, `TrainError` and `GatherError` extend `ActionManagerError`, which extends `NodeSC2Error`; `MapDecompositionError`, `GameEndedError` and `ConnectionClosedError` (a game whose SC2 connection closed) are there too. Check them with `instanceof`.

```ts
import { TrainError } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import { ATTACK, EFFECT_HEAL } from '@sc-bot/core/constants/ability';
import { BARRACKS, MARINE, MEDIVAC } from '@sc-bot/core/constants/unit-type';

export async function onStep({ resources }: World) {
    const { units, map, actions } = resources.get();

    try {
        await actions.train(MARINE);
    } catch (err) {
        if (!(err instanceof TrainError)) throw err;
    }

    const spot = await actions.findPlacement(BARRACKS, map.getMain().townhallPosition, { addonPlace: true });
    if (spot) await actions.build(BARRACKS, spot);

    const army = units.getById(MARINE).idle;
    if (army.amount >= 16) {
        actions.queueAction({
            abilityId: ATTACK,
            unitTags: army.map(marine => marine.tag!),
            targetWorldSpacePos: map.getEnemyNatural().townhallPosition,
        });
    }

    const medivacs = units.getById(MEDIVAC);
    if (medivacs.exists) await actions.toggleAutocast(medivacs, EFFECT_HEAL);

    await actions.chatSend('glhf');
}
```

#### Command arbitration

Every proposed command belongs to a commander: `'agent'` for the agent's own handlers, the system's `name` for a system's handlers. The engine tracks this through `await`s and Bluebird callbacks, so a handler doesn't pass anything. Commands proposed outside a step (in a test, say) belong to `'unknown'` and lose every tie.

At the end of the step, after all systems have run, the engine decides per unit (a command proposed after that, from a promise a handler didn't await, goes out with the next step's):

- **One commander wins.** The commander with the highest priority wins: the agent's `settings.commandPriority` or a system's `commandPriority`, both `0` by default. At equal priority the agent's handlers win, then systems in `agent.use()` order. All commands of the other commanders for that unit are dropped.
- **The winner keeps all its commands** for that unit, in the order it proposed them, so a build followed by a queued gather or two trains on a reactor both go out.
- **Repeats are dropped.** A command that repeats the unit's current order (same ability and target, not queued) is not sent, like python-sc2's `prevent_double_actions`. Re-issuing an order every step is a no-op.
- **Identical commands are merged.** Units whose only command is the same (ability, target, queue flag) get one command with all of them.
- **A dropped or rejected build frees its worker.** The worker loses its `command` label in the same step, so it isn't reported stuck. Nothing is refunded: money spent on a proposal comes back with the next observation.

`actions.as({ owner?, priority?, rank? }, fn)` runs `fn` with a different commander; what it doesn't set is taken from the current one. `rank` is the tie-break at equal priority, lower wins (the agent is `-1`, systems count from `0` in `use()` order).

`sendAction`, `swapBuildings`, `toggleAutocast`, `chatSend` and `surrender` send immediately. Units given a command through `sendAction` count as commanded for the rest of the observation: a proposal from another commander is dropped unless it strictly outranks the sender (higher priority, or at equal priority a lower rank); the sender's own follow-ups still go out.

`actions.queueAction(command | command[])` proposes raw `ActionRawUnitCommand`s under the current commander; it throws `ActionManagerError` for a command without `unitTags`. `actions.flushQueuedActions()` decides and sends early, `actions.clearQueuedActions()` discards the proposals, and `actions.unitTagsReceivedAction()` returns the tags that were proposed or sent for the current observation, by any commander.

The step after a flush, handlers named `onCommandResults` receive one `CommandResult` per proposal and outcome (a proposal for several units that partly lost gets two):

| Field | |
|---|---|
| `owner`, `command`, `tags` | Who proposed it, the command as proposed, and the units this outcome covers |
| `outcome` | `'won'` (sent, SC2 accepted it), `'dropped'` (not sent) or `'rejected'` (SC2 refused it, or the request failed) |
| `reason` | Dropped only: `'outranked'`, `'repeat'` or `'not-owner'` (the unit's role is exclusive, see [roles](#roles)) |
| `by` | Dropped because outranked: the winning commander. Dropped as `'not-owner'`: the owning role, `'role:<ROLE>'`. |
| `result` | SC2's `ActionResult` for a sent command |
| `error` | Rejected because the request itself failed: its message |

A command SC2 refuses is also logged on `sc2:debug:actionManager`; it doesn't throw anywhere.

```ts
import { createAgent, createSystem } from '@sc-bot/core';
import type { CommandResult, World } from '@sc-bot/core';
import { Alliance } from '@sc-bot/core/constants/enums';

const defense = createSystem(
    {
        name: 'Defense',
        async onStep({ resources }: World) {
            const { units, actions } = resources.get();
            const workers = units.getWorkers();
            const threat = units.getCombatUnits(Alliance.ENEMY).first;
            if (threat && workers.length > 0) await actions.attack(workers.slice(0, 4), threat);
        },
        async onCommandResults(world: World, results: CommandResult[]) {
            for (const result of results.filter(({ outcome }) => outcome === 'rejected')) {
                console.log(`${result.owner}: ${result.tags.length} units, result ${result.result ?? result.error}`);
            }
        },
    },
    { commandPriority: 10 },
);

const bot = createAgent({});
bot.use([defense]);
```

The commander is tracked with `AsyncLocalStorage`. To carry it through Bluebird callbacks, importing `@sc-bot/core` turns on Bluebird's `asyncHooks` for the whole process, which costs about 0.1 ms per step with a handful of systems.

### map

The `map` resource covers the map layout: start locations, expansions, ramps, grids and pathing.

**Expansions.** `getExpansions(alliance?)` returns every expansion, ordered by distance from your start location (or from the enemy's with `Alliance.ENEMY`). Shortcuts: `getMain()`, `getNatural()`, `getThirds()`, `getEnemyMain()`, `getEnemyNatural()`, `getEnemyThirds()`, `getClosestExpansion(point)`, `getAvailableExpansions()`, `getOccupiedExpansions(alliance?)`. `getThirds()` returns up to two expansions (fewer on small maps). An `Expansion` has `townhallPosition`, `zPosition`, `centroid`, `cluster` (`mineralFields`, `vespeneGeysers`), `areas` (`areaFill`, `placementGrid`, `mineralLine`, `behindMineralLine`, `wall`), `pathFromMain`, `pathFromEnemy`, `getBase()`, `getAlliance()` and `getWall()`.

`getExpansionLocations()` returns every possible townhall position, computed with python-sc2's algorithm.

**Locations.** `getLocations()` returns `{ self, enemy }`, where `enemy` is an array of possible enemy start points. `getCombatRally()` is a gathering point on the path from your natural towards the map center, 5% further along per base you own (the map center on a map without expansions). `getCenter(pathable?)`, `getSize()`.

**Ramps and walls.** `getRamps()` returns every ramp; `getMainBaseRamp()` the one leading out of your main, or `undefined` on maps where none is found (some custom maps). A `Ramp` has `points`, `upper`, `lower`, `topCenter`, `bottomCenter` and `size`, plus wall positions that are `null` (or `[]`) when a ramp doesn't fit the standard shape. As in python-sc2, `barracksCanFitAddon` throws on such a ramp (read `barracksCorrectPlacement` instead), and `cornerDepots` throws on a ramp with a single upper cell. On a standard-sized ramp whose upper cells are too far apart for the wall math, `barracksInMiddle` and what is built on it (`barracksCorrectPlacement`, the Protoss wall positions) throw where python-sc2 asserts, while `depotInMiddle` is `null` and `cornerDepots` `[]`:

```text
upper2ForRampWall: Point2D[]
depotInMiddle, barracksInMiddle: Point2D | null
cornerDepots: Point2D[]                    // the two depots of a terran wall
barracksCanFitAddon: boolean
barracksCorrectPlacement: Point2D | null   // leaves room for an add-on when possible
protossWallPylon, protossWallWarpin: Point2D | null
protossWallBuildings: Point2D[]
```

`getVisionBlockers()` returns the cells of vision-blocking terrain.

**Grids and pathing.**

| Method | Returns |
|---|---|
| `isPathable(point)`, `isPlaceable(point)`, `isPlaceableAt(unitType, pos)` | Pathing and placement as the map system tracks them (structures and rocks block cells) |
| `inPathingGrid(point)`, `inPlacementGrid(point)` | The static grids from the game info |
| `getTerrainHeight(point)`, `getTerrainZHeight(point)`, `getHeight(point)` | The raw height-map value (0 to 255); that value as world z; node-sc2's height (the processed height grid divided by 10) |
| `isVisible(point)`, `hasCreep(point)`, `getCreep()`, `isRamp(point)` | Visibility and creep this step |
| `path(start, end)` | A local A* path as `[x, y][]`, synchronous and fast; empty when no path exists. The path graph also blocks the cells the map system marks unplaceable (structures, minerals, geysers, rocks, xel'naga towers), so `end` on such a cell, or `start` surrounded by them (e.g. a townhall's `townhallPosition`), gives an empty path; start from a unit's `pos` or `closestPathable(point)`. For paths that avoid enemy threats and change every step, use [`pathing`](#pathing). |
| `queryPathing(start, end)` | `Promise<number \| null>`: SC2's own path length from a point or unit, `null` if unreachable |
| `closestPathable(point, radius = 3)` | The closest pathable cell; throws if there is none within `radius` |
| `freeGasGeysers()`, `getEffects()`, `getGrids()`, `isCustom()` | Geysers without a gas building near your bases; active effects; the raw grids; whether the map has no expansions (a custom map) |

```ts
import type { World } from '@sc-bot/core';
import { PYLON } from '@sc-bot/core/constants/unit-type';

export async function onGameStart({ resources }: World) {
    const { map, units, actions } = resources.get();

    const ramp = map.getMainBaseRamp();
    if (!ramp) return;
    console.log(ramp.topCenter, ramp.cornerDepots, ramp.barracksCorrectPlacement);

    const pylonSpot = ramp.protossWallPylon;
    if (pylonSpot) await actions.build(PYLON, pylonSpot);

    const natural = map.getNatural();
    const [worker] = units.getWorkers();
    const groundDistance = await map.queryPathing(worker, natural.townhallPosition);
    const localPath = map.path(worker.pos, natural.townhallPosition);

    console.log(groundDistance, localPath.length, map.getExpansionLocations().length);
    console.log(map.getTerrainZHeight(natural.townhallPosition), map.inPlacementGrid(natural.townhallPosition));
}
```

### frame

`frame` gives synchronous access to the current observation.

| Method | Returns |
|---|---|
| `getGameLoop()` | The current game loop |
| `time()`, `timeFormatted()`, `timeInSeconds()` | Game seconds; `'MM:SS'`; rounded seconds (old node-sc2 formula) |
| `getObservation()`, `getGameInfo()`, `getMapState()`, `getPrevious()` | Raw data |
| `getScore()` | `SC2APIProtocol.Score`; needs `score: true` in the agent's `interface` |
| `getAlerts()`, `hasAlert(alert)` | Alerts such as a detected nuke |
| `getActionErrors()` | Commands SC2 rejected in the last step |
| `getEffects()` | Active effects |
| `getStepTime()` | `{ min, avg, max, last }`: milliseconds spent in your agent's `onStep` |
| `getRender()`, `getFeatureLayer()` | Rendered and feature-layer data, when enabled in `interface` |

```ts
import type { World } from '@sc-bot/core';
import { Alert } from '@sc-bot/core/constants/enums';
import { MARINE } from '@sc-bot/core/constants/unit-type';

export async function onStep({ agent, resources }: World) {
    const { frame, debug, map } = resources.get();

    if (frame.hasAlert(Alert.NUCLEARLAUNCHDETECTED)) console.log('nuke incoming');
    frame.getActionErrors().forEach(error => console.log('rejected', error.abilityId, error.result));

    const { avg, max } = frame.getStepTime();
    console.log(`${frame.timeFormatted()} step avg ${avg.toFixed(1)}ms, max ${max.toFixed(1)}ms`);

    if (frame.getGameLoop() < 10 && debug) {
        await debug.createUnit({ unitType: MARINE, quantity: 5, pos: map.getMain().townhallPosition, playerId: agent.playerId });
        await debug.showMap();
        debug.drawBox({ x: 10, y: 10, z: 12 }, { x: 12, y: 12, z: 14 });
    }
}
```

### debug

`debug` wraps SC2's debug interface, for testing and development. It is typed as optional on the resource container, so check it or use `debug!`.

| Method | What it does |
|---|---|
| `createUnit({ unitType, quantity?, pos?, playerId? } \| [...])` | Spawn units (defaults: 1, a random placeable cell in your main, you) |
| `killUnit(units)` | |
| `setUnitValue(units, unitValue, value)` | Set energy, life or shields |
| `showMap()`, `controlEnemy()`, `food()`, `free()`, `allResources()`, `god()`, `minerals()`, `gas()`, `cooldown()`, `techTree()`, `upgrade()`, `fastBuild()` | The game's cheats |
| `moveCamera(unitOrPoint)` | |
| `drawBox(min, max, color?)` | Draw a box for one step |
| `setDrawCells`, `setDrawSpheres`, `setDrawLines`, `setDrawTextWorld`, `setDrawTextScreen` | Persistent drawings, keyed by id; `removeCommand(id)` removes one |
| `quickSave()`, `quickLoad()` | Single-player only |

### events and data

`events` is the event channel: `write(event)` publishes a [custom event](#custom-events); `createReader`, `read` and `removeReader` are what the engine uses to deliver events.

`world.data` holds the game data from SC2 (`getUnitTypeData(id)`, `getAbilityData(id)`, `getUpgradeData(id)`, `getEffectData(id)`, `findUnitTypesWithAbility(abilityId)`) and earmarks. An earmark reserves money for later: `data.addEarmark({ name, minerals, vespene })`. While it exists, `agent.canAfford` and `agent.canAffordUpgrade` subtract it, except when called with that earmark's name; if that check passes, the earmark is settled (removed). `getEarmarkTotals(name?)` and `settleEarmark(name)` are available directly.

### memory

Enemies that leave vision stay in `units` as ghosts (`unit.isMemory()`) until `memory` forgets them. Each step, a ghost is deleted when it is older than its expiry (`unit.age()` past `expireAir` for flying units, `expireGround` otherwise), or when all four cells around its last position are visible and it isn't burrowed. A burrowed ghost stays until it expires. Enemies whose death SC2 reports are removed right away.

| Member | What it does |
|---|---|
| `getGhosts()` | Enemies out of vision that are still remembered |
| `getSnapshots()` | Current enemy snapshots (structures seen through the fog) |
| `getEnemies({ includeGhosts = true, structures = true })` | Every known enemy, ghosts included unless `includeGhosts: false` |
| `forget(tag)` | Deletes a ghost now. If the tag is seen again, `onEnemyUnitEnteredVision` fires but `onEnemyFirstSeen` doesn't. |
| `configure({ expireGround?, expireAir? })` | Expiry in game seconds, both `30` by default. Settings survive a new game on the same engine. |

```ts
import type { World } from '@sc-bot/core';

export async function onGameStart({ resources }: World) {
    resources.get().memory.configure({ expireGround: 60 });
}

export async function onStep({ resources }: World) {
    const { memory } = resources.get();
    const remembered = memory.getEnemies({ structures: false });
    console.log(`${remembered.length} enemy units known, ${memory.getGhosts().length} out of vision`);
}
```

### spatial

Range queries over enemy and own units. The index is rebuilt on the first query of each game loop, so later queries in the same loop are cheap. Enemies come from `memory.getEnemies()`, so ghosts are included; own units are the alive ones. Each query takes a kind: `'enemy'`, `'enemyGround'`, `'enemyAir'`, `'own'`, `'ownGround'` or `'ownAir'`. Ground and air are split by `isFlying` (or a graviton beam), so landed structures count as ground and lifted ones as air. Distances are centre to centre, ignoring unit radius.

| Member | Returns |
|---|---|
| `unitsInRange(from, distance, kind)` | `Units` within `distance` of a point or unit |
| `anyInRange(from, distance, kind)` | Whether there is at least one, stopping at the first |
| `closest(from, kind, maxDistance?)` | The closest unit, or `undefined` |

Result order isn't stable: `unitsInRange` returns units in bucket order, not in the order they were added, and `closest` breaks ties between equal distances by bucket ring order. Sort the result yourself if order matters.

```ts
import type { World } from '@sc-bot/core';
import { MARINE } from '@sc-bot/core/constants/unit-type';

export async function onStep({ resources }: World) {
    const { actions, spatial, units } = resources.get();
    for (const marine of units.getById(MARINE)) {
        const target = spatial.closest(marine, 'enemyGround', 6);
        if (target) await actions.attack([marine], target);
    }
}
```

### influence

Danger grids, built on the first `getGrid` of each game loop. There are four layers: `'ground'`, `'air'`, `'groundAvoidance'` and `'airAvoidance'`. A cell is `1` when free and `Infinity` when blocked (unpathable for the ground layers, outside the playable area for air). Enemy threats add cost on top, so a cell is safe when its value is at most `1`.

- Units, ghosts included and changelings skipped: known units use ares' weight table; static defence uses its own handlers; anything else that can attack adds its DPS within weapon range plus `rangeBuffer`. Unfinished enemy structures don't count.
- Effects, while present: psionic storm 600 / 3.5, corrosive bile 100 / 3, liberator zones 500 / 6 (ground only, and not your own), lurker spines 600 / 1, blinding cloud 300 / 3.5, nuke 1000 / 8 (cost / radius), each radius plus `effectsRangeBuffer`. Some go into the avoidance layers too.

| Member | What it does |
|---|---|
| `getGrid(layer)` | The `InfluenceGrid`: `width`, `height`, `data` (a `Float32Array` indexed `y * width + x`; read-only by contract) and `get(point)`, which floors the point and gives `Infinity` out of bounds |
| `addCost(layers, center, radius, weight)` | Adds your own cost circle to one or more layers for the rest of this game loop. Cells never drop below `1`; `Infinity` stays blocked. |
| `configure({ rangeBuffer = 4, effectsRangeBuffer = 1, costMultiplier = 1, effects })` | `costMultiplier` scales the built-in sources only, not `addCost`. `effects` overrides `{ cost, range }` per effect id. Settings survive a new game on the same engine. |
| `drawDebug(layer, { threshold = 1 })` | Draws the cells above `threshold` with their value, through `debug.setDrawCells` |

```ts
import type { World } from '@sc-bot/core';

export async function onStep({ resources }: World) {
    const { influence, map } = resources.get();
    influence.addCost('ground', map.getEnemyNatural().townhallPosition, 8, 50);
    const grid = influence.getGrid('ground');
    console.log('natural is safe:', grid.get(map.getNatural().townhallPosition) <= 1);
}
```

### pathing

Paths over an influence layer (`'ground'` by default, or any `InfluenceGrid`), with an 8-connected A* that doesn't cut corners. Entering a cell costs its value, so paths go around danger when that is cheaper. Use it for movement that should react to the current threats; `map.path` stays for static map analysis.

| Member | What it does |
|---|---|
| `findPath(start, goal, { layer?, maxExpanded? })` | Cell centres from start (excluded) to goal, or `[]` when there is no path. A blocked goal is moved to the closest open cell within 3; out-of-bounds points are clamped to the map. |
| `nextPoint(start, goal, { layer?, sensitivity = 5, senseDanger = true, dangerDistance = 20, dangerThreshold = 5, maxExpanded? })` | The point to move to next: the `sensitivity`th point of the path, or `goal` when there is no path. With `senseDanger`, it returns `goal` without searching when no cell within `dangerDistance` of `start` reaches `dangerThreshold`. |
| `closestSafeSpot(from, { layer?, radius = 11 })` | The cell centre with the lowest cost within `radius`, closest first on ties, or `undefined` |
| `isPositionSafe(point, { layer?, limit = 1 })` | Whether the cell's cost is at most `limit` |

```ts
import type { World } from '@sc-bot/core';
import { MARINE } from '@sc-bot/core/constants/unit-type';

export async function onStep({ resources }: World) {
    const { actions, map, pathing, units } = resources.get();
    const target = map.getEnemyNatural().townhallPosition;
    for (const marine of units.getById(MARINE)) {
        if (!pathing.isPositionSafe(marine.pos)) {
            const spot = pathing.closestSafeSpot(marine.pos);
            if (spot) await actions.move(marine, spot);
            continue;
        }
        await actions.move(marine, pathing.nextPoint(marine.pos, target));
    }
}
```

### roles

Roles group your own units by job, using ares' role names: the `UnitRole` constants in `@sc-bot/core/constants/unit-role` (`ATTACKING`, `DEFENDING`, `GATHERING`, `BUILDING`, ...). A unit has at most one role. Roles live in their own resource, not in unit labels, so unit systems and `units.withLabel` don't see them.

Each step, before agent code, `roles` drops units that died and gives each new finished own unit its default role, once per unit. By default workers other than MULEs get `GATHERING` and everything else gets none; change that with `configure({ defaultRole })`. A role you clear stays cleared. A unit inside a transport keeps its role, but `get` leaves it out until it is unloaded.

| Member | What it does |
|---|---|
| `assign(units, role)` | Gives one or more units (or tags) a role, replacing any previous one |
| `clear(units)` | Removes their role |
| `switchRole(from, to)` | Moves every unit of one role to another |
| `get(roles, { types?, excludeTypes? })` | Your current units with that role, or any of a list of roles, as `Units`, optionally filtered by unit type |
| `roleOf(unit)` | The role of a unit or tag, or `undefined` |
| `getTags(role)` | The tags with that role, units in transports included |
| `as(role, fn, { priority? })` | Runs `fn` as the commander `'role:<ROLE>'` (through `actions.as`); `priority` defaults to the caller's |
| `mayCommand(owner, tag)` | Whether that commander may command the unit: `false` only when the unit's role is exclusive and the owner isn't that role |
| `configure({ defaultRole?, exclusive? })` | `defaultRole(unit)` returns the role for a new unit, or `undefined`; `exclusive` defaults to `[]`. Settings survive a new game on the same engine; roles don't. |

**Exclusive roles.** With `configure({ exclusive: [ATTACKING] })`, only `'role:ATTACKING'` may command units in that role: every other commander's proposal for them is dropped with `reason: 'not-owner'` (see [Command arbitration](#command-arbitration)). Make a role exclusive only once everything that commands its units does so inside `roles.as`. The immediate `sendAction`, `swapBuildings` and `toggleAutocast` aren't filtered. A `sendAction` from another commander also takes the unit for the rest of the observation, so the role's own commands only get it back in that step when they strictly outrank the sender; pass `roles.as` a higher `priority` if that matters.

```ts
import type { World } from '@sc-bot/core';
import { ATTACKING, GATHERING } from '@sc-bot/core/constants/unit-role';
import { MULE } from '@sc-bot/core/constants/unit-type';

export async function onGameStart({ resources }: World) {
    resources.get().roles.configure({
        defaultRole: (unit) =>
            unit.isWorker() ? (unit.unitType === MULE ? undefined : GATHERING) : unit.isCombatUnit() ? ATTACKING : undefined,
        exclusive: [ATTACKING],
    });
}

export async function onStep({ resources }: World) {
    const { actions, map, roles } = resources.get();
    const army = roles.get(ATTACKING);
    if (army.length >= 20) {
        await roles.as(ATTACKING, () => actions.attackMove(army, map.getEnemyNatural().townhallPosition));
    }
}
```

### squads

Groups a role's units into squads by distance, so you can give per-squad orders that hold across steps. It costs nothing until you ask: the first `getSquads` call for a role and type filter in a game loop does the clustering, and later calls in that loop return the same squads.

Clustering is ares': a unit farther than `radius` from its squad's centre leaves it; then at most one pair of squads whose centres are within `radius` merges, the smaller into the larger (the newer into the older on a tie); then each unit without a squad joins the closest squad within `radius`, or starts a new one. Ids are `'<ROLE>-<n>'`, counted per role and type filter, so a squad keeps its id for as long as it exists. The main squad is the one with the most units, the oldest on a tie.

**One radius per role and type filter.** The radius isn't part of what identifies the squads: the first `getSquads` call in a game loop decides it for that loop. Switching radius between loops makes squads split and merge back, so use one radius for each (role, types).

| Member | What it does |
|---|---|
| `getSquads(role, { radius = 6, types? })` | The role's squads: `{ id, role, units, tags, position, isMain }`, with `position` the mean position of its units |
| `getMainSquad(role, { radius?, types? })` | The main squad, or `undefined` when the role has no units |
| `getMainSquadPosition(role, { types? })` | The main squad's position. With no units, its last position for this role and filter, else your main base's townhall position. |

```ts
import type { World } from '@sc-bot/core';
import { ATTACKING } from '@sc-bot/core/constants/unit-role';

export async function onStep({ resources }: World) {
    const { actions, roles, squads } = resources.get();
    const rally = squads.getMainSquadPosition(ATTACKING);
    for (const squad of squads.getSquads(ATTACKING)) {
        if (!squad.isMain) await roles.as(ATTACKING, () => actions.move(squad.units, rally));
    }
}
```

### intel

Each step, before agent code, `intel` tracks the enemies near each of your bases and sets strategy flags.

**Base threats.** A visible enemy within `groundNearBase` (15) of one of your townhalls joins that base's ground threats, and one within `airNearBase` (20) its air threats; ground and air are split as in [spatial](#spatial). A base's ground threats are all cleared at once when the closest ground enemy is farther than `groundLeavingBase` (24) or is a ghost, and the same for air with `airLeavingBase` (22). That is ares' hysteresis: an enemy that walks off stays a threat while others are still close.

**Strategy flags.** Flags are judged on every known enemy, ghosts included, at game time `t` (`frame.time()`, in game seconds). Distances are to your main's and natural's townhall positions and to the enemy start location and natural. Once set, a flag stays set for the game. The first time, intel records the game loop and writes an `enemyStrategyDetected` event, which `onEnemyStrategyDetected` handlers receive in the same step.

| Flag | Set when |
|---|---|
| `workerRush` | Before 3:00, more than 6 enemy workers within 15 of your main or 16 of your natural |
| `lingRush` | More than 2 zerglings within 50 of your main before 2:30, more than 7 zerglings before 3:00, or more than 4 before 1:30 |
| `roachRush` | 6 or more roaches within 50 of your main before 4:00, or 3 or more roaches before 3:00 |
| `ravagerRush` | A ravager before 4:00 |
| `marineRush` | Up to 3:30, while the enemy has one townhall and no factory: 3 or more barracks before 3:00, or at least `max(3, floor(t / 45))` marines more than 60 from the enemy start |
| `marauderRush` | Up to 4:00: a barracks tech lab within 55 of your natural, 2 or more marauders before 3:30, or one before 2:40 |
| `fourGate` | Before 3:20, 3 or more gateways while the enemy has one townhall |
| `proxyZealot` | Up to 4:00, 2 or more gateways within 100 of your main and more than 60 from the enemy start; or before 2:30, a zealot within 65 of your main |
| `proxy` | Before 4:00, any structure `getProxies()` returns |
| `reaper` | A reaper |
| `expanded` | An enemy townhall more than 6 from the enemy start |
| `baseOutsideNatural` | An enemy townhall more than 6 from both the enemy start and the enemy natural |
| `greedy` | 2 Terran or Protoss townhalls started before `greedyTwoBaseBefore` (65 s), or 3 hatcheries (lairs and hives included) started before `greedyThreeHatchBefore` (90 s). The start is estimated from the build progress when the townhall is first seen. |
| `rushed` | Any of `lingRush`, `workerRush`, `proxyZealot`, `ravagerRush`, `fourGate` or `roachRush`; `marauderRush` without `expanded`; `marineRush` with no enemy structure within 15 of your natural; or 3 or more roaches before 4:00, a zergling before 1:45, or 2 or more barracks before 2:00 |

| Member | What it does |
|---|---|
| `getBaseThreats()` | A `BaseThreat` per own townhall with threats: `{ townhall, ground, air, groundSupply, airSupply }`. The units are the threats still visible; supply leaves structures out. |
| `getMainThreat(kind)` | The base with the most `'ground'` or `'air'` supply, or `undefined` when no base has any |
| `has(flag)` | Whether the flag has been set this game |
| `detectedAt(flag)` | The game loop it was first set at, or `undefined` |
| `getProxies()` | Enemy structures, ghosts included, within 100 of your main and more than 60 from the enemy start, leaving out creep tumors and gas buildings |
| `configure({ groundNearBase = 15, airNearBase = 20, groundLeavingBase = 24, airLeavingBase = 22, greedyTwoBaseBefore = 65, greedyThreeHatchBefore = 90 })` | Distances, and the `greedy` thresholds in game seconds. Settings survive a new game on the same engine; flags and threats don't. |

```ts
import { createAgent } from '@sc-bot/core';
import type { EnemyStrategyDetected, World } from '@sc-bot/core';

const bot = createAgent({
    async onEnemyStrategyDetected(world: World, { flag, gameLoop }: EnemyStrategyDetected) {
        console.log(`${flag} detected at loop ${gameLoop}`);
    },
    async onStep({ resources }: World) {
        const { actions, intel, units } = resources.get();
        const threat = intel.getMainThreat('ground');
        if (threat && intel.has('rushed')) await actions.attackMove(units.getCombatUnits(), threat.townhall.pos);
    },
});
```

### Custom resources

A resource is registered from a definition: a `name`, a `create(world)` factory and an optional `reset(resource, world)`. `world.resources.register(definition)` creates the resource and returns it; call it from a system's `setup`, which runs every game. Registering the same definition object again returns the existing resource; registering another definition under a taken name throws `NodeSC2Error`. Declare the resource's type by augmenting the `ResourceContainer` interface of `@sc-bot/core/types` (augmenting `@sc-bot/core` itself doesn't merge). The key is typed as present before `register` has run, so register it before anything reads it.

When a new game starts on the same engine, every registered resource is reset in registration order, keeping its identity, so references held from `resources.get()` stay valid. `reset` runs when given; without it, a fresh `create(world)` is assigned onto the existing object. Resources added with `resources.set()` are left alone.

```ts
import { createSystem } from '@sc-bot/core';
import type { ResourceDefinition, Unit, World } from '@sc-bot/core';

declare module '@sc-bot/core/types' {
    interface ResourceContainer {
        sightings: { tags: Set<string> };
    }
}

const sightings: ResourceDefinition<'sightings'> = {
    name: 'sightings',
    create: () => ({ tags: new Set() }),
    reset: (resource) => resource.tags.clear(),
};

export const scouting = createSystem({
    name: 'Scouting',
    setup(world: World) {
        world.resources.register(sightings);
    },
    async onEnemyFirstSeen({ resources }: World, enemy: Unit) {
        resources.get().sightings.tags.add(enemy.tag!);
    },
});
```

## Utilities

Pure functions exported from `@sc-bot/core`.

### Fights

`simulateFight(own, enemy, options?)` simulates a fight between two lists of units and returns a `FightSimulation`: `{ ownWins, ownHealthLeft, enemyHealthLeft, ownHealthStart, enemyHealthStart, seconds }`. `canWinFight(own, enemy, options?)` runs the same simulation and returns an `EngagementResult` on ares' 0 to 10 scale, so ares thresholds carry over. Use `simulateFight` to build your own.

Health is health plus shields on both sides. Every quarter second, each unit deals its `calculateDpsVsTarget` damage (upgrades, armor, attributes and air/ground targeting included, see [Unit](#unit)) to the enemy with the least health that it can hit, skipping enemies already dealt enough to die, and both sides take their damage at the same time. The fight ends when a side has no units left, when neither side can hurt the other, or after `maxSeconds`. A side with units left against none wins; otherwise the side with the larger fraction of its health left wins, and equal fractions are a tie. An empty enemy list gives `VICTORY_EMPHATIC`, an empty own list `LOSS_EMPHATIC`, both empty `TIE`. See [Known limitations](#known-limitations) for what it doesn't model.

| Option | |
|---|---|
| `timingAdjust = true` | Each unit starts firing once it could have reached the closest enemy it can hit: the edge-to-edge gap minus its range, at its `realSpeed()`. A unit that can't move waits for the enemy to walk in. Without it every unit fires from the start. |
| `workersDoNoDamage = false` | Workers on both sides deal no damage |
| `maxSeconds = 60` | Length limit, in normal-speed seconds (16 game loops each, the time base of the unit data) |

The results are constants in `@sc-bot/core/constants/engagement-result`. A win is graded by the fraction of your health left, a loss by the fraction of the enemy's:

| Result | Value | When |
|---|---|---|
| `VICTORY_EMPHATIC` | 10 | Win with at least 90% left |
| `VICTORY_OVERWHELMING` | 9 | Win with at least 75% |
| `VICTORY_DECISIVE` | 8 | Win with at least 60% |
| `VICTORY_CLOSE` | 7 | Win with more than 40% |
| `VICTORY_MARGINAL` | 6 | Win with more than 20% |
| `TIE` | 5 | Win with 20% or less, loss with the enemy at 20% or less, or equal fractions |
| `LOSS_MARGINAL` | 4 | Loss, enemy has more than 20% left |
| `LOSS_CLOSE` | 3 | More than 40% |
| `LOSS_DECISIVE` | 2 | More than 60% |
| `LOSS_OVERWHELMING` | 1 | At least 75% |
| `LOSS_EMPHATIC` | 0 | At least 90% |

```ts
import { canWinFight } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import { VICTORY_CLOSE } from '@sc-bot/core/constants/engagement-result';
import { ATTACKING } from '@sc-bot/core/constants/unit-role';

export async function onStep({ resources }: World) {
    const { actions, map, spatial, squads } = resources.get();
    const squad = squads.getMainSquad(ATTACKING);
    if (!squad) return;

    const enemies = spatial.unitsInRange(squad.position, 15, 'enemy');
    if (canWinFight(squad.units, enemies) >= VICTORY_CLOSE) {
        await actions.attackMove(squad.units, enemies.empty ? map.getEnemyNatural().townhallPosition : enemies.first.pos);
    } else {
        await actions.move(squad.units, map.getNatural().townhallPosition);
    }
}
```

### Build orders

`parseBuildOrder(steps, race)` turns ares-style build order strings into the `[supply, task]` pairs of a build system's `buildOrder`, and returns them. A string step is `'<supply> <command> [@target ...] [x<n>]'`, case-insensitive: the command is a unit type, an upgrade, or one of `WORKER`, `SUPPLY`, `GAS`, `EXPAND`, `GATE`, `CORE`, `ORBITAL`, `CANCEL_GAS`, `CHRONO`, `WORKER_SCOUT`, `OVERLORD_SCOUT` and `ADDONSWAP`, with the race-specific ones resolved for `race`. Targets are the `BuildTarget` names of `@sc-bot/core/constants/build-target`, and `x<n>` repeats the step. An object step `{ '<supply> worker_scout': [targets] }` gives the scout its waypoints. `[supply, task]` pairs pass through unchanged. An invalid step throws `NodeSC2Error` naming it.

```ts
import { parseBuildOrder } from '@sc-bot/core';
import { Race } from '@sc-bot/core/constants/enums';

const opening = parseBuildOrder(
    ['14 supply @ ramp', '16 barracks @ ramp', '16 gas', '19 orbital', '20 expand', { '17 worker_scout': ['enemy_spawn', 'enemy_nat'] }],
    Race.TERRAN,
);
```

## Constants

Import constants by module path:

| Module | Contents |
|---|---|
| `@sc-bot/core/constants/unit-type` | Unit type ids (`MARINE`, ...) |
| `@sc-bot/core/constants/ability` | Ability ids |
| `@sc-bot/core/constants/upgrade` | Upgrade ids |
| `@sc-bot/core/constants/buff` | Buff ids |
| `@sc-bot/core/constants/effect` | Effect ids |
| `@sc-bot/core/constants/enums` | Proto enums (`Race`, `Difficulty`, `AIBuild`, `Alliance`, `GameResult`, `Attribute`, `Alert`, ...) with `*Id` reverse maps |
| `@sc-bot/core/constants/groups` | Unit and ability groups (`workerTypes`, `townhallTypes`, `combatTypes`, `addonTypes`, ...) |
| `@sc-bot/core/constants/unit-role` | ares' unit roles for [roles](#roles) (`ATTACKING`, `GATHERING`, ...); their type is `UnitRole` |
| `@sc-bot/core/constants/engagement-result` | The [fight](#fights) result scale, `LOSS_EMPHATIC` (0) to `VICTORY_EMPHATIC` (10); their type is `EngagementResult` |
| `@sc-bot/core/constants/index` | Namespaces of the above (`UnitType`, `Ability`, `Upgrade`, `Buff`, `Effect`, `enums`, `groups`, `UnitRole`, `EngagementResult`), `Color`, `WarpUnitAbility`, `AbilitiesByUnit`, plus reverse lookups `UnitTypeId`, `AbilityId`, `UpgradeId`, `BuffId`, `EffectId` |
| `@sc-bot/core/constants/race-map` | Per-race lookups: `WorkerRace`, `TownhallRace`, `GasMineRace`, `SupplyUnitRace`, `HarvestGatheringRace` |
| `@sc-bot/core/constants/color` | Named RGB colors for debug drawing |
| `@sc-bot/core/constants/dicts/trained-from` | `trainedFrom[unitType]`: producer types |
| `@sc-bot/core/constants/dicts/researched-from` | `researchedFrom[upgradeId]`: researching structure |
| `@sc-bot/core/constants/dicts/research-requirements` | `researchRequirements[upgradeId]`: `{ requiredBuilding?, requiredUpgrade?, ability? }` |
| `@sc-bot/core/constants/dicts/tech-requirement`, `tech-alias`, `unit-alias`, `unit-abilities` | Tech tree data |

The id modules and dictionaries are generated from SC2 4.10's own game data (`bun run generate:data`), not copied from python-sc2's tables (which come from a newer version). Names that existed in node-sc2 are kept, so some old ids stay next to the 4.10 ones; for example `MOVE`, `PATROL` and `HOLDPOSITION` exist alongside `GENERAL_MOVE`, `GENERAL_PATROL` and `GENERAL_HOLDPOSITION`, and the unit predicates accept both.

```ts
import { researchedFrom } from '@sc-bot/core/constants/dicts/researched-from';
import { trainedFrom } from '@sc-bot/core/constants/dicts/trained-from';
import { townhallTypes, workerTypes } from '@sc-bot/core/constants/groups';
import { UnitTypeId } from '@sc-bot/core/constants/index';
import { MARINE } from '@sc-bot/core/constants/unit-type';
import { STIMPACK } from '@sc-bot/core/constants/upgrade';

console.log(trainedFrom[MARINE].map(producer => UnitTypeId[producer]));
console.log(UnitTypeId[researchedFrom[STIMPACK]]);
console.log(workerTypes.length, townhallTypes.length);
```

`researchRequirements` is ported from python-sc2's `RESEARCH_INFO`, because the API data has no research requirements. `techRequirement` also lists the requirements 4.10's data leaves out (ghost: ghost academy, thor: armory, battlecruiser: fusion core, mothership: fleet beacon, as in python-sc2's `TRAIN_INFO`); `agent.hasTechFor`, `techRequirementProgress`, `train`, `actions.build` and `actions.train` all respect them.

Terran vehicle and ship plating is one upgrade line on 4.10 (`TERRANVEHICLEANDSHIPARMORSLEVEL1` to `3`), researched at the armory. 4.10's data points those upgrades at abilities the armory doesn't have, so `researchRequirements` carries the armory's `RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL1` to `3` as their `ability`, which `research` and `alreadyPendingUpgrade` use. The old separate `TERRANVEHICLEARMORSLEVEL*` and `TERRANSHIPARMORSLEVEL*` constants still exist but are not in `researchedFrom`, since nothing researches them. `actions.upgrade` and `units.getUpgradeFacilities` still read the data's ability, so `actions.upgrade` can't start plating (upgrade ids 116 to 118); use `agent.research` for those.

## Where this library differs from python-sc2

Where python-sc2 has a bug or its data doesn't match SC2 4.10, this library deliberately does something else:

- **`realSpeed()` off creep.** The off-creep speed bonus (hydralisk, ultralisk) needs that unit's own upgrade. python-sc2 applies it when the player owns any upgrade at all.
- **Blue flame.** `calculateDamageVsTarget()` adds a flat +5 against light targets for your own hellions once the upgrade is done. python-sc2 multiplies the bonus by the attack upgrade level, so it is 0 at level 0. Enemy hellions never get it, since enemy upgrades aren't observable.
- **`nClosestToDistance` / `nFurthestToDistance`.** They sort ascending by how far each unit's plain distance is from the given distance, for points and units alike. python-sc2 sorts in reverse and, for unit positions, compares squared against linear distance.
- **`distributeWorkers(resourceRatio)`.** It honours the ratio: it fills gas first when your minerals-to-gas ratio is at least `resourceRatio` (or you have no gas), otherwise minerals. python-sc2 ignores the parameter.
- **`research()`.** Besides the required building (e.g. an armory for level 2 weapons) it also checks that the previous level is done.
- **Research structures on 4.10.** The dictionaries reflect 4.10 data: `LIBERATORAGRANGEUPGRADE` and `MEDIVACCADUCEUSREACTOR` are researched at the starport tech lab and `LURKERRANGE` at the hydralisk den. Newer SC2 versions, which python-sc2's tables follow, moved them (to the fusion core and the lurker den).
- **Build worker selection.** The macro helpers' builder pick (python-sc2's `select_build_worker`) skips an idle worker that already received a command this step. python-sc2 means to, but compares the worker object against a set of tags, so the check never matches.
- **Snapshots on old builds.** On SC2 before 5.0.4 (including 4.10) `isSnapshot()` and the `visible` filter use the visibility grid, because the API misreports `displayType` there. python-sc2 does the same, but reads the grid at the rounded position; this library floors it, like every other grid lookup here, so a unit near a cell edge can be judged by the neighbouring cell.
- **`distanceToWeaponReady()`.** It uses 16 game loops per second, the time base of the movement speeds it multiplies, so it is the distance the unit really covers before its weapon is ready. python-sc2 divides by 22.4 and comes out 1.4 times too short.

## Where this library differs from ares-sc2

Where ares-sc2 does something this library deliberately doesn't:

- **Distances in `spatial`.** Queries measure centre to centre on a bucket grid. ares uses KD-trees, also centre to centre, so results match up to the order of equal distances.
- **Skipped influence sources.** The KD8 charge, parasitic bomb and force field handlers aren't ported, and neither are the climber, air-vs-ground, ground-to-air, tactical and priority grids. Only the ground, air, ground avoidance and air avoidance layers exist.
- **Spine crawlers.** They add ground influence (cost 22, range 7). ares has no handler for them.
- **Banelings in ground avoidance.** They are stamped into `groundAvoidance`. ares has code for it, but it never runs, because the weight table is checked first.
- **Float weights.** Influence costs are kept as floats. ares truncates them to integers, which changes costs by less than 1.
- **Inclusive circles.** A cost circle includes the cells exactly at its radius, so at integer radii it can be one ring larger than ares'.
- **Own liberator zones.** Your own liberators' zones aren't stamped. ares stamps every liberator zone, so a Terran army paths around its own liberators.
- **Combat sim.** `simulateFight` and `canWinFight` are this library's own focus-fire simulation on per-pair DPS, not ares' native sc2_helper simulator. Health counts shields on both sides (ares leaves out your own shields), and there is no `good_positioning` option, since in sc2_helper it only affects splash, which isn't modelled.
- **Squad merges.** When two squads merge, the smaller joins the larger (the newer the older on a tie), so the main squad keeps its id, and ids are counters (`'ATTACKING-3'`). ares doesn't order the merge by size, and its ids aren't deterministic.
- **Rush flags by unit type.** Intel's rush rules check for the unit types involved, not the enemy race, since only one race has those types.
- **`greedy`.** ares declares the flag but never sets it. Here it is set from townhall start times, with thresholds of our own choosing (`greedyTwoBaseBefore`, `greedyThreeHatchBefore`).
- **Roles aren't labels.** Roles live in the `roles` resource. Unit systems give labelled units special handling, so storing roles as labels would change how every unit with a default role is dispatched.

## Changes compared to node-sc2

Bug fixes that changed a signature or a failure mode:

- `units.getByTag(tag)` returns `undefined` for an unknown tag (it used to return the tag string). The array form leaves unknown tags out and returns `Units`.
- Every `units.*` getter, including `getClosest` and `getByTag(tags)`, returns `Units` instead of a plain array. See the [testing note](#the-units-collection).
- The unit command methods of `actions` (`attack`, `move`, `build`, `train`, `do` and the rest, and the `Unit` shortcuts such as `useAbility`, `burrow` and `inject`) resolve with no value once the command is proposed, instead of with SC2's `ResponseAction`, and no longer reject when SC2 refuses the command; that arrives the next step through `onCommandResults` (see [Command arbitration](#command-arbitration)). Commands go out after all systems have run instead of during the step, conflicting commands for one unit resolve by priority and `use()` order instead of last-write-wins, and repeating a unit's current order is a no-op. Precondition errors still reject.
- `actions.swapBuildings` awaits the whole lift-move-land sequence, resolves with the responses of both land commands (`ResponseAction[]`), and rejects on failure. It used to swallow errors.
- `actions.attack` rejects with `ActionManagerError` when the target is missing, and `actions.attackMove` when no position is given and no enemy start location is known, instead of throwing a `TypeError`. Missing units are not an error: the command methods resolve without proposing anything for an empty unit list (`do` used to reject with a `TypeError`). Only the raw `actions.queueAction` throws `ActionManagerError` for a command without units.
- `actions.gather` rejects with `GatherError` when there is no completed own base to mine at, instead of crashing.
- `actions.warpIn` rejects with `ActionManagerError` when there is no free warp-in point.
- Event handlers are called as `(world, data, event)`, apart from the system hooks listed under [Events](#events). `onUnitTypeChanged` and `onUnitTookDamage` pass a single payload object.
- `createEngine({ onGameEnd })` is now called. Leaving a game (including `surrender()`) ends it as a silent `DEFEAT` instead of logging "no result data".
- `map.getThirds()` / `getEnemyThirds()` never contain `undefined`. Maps without a natural wall or without known enemy start locations no longer throw during setup.
- The `Agent`, `Unit`, `UnitResource`, `MapResource`, `FrameResource`, `ActionManager`, `Debugger` and `Engine` interfaces gained required members. Code that builds its own objects of these types (test doubles, for example) has to implement them.
- Other type changes that can stop existing code from compiling:
  - A variable typed by a `units.*` getter is now `Units`. Reassigning it from `filter`, `map` or `flatMap` with a unit callback, `slice`, `reverse` and the other `Units` methods still works, but `workers = []`, `workers = Array.from(...)`, `workers = [...workers]` or a `Unit[]` from elsewhere don't; annotate the variable as `Unit[]` or wrap with `Units.from()`.
  - `units.getByTag(tag)` is `Unit | undefined`, and `expansion.getBase()` is `Unit | undefined` (no base on the expansion).
  - `Grid2D` is `number[][]` (it was `Array<Uint8Array>`).
  - `debug.createUnit` takes `{ unitType, quantity?, pos?, playerId? }` or an array of them; the proto `owner` field is `playerId`, and arrays of arrays are gone.
  - `createSystem` types its blueprint as `UnitSystemObject | BuildSystemObject | GeneralSystemObject`, so a `type: 'unit'` or `type: 'build'` blueprint gets its own `onStep` signature; a value typed `EventReader<SystemObject>` is still accepted.
  - The `opts.near` of a build task is a unit type (it was declared `boolean`), and `BuildHelper` is the union of the task functions instead of `(...args: any[]) => BuildTaskI`.
  - `actions.patrol` takes a `[from, to]` pair or a single point (it was declared as an array of pairs); `actions.swapBuildings` resolves with `ResponseAction[]`.
  - `data.getEarmarkTotals` returns a `Cost`, `engine.createGame` may resolve `undefined`, and the `frame._previous`, `_observation`, `_gameInfo`, `_score`, `_render` and `_feature` fields can be `null`.
- Requests that SC2 answers with an error, and requests still pending when the connection closes, now reject. They used to never settle, which hung the game loop.
- `agent.hasTechFor` (and with it `actions.build` and `actions.train`) now requires a ghost academy for ghosts, an armory for thors and a fusion core for battlecruisers, which 4.10's data leaves out. Before, they were treated as having no requirement.
- `unit.burrow()` burrows every unit that can burrow (it used to handle only widow mines), and `unit.toggle()` switches every two-way morph (it used to handle only warp prisms and liberators).
- In a build order of `[supply, task]` pairs, a `train` task with a list of unit types no longer crashes; it counts the largest supply cost among them.
- With `createEngine({ launch: false })` or under a ladder manager, a map name is sent as a Battle.net map name instead of being resolved against a local install. A map name that isn't found locally logs a warning before falling back to Battle.net.
- Point targets with `x === 0` are no longer silently dropped by `actions.do`, `smart`, `move` and `build`.
- `units.clone()` keeps each unit's labels.
- `units.getProductionUnits` and `units.getUpgradeFacilities` return only your own units, so `actions.train`, `actions.upgrade` and the builder never pick a visible enemy building.
- The agent's own `onGameStart` and `onStep` now also receive `(data, event)` after `world`, and `onGameStart` keeps an `agent.opponent.id` set before the game (it used to wipe the ladder's `--OpponentId`). Under a ladder manager the engine sets the id from `--OpponentId` at setup only when it is passed, so a preset id survives otherwise.
- Units whose death SC2 reports are labelled `dead` as before, and dead enemies are now also removed from the unit store, since enemies are otherwise kept as memory.
- The map system marks the cells of destructible rocks and xel'naga towers unplaceable (node-sc2 only marked unbuildable plates), so `isPlaceable`, `isPlaceableAt`, the placement grid and `map.path` treat them as blocked. Rocks whose shape isn't known (diagonal and very large ones) stay placeable.
- Enemy memory expires: a ghost is forgotten after 30 seconds (configurable with `memory.configure`) or when its last position is visible again. node-sc2 kept every enemy that left vision for the rest of the game.
- Running another game on the same engine resets every registered resource in place (unit store, map caches, events, debug drawings, step times, proposed commands, and custom resources through their own `reset`), earmarks and systems' step timing (see [Several games on one engine](#enginerungamemap-players-options)). Enemy memory and the cached combat rally used to carry over, and agent systems skipped their `onStep` until the game loop passed where the previous game ended. The first game no longer resets anything, and the build and unit plugins are no longer re-applied per game (which ran a build order once more per step for every extra game).
- A game SC2 can't create rejects `runGame` and `runBotVsBot` with SC2's error (e.g. `Could not create a game on "<map>" (InvalidMapName): ...`). It used to hang or fail later with a misleading error.
- A realtime game whose SC2 connection closes rejects with `ConnectionClosedError` instead of resolving `[world, undefined]`.
- `onNewEffect` and `onExpiredEffect` fire only when an effect appears or ends. The checks were inverted, so both fired for effects that were still active.

## Testing

Run `bun test` in `packages/core` (or `bun run test` at the repo root, through turbo). Tests are colocated with the code as `*.test.ts` and come in three tiers:

- **Pure**: plain inputs, no world.
- **Fixture**: a real engine and world built from captured game data, with a fake SC2 client. No SC2 needed.
- **Live**: real SC2 games, in `engine/create-engine.live.test.ts`. They only run when `SC2PATH` is set.

The fixture tier uses `createTestWorld(fixtureOrMapName, { loop?, agent?, onQuery? })` from `test/create-test-world.ts`. It loads `fixtures/<map>/`, runs the engine's setup and first step on the observation at `loop`, and returns the world plus `client` and `engine`. `stepTo(world, loopOrObservation)` feeds the next observation through a full dispatch, so events fire. The fake client (`test/fake-client.ts`) records every request in `client.sent` (`actions`, `step`, `debug`, `queries`, `createGame`, `leaveGame`, `saveReplay`, ...). It tracks `client.status` through `createGame`, `joinGame` and `leaveGame`, and like SC2, `saveReplay` throws once the game has been left. It answers placement and pathing queries with the answers recorded from the real engine when it has them, and otherwise computes them from the fixture's grids. `test/factories.ts` has `rawUnit`, `observation`, `unitTypeData` and `toyFixture` for hand-built frames.

```ts
import { describe, expect, it } from 'bun:test';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { UnitType } from '../constants/index.ts';

describe('opening', () => {
    it('stops the starting workers on Blueshift', async () => {
        const world = await createTestWorld('blueshift', { loop: 0 });
        const { units, actions } = world.resources.get();

        const workers = units.getWorkers();
        expect(workers.exists).toBe(true);
        expect(units.getById(UnitType.COMMANDCENTER).amount).toBe(1);

        await actions.stop(workers);
        expect(world.client.sent.actions).toHaveLength(1);

        await stepTo(world, 224);
        expect(world.resources.get().frame.getGameLoop()).toBe(224);
    });
});
```

To test a failure path, override a client method on the world, e.g. `world.client.action = async () => ({ result: [3] })` makes SC2 reject every command.

The test helpers live inside the package and aren't part of its exports, so they are for tests within `packages/core`.

**Fixtures.** `fixtures/` holds games captured from SC2 4.10: `blueshift`, `acropolis` and `simple64` (Terran), plus `blueshift-zerg` and `blueshift-protoss`. Each has `gameInfo.json`, observations at loops 0, 224 and 896 (`obs-<loop>.json`), and `abilities.json` and `queries.json` keyed by loop. `fixtures/data.json` is the shared game data. `blueshift/type-abilities.json` lists the abilities of each unit type (it feeds `generate:data`), and `simple64/rock-placements.json` holds placement answers around destructible rocks, captured by hand.

**Scripts** (run in `packages/core`):

- `bun run capture:fixtures [fixture...]` plays scripted games against the built-in AI and re-captures all fixtures, or only the named ones. It needs SC2 and the maps (`Ladder2018Season4/BlueshiftLE`, `Ladder2019Season3/AcropolisLE`, `Melee/Simple64`). It uses port 5077 and refuses to start if that port is taken. Each fixture is written to `<fixture>.capturing` and only replaces the old one when the capture completes. A saved observation is the exact response the frame system consumed, so the actions, action errors, chat and dead units SC2 reports only once are kept. The `type-abilities` passes run when no fixture is named, or when `type-abilities` is named along with `blueshift`. `CAPTURE_DIR` changes the output folder.
- `bun run generate:data` regenerates the id modules in `constants/` and the dictionaries in `constants/dicts/` from the captured data. Existing names are kept.

## Known limitations

- Influence has no climber, air-vs-ground, ground-to-air, tactical or priority grids, and ignores KD8 charges, parasitic bombs and force fields (see [Where this library differs from ares-sc2](#where-this-library-differs-from-ares-sc2)).
- The fight simulation (`simulateFight`, `canWinFight`) doesn't model splash, healing (medivacs, transfuse, repair), spells, terrain, chokes or high ground, bunker passengers, or micro; units don't move apart from the `timingAdjust` start delay. A sieged tank's minimum range is judged on the starting positions, so a unit that would walk inside it still gets shelled. As in the rest of the combat math, upgrade-dependent bonuses (range, attack speed, ...) count for your own units only.
- The launcher waits for a freshly started SC2 to listen on its port without a timeout.
- SC2 under WSL is not discovered.

## Examples

Small runnable bots live in [`examples/`](examples). Each needs SC2 installed. The game-playing ones read `MAP` (default `Melee/Simple64`) and `GAME_TIME_LIMIT` (game seconds) to end the game early; all but `ladder.ts` also read `SAVE_REPLAY=<path>` to save a replay, and the ones against the built-in AI (worker rush, cannon rush, ramp wall) read `DIFFICULTY` (a `Difficulty` name such as `HARD`, default `MEDIUM`).

- `bun run examples/worker-rush.ts`
- `bun run examples/cannon-rush.ts` (`findPlacement`, `Units` filters, chat)
- `bun run examples/ramp-wall.ts` (Terran main ramp wall, `distributeWorkers`, depot raise/lower)
- `bun run examples/bot-vs-bot.ts` (`runBotVsBot`)
- `bun run examples/watch-replay.ts <replay> [observedPlayerId]` (`runReplay`)
- `bun run examples/ladder.ts` (started by a ladder manager with `--LadderServer`, `--GamePort`, `--StartPort`)
- [`examples/tutorial.ts`](examples/tutorial.ts) is a build system (an eight-gate all-in) to mount on an agent. It builds no pylons and has no supply handling, so as is its gateways can't be placed; add pylons to the order before using it.

## More documentation

- [API reference](docs/api.md): every method with its signature
- [Overview](docs/overview.md) and [tutorial](docs/tutorial.md) from node-sc2
- [Design](docs/design.md) and [internals](docs/internals.md): how the engine works inside
- [Changelog](docs/changelog.md)

The SC2 AI community is on Discord: https://discord.gg/Emm5Ztz
