# Build orders

A build order is an ordered list of steps (build this, train that, research this, send a scout) that a system works through one at a time. Give a system `type: 'build'` and a `buildOrder`, and `createSystem` attaches the builder plugin: it picks workers and spots, sends the commands, waits for what can't be afforded yet, and tells you when the last step is done.

Steps are written three ways, and one list can mix them: plain task objects made with `taskFunctions`, `[supply, task]` pairs that also fill in workers up to a supply, and ares-style [strings](#string-steps) such as `'16 barracks @ramp'`. An [opening](#openings) is a named build order with a few options, and a build system can choose between several of them at game start, from a history file of past results.

The builder places structures through the machinery in [Macro](macro.md): [`placement`](macro.md#placement) for spots, [`buildings`](macro.md#buildings) for the tracked walk-and-build, [`mining`](macro.md#mining) for workers. Its commands go out through [Command arbitration](commands.md#command-arbitration) like any others. A build system is a system, so everything in [Systems](agents.md#systems) applies to it, including `state`, `setState` and `pause`.

```ts
import { createAgent, createSystem, taskFunctions } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import { Race } from '@sc-bot/core/constants/enums';
import { BARRACKS, BARRACKSTECHLAB, MARINE, REFINERY, SUPPLYDEPOT } from '@sc-bot/core/constants/unit-type';
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
                place: ({ resources }, unitTypeId) =>
                    unitTypeId === SUPPLYDEPOT ? resources.get().map.getMainBaseRamp()?.cornerDepots : undefined,
            },
        });
    },
    async buildComplete() {
        this.setState({ openerDone: true });
    },
});

const bot = createAgent({ settings: { race: Race.TERRAN } });
bot.use(opener);
```

## Tasks

`taskFunctions` builds the task objects. Each returns a plain object, so a task can be reused or put in a `[supply, task]` pair.

#### `taskFunctions.build(unitType: number, qty = 1, opts?: BuildTaskOptions) => BuildTaskI`

Build a structure. `opts.near` (a unit type) anchors placement at the first of your units of that type, where the builder uses `actions.findPlacement`; `opts.on` picks the host unit type for an add-on; `opts.at` (a [build target](#build-targets)) says where it goes; `opts.skip` is described below. See [How the builder places structures](#how-the-builder-places-structures).

#### `taskFunctions.train(unitType: number | number[], qty = 1, opts?: BuildTaskOptions) => BuildTaskI`

Train a unit (a random one of the list each time). Uses warp-in once warp gate research is done. With `opts.at` the producer closest to that [build target](#build-targets) trains it, through `agent.train`. `opts.skip` applies.

#### `taskFunctions.upgrade(upgradeId: number) => BuildTaskI`

Research an upgrade at a free research structure. Takes no options.

#### `taskFunctions.ability(abilityId: number, opts?: BuildTaskOptions) => BuildTaskI`

Use an ability on a unit that has it. `opts.target` (a unit type) picks a random finished unit of that type as the target; `opts.on` (a unit type) limits the casters to units of that type. `opts.skip` applies.

#### `taskFunctions.scout(kind: 'worker' | 'overlord', waypoints?: BuildTarget[]) => BuildTaskI`

Send a scout through [build targets](#build-targets); see [Scouts](#scouts-and-the-persistent-builder). `waypoints` defaults to `[ENEMY_SPAWN]` for a worker and `[ENEMY_NAT_VISION]` for an overlord.

#### `taskFunctions.addonSwap(hostType: number, addonType: number) => BuildTaskI`

Calls [`flying.addonSwap`](macro.md#flying) with the structure type and add-on. While it returns `false` (no finished host or add-on) the step can't be satisfied and is retried each step.

`opts.skip` is the name of a key in the system's state: when that key is truthy the task is skipped (`BuildResult.SKIPPED` goes to `onStep`).

## The order

A `buildOrder` is a list of tasks, or `[supply, task]` pairs, or [strings](#string-steps), mixed. Steps run strictly in order: the builder works on the first step that isn't done and moves on when it is.

With pairs, worker tasks are inserted automatically until the given supply is reached, counting from 12. A `train` task then adds its supply to the count: its unit's supply cost times `qty`, or for a list of unit types the largest supply cost among them. A Zerg `build` task subtracts one, for the drone it consumes. A plain task without a supply inserts no workers. [Supply-gate mode](#workers-and-supply-gate-mode) replaces this fill with a wait.

A `build` task whose command was sent is done when an unfinished structure of that type appears. After 250 game loops without one it starts over, unless the tracker still has a build of that type pending. Other tasks are done when their command is proposed. A task that can't be started this step (unaffordable, no producer, no spot) is retried every step.

### Build system members

A build system's `onStep` receives `(world, gameLoop, task?, result?)`: the current task and the `BuildResult` of this step's attempt (`SUCCESS` 0, `COMMAND_SENT` 1, `CANNOT_SATISFY` 2, `ERROR` 3, `SKIPPED` 4, from `@sc-bot/core/constants/enums`). Both are `undefined` while the order is paused or finished. `createSystem` types a `type: 'build'` blueprint as `BuildSystemObject`, so these parameters are typed.

```ts
// signature sketch: the fields a build system adds to a system blueprint
{
    buildOrder?: Array<BuildTask | BuildOrderStep>;
    openings?: Record<string, OpeningDefinition> | 'config';
    opening?: string | ((world: World) => string);
    buildOptions?: { paused?: boolean; earmarks?: null | number; fillWorkers?: boolean };
    buildComplete?(world: World, gameLoop: number): Promise<any>;
    pauseBuild(): void;
    resumeBuild(): void;
    earmarkDelay(loops: number): void;
    switchOpening(name: string, opts?: { removeCompleted?: boolean }): void;
    getOpening(): string | undefined;
}
```

#### `buildOptions: { paused?: boolean, earmarks?: null | number, fillWorkers?: boolean }`

Defaults `paused = false`, `earmarks = 1000`, `fillWorkers = true`. See `this.earmarkDelay` below for `earmarks` and [Workers and supply-gate mode](#workers-and-supply-gate-mode) for `fillWorkers`.

#### `buildComplete(world: World, gameLoop: number) => Promise<any>`

Called once when the last task is done, and again when the order switched to with [`switchOpening`](#switching) is done.

#### `this.pauseBuild() => void`, `this.resumeBuild() => void`

Pause and resume the order. While paused, `onStep` still runs, with no task or result.

#### `this.earmarkDelay(loops: number) => void`

When the current task still can't be afforded `earmarks` game loops after it came up (1000 by default), the builder earmarks its cost so other spending leaves it alone (see [Earmarks](resources.md#earmarks)). `earmarkDelay` changes that delay; `0` turns earmarking off, and so does `buildOptions.earmarks: null`.

#### `this.switchOpening(name: string, opts?: { removeCompleted = true }) => void` and `this.getOpening() => string | undefined`

See [Switching](#switching).

## String steps

A `buildOrder` step can also be a string in ares' format, or an object for a scout. Strings compile to the same `[supply, task]` pairs as hand-written ones, so strict order, `skip`, pausing and earmarks work as before, and a build order without strings behaves exactly as it did. [`parseBuildOrder`](#parsebuildorder) does the compiling, and the build system calls it at game start.

```text
'<supply> <command> [@target ...] [x<n>]'
```

- Matching is case-insensitive. The supply is the minimum supply used for the step; a missing or non-numeric one counts as `0` and logs on `sc2:debug:buildOrder`.
- The target is written `@ramp`, `@ ramp` or `ramp`; on a unit step the last one wins. Every target is checked against the [`BuildTarget`](#build-targets) names (except a `CHRONO` target), but only the commands marked below use it. `x3` or `*3` repeats the step three times (`x0` is ignored).
- The command is looked up as a unit type name first (a structure is built, anything else trained), then as an upgrade name, then as one of the options below. `LAIR` and `HIVE` are morph abilities, not builds. An upgrade name has to exist in the library's upgrade constants, which come from the game data. ares' `tempestgroundattackupgrade` isn't there (the only Tempest upgrade is `TEMPESTRANGEUPGRADE`), so `16 tempestgroundattackupgrade` throws `unknown command`.

| Option | Task |
|---|---|
| `WORKER` | Train a worker (`SCV`, `PROBE` or `DRONE`); honours the target |
| `SUPPLY` | Build a `SUPPLYDEPOT` or `PYLON`; for Zerg, train an `OVERLORD`. Honours the target. |
| `GAS` | Build a `REFINERY`, `ASSIMILATOR` or `EXTRACTOR` through [`buildings.buildGas`](macro.md#buildings) on a free geyser at your own bases. The target is checked and dropped, so `14 gas @enemy_spawn` is a plain `14 gas`. |
| `EXPAND` | Build a townhall; honours the target |
| `GATE`, `CORE` | Build a `GATEWAY` or `CYBERNETICSCORE`; honours the target |
| `ORBITAL` | The `MORPH_ORBITALCOMMAND` ability |
| `CANCEL_GAS` | Cancel the race's gas building under construction (`CANCEL_BUILDINPROGRESS`, on gas buildings only) |
| `CHRONO` | Chrono boost; the target is the unit type that gets it and is required (`16 chrono @ nexus`; `core` means `CYBERNETICSCORE`) |
| `WORKER_SCOUT`, `OVERLORD_SCOUT` | A scout task; the targets are its waypoints |
| `ADDONSWAP` | `'21 addonswap factory barracksreactor'`: exactly two structure names, the host and the add-on, as the `addonSwap` task |

The object form gives a scout its waypoints: `{ '17 worker_scout': ['enemy_nat', 'enemy_spawn'] }`. Its keys are `<supply> worker_scout` or `<supply> overlord_scout` only. Without waypoints a worker scout goes to `ENEMY_SPAWN` and an overlord scout to `ENEMY_NAT_VISION`. A string takes waypoints as targets too: `'17 worker_scout @enemy_nat @enemy_spawn'`.

**Errors.** A bad step throws `NodeSC2Error` (`Invalid build order step "<step>": <reason>`) at game start, before the game runs, for:

- a string with fewer than two words (no `<command>`);
- an unknown command, an upgrade name missing from the game data included;
- an unknown target, and `ENEMY_NAT_HG_SPOT`, which isn't supported;
- `CHRONO` without a unit type target, or with an unknown one;
- `ADDONSWAP` with other than two names, or a name that isn't a structure;
- an object step whose key isn't a scout, or whose targets aren't a list;
- a race-specific option (`WORKER`, `SUPPLY`, `GAS`, `EXPAND`, `CANCEL_GAS`) for a race that isn't Terran, Protoss or Zerg.

```ts
import { createAgent, createSystem, taskFunctions } from '@sc-bot/core';
import { Race } from '@sc-bot/core/constants/enums';
import { MARINE } from '@sc-bot/core/constants/unit-type';

const { train } = taskFunctions;

const reaperExpand = createSystem({
    name: 'ReaperExpand',
    type: 'build',
    buildOrder: [
        '14 supply @ramp',
        { '15 worker_scout': ['enemy_nat', 'enemy_spawn'] },
        '16 barracks @ramp',
        '16 gas',
        '19 reaper',
        '19 orbital',
        '20 expand @nat',
        '22 supply',
        '23 barracksreactor',
        '24 factory @production',
        '26 barracks x2',
        '30 stimpack',
        [32, train(MARINE, 4)],
    ],
});

const bot = createAgent({ settings: { race: Race.TERRAN } });
bot.use(reaperExpand);
```

### Build targets

`@target` and `opts.at` say where a step happens. The names are the `BuildTarget` constants of `@sc-bot/core/constants/build-target`.

| Target | The point | A structure with this target |
|---|---|---|
| `RAMP` | Top of your main ramp | A [`placement`](macro.md#placement) request for the main base with the `wall` flag. When an enemy unit is within 10 of the ramp top the flag is dropped, so the builder isn't sent into them. |
| `NAT_WALL` | Your natural's townhall position | The same request for the natural. Unlike ares, it keeps the `wall` flag when enemies are at the main ramp. |
| `REAPER_WALL`, `SUPPLY`, `PRODUCTION`, `UPGRADE`, `BUNKER` | Your start location | A request with the flag `reaperWall`, `supplyDepot`, `production`, `upgradeStructure` or `bunker` |
| `SPAWN`, `NAT`, `THIRD`, `FOURTH`, `FIFTH`, `SIXTH` | The townhall position of your 1st to 6th expansion, in `map.getExpansions()` order | A request for that base; a townhall goes on that base's townhall position |
| `ENEMY_SPAWN`, `ENEMY_NAT`, `ENEMY_THIRD`, `ENEMY_FOURTH` | The townhall position of the enemy's 1st to 4th expansion (your start when there is none) | Placed with `actions.findPlacement` near the point (a proxy) |
| `ENEMY_RAMP` | Top of the enemy main ramp from [`mapAnalysis.getEnemyMainRamp`](map.md#mapanalysis), else the enemy spawn | Proxy near the point |
| `ENEMY_NAT_VISION` | 10 from the enemy natural towards the map centre | Proxy near the point |
| `MAP_CENTER` | The map centre | Proxy near the point |

A gas step, a step without a target, and a townhall step whose target isn't one of your bases or an enemy-side or map-centre point use the builder's usual placement. Proxies use query placement, not the solver: with no placement near the point the step can't be satisfied and is retried each step.

Scout waypoints are expanded per target. `SPAWN` and `ENEMY_SPAWN` circle that main along the perimeter of its [region](map.md#mapanalysis): perimeter cells within 8 of the ramp top are dropped, the rest kept at least 4 apart, each moved 2 towards the base, and those that end up outside the region are dropped (ares keeps them). The enemy circuit starts next to the enemy ramp; with no region, or nothing left, it is the base position alone. `NAT` goes behind the natural's mineral line, and any other target is its point.

### How the builder places structures

- Gas buildings go on a free geyser through [`buildings.buildGas`](macro.md#buildings), with no cap on simultaneous builds, so every gas step of the order is honoured.
- An untargeted townhall goes to `buildings.getNextExpansion({ checkSafe: false })`, the single pick; the step returns `CANNOT_SATISFY` if `actions.canPlace` rejects it (no search for another spot). Terran and Protoss track it as a build at that spot; Zerg sends an untracked `actions.build`. A targeted townhall (`expand @nat`) takes the `opts.at` route below, tracked the same way.
- A step with `opts.at` whose target resolves is placed from that target, before the [`placer`](macro.md#placer) `place` hook and the solver below are consulted.
- If a `placer` resource is set and returns positions for that unit type, one of them that SC2 accepts is built on, as a tracked build for Terran and Protoss (Zerg falls back to an untracked `actions.build` there).
- Otherwise, for Terran and Protoss structures other than add-ons, it calls `buildings.build` with a [`placement`](macro.md#placement) request: the precomputed spots, anchored at `opts.near` when given (a Protoss structure other than a pylon must be powered; a Terran depot asks for the flag `supplyDepot`, a barracks, factory or starport for `production`). The tracker walks the worker, retries the command and re-places the building when it keeps failing. Spots from `placer.placements` or `placement.add` are used when their flags match.
- When the tracker can't start the build (no spot, no worker, or a Zerg order), it falls back to `actions.findPlacement` near `opts.near`, or near a point 8 cells from the main townhall towards the map center. Protoss buildings other than pylons are placed around finished pylons; Terran production buildings require room for an add-on.
- An add-on step (`build` with an add-on type) is sent to the finished, idle host without an add-on: a unit of `opts.on` when given, else a production structure of the type that makes it.

Which worker builds is the [Builder pick](macro.md#builder-pick) rule.

## Openings

An opening is a named build order with options. A build system takes them instead of `buildOrder`; when both are set, `buildOrder` is ignored with a warning.

```ts
// signature sketch
type OpeningDefinition = {
    buildOrder: Array<BuildTask | BuildOrderStep>; // steps, as above
    constantWorkerProductionTill?: number; // a worker supply; above 0, trains workers constantly up to it and runs in supply-gate mode
    autoSupplyAtSupply?: number; // from this supply used on, the autoSupply controller runs every step
    persistentWorker?: boolean; // false turns off the persistent builder (default on; Terran and Protoss only)
};
```

(Signature sketch.) `autoSupplyAtSupply` runs the [`autoSupply`](behaviors.md#controllers) controller every step while the order is active (not paused and not complete). Like the other opening options, `constantWorkerProductionTill` and `persistentWorker` act only while the order is active.

```ts
import { createSystem } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import { Race } from '@sc-bot/core/constants/enums';

const macro = createSystem({
    name: 'Macro',
    type: 'build',
    openings: {
        reaperExpand: {
            buildOrder: ['14 supply @ramp', '16 barracks @ramp', '16 gas', '19 orbital', '20 expand @nat'],
            constantWorkerProductionTill: 44,
            autoSupplyAtSupply: 30,
        },
        threeRax: { buildOrder: ['14 supply @ramp', '16 barracks @ramp', '20 barracks x2'] },
    },
    opening: ({ agent }: World) => (agent.opponent?.race === Race.ZERG ? 'threeRax' : 'reaperExpand'),
});
```

Which opening runs is decided once, at game start. `opening` as a string or a function of the world picks it directly. Without `opening`, [`openings.choose`](#openings-resource) picks one of the opening names, by the choices and history below. An unknown name, or none to pick, throws `NodeSC2Error` listing the available names.

`openings: 'config'` takes the definitions from `openings.getDefinitions()`, which the config file's `resources.openings` section fills, so builds change without editing code:

```json
{
    "resources": {
        "openings": {
            "builds": {
                "reaperExpand": { "buildOrder": ["14 supply @ramp", "16 barracks @ramp", "16 gas", "19 orbital", "20 expand @nat"], "constantWorkerProductionTill": 44 },
                "threeRax": { "buildOrder": ["14 supply @ramp", "16 barracks @ramp", "20 barracks x2"] }
            },
            "choices": { "Zerg": ["threeRax", "reaperExpand"] },
            "method": "winrate",
            "minGames": 3,
            "dataDir": "data"
        }
    }
}
```

### Switching

`this.switchOpening(name, { removeCompleted = true }?)` swaps the running opening for another, and `this.getOpening()` returns the current name (`undefined` before the game starts or without `openings`). Switching to the current opening, or before the game starts, does nothing; an unknown name throws `NodeSC2Error`. With `removeCompleted`, the new order skips what is already done, by ares' rules: the first townhall, one overlord and 12 workers count as done; a build or train step is dropped while you already have (or have pending) more of its type than steps dropped so far; an upgrade is dropped when it is researched or in progress; scout and chrono steps are always dropped. The switch also settles the order's earmarks, releases the persistent builder (the new opening picks its own), continues from the first remaining step and re-applies the new opening's supply-gate setting.

### Workers and supply-gate mode

By default the builder fills workers: for `[supply, task]` pairs it trains workers until the step's supply is reached, as described under [The order](#the-order). `buildOptions: { fillWorkers: false }` on the system switches to ares' supply-gate mode: no workers are inserted, and a step with a supply that hasn't started waits until your supply used reaches it; a started step still completes, or resets after 250 loops and then waits.

An opening with `constantWorkerProductionTill` above 0 sets `fillWorkers` to `false` for as long as it is the current opening, so the two never stack; an opening without it (or with `0`) leaves the system's own setting (default `true`). Constant production trains a worker on an idle finished townhall each step while worker supply is under the limit, supply is left and the worker is affordable. It holds back while the current step is a townhall morph whose supply is reached (an orbital also needs its tech requirement 95% done), so the townhall is free for the morph.

### Scouts and the persistent builder

A worker scout takes a worker through `mining.selectWorker` when [`mining`](macro.md#mining) is enabled, else the `GATHERING` mineral worker closest to the main townhall, and gives it the role `BUILD_RUNNER_SCOUT`. A worker carrying resources returns them first; then it moves through the waypoints with queued moves, as owner `role:BUILD_RUNNER_SCOUT`. Without a worker the step can't be satisfied, so the order waits for one. An overlord scout is the first overlord without that role. A scout keeps its role after the last waypoint and isn't given back to mining.

With `persistentWorker` on, a Terran or Protoss opening keeps one builder. At 3 seconds, when its first supply structure is at 13 supply or less or at `NAT`, else at 9 seconds, it takes a worker with the role `PERSISTENT_BUILDER` and moves it to the placement point of that structure. That worker is handed to the builds that go through the [tracker](macro.md#buildings) (targeted steps such as `'expand @nat'`, `placer` positions and the placement solver), unless it is busy on a tracked build. Gas, an untargeted townhall, add-ons and the `actions.findPlacement` fallback pick their own worker. It goes back to mining when the opening completes, on `switchOpening`, and for Protoss also once a pylon step completes.

## openings resource

Holds the opening definitions and settings, picks an opening per game and keeps the per-opponent history. A build system uses it; you rarely call it yourself. It is registered last, after `behaviors`.

```ts
// signature sketch
type OpeningSettings = {
    builds: Record<string, OpeningDefinition>; // = {}
    choices: Record<string, string[]>; // = {}: opponent id or race name to opening names
    method: 'cycle' | 'winrate'; // = 'cycle'
    minGames: number; // = 3
    dataDir?: string; // unset: nothing is read or written
};
type OpeningRecord = { race: string; duration: number; opening: string; result: 'victory' | 'defeat' | 'tie' | 'undecided' };
```

(Signature sketch.) The config file's `resources.openings` section goes to `configure`.

#### `openings.configure(settings: Partial<OpeningSettings>) => void`

Assigns the given fields over the current settings.

#### `openings.getDefinitions() => Readonly<Record<string, OpeningDefinition>>`

The configured `builds`.

#### `openings.choose(available = Object.keys(builds)) => string | undefined`

The opening for this game, or `undefined` when no candidate is left. Decided once per game and then returned unchanged until the next game; with `dataDir` it reads the history file.

`choices` maps an opponent id, or an enemy race name (`Terran`, `Zerg`, `Protoss`, `Random`; `Random` is also used while the race is unknown), to the openings it may pick from. The opponent id wins over the race; with neither, every available opening is a candidate. A name that isn't in `available` is left out. Two methods pick from the list:

- `cycle` (the default) keeps the opening of the last recorded game after a victory and moves on to the next, wrapping, after a defeat, a tie or anything else. With no history, or a last opening that isn't in the list, it is the first.
- `winrate` needs every listed opening to have at least `minGames` recorded games (default 3; above 10 it never applies), otherwise it cycles. It scores each opening by its last 10 games (no records scores 0) and takes the best. On a tie it takes the tied opening after the last one used, else the first.

#### `openings.getChosen() => string | undefined`

The opening recorded for this game, `undefined` before one is chosen.

#### `openings.getHistory() => readonly OpeningRecord[]`

The records read for this game, plus the one appended at game end.

#### `openings.record(name: string) => void`

Belongs to the runner: it sets the opening that goes into the history at game end, reading the history file first when `choose` hasn't. A bot that calls it overwrites that name and corrupts the winrate data. Use `opening` and `switchOpening` instead.

**History.** With `dataDir` set, each game appends a record to `<dataDir>/<opponent id or 'unknown'>-<your race, lowercase>.json` when it ends. The directory is created, and the file is written synchronously, so it exists when the game-end hook returns. Without `dataDir`, nothing is read or written. The file is in ares' own format (`EnemyRace`, `Duration`, `StrategyUsed`, and `Result` as 0 defeat, 1 tie, 2 victory; an `undecided` result is written as 1), so an existing ares `data/` folder is reused. A file that isn't a JSON array warns and counts as empty; entries that don't parse are dropped with a warning and are gone from the file at the next write. A relative `dataDir` is relative to the working directory. Every opening chosen at game start is recorded, whether it came from `choose`, from `opening` as a string or from a function; a mid-game `switchOpening` isn't. No history is written for a replay, or for a game that crashed or lost its connection (resources get no game end for those). A game reset clears the chosen opening and the history.

```ts
import { createSystem } from '@sc-bot/core';
import type { World } from '@sc-bot/core';

export const macro = createSystem({
    name: 'Macro',
    type: 'build',
    openings: 'config',
    setup({ resources }: World) {
        resources.get().openings.configure({
            builds: {
                reaperExpand: { buildOrder: ['14 supply @ramp', '16 barracks @ramp', '20 expand @nat'] },
                threeRax: { buildOrder: ['14 supply @ramp', '16 barracks @ramp', '20 barracks x2'] },
            },
            method: 'winrate',
            dataDir: 'data',
        });
    },
});
```

## parseBuildOrder

#### `parseBuildOrder(steps: Array<BuildOrderStep | BuildTask>, race: SC2APIProtocol.Race) => BuildTask[]`

Turns ares-style steps into the `[supply, task]` pairs of a build system's `buildOrder`, and returns them. `BuildOrderStep` is `string | Record<string, string[]>`. The grammar, the targets and the errors are described under [String steps](#string-steps); the race-specific options resolve for `race`. `[supply, task]` pairs and plain task objects pass through unchanged. Throws `NodeSC2Error` naming the first invalid step.

```ts
import { parseBuildOrder } from '@sc-bot/core';
import { Race } from '@sc-bot/core/constants/enums';

const opening = parseBuildOrder(
    ['14 supply @ramp', '16 barracks @ramp', '16 gas', '19 orbital', '20 expand', { '17 worker_scout': ['enemy_spawn', 'enemy_nat'] }],
    Race.TERRAN,
);
```
