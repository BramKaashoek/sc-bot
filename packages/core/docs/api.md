# API Reference
All parameter examples below are shown with their *default* values.

## Main Export
The main export exposes all relevant APIs. Some are available separely through deep linking as well.
```js
import {
    createAgent,
    createEngine,
    createSystem,
    createPlayer,
    taskFunctions,
    Units,
    Ramp,
    PixelMap,
    NodeSC2Error,
    ActionManagerError,
    BuildError,
    TrainError,
    GatherError,
    MapDecompositionError,
    GameEndedError,
    canWinFight,
    simulateFight,
    parseBuildOrder,
} from '@sc-bot/core';
```
Types are exported from the same entry (`import type { World, Unit } from '@sc-bot/core'`), constants from `@sc-bot/core/constants/<module>`, and the behavior and controller factories from `@sc-bot/core/behaviors` (see [Behaviors](#behaviors-1) and [Controllers](#controllers)).

### *`createPlayer(settings, bot?) => Player`*
This is a convenience function for creating player objects to be passed to `Engine#runGame`. You can construct the player objects manually instead, for more control. If the 'player' should be an Agent, you must pass it as the second parameter.
```js
settings = {
    race: Race.RANDOM, // required
    difficulty: Difficulty.MEDIUM, // only set this for a built-in AI player
}
```

### *`taskFunctions`*
The task builders for the `buildOrder` of a `build` system. See [Build systems](../readme.md#build-systems) in the readme.

#### *`taskFunctions.build(id: number, qty = 1, opts?: BuildTaskOptions) => BuildTaskI`*
#### *`taskFunctions.train(id: number | number[], qty = 1, opts?: BuildTaskOptions) => BuildTaskI`*
#### *`taskFunctions.upgrade(id: number) => BuildTaskI`*
#### *`taskFunctions.ability(id: number, opts?: BuildTaskOptions) => BuildTaskI`*
Tasks with `qty` 1 for `upgrade` and `ability`. `BuildTaskOptions = { near?, on?, skip?, target?, at?: BuildTarget, waypoints?: BuildTarget[], scout?: 'worker' | 'overlord', addon?: number }`. `near` (a unit type) anchors a build's placement, `on` picks the add-on host of a build or restricts an ability to units of that type, `skip` names a state key that skips the task when truthy, `target` (a unit type) is an ability's target. `at` (a `BuildTarget`) places a `build` (a gas step ignores it; a townhall honours it only for your own bases and the enemy-side and map-centre targets) and picks the `train` producer closest to that point.

#### *`taskFunctions.scout(kind: 'worker' | 'overlord', waypoints?: BuildTarget[]) => BuildTaskI`*
`waypoints = [ENEMY_SPAWN]` for a worker and `[ENEMY_NAT_VISION]` for an overlord. Moves the scout through the waypoints, expanded per target (see Build targets in the readme). A worker scout takes the role `BUILD_RUNNER_SCOUT` through `mining.selectWorker` when mining is enabled, else the closest `GATHERING` mineral worker; an overlord scout takes the first overlord without that role. Without a scout unit the task can't be satisfied and is retried each step.

#### *`taskFunctions.addonSwap(host: number, addon: number) => BuildTaskI`*
Calls `flying.addonSwap(host, addon)`; when that returns `false` the task can't be satisfied and is retried each step.

## Engine
An Engine is the glue that wires all the parts together internally. It is similar to the concept of the 'Coordinator' in some other sc2 APIs. In `node-sc2`, the engine is used to connect to a client, create games, and join games (whether created by this engine or not). When a new Engine is created, it also creates the *context* (called the `World`) that will exist in any game it coordinates, including all resources and data. During a game, it runs the main loop and handles dispatching of each `step` across all systems and agents.

### *`createEngine(options?) => Engine`*
```js
options = {
    host: '127.0.0.1', // passed to the underlying proto client
    port: 5000, // passed to the underlying proto client
    launch: true, // launch SC2 on connect() unless something already listens on the port
    force: false, // on connect(), kill whatever already listens on `port` and launch a fresh SC2
    onGameEnd: undefined, // (results: PlayerResult[]) => void, called when a game ends
    client: undefined, // a proto client to use instead of a real connection (tests)
    config: {}, // CoreConfigInput: gameStep, features and resources, merged over the config file
    configFile: undefined, // string | false: path of the JSON config file; false reads none
}
```
`config` and `configFile` are resolved when the engine is created (see the readme's Config file section): defaults, then the file (`configFile`, else `SC_BOT_CONFIG`, else `sc-bot.config.json` in the working directory), then `config`, then the `STEP_COUNT` environment variable for `gameStep`. It throws `NodeSC2Error` for a named file that doesn't exist, for invalid JSON or JSON that isn't an object, for a `gameStep` or `STEP_COUNT` that isn't a positive integer and for a non-boolean feature; an unknown key under `features` logs a warning. The result is `world.config`.
`engine.shutdown()` closes the connection to SC2.

### *`engine.connect() => Promise<SC2APIProtocol.ResponsePing>`*
This function must be awaited (or the returning promise, resolved) before anything else useful can happen. Once the engine is connected to the SC2 client, you can then invoke either `runGame` or some combination of `createGame` and/or `joinGame`, depending on the desired behavior.

### *`engine.runGame(map, players, options?) => Promise<[World, SC2APIProtocol.PlayerResult[]]>`*
This is a convenience function for both creating a game, and then joining it. Its primary use is to facilitate starting a game against the built in AI.

`map` is resolved as described under `createGame` below.

```js
players = [{
    type: PlayerType.PARTICIPANT,
    race: Race.RANDOM,
    agent: bot, // this is your bot created from `createAgent`
}, {
    type: PlayerType.COMPUTER,
    race: Race.RANDOM,
    difficulty: Difficulty.EASY,
}];
```

For your convenience, there is a `createPlayer` function in the main export that can be used to shorten this boilerplate, here is an example:

```js
players = [
    createPlayer({ race: Race.RANDOM }, bot), // bot is your bot created from `createAgent`
    createPlayer({ race: Race.RANDOM, difficulty: Difficulty.MEDIUM }),
]
```
### *`engine.createGame(map, players, realtime?, { randomSeed, disableFog }?) => Promise<SC2APIProtocol.ResponseCreateGame | undefined>`*
Creates a new game on the client with the given map and player setup. A path containing `SC2Map` is sent as a local map. Any other name is looked up under the install's `Maps/` when the engine launched SC2 itself; with `launch: false` (or under a ladder manager) it is sent as a Battle.net map name.
```js
engine.createGame('Blueshift LE', [{
        type: PlayerType.PARTICIPANT,
        race: Race.RANDOM,
    }, {
        type: PlayerType.COMPUTER,
        race: Race.RANDOM,
        difficulty: Difficulty.EASY,
    }]);
```
It resolves with `undefined`, without creating anything, under a ladder manager or when the client isn't in the launched or ended state. The client will expect players to join the game after it's created, and the game will not start until the players defined in the player setup join.

### *`engine.joinGame(bot) => Promise<[World, SC2APIProtocol.PlayerResult[]]>`*
Joins the game with the given bot as the participant defined previously, and then starts the internal game loop when all participants are ready. Returns a tuple of a snapshot of the game context (`world`) on the last frame of the game, and the game results (an array of `PlayerResult`). If the game is already in progress, it resyncs with it instead, reading your player id from the observation.

```js
const [world, results] = await engine.joinGame(bot);
```
### *`engine.runGame(map, players, options?)` options*
`runGame` also accepts a third argument. All fields are optional:
```js
options = {
    realtime: false, // run at game speed; the engine doesn't call `step`, each observation waits for the next game loop
    randomSeed: undefined, // passed to the game for deterministic AI/RNG
    disableFog: undefined, // reveal the whole map
    gameTimeLimit: undefined, // in game seconds; the game is left once exceeded and every participant is reported as a tie
    saveReplayAs: undefined, // path; the replay is written there when the game ends
}
```
`runBotVsBot` accepts the same options. `createGame` takes `randomSeed` and `disableFog` as a fourth argument.

`runGame` can be called again on the same engine after a game ends. From the second game on, each game starts with the unit store cleared and the `map`, `events` and `debug` resources reset in place (no units or enemy memory from the previous game, no cached combat rally or paths), no earmarks, every system unpaused, its `state` back to a deep copy of its initial `state` and its step timing reset, and a build system's `buildOptions` (`paused`, `earmarks`, `fillWorkers`) back to their initial values. The build and unit plugins are applied only once.

`actions.surrender()` leaves the game; `runGame` then resolves with your player as `DEFEAT`. With `saveReplayAs`, the replay is saved before any leave, including a raw `_client.leaveGame()`.

Computer players may set `aiBuild` (an `AIBuild` value from the enums) and `playerName`.

### *`engine.runBotVsBot(map, [playerA, playerB], options?) => Promise<[GameResult, GameResult]>`*
Plays two agents against each other in one call. The engine launches a second client, creates the game on the first, and has both join; both agents run in this process. Returns one `[World, PlayerResult[]]` tuple per agent; both carry the same results, one entry per agent keyed by the `playerId` it actually got (look results up by `agent.playerId`, not by position). Both players must be `PlayerType.PARTICIPANT` with an `agent`.

```js
const [[world, results]] = await engine.runBotVsBot('Simple64', [
    { type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent: botA },
    { type: PlayerType.PARTICIPANT, race: Race.ZERG, agent: botB },
], { gameTimeLimit: 120, saveReplayAs: 'bot-vs-bot.SC2Replay' });
```
SC2 4.10 can not join a game whose map path contains whitespace. Such a map is passed as a path relative to `<install>/maps` when that relative path has no whitespace; otherwise it is copied once into `<install>/maps/node-sc2/` (whitespace removed from the file name) and the game uses that copy. The copy is kept, so replays of the game stay playable.

`runBotVsBot` connects by itself when the engine isn't connected yet.

### *`engine.runReplay(observer, replayPath, options?) => Promise<[World, PlayerResult[]]>`*
Plays a replay with `observer` (an agent from `createAgent`) in place of a player. The agent receives the usual events (`onGameStart`, `onStep`, `onUnitCreated`, ...) from the observed player's view until the replay ends.
```js
options = {
    observedPlayerId: 1, // whose perspective to observe
    realtime: false,
}
```

### Ladder
When the process is started with `--LadderServer`, `--GamePort` and `--StartPort` (and optionally `--OpponentId`), `createEngine` connects to that server instead of launching SC2, and `runGame` joins the already created game; the player list is only used to find your agent. At each game's setup `agent.opponent.id` is set to `--OpponentId` when it is passed, replacing an id you set yourself; without it, a preset id is kept.

### SC2 discovery
The launcher looks for SC2 in this order: `ExecuteInfo.txt` (`~/Documents/StarCraft II`, or `~/Library/Application Support/Blizzard/StarCraft II` on macOS), the `SC2PATH` env var (the install root, containing `Versions/`), then `~/StarCraftII` on Linux. For the last two the newest `Versions/Base*` is used.

## Agent
An agent represents an AI controlling a player. The factory is available from the main export. In game, it is exposed throughout the engine via the `World` context.

### *`createAgent(blueprint?) => Agent`*
Accepts a blueprint implementing `EventConsumer` and returns an `Agent`.
```js
blueprint = {
    settings: {
        race: Race.RANDOM, // requested by joinGame; runGame and runBotVsBot use the player entry's race instead
        commandPriority: 0, // priority of the agent's own commands against its systems' (see actions › Arbitration)
        skipAvailableAbilitiesQuery: false, // skip the per-step ability query; use unit.fetchAvailableAbilities()
    },
    interface: { raw: true, score: true, rawCropToPlayableArea: true }, // SC2APIProtocol.InterfaceOptions; `raw: true` is required
    // a *synchronous* function of any additional setup you would like to run *before* the 'gameStart' event
    setup: (world: World) => void; 
    ...EventConsumer // see the EventConsumer section for details on what this implements
}
```

An agent implements the following properties from multiple interfaces:
```ts
{
    // this is the actual race in game, not the one selected (in the case of random)
    race: SC2APIProtocol.Race; 
    opponent: {
        // the requested race, or NORACE when the opponent picked random
        race: SC2APIProtocol.Race;
        id?: string; // set by you before the game and kept when the race is filled in; under a ladder manager, --OpponentId when passed
    };
    /**
     * these properties are implemented from `SC2APIProtocol.PlayerCommon`
     */
    playerId: number;
    minerals: number;
    vespene: number;
    foodCap: number;
    foodUsed: number;
    foodArmy: number;
    foodWorkers: number;
    idleWorkerCount: number;
    armyCount: number;
    warpGateCount: number;
    larvaCount: number;
    /**
     * these properties are implemented from `SC2APIProtocol.PlayerRaw`
     */
    powerSources: Array<{
        pos: { x, y, z };
        radius: number;
        tag: string;
    }>,
    camera: { x, y, z };
    upgradeIds: Array<number>;
}
```
As well as the above data directly related to the player itself, the following helper methods are exposed:

### *`agent.hasTechFor(unitType) => boolean`*
This is a synchronous function that, given a `unitType`, will return `true` or `false` whether you have a finished structure of the required tech type (or one of its aliases). The requirement comes from the game data; where SC2 4.10 data has none (ghost, thor, battlecruiser, mothership) it falls back to the `tech-requirement` dictionary.

### *`agent.canAfford(unitType, earmarkName?) => boolean`*
This is a synchronous function that, given a `unitType`, will return `true` or `false` whether you have the resources available to build/train the given unit.

This function also takes into account all `Earmark`'s currently in place (if any), and as such will tell you that you cannot afford something *even if you can*, if it encroaches on an earmark. If you want to check if something can be afforded *while consuming an earmark*, pass the earmark name along as the second parameter. If the function returns true - that earmark will be consumed, so either you must then choose to build/train the unit or issue a new earmark. For more information about earmarks see [events and data](../readme.md#events-and-data) in the readme.

### *`agent.canAffordUpgrade(upgradeId, earmarkName?) => boolean`*
Same as above but for upgrades, including the earmark handling.

### *`agent.canAffordN(unitType, max = 1) => number`*
How many of `unitType`, up to `max`, you can afford with your current minerals and gas. Ignores earmarks and supply.

### Supply and cost
```ts
agent.supplyCap / supplyUsed / supplyLeft / supplyArmy / supplyWorkers: number // getters
agent.calculateCost(unitType) => { minerals, vespene } // morphs are net of the consumed unit
agent.calculateUpgradeCost(upgradeId) => { minerals, vespene }
agent.calculateSupplyCost(unitType) => number
agent.canFeed(unitType) => boolean // enough supply left
agent.canAffordUnit(unitType, checkSupplyCost = true) => boolean // minerals, gas and supply, ignoring earmarks
```
`canAfford`, `canAffordN` and `canAffordUpgrade` keep their existing behavior.

### Pending and tech progress
```ts
agent.alreadyPending(unitType) => number // units/structures in production, counted from orders and unfinished units
agent.alreadyPendingUpgrade(upgradeId) => number // 1 if owned, else 0..1 research progress
agent.structureTypeBuildProgress(unitType) => number // best build progress among own structures of that type (and equivalents)
agent.techRequirementProgress(unitType) => number // 0..1 progress of the structure the unit requires
agent.workerEnRouteToBuild(unitType) => number
```

### Expansion and production helpers
```ts
agent.getNextExpansion() => Promise<Point2D | null> // free expansion location closest to your start by SC2 ground distance
agent.ownedExpansions() => Array<{ location: Point2D, townhall: Unit }>
agent.expandNow(unitType?, maxDistance = 10, location?) => Promise<void> // builds a townhall at the next (or given) expansion
agent.distributeWorkers(resourceRatio = 2, opts?: { workersPerGas?: number }) => Promise<void> // moves idle and surplus workers to undersaturated bases and gas
agent.train(unitType, amount = 1, closestTo?, trainOnlyIdleBuildings = true) => Promise<number> // returns how many were started
agent.research(upgradeId) => Promise<boolean>
```
These follow python-sc2's `BotAI` helpers of the same names. `distributeWorkers` fills gas first when minerals/vespene is at least `resourceRatio` (or there is no vespene), otherwise minerals. `workersPerGas = 3` caps the target per gas building at `min(ideal, workersPerGas)`; it must be an integer from 0 to 3 or the call rejects with a `RangeError`. Workers above the cap join the pool like any surplus and go to the deficit places the ratio favours, and `0` leaves gas empty. `research` also checks the required building (eg. an armory for level 2 upgrades) and the previous level, and throws for an upgrade missing from the researched-from dictionary. They propose their commands through `actions.queueAction` under the calling commander, so they go out with the rest at the end of the step. They deduct what they spend from the agent's minerals and gas right away, and `train` adds the supply it uses to `foodUsed`, so later calls in the same step see what is left.

### *`agent.use(system) => void`*
`System`'s (explained below) are mounted to your agent before the game starts, via `agent.use()`. It accepts either a single system, or an array of systems.

## System

### *`createSystem(SystemBlueprint) => System`*
Accepts a `SystemBlueprint` and returns a `System`.
```js
systemBlueprint = {
    name: 'MyCoolSystem', // this is the only required property, used for logging and debugging
    type: 'agent', // 'agent' (default), 'build' or 'unit'
    defaultOptions: {
        state: {}, // allows you to preset a state on initialization
        stepIncrement: 8, // agent systems only: skip onStep until more than N game loops have passed; defaults to 8 with an explicit type: 'agent', to 2 when type is left out
        commandPriority: 0, // priority of this system's commands; ties go to agent.use() order (see actions › Arbitration)
    },
    // a *synchronous* function of any additional setup you would like to run *before* the 'gameStart' event
    setup: (world: World) => void; 
    ...EventConsumer, // see the EventConsumer section for event handlers that can be implemented in a system
}
```

Systems also implement the following properties:
```ts
    {
        state: object;
        setState(newState: object): void;
        setState(newState: (currentState) => object): void;
        pause(): void; // skip all handlers until unpause(); `onStepPaused(world)` runs instead, if defined
        unpause(): void;
    }
```
`createSystem` also takes an options object as a second argument (`{ state?, stepIncrement?, commandPriority? }`), which overrides `defaultOptions`.

A blueprint with `type: 'build'` is typed as `BuildSystemObject`: its `onStep` is `(world, gameLoop, task?: BuildTaskI, result?: BuildResult)`, where `task` and `result` are `undefined` while the order is paused or finished. Its extra fields:
```ts
    {
        buildOrder?: Array<BuildTask | BuildOrderStep>;
        openings?: Record<string, OpeningDefinition> | 'config'; // replaces buildOrder (a warning when both are set); 'config' reads openings.getDefinitions()
        opening?: string | ((world: World) => string); // picks the opening at game start; without it openings.choose(names) does; an unknown name or none to pick throws NodeSC2Error
        buildOptions?: { paused?: boolean; earmarks: null | number; fillWorkers?: boolean }; // earmarks = 1000, fillWorkers = true
        pauseBuild(): void;
        resumeBuild(): void;
        earmarkDelay(loops: number): void;
        switchOpening(name: string, opts?: { removeCompleted?: boolean }): void; // removeCompleted = true
        getOpening(): string | undefined;
        buildComplete?(world: World, gameLoop: number): Promise<any>;
    }
```
`fillWorkers: false` is ares' supply-gate mode: no workers are inserted for `[supply, task]` pairs and a task waits until supply used reaches its supply. An opening whose `constantWorkerProductionTill` is above 0 sets it to `false` while it is the current opening (a `0` or unset one leaves the system's own value), and `switchOpening` re-applies it. `switchOpening(name)` before the game starts or to the current opening does nothing, and an unknown name throws `NodeSC2Error`; with `removeCompleted` the new order drops the steps already done (the first townhall, one overlord and 12 workers count as done; build and train steps are matched against existing plus pending units; upgrades researched or in progress; scout and chrono steps always), settles the earmarks, resets the persistent builder and continues from the first remaining step. `getOpening()` is `undefined` before the game starts and without `openings`.

In case those signatures are unclear, systems hold local, encapsulated state for use across frames. In any system function, `this.state` can be used to access the current state object. To mutate the state, you can use either `this.setState({ newProp: someValue })` which will perform a shallow merge, or you can pass in a function that takes the entire current state object, and returns the new state, but the state passed in *should not be mutated* - eg:

```js
this.setState((currentState) => {
    return { fooValue: currentState.fooValue +=1, barValue: 'bar' };
});
```

This encourages immutability, as well as keeping state shallow (without deep / graph objects). Of course, you can completely ignore this and just set things however you like (`this.state.foo = bar`), but these are best practices that you may be familiar with if you've worked with frameworks before such as React.

## EventConsumer
EventConsumer is a trait that represents a sum of the available event handlers that can be implemented. This includes all built-in events, as well as custom events you would like to create or use. The agent and system blueprints both implement this trait, and therefore can accept any of these handlers. The following are the built-in ones:

```js
{
        onStep?: (world: World, gameLoop: number, event: SystemEvent) => Promise<any>; // build systems: (world, gameLoop, task?, result?)
        onGameStart?: (world: World, data?: null, event?: SystemEvent) => Promise<any>; // no event when a system is mounted mid-game
        onUnitIdle?: (world: World, data: Unit) => Promise<any>;
        onUnitDamaged?:(world: World, data: Unit) => Promise<any>;
        onUnitCreated?: (world: World, data: Unit) => Promise<any>;
        onUnitFinished?: (world: World, data: Unit) => Promise<any>;
        onEnemyFirstSeen?: (world: World, data: Unit) => Promise<any>;
        onUnitDestroyed?: (world: World, data: Unit) => Promise<any>;
        onUnitHasEngaged?: (world: World, data: Unit) => Promise<any>;
        onUnitHasDisengaged?: (world: World, data: Unit) => Promise<any>;
        onUnitHasSwitchedTargets?: (world: World, data: Unit) => Promise<any>;
        onUnitIsTransforming?: (world: World, data: Unit) => Promise<any>;
        onUnitHasBurrowed?: (world: World, data: Unit) => Promise<any>;
        onBuildingConstructionStarted?: (world: World, data: Unit) => Promise<any>;
        onBuildingConstructionComplete?: (world: World, data: Unit) => Promise<any>;
        onStructureConstructionStarted?: (world: World, data: Unit) => Promise<any>;
        onStructureConstructionComplete?: (world: World, data: Unit) => Promise<any>;
        onUnitSpawned?: (world: World, data: Unit) => Promise<any>;
        onUnitTypeChanged?: (world: World, data: { unit: Unit, previousType: number }) => Promise<any>;
        onUnitTookDamage?: (world: World, data: { unit: Unit, amount: number }) => Promise<any>;
        onEnemyUnitEnteredVision?: (world: World, data: Unit) => Promise<any>;
        onEnemyUnitLeftVision?: (world: World, data: Unit) => Promise<any>;
        onUpgradeComplete?: (world: World, upgradeId: number) => Promise<any>;
        onChatReceived?: (world: World, chat: SC2APIProtocol.ChatReceived) => Promise<any>;
        onNewEffect?: (world: World, effect: Effect) => Promise<any>;
        onExpiredEffect?: (world: World, effect: Effect) => Promise<any>;
        onCommandResults?: (world: World, results: CommandResult[], event?: SystemEvent) => Promise<any>;
        onEnemyStrategyDetected?: (world: World, data: EnemyStrategyDetected, event?: SystemEvent) => Promise<any>;
        onEnemyRaceDetected?: (world: World, race: SC2APIProtocol.Race, event?: SystemEvent) => Promise<any>;
}
```

`onBuildingConstructionStarted` fires when a new own structure appears unfinished, `onBuildingConstructionComplete` when one finishes or a new one appears already finished. The python-sc2 equivalents are `onStructureConstructionStarted` (also fires when an own unit turns into an unfinished structure while keeping its tag; on SC2 4.10 a drone's building gets a new tag instead, so for drones it fires alongside `onBuildingConstructionStarted` with the building, and the drone is reported destroyed when the building finishes), `onStructureConstructionComplete` (also for structures first seen finished, such as the starting townhall) and `onUnitSpawned` (own non-structure units, once per tag per game — unlike `onUnitCreated`, which also fires for structures). `onEnemyStrategyDetected` receives `EnemyStrategyDetected` (`{ flag: IntelFlag; gameLoop: number }`) once per flag per game, in the step `intel` first sets it. `onEnemyRaceDetected` receives the `Race` of a random opponent once per game, in the first step an enemy unit is alive, after `agent.opponent.race` is set; it never fires when the race was known at game start. Agent systems get it in that step, the agent's own handler in the next. `onUnitTypeChanged` (own units only) receives `{ unit, previousType }` (morphs, sieging, lowering depots). `onUnitTookDamage` (own units only) receives `{ unit, amount }`, the health and shield lost since the previous frame. Event handlers are called as `(world, data, event)`, where `event` is the raw `SystemEvent` (`name`, `gameLoop`, ...); extra event fields are never spread into further arguments. This includes the agent's own `onStep` (`data` is the game loop) and `onGameStart` (`data` is `null`). The system hooks with their own arguments are the exceptions: a unit system's `onStep(world, units)`, `onNewUnit`, `onUnitIdle`, `onUnitDestroyed` and `idleFunctions` (`(world, unit)`), a build system's `onStep(world, gameLoop, task?, result?)` and `buildComplete(world, gameLoop)`, `onStepPaused(world)`, and `onGameStart(world)` of a system mounted after the game started. `event` is optional in the handler types, so handlers can also be called directly with two arguments. `onEnemyUnitLeftVision` fires for an enemy that was visible last frame and is not now; the unit stays in `units` as a memory (see `unit.isMemory()`). `onCommandResults` receives, the step after each flush of proposed commands, one entry per (proposal, outcome):
```ts
CommandResult {
    owner: string; // the proposing commander
    command: SC2APIProtocol.ActionRawUnitCommand; // as proposed
    tags: string[]; // the units this outcome covers
    outcome: 'won' | 'dropped' | 'rejected';
    reason?: 'outranked' | 'repeat' | 'not-owner'; // dropped only; 'not-owner': the unit's role is exclusive
    by?: string; // dropped: the winning owner, or for 'not-owner' the owning 'role:<ROLE>'
    result?: SC2APIProtocol.ActionResult; // won: SUCCESS; rejected by SC2: its code
    error?: string; // rejected because the request failed
}
```

As you can see, event handlers accept the `World` context as the first argument and some optional event-related data as the second argument. Unlike regular javascript event handlers, which are independent, `node-sc2` event handlers *can create backpressure*. This is a good thing, and is why they are expected to return a promise. Backpressure allows you to run your event handlers with a guarantee that they will complete *before the game step increments*. The easiest way to ensure this is simply implementing the handler as an async function, like the following:
```js
{
    async onStep(world, gameLoop) {
        // ...
    }
}
```

Then within the function body, make sure to `return` or `await` any asynchronous actions. Of course, if your function is not doing any asynchronous work, it won't matter either way. But keeping to this convention will ensure determinism throughout your systems.

As a final note, if you purposely have some extended calculation to do, or you *want* a function to run across multiple loops, you *can* leave a promise dangling on purpose (not awaiting or returning it). Just make sure to implement some sort of locking mechanism into your system state so you don't pile up multiple invocations on the stack (or at least debounce / have some maximum concurrency).

## World
The `World` is the context of a single game of Starcraft 2. It's defined like this:
```ts
World { agent: Agent, data: DataStorage, resources: ResourceManager, config: Readonly<CoreConfig> }
```
`world.config` is the frozen config the engine resolved (see `createEngine`): `CoreConfig { gameStep: number; features: { chatDebug: boolean; eagerMapAnalysis: boolean }; resources: ResourceSettings }`, defaults `4`, `false`, `true` and `{}`. `ResourceSettings` maps a resource name to the settings type of its `configure`. `CoreConfig` is an interface, so other packages can add their own top-level sections by declaration merging; core keeps them unvalidated. The registry passes `config.resources.<name>` to that resource's `configure` after creating it and after every `resources.reset`, and warns once for a section whose resource has no `configure`.
The `world` context is given as the first argument of every event consumer handler, and therefore available in any invokable part of your agent and/or systems. The easiest way to utilize it is via destructuring. Here is an example of a system logging the agent's race:

```js
    onGameStart({ agent }) {
        console.log(`My race this game is ${agent.race}`);
    }
```

### *`world.resources.register<K>(definition: ResourceDefinition<K>) => NonNullable<ResourceContainer[K]>`*
Creates and stores a resource from `{ name: K, create(world), reset?(resource, world), onStep?(resource, world), onGameEnd?(resource, world, results) }` and returns it. Registering the same definition object again returns the existing resource, so it is safe from a system's `setup`; another definition under a taken name throws `NodeSC2Error`. Type the resource by augmenting `interface ResourceContainer` in `declare module '@sc-bot/core/types'`.

### *`world.resources.endGame(world: World, results: SC2APIProtocol.PlayerResult[]) => void`*
Runs every registered definition's `onGameEnd(resource, world, results)` synchronously, in registration order. A throwing hook is logged and the next one still runs. The engine calls it when a game ends, before `createEngine`'s `onGameEnd` option; a game that crashes or loses its connection (`ConnectionClosedError` or an unknown error) never reaches it. Hooks must be synchronous.

### *`world.resources.reset(world: World) => void`*
Resets every registered resource in registration order, in place: its `reset` when given, otherwise `Object.assign(resource, create(world))`. The engine calls it when another game starts on the same engine. Resources added with `resources.set()` are left alone.

## Unit
A unit is a special type of object that represents a unit in game. Units implement the following properties:

```ts
{
    noQueue: boolean;
    lastSeen: number;
    /**
     * these properties are implemented from `SC2APIProtocol.Unit`
     */
    displayType?: DisplayType;
    alliance?: Alliance;
    tag?: string;
    unitType?: number;
    owner?: number;
    pos?: Point;
    facing?: number;
    radius?: number;
    buildProgress?: number;
    cloak?: CloakState;
    detectRange?: number;
    radarRange?: number;
    isSelected?: boolean;
    isOnScreen?: boolean;
    isBlip?: boolean;
    isPowered?: boolean;
    health?: number;
    healthMax?: number;
    shield?: number;
    shieldMax?: number;
    energy?: number;
    energyMax?: number;
    mineralContents?: number;
    vespeneContents?: number;
    isFlying?: boolean;
    isBurrowed?: boolean;
    orders?: Array<UnitOrder>;
    addOnTag?: string;
    passengers?: Array<PassengerUnit>;
    cargoSpaceTaken?: number;
    cargoSpaceMax?: number;
    buffIds?: Array<number>;
    assignedHarvesters?: number;
    idealHarvesters?: number;
    weaponCooldown?: number;
    engagedTargetTag?: string;
}
```

Units also implement the following methods:
```ts
unit.is(unitType), isWorker(), isTownhall(), isStructure(), isGasMine(), isMineralField(), isCombatUnit()
unit.isEnemy(), isFinished(), isCurrent(), isCloaked(), isHolding(), isConstructing(), isFlyingOrGravitoned()
unit.hasReactor(), hasTechLab(), canShootUp(), canInject(), canBlink(), canMove()
unit.inject(target?), blink(target, opts?), burrow(opts?), toggle(opts?) // => Promise<void>, proposed like actions.do
unit.addLabel(name, value), hasLabel(name), getLabel(name), removeLabel(name), hasNoLabels()
unit.data(), typeData(unitType), getLife() // getLife is health as a percentage
```

The following predicates and helpers follow python-sc2's `Unit`:
```ts
// state
unit.isIdle(), isMoving(), isAttacking(), isPatrolling(), isRepairing(), isCollecting()
unit.isGathering(type?), isReturning(), isCarryingMinerals(), isCarryingVespene(), isCarryingResource()
unit.isConstructingScv(), isTransforming(), isUsingAbility(abilityIds)
unit.isSnapshot(), isMemory() // memory = not seen this frame
unit.age() => number // seconds since last seen
// attributes
unit.isLight(), isArmored(), isBiological(), isMechanical(), isMassive(), isPsionic()
// buffs and add-ons
unit.buffs() => Set<number>; unit.hasBuff(buffId) => boolean
unit.hasAddOn(), addOnPosition(), addOnLandPosition()
unit.surplusHarvesters() => number // assigned minus ideal
// combat
unit.groundDps(), airDps(), groundRange(), airRange(), sightRange(), movementSpeed()
unit.realSpeed() // movement speed with upgrades, creep and speed-changing buffs
unit.weaponReady()
unit.distanceToWeaponReady() // realSpeed() / 16 * weaponCooldown: how far it moves before its weapon is ready
unit.targetInRange(target, bonusDistance = 0), inAbilityCastRange(abilityId, target, bonusDistance = 0)
unit.calculateDamageVsTarget(target, ignoreArmor?, includeOverkillDamage?) => [damage, weaponSpeed, weaponRange]
unit.calculateDpsVsTarget(target, ignoreArmor?, includeOverkillDamage?) => number
unit.isFacing(other, angleError?) => boolean
// abilities and commands
unit.availableAbilities(), abilityAvailable(abilityId) // from this loop's ability query
unit.fetchAvailableAbilities() => Promise<number[]> // queries SC2, cached per game loop
unit.useAbility(abilityId, { target?, queue? }) => Promise<void> // proposes, like actions.do
```
With the agent setting `skipAvailableAbilitiesQuery`, the synchronous accessors return only what `fetchAvailableAbilities()` fetched this loop.
Buff time is exposed as the properties `buffDurationRemain` and `buffDurationMax`, and upgrade levels as `attackUpgradeLevel`, `armorUpgradeLevel` and `shieldUpgradeLevel`.

Deliberate differences from python-sc2 (off-creep speed, blue flame, the snapshot fallback's cell, ...) are listed in the [readme](../readme.md#where-this-library-differs-from-python-sc2).

Units also have a `labels` property which is used to store additional flags and component meta data. It works very much like the `Map` interface and implements `set`, `get`, and `has`.

## Units
Every `units.*` getter returns a `Units`, a subclass of `Array<Unit>` exported from `@sc-bot/core`. It is assignable anywhere a `Unit[]` is expected. `filter`, `slice`, `concat`, `splice`, `reverse` and `sort` return a `Units` again, so calls chain. `map` and `flatMap` return a `Units` only when the callback returns units (`units.map(unit => unit.tag)` is a plain `string[]`). `Units.from(unitArray)` wraps a plain array:
```js
const nearbyIdle = units.getWorkers().idle.closerThan(10, map.getMain().townhallPosition);
```
Where a `position` is taken it is either a `Unit` or a `Point2D`.

```ts
// properties
units.amount: number; empty: boolean; exists: boolean; first: Unit; random: Unit; center: Point2D; tags: Set<string>
units.ready, notReady, idle, flying, notFlying, structures, notStructures, selected, visible
units.mineralFields, gathering, returning, collecting, preferIdle // each returns Units
// selection
units.copy(), union(other), intersection(other), difference(other)
units.findByTag(tag) => Unit | undefined; byTag(tag) => Unit // throws if missing
units.take(count), randomGroupOf(count), randomOr(fallback)
units.sorted(key, reverse = false)
units.tagsIn(tags), tagsNotIn(tags)
units.ofType(types), excludeType(types), sameTech(types), sameUnit(types)
// distance
units.closestTo(position), furthestTo(position)
units.closestDistanceTo(position), furthestDistanceTo(position)
units.closerThan(distance, position), furtherThan(distance, position)
units.inDistanceBetween(position, min, max)
units.closestNUnits(position, count), furthestNUnits(position, count)
units.nClosestToDistance(position, distance, count), nFurthestToDistance(position, distance, count)
units.inDistanceOfGroup(other, distance), inClosestDistanceToGroup(other)
units.sortedByDistanceTo(position, reverse = false)
units.inAttackRangeOf(unit, bonusDistance = 0)
```
`first`, `random`, `center`, `closestTo`, `furthestTo`, `closestDistanceTo`, `furthestDistanceTo` and `inClosestDistanceToGroup` throw on an empty collection; check `exists` first, or use `randomOr`. `inDistanceOfGroup` and `inClosestDistanceToGroup` also throw when `other` is empty. `nClosestToDistance` / `nFurthestToDistance` sort ascending by how far each unit's distance is from the given distance.

Because the getters (and a `map` of their results to units) return `Units`, `toStrictEqual` / `deepStrictEqual` against a plain array fail (different prototype); `toEqual` works.

## Expansion
An expansion is a special type of object that represents an area and the surrounding region where a townhall can be placed and resources mined. It is a simple type of region decomposition. An expansion has the following properties:

```ts
    areas: {
        areaFill: Array<Point2D>; // every coordinate in the expansion
        placementGrid: Array<Point2D>; // coordinates free to be placeable (1x1)
        mineralLine: Array<Point2D>; // coordinates considered to be in the mineral line
        behindMineralLine: Array<Point2D>; // cooordinates considered to be behind the mineral line
        hull: Array<Point2D>; // the outline of the expansion area
        wall?: Array<Point2D>; // the cells of a wall-off; only computed for your natural, [] when none fits
    };
    cluster: {
        centroid: Point2D; // the average center point of the mineral fields
        // @FIXME: these currently do not update properly throughout the game
        mineralFields: Unit[], // an array of the mineral fields
        // @FIXME: these currently do not update properly throughout the game
        vespeneGeysers: Unit[], // an array of the vespene geysers
    };
    townhallPosition: Point2D; // the optimal placement position for a townhall building
    zPosition: number; // the z-height of the expansion
    centroid: Point2D; // the average center point of *all* expansion coordinates
    pathFromMain: Path; // a 2D array representing a path from the player's main base to this expansion
    pathFromEnemy: Path; // a 2D array representing a path from the enemy's main base to this expansion
    labels: Map<string, any>;
```

Expansions also have the following methods:
```ts
expansion.getBase() => Unit | undefined; // the base currently occupying the expansion, if any
expansion.getAlliance() => SC2APIProtocol.Alliance; // the alliance who owns the expansion currently, NEUTRAL when nobody (or its base died)
expansion.getWall() => Point2D[]; // areas.wall, or [] when there is none
```

## Resources
Resources in `node-sc2` are objects that manage and expose various parts of the API, shared between all agents and systems. The `resources` instance of the `ResourceManager` exposed from the `world` context likely has only 1 method you'll use, that is, `get()`. This method exposes all resources and is suggested to be used via destructuring. Here is an example, showing all available built-in resources:

```js
    onStep({ resources }) {
        const { actions, events, frame, map, units, debug } = resources.get();
    }
```

This way you can simply destructure whatever resources you need for a certain routine. Now we'll go over each of the resources in detail.

### frame
The `frame` resource represents the current underlying game frame data. It has a number of methods that act as synchronous accessors to this raw data.

#### *`frame.getObservation() => SC2APIProtocol.Observation`*
The raw observation data. Most of this is digested and made available in more useful interfaces.
#### *`frame.getGameInfo: () => ResponseGameInfo;`*
The raw `gameInfo`, currently only updated at the start of the game.
#### *`frame.getGameLoop: () => number;`*
The current `gameLoop` interval. Systems' `onStep` receives the same value as its second argument.
#### *`frame.getMapState: () => SC2APIProtocol.MapState;`*
This includes the `ImageData` for visibility and creep.
#### Score, alerts and timing
```ts
frame.getScore() => SC2APIProtocol.Score // needs `score: true` in the agent's `interface` (the default has it)
frame.getAlerts() => SC2APIProtocol.Alert[]; frame.hasAlert(alert) => boolean
frame.getActionErrors() => SC2APIProtocol.ActionError[] // commands SC2 rejected last step
frame.getEffects() => SC2APIProtocol.Effect[]
frame.time() => number // game seconds
frame.timeFormatted() => string // 'MM:SS'
frame.timeInSeconds() => number // rounded seconds (node-sc2's formula)
frame.getPrevious() => GameFrame // the previous frame's game loop
frame.getRender(), frame.getFeatureLayer() // raw render / feature-layer data, when enabled in the agent's `interface`
frame.getStepTime() => { min, avg, max, last } // ms spent in the agent's `onStep` handler
```

### units
Most things in the game are represented by a `Unit`, therefore this is a very important resource that you will use regularly.

One thing to keep in mind, is that most (if not all) unit methods will take either an `Alliance` enum value (eg: `Alliance.SELF`) or a more complex filter object, based on unit data. For instance, `units.getAlive({ isFlying: true })` will return an array of all living units that are flying.

#### *`units.clone() => Map<string, Unit>`*
This returns a deep clone off all units, minus any methods (data only). You will likely never need this, unless you need to do some destructive transforms to be able to process data (possibly for combat simulation?). The string keys on the `Map` returned are the unit tags. Try to avoid it where possible as it could have some significant overhead later in the game.

#### *`units.getAll(filter?: (number | UnitFilter | ((unit: Unit) => boolean))) => Units`*
Returns *all* units, based on filter, or literally *all units* if no filter is given. Please note that *all* means *all*. That includes neutral units, snapshot units, enemies kept as memory, and own and neutral units that died (labelled `dead`) or left the observation. Dead enemies are removed once SC2 reports their death. You generally don't want to use this method without giving a filter. The filter can be an Alliance value, an object to compare units against, or a predicate.

#### *`units.getAlive(filter?: (number | UnitFilter)) => Units`*
Like `getAll` but only returns units that are *current*. Current means the unit data was available in the current frame. This is slightly different than literally 'alive', as your enemy units won't be current unless they are currently visible. It *will* return snapshots as long as those snapshots are current.

#### *`units.getBases(filter = { alliance: Alliance.SELF }) => Units`*
Returns the current townhalls matching the filter (an `Alliance` value or a filter object). Defaults to your own.

#### *`units.getById(unitTypeId: number | number[], filter = { alliance: Alliance.SELF }) => Units`*
Returns all units of a `unitType`. `unitType`'s can be retrieved from constants:

```js
import { ZEALOT } from '@sc-bot/core/constants/unit-type';

// ...
{
    onStep({ resources }) {
        const { units } = resources.get();
        const zealots = units.getById(ZEALOT);
    }
}
```

This is *similar* to `getByType` but not the same. This method accepts a filter as a second argument and defaults to your own units; passing a filter replaces that default, so include `alliance` in it if you still want only your own. `getByType` matches every alliance and does not accept a filter.

#### *`units.getByTag(unitTags: string) => Unit | undefined`*
#### *`units.getByTag(unitTags: string[]) => Units`*
Returns `Unit` (or `undefined` for an unknown tag) if given a `tag`. Returns `Units` if given `tag[]`, leaving out unknown tags. Unit tags are string representations of the unique unit id, available on `unit.tag`.

#### *`units.getByType(unitType | unitType[]) => Units`*
Similar to `getById`, but without a filter. Returns all live units of any alliance that match any of the given types.

#### *`units.getCombatUnits(filter = Alliance.SELF) => Units`*
Returns all living combat units, your own by default. Basically a shortcut to get your whole army. Think F2.

#### *`units.getClosest(pos: Point2D, units: Unit[], n?: number) => Units`*
Given a `Point2D` (`{ x, y }`), an array of units, and an optional number `n`, returns the closest `n` units to the point. Default of `n` is 1. Always returns a `Units` collection (empty when `units` is). It also accepts an array of power sources (`agent.powerSources`).

#### *`units.getProductionUnits(unitTypeId: number) => Units`*
Given a `unitType`, returns all of your living units that can produce that `unitType` (eg: give it `MARINE` to get your barracks). Enemy buildings are never included.

#### *`units.getUpgradeFacilities(upgradeId: number) => Units`*
Given an `upgrade`, returns all of your living units that can research that `upgrade` (eg: given `CHARGE`, your twilight councils).

#### *`units.getMineralFields(filter?: UnitFilter) => Units`*
Returns all mineral fields across the entire map.

#### *`units.getGasGeysers(filter?: UnitFilter) => Units`*
Returns all vespene geysers across the entire map.

#### *`units.getStructures(filter = { alliance: Alliance.SELF }) => Units`*
Returns the living units with the `structure` attribute, your own by default.

#### *`units.getWorkers(includeBusy = false) => Units`*
Returns all own living workers of your race. By default, leaves out workers that `actions.build` sent off until SC2 reports their order back (or 250 game loops pass).

#### *`units.getIdleWorkers() => Units`*
Returns all own living workers with no orders.

#### *`units.getMineralWorkers() => Units`*
Returns all own living workers that:
- have exactly one order, and it is a gather order (gas workers included)
- carry no labels (so no unacknowledged command)

#### *`units.inProgress(unitTypeId: number) => Units`*
Returns units of the given `unitType` which are not "finished" (eg: buildings being constructed / morphed / warped).

#### *`units.withCurrentOrders(abilityId: number) => Units`*
Returns your own living units with the given `ability` somewhere in their order queue. Useful for seeing if you've already given a certain command (like to build something) in a very recent frame.

#### *`units.withLabel(label: string) => Units`*
Returns the living units with a given label (see `unit.addLabel` and the `labels` map under Unit).

#### Additional getters
```ts
units.getEnemyUnits() => Units // non-structure enemies
units.getEnemyStructures() => Units
units.getDestructables() => Units // neutral, excluding minerals, geysers and xel'naga towers
units.getWatchtowers() => Units
units.getLarva() => Units
units.getGasMines(filter = Alliance.SELF) => Units
units.getIdle() => Units // own units with an empty order queue
units.getRangedCombatUnits() => Units
units.getUnfinished(filter?) => Units
units.getConstructingWorkers() => Units
units.getPendingAt(unitType | unitType[], pos, maxDistance = 1) => Units // unfinished units of those types near pos, plus workers ordered to build one there
```
#### *`units.getArmyValue(alliance?: Alliance.SELF | Alliance.ENEMY, opts?: { includePending?: boolean; includeGhosts?: boolean }) => number`*
Minerals plus gas of the combat units (`isCombatUnit()`), each at its type's full cost. `alliance = Alliance.SELF`, `includePending = false`, `includeGhosts = true`. `ENEMY` reads `memory.getEnemies({ includeGhosts })`; `SELF` with `includePending` also counts units in production (finished non-townhall structures' orders, two with a reactor, and eggs). Throws `NodeSC2Error` for any other alliance.

Enemy units that leave vision are kept in `units` with their last known state, as ghosts. `getAll(Alliance.ENEMY)` includes them, `getAlive` does not; use `unit.isMemory()` and `unit.age()` to tell them apart. Ghosts expire after 30 seconds by default, or earlier when their last position is visible again (see `memory`).

### map
The `map` resource represents everything related to positioning of the game world. It contains data and methods pertaining to the map size and state, self and enemy locations, expansions, and pathing.

#### map.getLocations() => Locations;
Returns the starting locations of the player and enemy:
```js
locations = {
    self: Point2D;
    enemy: Point2D[]; // possible enemy start locations
}
```

#### map.getExpansions(alliance?: Alliance) => Expansion[];
Returns all expansions on the map in order of distance from alliance. By default, will return them in order from your starting position. If given `Alliance.ENEMY`, will return them in the order from the enemy main. This allows for simple destructuring such as:

```js
const [main, natural] = map.getExpansions();
// or...
const [enemyMain] = map.getExpansions(Alliance.ENEMY);
```

The following related convenience functions also exist to get common expansion locations:
```ts
map.getMain() => Expansion;
map.getEnemyMain() => Expansion;
map.getNatural() => Expansion;
map.getEnemyNatural() => Expansion;
map.getThirds() => Expansion[];
map.getEnemyThirds() => Expansion[];
```
Note that `getThirds` and `getEnemyThirds` return up to two expansions (fewer on maps with less than four bases). This is because on *most* maps, third and fouth bases are fairly interchangeable. The first expansion in the array will be the closer one, however.

#### map.getClosestExpansion(point: Point2D) => Expansion;
Given a point, returns the closest expansion.

#### map.getAvailableExpansions() => Expansion[];
Returns all expansions that have not been (knowingly) taken, in order from the players perspective.

#### map.getOccupiedExpansions(alliance?: Alliance) => Expansion[];
Given an alliance, returns all expansions that have been taken by that alliance.

#### map.getGrids() => Grids;
Returns a grids object containing 2D arrays of datas:
```ts
grids = {
    miniMap: Grid2D;
    placement: Grid2D;
    pathing: Grid2D;
}    
```
```ts
grids.height: Grid2D;
```
Placement, pathing and height grids are the same as provided by the API. `miniMap` is an experimental grid containing minimap-like data.

#### map.path(start: Point2D, end: Point2D) => Path;
Given a start and end point as coordinates, does an A* search and returns the resulting path as a 2D array of sets of coordinates. Returns an empty array if pathing is impossible. The path graph also blocks the cells the map system marks unplaceable (structures, minerals, geysers, rocks, xel'naga towers), so an `end` on such a cell, or a `start` surrounded by them (such as `townhallPosition` of an occupied base), gives an empty path; start from a unit's `pos` or `map.closestPathable(point)`. NOTE: this is *not* the same as querying the API, this is significantly faster (exponentially) and done synchronously. It cannot, however, take into account any information about the map or paths not known to the system. For cost-aware paths around enemy threats, use `pathing` instead.

#### Ramps and walls
```ts
map.getRamps() => Ramp[]
map.getMainBaseRamp() => Ramp | undefined // the ramp leading out of the start location; undefined when none is found
map.getVisionBlockers() => Point2D[]
```
A `Ramp` has `points`, `upper`, `lower`, `topCenter`, `bottomCenter` and `size`, plus wall helpers that return `null` (or `[]`) on ramps that do not fit the standard wall shapes:
```ts
ramp.upper2ForRampWall: Point2D[]
ramp.depotInMiddle / barracksInMiddle: Point2D | null
ramp.cornerDepots: Point2D[] // the two depots of a terran wall
ramp.barracksCanFitAddon: boolean
ramp.barracksCorrectPlacement: Point2D | null // leaves room for an add-on when possible
ramp.protossWallPylon / protossWallWarpin: Point2D | null
ramp.protossWallBuildings: Point2D[]
```
`barracksCanFitAddon` throws on a ramp without the standard shape, and `cornerDepots` on a ramp with a single upper cell. On a standard-sized ramp whose upper cells are too far apart, `barracksInMiddle`, `barracksCorrectPlacement` and the Protoss wall positions throw (python-sc2 asserts), while `depotInMiddle` is `null` and `cornerDepots` `[]`.

#### Terrain and grids
```ts
map.getExpansionLocations() => Point2D[] // every possible townhall location
map.getTerrainHeight(point) => number // height-map value
map.getTerrainZHeight(point) => number // world z
map.inPathingGrid(point), map.inPlacementGrid(point) => boolean // static, from game info
map.queryPathing(start: Point2D | Unit, end: Point2D) => Promise<number | null> // engine path length, null if unreachable
```
`PixelMap` (exported from `@sc-bot/core`) wraps an SC2 `ImageData`, e.g. `new PixelMap(gameInfo.startRaw.pathingGrid)`, with `get`, `set`, `isSet(point)`, `isEmpty(point)`, `copy()`, `floodFill(start, predicate)` and `floodFillAll(predicate)`. Points must be integer and inside the map; otherwise it throws a `TypeError` or `RangeError`. `Ramp` is exported too.

### actions
The action manager resource is the main way to interact with the API via commands (actions or queries).

The unit command methods below resolve with no value once the command is proposed; they don't wait for SC2. The engine arbitrates all proposals per unit at the end of the step and sends one request (see [Arbitration](#arbitration)). They still reject at once when their preconditions fail; what happened to the command arrives the next step as a `commandResults` event.

#### *`actions.attack(units?: Unit[], unit?: Unit, queue?: boolean) => Promise<void>`*
Command one or more units to attack another unit. `queue = false`. Rejects with `ActionManagerError` when the target unit is missing. An empty or missing unit list proposes nothing.

#### *`actions.attackMove(u?: Unit[], p?: Point2D, queue?: boolean) => Promise<void>`*
Command one or more units to move and attack to a position. Without `p`, the first possible enemy start location is used; rejects with `ActionManagerError` when neither is available. An empty unit list proposes nothing. `queue = false`.

#### *`actions.build(unitType: number, target?: Unit, worker?: Unit) => Promise<void>`*
#### *`actions.build(unitType: number, pos?: Point2D | null, worker?: Unit) => Promise<void>`*
Command a given worker to build a `unitType` on either a position or a target unit. If no worker is given and `mining` is enabled, `mining.selectWorker(position, { forceClose: true, role: GATHERING })` picks a mining worker near the site; otherwise the least busy, closest worker is selected. The worker gets the `command` label right away; if the build is dropped or SC2 rejects it, the label is removed again during the flush. A gas building is followed by a queued `gather` from the same commander. Nothing is refunded for a build that isn't sent.

Rejects with `BuildError` (with `err.data`) if the player is missing the necessary tech, can not afford it, gave a target the build ability doesn't accept (or none where one is required), or no builder is found.

#### *`actions.do(abilityId: number, tags: string | string[], opts?: AbilityOptions) => Promise<void>`*
Command one or more units to do an ability, optionally on a target unit or point (`opts = { target?, queue? }`, `queue = false`; any other `target` value is ignored). An empty tag list proposes nothing.

#### *`actions.buildGasMine() => Promise<void>`*
Will build an assimilator, refinery, or extractor on an open geyser in an existing expansion. Rejects with `BuildError` (with `err.data`) if there are no free geysers on any owned expansions.

#### *`actions.gather(unit: Unit, mineralField?: Unit, queue?: boolean) => Promise<void>`*
Given a worker unit and optionally a specific `mineralField`, commands the unit to gather minerals. When not given a target `mineralField`, it picks the closest finished own base that is below its ideal harvester count (or the closest base), and of that base's three nearest mineral fields the one closest to the worker. Rejects with `GatherError` for a unit that isn't a worker or MULE, or when there is no finished own base to mine at. `queue = true`, so it is safe to give after another command to a worker, or to all workers `onUnitIdle`; a worker with the `command` label is always queued.

#### *`actions.mine(units: Unit[], target: Unit, queue?: boolean) => Promise<void>`*
Like `gather`, but for mining gas. Must be given the target gas building. `queue = true`.

#### *`actions.move(units: Unit | Unit[], target: Point2D | Unit, queue?: boolean) => Promise<void>`*
Commands units to move to a target position or target unit. `queue = false`.

#### *`actions.smart(units: Unit[], target: Point2D | Unit, queue?: boolean) => Promise<void>`*
Right-click. `queue = false`.

#### *`actions.patrol(units: Unit | Unit[], positions: [from: Point2D, to: Point2D] | Point2D, queue?: boolean) => Promise<void>`*
Proposes a move to `from` (default: the first unit's position), then a queued patrol to `to`, from the same commander.

#### *`actions.stop(units: Unit | Unit[], queue?: boolean) => Promise<void>`*
#### *`actions.holdPosition(units: Unit | Unit[], queue?: boolean) => Promise<void>`*
#### *`actions.returnResource(units: Unit | Unit[], queue?: boolean) => Promise<void>`*
#### *`actions.repair(units: Unit | Unit[], target: Unit, queue?: boolean) => Promise<void>`*
Shortcuts for `do` with the matching ability. `queue = false`. Like every high-level command method (`move`, `smart`, `patrol`, `mine`, ...), they resolve without proposing anything for an empty unit list.

#### *`actions.train(unitType: number, unit?: Unit) => Promise<void>`*
Given a `unitType` and, optionally, a production unit, orders a new unit from that facility.
If no production unit is given, it looks up a facility that is both capable of training the given `unitType` *and* does not currently have a queue. If the player does not have the tech, can not afford the unit, or there is no free production facility, it rejects with `TrainError`.

#### *`actions.upgrade(upgradeId: number, unit?: Unit) => Promise<void>`*
Given an upgrade and, optionally, a research facility, orders the research from that facility.
If no research facility is given, it looks up a facility that is both capable of researching the upgrade *and* does not currently have a queue. Rejects with `TrainError` when there is none.

#### *`actions.warpIn(unitType: number, opts?: WarpInOptions) => Promise<void>`*
Warps in up to `maxQty` units at distinct free points of a power field near `nearPosition` (`opts = { nearPosition?, maxQty?, highground? }`). Rejects with `ActionManagerError` when nothing is affordable, no warp gate is ready, or no point is free.

#### *`actions.swapBuildings(unitA: Unit, unitB: Unit) => Promise<void>`*
Rejects with `ActionManagerError` if either building can't lift or isn't finished; otherwise calls [`flying.swap(unitA, unitB)`](#flying) and resolves with no value. The lifting, flying and landing happen over the following steps under the `flying` commander; nothing is sent by this call.

#### *`actions.toggleAutocast(units: Unit | Unit[], abilityId: number) => Promise<SC2APIProtocol.ResponseAction>`*
Sent immediately.

#### *`actions.chatSend(message: string, teamOnly?: boolean) => Promise<SC2APIProtocol.ResponseAction>`*
Sent immediately. `teamOnly = false`.

#### *`actions.surrender() => Promise<unknown>`*
Leaves the game and resolves with the leave-game response; `runGame` resolves with `DEFEAT`.

#### *`actions.canPlace(unitType: number, positions: Point2D[]) => Promise<Point2D | false>`*
For a grid-only check of one position without a query, see [`placement.canPlace`](#placement).
Given a `unitType` and an array of positions, queries the game to check placability (of at most 10 positions, sampled randomly from longer lists). Returns either *a random position which returned a success*, or false.

#### *`actions.findPlacement(unitType: number, near: Point2D, options?: FindPlacementOptions) => Promise<Point2D | false>`*
For Terran and Protoss, [`placement.request`](#placement) returns precomputed spots with flags and reservations.
Returns `near` itself when `unitType` can be placed there, otherwise searches outward in square rings `placementStep` apart and returns a position from the first ring with valid spots, or false.
```js
options = {
    maxDistance: 20,
    randomAlternative: true, // pick randomly among the valid spots of that ring; false picks the closest
    placementStep: 2,
    addonPlace: false, // also require room for an add-on (terran production)
}
```

#### Arbitration
Each proposal carries the current commander, `{ owner, priority, rank }` (`CommandContext`): the agent's handlers run as `{ owner: 'agent', priority: settings.commandPriority ?? 0, rank: -1 }`, each agent system as `{ owner: name, priority: commandPriority, rank: <index in agent.use() order> }`, anything else as `{ owner: 'unknown', priority: 0, rank: Infinity }`. Per unit tag, the highest priority wins, ties go to the lowest rank. The winner keeps all its commands for that tag in proposal order; every other owner's are dropped (`reason: 'outranked'`). A command repeating the unit's current order (same ability and target, not queued) is dropped (`reason: 'repeat'`). Tags whose only command is identical (ability, target, queue flag) are merged into one command. Commanders are tracked with `AsyncLocalStorage`; importing the package turns on Bluebird's `asyncHooks` process-wide so Bluebird callbacks keep theirs (about 0.1 ms per step).

#### *`actions.as<T>(context: Partial<CommandContext>, fn: () => T) => T`*
Runs `fn` with the current commander overridden by `context`. Everything `fn` proposes, including after `await`s, belongs to that commander.

#### *`actions.queueAction(commands: ActionRawUnitCommand | ActionRawUnitCommand[], opts?: { onNotSent?: (tags: string[], result: CommandResult) => void }) => void`*
Proposes raw unit commands under the current commander. Throws `ActionManagerError` for a command with empty or missing `unitTags`. `onNotSent` is called during the flush with the proposal's tags that were dropped or rejected, before the `commandResults` event is written.

#### *`actions.flushQueuedActions() => Promise<SC2APIProtocol.ResponseAction | undefined>`*
Arbitrates and sends the proposals now (the engine calls it after all agent systems). Writes a `commandResults` event with a `CommandResult` per (proposal, outcome) when there were proposals, and resolves with SC2's response, or `undefined` when nothing was sent. Rejects when the request fails, after reporting every proposal in it as `rejected` with `error`. A result other than success is logged on `sc2:debug:actionManager`.

#### *`actions.clearQueuedActions() => void`*
Discards the proposals and forgets the units committed this observation.

#### *`actions.unitTagsReceivedAction() => Set<string>`*
The tags proposed or sent for the current observation, by any commander.

#### *`actions.sendAction(unitCommand: ActionRawUnitCommand) => Promise<SC2APIProtocol.ResponseAction>`*
#### *`actions.sendAction(unitCommand: ActionRawUnitCommand[]) => Promise<SC2APIProtocol.ResponseAction>`*
Sends raw unit commands immediately and resolves with the response. Their tags count as committed under the current commander for the rest of the observation: a proposal from another commander is dropped unless it strictly outranks the sender; the sender's own follow-ups still go out. Not reported in `commandResults`.

#### *`actions.sendQuery(query: SC2APIProtocol.RequestQuery) => Promise<SC2APIProtocol.ResponseQuery>`*
A lower level interface to send arbitrary queries (such as `pathing`, `abilities`, or `placements`). Given a `RequestQuery`, returns a `ResponseQuery`.

### debug
```ts
debug.createUnit({ unitType, quantity?, pos?, playerId? } | [...]), killUnit(units), setUnitValue(units, unitValue, value)
debug.showMap(), controlEnemy(), food(), free(), allResources(), god(), minerals(), gas()
debug.cooldown(), techTree(), upgrade(), fastBuild() // the game's debug cheats
debug.moveCamera(unitOrPoint)
debug.drawBox(min, max, color?) // one frame
debug.quickSave(), quickLoad()
debug.useDebugWidget(id, data, { title? }) // a line in the on-screen debug widget, keyed by id
```
Drawing helpers (`setDrawCells`, `setDrawSpheres`, `setDrawLines`, `setDrawTextWorld`, `setDrawTextScreen`) are unchanged.

#### Chat commands
With `features.chatDebug` on (default off), the engine mounts a system that reads the agent's own chat (`chat.playerId === agent.playerId`); other players' chat and non-commands are ignored. Case-insensitive; it sends debug requests and chat replies, never unit commands. A bad command (usage, count that isn't a positive integer, unknown unit name, bad player id) is answered with `actions.chatSend(error)`.
```text
create | make <count> <UnitType> [playerId]    debug.createUnit at the camera (map centre without one), for playerId or you
kill | destroy <count> <UnitType> [playerId]   debug.killUnit on the first <count> of that type: your units, or the enemy units of playerId; chat reply "Can't find any of those" when none
cooldown                                       debug.cooldown()
food | supply                                  debug.food()
god                                            debug.god()
resources | money                              debug.allResources()
reveal | show | show-map                       debug.showMap()
tech | tech-tree                               debug.techTree()
upgrades                                       debug.upgrade()
```
`<UnitType>` is a unit-type constant name; one trailing `s` is accepted (`marines`).

### memory
Enemy ghosts (`unit.isMemory()`) stay in `units` until memory forgets them. Each step, a ghost older than its expiry is deleted, and so is one whose four surrounding cells are all visible (unless burrowed). A forgotten tag that is seen again doesn't fire `onEnemyFirstSeen` again.

#### *`memory.getGhosts() => Units`*
Enemies out of vision that are still remembered.

#### *`memory.getSnapshots() => Units`*
Current enemy snapshots.

#### *`memory.getEnemies(opts?: { includeGhosts?: boolean; structures?: boolean }) => Units`*
Every known enemy. `includeGhosts = true`, `structures = true`.

#### *`memory.forget(tag: string) => void`*
Deletes the ghost now.

#### *`memory.configure(settings: Partial<MemorySettings>) => void`*
```ts
MemorySettings = {
    expireGround: 30, // game seconds
    expireAir: 30,
}
```
Settings survive a new game on the same engine.

### spatial
A bucket-grid index of enemies (from `memory.getEnemies()`, ghosts included) and alive own units, rebuilt on the first query of each game loop. `SpatialKind` is `'enemy' | 'enemyGround' | 'enemyAir' | 'own' | 'ownGround' | 'ownAir'`; ground and air are split by `isFlying`, so landed structures count as ground. Distances are centre to centre. Result order isn't stable: `unitsInRange` returns bucket order, and `closest` breaks ties between equal distances by ring order.

#### *`spatial.unitsInRange(from: Point2D | Unit, distance: number, kind: SpatialKind) => Units`*
The units of that kind within `distance`.

#### *`spatial.anyInRange(from: Point2D | Unit, distance: number, kind: SpatialKind) => boolean`*
Whether there is at least one; stops at the first.

#### *`spatial.closest(from: Point2D | Unit, kind: SpatialKind, maxDistance?: number) => Unit | undefined`*
The closest unit of that kind, within `maxDistance` when given.

### influence
Per-loop danger grids. `InfluenceLayer` is `'ground' | 'air' | 'groundAvoidance' | 'airAvoidance'`. Cells are `1` when free, `Infinity` when blocked, and higher where enemies (ghosts included, changelings and unfinished structures skipped) or effects threaten them; own liberator zones aren't stamped.

#### *`influence.getGrid(layer: InfluenceLayer) => InfluenceGrid`*
Built on the first call of each game loop. `InfluenceGrid` has `layer`, `width`, `height`, `data` (`Float32Array`, index `y * width + x`, read-only by contract) and `get(point)`, which floors the point and returns `Infinity` out of bounds.

#### *`influence.addCost(layers: InfluenceLayer | InfluenceLayer[], center: Point2D, radius: number, weight: number) => void`*
Adds a cost circle (cells at exactly `radius` included) for the rest of the game loop. Cells never drop below `1`, and `costMultiplier` doesn't apply.

#### *`influence.configure(settings: Partial<InfluenceSettings>) => void`*
```ts
InfluenceSettings = {
    rangeBuffer: 4,
    effectsRangeBuffer: 1,
    costMultiplier: 1, // scales built-in sources only
    effects: {}, // { [effectId]: { cost, range } }, merged over the defaults
}
```
Settings survive a new game on the same engine.

#### *`influence.drawDebug(layer: InfluenceLayer, opts?: { threshold?: number }) => void`*
Draws cells above `threshold` (`1`) with their value through `debug.setDrawCells`.

### pathing
A* over an influence layer: 8-connected, diagonals cost √2 times the cell, no corner cutting. `PathOptions` is `{ layer?: InfluenceLayer | InfluenceGrid; sensitivity?: number; maxExpanded?: number }`, with `layer = 'ground'`.

#### *`pathing.findPath(start: Point2D, goal: Point2D, opts?: PathOptions) => Point2D[]`*
Cell centres from `start` (excluded) to `goal`, or `[]` when unreachable or when `maxExpanded` runs out. A blocked goal is moved to the closest open cell within 3; out-of-bounds points are clamped.

#### *`pathing.nextPoint(start: Point2D, goal: Point2D, opts?: PathOptions & { senseDanger?: boolean; dangerDistance?: number; dangerThreshold?: number }) => Point2D`*
`sensitivity = 5`, `senseDanger = true`, `dangerDistance = 20`, `dangerThreshold = 5`. With `senseDanger`, returns `goal` without a search when no cell within `dangerDistance` reaches `dangerThreshold`. Otherwise returns path point `min(sensitivity, length) - 1`, or `goal` when there is no path.

#### *`pathing.closestSafeSpot(from: Point2D, opts?: { layer?: InfluenceLayer | InfluenceGrid; radius?: number }) => Point2D | undefined`*
The cell centre with the lowest finite cost within `radius` (`11`), closest first on ties.

#### *`pathing.isPositionSafe(point: Point2D, opts?: { layer?: InfluenceLayer | InfluenceGrid; limit?: number }) => boolean`*
Whether the cell's cost is at most `limit` (`1`).

### roles
Own units grouped by `UnitRole` (string constants from `@sc-bot/core/constants/unit-role`), one role per unit, kept apart from labels. `onStep` drops dead units and gives each new finished own unit `defaultRole(unit)` once; a cleared role isn't re-defaulted. Units in transports keep their role.

#### *`roles.assign(units: Unit | Unit[] | string | string[], role: UnitRole) => void`*
Replaces any previous role.

#### *`roles.clear(units: Unit | Unit[] | string | string[]) => void`*

#### *`roles.switchRole(from: UnitRole, to: UnitRole) => void`*
Moves every unit of `from` to `to`.

#### *`roles.get(roles: UnitRole | UnitRole[], opts?: { types?: number | number[]; excludeTypes?: number | number[] }) => Units`*
Current, alive own units with any of the roles, filtered by unit type when given.

#### *`roles.roleOf(unit: Unit | string) => UnitRole | undefined`*

#### *`roles.getTags(role: UnitRole) => ReadonlySet<string>`*
The tags with that role, units in transports included.

#### *`roles.as<T>(role: UnitRole, fn: () => T, opts?: { priority?: number }) => T`*
`actions.as({ owner: 'role:<ROLE>', priority }, fn)`. `priority` defaults to the current commander's.

#### *`roles.mayCommand(owner: string, tag: string) => boolean`*
`false` only when the unit's role is in `exclusive` and `owner` isn't `'role:<ROLE>'`. The flush drops such proposals with `reason: 'not-owner'`. `sendAction` and `toggleAutocast` aren't filtered, and a `sendAction` commits the unit to its sender for the rest of the observation.

#### *`roles.configure(settings: Partial<RoleSettings>) => void`*
```ts
RoleSettings = {
    defaultRole: (unit) => unit.isWorker() && unit.unitType !== MULE ? GATHERING : undefined,
    exclusive: [],
}
```
Settings survive a new game on the same engine; roles don't.

### squads
A role's units clustered by distance, lazily: the first `getSquads` call per (role, sorted types) in a game loop clusters, later calls in that loop return the cached squads. The radius isn't part of that key, so use one radius per (role, types). `Squad` is `{ id: string; role: UnitRole; units: Units; tags: ReadonlySet<string>; position: Point2D; isMain: boolean }`; ids are `'<ROLE>-<n>'`, counted per key.

#### *`squads.getSquads(role: UnitRole, opts?: { radius?: number; types?: number | number[] }) => Squad[]`*
`radius = 6`. Units farther than `radius` from their squad's previous centre leave it, at most one pair of squads within `radius` merges (smaller into larger, newer into older on a tie), and the rest join the closest squad within `radius` or start one. `position` is the mean unit position; the main squad has the most units, the oldest on a tie.

#### *`squads.getMainSquad(role: UnitRole, opts?: { radius?: number; types?: number | number[] }) => Squad | undefined`*

#### *`squads.getMainSquadPosition(role: UnitRole, opts?: { types?: number | number[] }) => Point2D`*
The main squad's position, else the last main squad position for that key, else `map.getMain().townhallPosition`.

### intel
Base threats and sticky enemy strategy flags, updated in `onStep`. `IntelFlag` is `'workerRush' | 'lingRush' | 'roachRush' | 'ravagerRush' | 'marineRush' | 'marauderRush' | 'fourGate' | 'proxyZealot' | 'proxy' | 'reaper' | 'expanded' | 'baseOutsideNatural' | 'greedy' | 'rushed'`; the rules are in the readme. The first time a flag is set, intel writes `{ name: 'enemyStrategyDetected', data: { flag, gameLoop } }`.

#### *`intel.getBaseThreats() => BaseThreat[]`*
`BaseThreat` is `{ townhall: Unit; ground: Units; air: Units; groundSupply: number; airSupply: number }`, one per own townhall with tracked enemies. A visible enemy within `groundNearBase` / `airNearBase` joins a base's set; the set clears when the closest enemy of that kind is beyond `groundLeavingBase` / `airLeavingBase` or is a ghost. The units are the tracked enemies still visible; supply is their `foodRequired`, structures excluded.

#### *`intel.getMainThreat(kind: 'ground' | 'air') => BaseThreat | undefined`*
The threat with the most supply of that kind, or `undefined` when none has any.

#### *`intel.has(flag: IntelFlag) => boolean`*

#### *`intel.detectedAt(flag: IntelFlag) => number | undefined`*
The game loop the flag was first set.

#### *`intel.getProxies() => Units`*
Enemy structures, ghosts included, within 100 of your main and more than 60 from the enemy start, excluding creep tumors and gas buildings.

#### *`intel.configure(settings: Partial<IntelSettings>) => void`*
```ts
IntelSettings = {
    groundNearBase: 15,
    airNearBase: 20,
    groundLeavingBase: 24,
    airLeavingBase: 22,
    greedyTwoBaseBefore: 65, // game seconds: 2nd Terran/Protoss townhall started before this
    greedyThreeHatchBefore: 90, // game seconds: 3rd hatchery started before this
}
```
Settings survive a new game on the same engine; flags and threats don't.

### placement
Precomputed Terran and Protoss building spots with reservations; see the readme for the layout. Solved once per game in the first `onStep` that has the expansions, the race and the first map state. For Zerg nothing is solved. Types: `BuildingSize = '2x2' | '3x3' | '5x5'`, `PlacementState = 'available' | 'reserved' | 'taken'`, `PlacementFlag = 'wall' | 'reaperWall' | 'bunker' | 'supplyDepot' | 'production' | 'upgradeStructure' | 'missileTurret' | 'sensorTower' | 'staticDefence' | 'productionPylon' | 'optimalPylon' | 'custom'` (the solver sets `wall`, `bunker`, `productionPylon`, `optimalPylon` and `custom`; the rest are for your own placements), `Placement = { readonly pos: Point2D; readonly size: BuildingSize; readonly base: Point2D; readonly flags: ReadonlySet<PlacementFlag>; readonly state: PlacementState; readonly tag?: string; readonly reservedAt?: number }`, `UserPlacement = { pos: Point2D; size?: BuildingSize; unitType?: number; flags?: PlacementFlag[] }`.

#### *`placement.request(unitType: number, opts?: PlacementRequest) => Point2D | undefined`*
```ts
PlacementRequest = {
    base?: Point2D, // default: map.getMain().townhallPosition; the solved base closest to it is used
    closestTo?: Point2D, // default: the base (for `wall` at your main: the ramp's top)
    flags?: PlacementFlag[], // tried in order; a flag no candidate carries is skipped
    findAlternative: true, // false: only the chosen base, instead of your other occupied bases
    reserve: true,
    powered: false, // Protoss: only spots in range of a pylon
    pylonBuildProgress: 1, // minimum build progress of that pylon
}
```
Returns a spot of the unit type's size (2x2 or 3x3, from its footprint) that is `available` and free on the live grids, or `undefined` (also for Zerg, before the solve, and for other sizes). `reserve` marks it `reserved` until built on, released, or `reservationTimeout` seconds pass.

#### *`placement.reserve(pos: Point2D) => boolean`*
Reserves the `available` spot at `pos`; `false` when there is none.

#### *`placement.release(pos: Point2D) => void`*
Makes the `reserved` spot at `pos` `available`. Does nothing otherwise.

#### *`placement.canPlace(unitType: number, pos: Point2D, opts?: { includeAddon?: boolean }) => boolean`*
Grid check against the live placement and pathing grids, and creep (except for Zerg, hatcheries and nydus canals). `includeAddon` defaults to `true` for barracks, factory and starport. A gas building is placeable when no gas building is within 3.5.

#### *`placement.getPlacements(filter?: { base?: Point2D; size?: BuildingSize; state?: PlacementState; flag?: PlacementFlag }) => Placement[]`*
Frozen copies of the spots that match every given field.

#### *`placement.add(placements: UserPlacement[]) => void`*
Adds spots flagged `custom` (plus their own `flags`). `size` defaults to that of `unitType`, else `'3x3'`. Queued until the solve; a spot that can't be placed, overlaps another or is `5x5` is skipped. `Placer.placements?: (world) => UserPlacement[] | undefined`, set through `resources.set({ placer })`, is added the same way at solve time.

#### *`placement.configure(settings: Partial<PlacementSettings>) => void`*
```ts
PlacementSettings = { reservationTimeout: 60 } // game seconds
```
Settings survive a new game on the same engine; spots don't.

#### *`placement.drawDebug() => void`*
Draws the spots as the debug cell layer `'placement'`.

### buildings
The building tracker; nothing happens until `build` or `buildGas` is called. A build is `{ id, unitType, target, geyserTag?, workerTag?, status, requestedAt, attempts, structureTag?, failure? }` (`TrackedBuild`), with `status` `'moving' | 'ordered' | 'constructing' | 'done' | 'failed'` and `failure` `'timeout' | 'cancelled' | 'noWorker' | 'noPlacement' | 'blocked'`. Commands go out as the `BUILDING` role at `priority`.

#### *`buildings.build(unitType: number, opts?: BuildOptions) => TrackedBuild | undefined`*
```ts
BuildOptions = {
    at?: Point2D | Unit, // a position, or a geyser for a gas building; default: placement.request(unitType, placement)
    placement?: PlacementRequest,
    worker?: Unit, // default: mining.selectWorker(target, { forceClose: true }), else (mining disabled) the closest free mineral worker
    earmark?: string, // earmark kept until the build command is sent
}
```
Returns `undefined` when there is no spot or no worker (a reservation it made is released). The builder gets the `BUILDING` role. A dropped or rejected command puts the build back to `'moving'` and counts an attempt; at `maxAttempts` the spot is re-placed by the placement solver (a build started with `placement` repeats that request; gas keeps its geyser). `timeout` applies to non-Terran builds and gas builds. A Terran build is done at `buildProgress` 1, a Protoss or Zerg build once the structure exists.

#### *`buildings.buildGas(opts?: { geyser?: Unit; max?: number }) => TrackedBuild | undefined`*
`max = 1`. Builds your race's gas building on `geyser`, or on the free geyser closest to one of your townhalls (within 15 of a townhall that is at least 98% built, 55% after 5:00). `undefined` when tracked plus unfinished gas buildings number `max` or more, or no geyser is free. An enemy gas building within 4.5 moves the build to another geyser.

#### *`buildings.cancel(target: Unit | TrackedBuild) => void`*
Cancels the unfinished structure (`CANCEL_BUILDINPROGRESS`) and fails the active build with `'cancelled'`.

#### *`buildings.pending(unitType?: number) => number`*
Active builds started through `build` or `buildGas`; resumed (adopted) builds aren't counted.

#### *`buildings.getTracked() => readonly TrackedBuild[]`*
Active builds, resumed ones included, and those that finished or failed this step.

#### *`buildings.configure(settings: Partial<BuildingSettings>) => void`*
```ts
BuildingSettings = {
    priority: 10, // of the BUILDING-role commands
    timeout: 120, // game seconds
    maxAttempts: 5,
    cancelLowHp: 'tracked', // 'tracked' | 'all' | 'off'
}
```
After the first `build` or `buildGas` call of a game that returns a `TrackedBuild`, an unfinished Terran structure with no builder (add-ons and orbital or planetary morphs excepted) is resumed by a worker. A structure whose health dropped since the previous step and is below `max(50, 9% of max health)` is cancelled: with `'tracked'` only builds you started (Protoss and Zerg ones too after they count as done, not resumed ones), with `'all'` any. Settings survive a new game on the same engine; builds don't.

### mining
Off by default. Manages the workers in the `GATHERING` role (not `command`-labelled or constructing) once `enabled` is set; commands are proposed as that role at `priority`. `MiningAssignment = { kind: 'mineral' | 'gas'; resourceTag: string; townhallTag: string }`.

#### *`mining.selectWorker(near: Point2D, opts?: { forceClose?: boolean; minHealth?: number; role?: UnitRole }) => Unit | undefined`*
`forceClose = false`, `minHealth = 0` (fraction of max health), `role = BUILDING`. Takes the closest unassigned worker, or, with `forceClose` or when all are assigned, a mining worker that carries nothing, preferring the base closest to `near`. The worker is unassigned and given `role`. While mining is disabled nobody is assigned, so `forceClose` returns `undefined`.

#### *`mining.release(worker: Unit | string) => void`*
Unassigns the worker and sets its role to `GATHERING`.

#### *`mining.getAssignment(worker: Unit | string) => MiningAssignment | undefined`*

#### *`mining.getWorkersOn(resource: Unit | string) => string[]`*
Tags of the workers on a mineral field or gas building.

#### *`mining.getMineralTarget(mineral: Unit | string) => Point2D | undefined`*
The speed-mining point of a field.

#### *`mining.isEnabled() => boolean`*

#### *`mining.configure(settings: Partial<MiningSettings>) => void`*
```ts
MiningSettings = {
    enabled: false,
    priority: -10,
    workersPerGas: 3, // integer 0-3, else RangeError
    speedMining: true,
    townhallDistanceFactor: 1.08,
    keepSafe: true,
    fleeAtHealth: 0.5, // fraction of health (plus shield for Protoss)
    weightSafetyLimit: 12, // ground cost above which a worker flees
    selfDefence: true,
    longDistanceMine: true,
}
```
Settings survive a new game on the same engine; assignments don't.

### flying
Per-structure flight plans for Terran buildings, advanced in `onStep` under the commander `{ owner: 'flying', priority }`. A grounded structure is lifted; a flying one moves towards the destination and, within 5.5 of it, lands when the plan says so. A plan ends when the structure is gone or has landed within 0.5 of the destination. A destination that never accepts a landing keeps the plan alive, re-proposing every step, until `cancel`; so does `land: false`. Your own commands for a structure in transit are dropped as outranked at the default priority.

#### *`flying.move(structure: Unit, destination: Point2D, opts?: { land?: boolean }) => void`*
`land = true`. Replaces the structure's plan.

#### *`flying.swap(a: Unit, b: Unit) => void`*
Plans each structure to land at the other's current position. No checks; `actions.swapBuildings` checks first.

#### *`flying.addonSwap(structure: Unit | number, addon: number) => boolean`*
`structure` is a unit, or a unit type (the first finished one without an add-on). `addon` is `REACTOR` or `TECHLAB` (matching any variant of it) or a specific add-on type. Picks the closest finished idle add-on; if another structure has it, that one flies to the host's position, and the host lands where the add-on attaches. `false` (and no plan) when there is no finished host or add-on.

#### *`flying.cancel(structure: Unit | string) => void`*

#### *`flying.getPlans() => readonly FlightPlan[]`*
`FlightPlan = { tag: string; destination: Point2D; land: boolean; state: 'lifting' | 'flying' | 'landing'; startedAt: number }` (`startedAt` is a game loop).

#### *`flying.configure(settings: Partial<{ priority: number }>) => void`*
`priority = 10`. Settings survive a new game on the same engine; plans don't.

### mapAnalysis
Regions and chokes of the start pathing grid (minerals walkable, structures ignored), computed once per game with a distance-to-wall watershed. Runs in the first per-step hook when `features.eagerMapAnalysis` is on (the default), otherwise on the first accessor call. Accessors throw `MapDecompositionError` when the start grids are missing; the eager run never throws.
```ts
Choke = {
    id: number;
    center: Point2D; // cell centre
    sides: [Point2D, Point2D]; // the two ends, cell centres
    points: Point2D[]; // the choke's cells, integer coordinates
    width: number;
    regions: [number, number]; // ids of the two regions it joins
    ramp?: Ramp; // set when the choke touches a ramp
}
Region = { id: number; area: number; center: Point2D; chokes: Choke[]; expansions: Expansion[] }
BaseChoke = { choke: Choke; pathDistance: number } // ground distance from the base to the choke centre
DefensivePosition = BaseChoke & { position: Point2D }
```

#### *`mapAnalysis.getChokes() => Choke[]`*
Every choke, as a copy, ordered by `regions` then `center`.

#### *`mapAnalysis.getRegions() => Region[]`*
Every region, as a copy. Ids are `0..n-1`.

#### *`mapAnalysis.getRegion(point: Point2D) => Region | undefined`*
`undefined` for an unwalkable cell or a point off the map.

#### *`mapAnalysis.isInChoke(point: Point2D) => boolean`*

#### *`mapAnalysis.getBaseChokes(base: Expansion | Point2D) => BaseChoke[]`*
The chokes of the region that holds `base`, nearest by ground distance first. A point that isn't walkable is moved to the nearest walkable cell within 4. Unreachable chokes are left out; `[]` when `base` resolves to no cell.

#### *`mapAnalysis.getDefensivePosition(base: Expansion | Point2D, opts?: { towards?: Point2D; offset?: number }) => DefensivePosition | undefined`*
The `base` choke that minimises the ground distance from the base plus the distance to `towards`, with `position` up to `offset` cells back from the choke centre down the path to the base. `towards` is the first possible enemy start, else the map centre; `offset = defenseOffset` (4). `undefined` when the base's region has no reachable choke.

#### *`mapAnalysis.getDefensiveThird() => Expansion | undefined`*
The one of `map.getThirds()` with the longest `pathFromEnemy` (a missing path counts as longest); `undefined` when there are no thirds.

#### *`mapAnalysis.getPerimeter(region: Region) => Point2D[]`*
The region's cells that are 4-adjacent to an unwalkable or off-grid cell, as cell centres sorted by angle (`atan2`, from -PI) around `region.center`. Cached per region; a copy is returned.

#### *`mapAnalysis.getEnemyMainRamp() => Ramp | undefined`*
`getDefensivePosition(enemyMain, { towards: ownStart })?.choke.ramp`. `undefined` without an enemy main expansion or when that choke has no ramp.

#### *`mapAnalysis.configure(settings: Partial<MapAnalysisSettings>) => void`*
```ts
MapAnalysisSettings = {
    maxChokeWidth: 14, // wider passages are not chokes
    peakRatio: 2.2, // how narrow a passage must be, relative to the areas it joins, to split them
    minRegionArea: 150, // smaller regions are merged into a neighbour
    defenseOffset: 4, // default offset of getDefensivePosition
}
```
The analysis is recomputed on the next accessor call. Settings survive a new game on the same engine; the analysis doesn't. A `resources.mapAnalysis` section of the config file is passed here.

#### *`mapAnalysis.drawDebug() => void`*
Sets the `debug` cell drawing `mapAnalysisChokes` to every choke cell (`C<id>`) and region centre (`R<id>`). Does nothing without the `debug` resource.

### behaviors
Runs behaviors (see [Behaviors](#behaviors-1)) in the caller's commander context. Registered after `mapAnalysis`; it has no per-step hook. Types: `Behavior`, `BehaviorContext`, `BehaviorsResource`, `ArmyComposition`.

#### *`behaviors.run(behavior: Behavior, opts?: { role?: UnitRole; priority?: number }) => Promise<boolean>`*
Executes the behavior immediately and resolves with its result (a rejection when it throws). Without options the commands are proposed under the caller's commander. With `role`, under `roles.as(role, ..., { priority })`, so the owner is `role:<ROLE>`. With only `priority`, under `actions.as({ priority })`. The one-order-per-unit-per-loop state behind `ctx.order` belongs to the resource and is kept per owner.

### openings
Opening definitions, settings and per-opponent history, registered last (after `behaviors`). Types: `OpeningDefinition`, `OpeningSettings`, `OpeningRecord`, `OpeningsResource`. It has an `onStep` hook that notes a replay and an `onGameEnd` hook that writes the history. The build system uses it (see `opening` and `openings: 'config'` under `createSystem`); the config file's `resources.openings` section goes to `configure`.
```ts
OpeningDefinition = {
    buildOrder: Array<BuildTask | BuildOrderStep>;
    autoSupplyAtSupply?: number;
    constantWorkerProductionTill?: number;
    persistentWorker?: boolean;
}
OpeningSettings = {
    builds: Record<string, OpeningDefinition>; // {}
    choices: Record<string, string[]>; // {}: opponent id or race name ('Terran', 'Zerg', 'Protoss', 'Random') to opening names
    method: 'cycle' | 'winrate'; // 'cycle'
    minGames: number; // 3
    dataDir?: string; // unset: nothing is read or written
}
OpeningRecord = { race: string; duration: number; opening: string; result: 'victory' | 'defeat' | 'tie' | 'undecided' }
```
The options act only while the order is active, not paused and not complete. `autoSupplyAtSupply` runs the `autoSupply` controller each step from that supply used on. `constantWorkerProductionTill` above 0 trains workers up to that worker supply and sets `buildOptions.fillWorkers` to `false` while the opening is current. `persistentWorker: false` turns the persistent builder off (on by default for Terran and Protoss).

#### *`openings.configure(settings: Partial<OpeningSettings>) => void`*
Assigns the given fields over the current settings. Settings survive a new game on the same engine.

#### *`openings.getDefinitions() => Readonly<Record<string, OpeningDefinition>>`*
The configured `builds`.

#### *`openings.choose(available?: string[]) => string | undefined`*
`available = Object.keys(builds)`. The candidates are the `choices` entry for the opponent id, else for the opponent's race name (`'Random'` for an unknown race), else `available`, filtered to `available`; `undefined` when none is left. `cycle` repeats the last recorded opening after a victory and takes the next one, wrapping, after anything else (the first with no history or a last opening outside the candidates). `winrate` applies once every candidate has at least `minGames` records (never above 10), scoring the last 10 per opening (0 without records) and breaking ties with the tied opening after the last one used, else the first; otherwise it cycles. With `dataDir` it reads `<dataDir>/<opponent id or 'unknown'>-<own race>.json` (ares' format; a malformed file warns and counts as empty, entries that don't parse are dropped with a warning). Decided once per game: later calls return the same name until the next game.

#### *`openings.getChosen() => string | undefined`*
The opening this game is recorded under.

#### *`openings.getHistory() => readonly OpeningRecord[]`*
The history read for this game plus the record appended at its end.

#### *`openings.record(name: string) => void`*
For the build system: sets the opening that goes into the history at game end (the chosen name, a string or function `opening`), reading the history file first when `choose` hasn't. Bots must not call it: it overwrites the name and corrupts the winrate data. A mid-game `switchOpening` isn't recorded.

At game end, with `dataDir` set, an opening recorded and the game not a replay, it appends `{ race: opponent race name, duration: seconds, opening, result for your player }` and writes the file synchronously, creating the directory. A game reset clears the chosen opening and the history.

### events
TBD

## Utilities
Pure functions exported from `@sc-bot/core`.

### *`simulateFight(own: Unit[], enemy: Unit[], opts?: FightOptions) => FightSimulation`*
A deterministic focus-fire simulation in 0.25 s ticks: health plus shields on both sides, each unit's `calculateDpsVsTarget` to the lowest-health enemy it can hit, without overkill, damage applied to both sides at once. It stops when a side is dead, when neither side can deal damage, or at `maxSeconds`. `ownWins` when you have units left and the enemy has none, or both have units and your fraction of health left is higher. `seconds` is the simulated time.
```ts
FightOptions = {
    timingAdjust: true, // each unit starts once it could reach the closest enemy it can hit
    workersDoNoDamage: false,
    maxSeconds: 60, // normal-speed seconds (16 game loops)
}
FightSimulation = { ownWins: boolean; ownHealthLeft: number; enemyHealthLeft: number; ownHealthStart: number; enemyHealthStart: number; seconds: number }
```

### *`canWinFight(own: Unit[], enemy: Unit[], opts?: FightOptions) => EngagementResult`*
`simulateFight` bucketed on ares' scale (`@sc-bot/core/constants/engagement-result`). A win by your health fraction left: ≥ 0.9 `VICTORY_EMPHATIC` (10), ≥ 0.75 `VICTORY_OVERWHELMING`, ≥ 0.6 `VICTORY_DECISIVE`, > 0.4 `VICTORY_CLOSE`, > 0.2 `VICTORY_MARGINAL`, else `TIE` (5). A loss by the enemy's fraction left: equal to yours `TIE`, ≥ 0.9 `LOSS_EMPHATIC` (0), ≥ 0.75 `LOSS_OVERWHELMING`, > 0.6 `LOSS_DECISIVE`, > 0.4 `LOSS_CLOSE`, > 0.2 `LOSS_MARGINAL`, else `TIE`. An empty enemy list is `VICTORY_EMPHATIC`, an empty own list `LOSS_EMPHATIC`, both `TIE`.

### *`parseBuildOrder(steps: Array<BuildOrderStep | BuildTask>, race: SC2APIProtocol.Race) => BuildTask[]`*
Expands ares-style steps into `[supply, task]` pairs; `BuildOrderStep` is `string | Record<string, string[]>`. Strings are `'<supply> <command> [@target ...] [x<n>]'`, case-insensitive, with `x<n>` or `*<n>` repeating the step; object steps only take `<supply> WORKER_SCOUT` / `<supply> OVERLORD_SCOUT` keys with a list of target names (a scout with no targets gets `ENEMY_SPAWN` for a worker, `ENEMY_NAT_VISION` for an overlord). `[supply, task]` pairs and task objects pass through. A command is resolved as a unit type name (a structure becomes a `build`, anything else a `train`; `LAIR` and `HIVE` become morph abilities), then an upgrade name, then an option: `WORKER`, `SUPPLY`, `GAS`, `EXPAND`, `GATE`, `CORE`, `ORBITAL`, `CANCEL_GAS`, `CHRONO`, `WORKER_SCOUT`, `OVERLORD_SCOUT`, `ADDONSWAP`, with the race-specific ones resolved for `race`. `GAS` drops its target; `CHRONO` needs a unit type target; `ADDONSWAP` takes exactly two structure names. Throws `NodeSC2Error` naming the step for an unknown command (an upgrade missing from the game data included), an unknown target, `ENEMY_NAT_HG_SPOT`, a bad `ADDONSWAP` or `CHRONO`, or a dict step that isn't a scout. A missing or non-numeric supply logs on `sc2:debug:buildOrder` and uses `0`. The `BuildTarget` names are in `@sc-bot/core/constants/build-target`.

## Behaviors
Imported from the `@sc-bot/core/behaviors` subpath, not the package root. A behavior is a plain object `Behavior = { readonly name: string; execute(ctx: BehaviorContext): boolean | Promise<boolean> }`; `execute` returns `true` when it acted. Run one with [`behaviors.run`](#behaviors) from inside the step, and compose several with `plan`. Every factory takes one options object; `Target = Point2D | Unit`; `layer?: InfluenceLayer` defaults to `'air'` for a flying unit and `'ground'` otherwise. The readme's "Behaviors and controllers" has the same information as tables.

```ts
BehaviorContext = {
    world: World;
    order(units: Unit | Unit[], abilityId: number, target?: Point2D | Unit, opts?: { queue?: boolean }): boolean;
    hasOrdered(unit: Unit | string): boolean;
}
```
`order` proposes one command (a unit target gives a target-unit command, a point a world-position command) under the current commander. It drops tags this owner already ordered in the current game loop unless `queue` is set, and returns `false` when no tag is left. `hasOrdered` is whether this owner ordered the unit in this loop. The state is cleared when the game loop changes.

### *`plan(...behaviors: Behavior[]) => Behavior`*
Runs the behaviors in order and returns `true` at the first that does, without running the rest; `false` when none did. Synchronous and asynchronous behaviors can be mixed; the result is a promise as soon as one behavior returns one. Its name is `plan(<names>)`.

### Helpers

#### *`attackReady(unit: Unit, target: Unit, stepLoops = 4) => boolean`*
`false` when the unit can't hit the target. `true` when `unit.weaponCooldown <= stepLoops`. Otherwise `true` when the distance between the unit's edge and the target's edge, minus the unit's range against it (ground range for a ground target when it has one, else air range), is at least `unit.distanceToWeaponReady()`.

#### *`inAttackRange(unit: Unit, targets: Unit[], extraRange = 0) => Unit[]`*
The targets for which `unit.targetInRange(target, extraRange)` holds.

#### *`pickEnemyTarget(targets: Unit[]) => Unit | undefined`*
The target with the lowest health plus shield; the first on a tie.

#### *`duplicateOrSimilarOrder(world: World, unit: Unit, target: Point2D | Unit, abilityId: number, distanceSquaredCheck = 2) => boolean`*
`true` when the squared distance from the unit to the target is under `distanceSquaredCheck`, or the unit's first order has the same ability as `abilityId` (both mapped to their general ability through the ability data's `remapsToAbilityId`) and targets the same unit tag, or the same position when both are rounded to whole numbers.

#### *`groupWeaponsOnCooldown(group: Unit[], stutterForward: boolean) => boolean`*
`true` when the group's average `weaponCooldown` is above 2.5 (`stutterForward`) or 5. `false` for an average of 0.

#### *`center(units: Unit[]) => Point2D`*
#### *`towards(from: Point2D, to: Point2D, step: number) => Point2D`*

#### *`ownUnitCount(world: World, unitType: number) => number`*
Your units of the type plus `agent.alreadyPending(unitType)`.

#### *`structurePending(world: World, unitType: number) => number`*
`buildings.pending(unitType)` plus your unfinished structures of the type that no tracked build refers to by `structureTag`.

### Individual combat behaviors

#### *`aMove({ unit, target, successAtDistance = 7 }) => Behavior`*
`unit: Unit`, `target: Target`. Attack-moves. `false` without an order when `distance(unit, target) < successAtDistance`; a value of 0 or less turns the check off.

#### *`attackTarget({ unit, target }) => Behavior`*
`unit: Unit`, `target: Target`. Always orders an attack and returns `true`.

#### *`shootTargetInRange({ unit, targets, extraRange = 0 }) => Behavior`*
`targets: Unit[]`. Drops targets that aren't current or are cloaked, then takes those in range (`inAttackRange`). `false` when none. `true` without an order when the unit's current order targets one of them and its `weaponCooldown` is 0. Otherwise picks the lowest health plus shield, returns `false` unless `attackReady`, and attacks it.

#### *`useAbility({ unit, abilityId, target? }) => Behavior`*
`false` when `unit.abilityAvailable(abilityId)` is false, otherwise orders it (at `target` when given) and returns `true`.

#### *`stutterUnitForward({ unit, target }) => Behavior`*
`target: Unit`. Attacks when `attackReady`, otherwise moves to the target's position. Always `true`.

#### *`stutterUnitBack({ unit, target, layer? }) => Behavior`*
`target: Unit`. Attacks when `attackReady`, otherwise returns the result of `keepUnitSafe`.

#### *`pathUnitToTarget({ unit, target, layer?, successAtDistance = 0, sensitivity = 5, senseDanger = true, dangerDistance = 20, dangerThreshold = 5 }) => Behavior`*
`target: Point2D`. `false` when `distance(unit, target) < successAtDistance`. Otherwise moves to `pathing.nextPoint(unit.pos, target, { layer, sensitivity, senseDanger, dangerDistance, dangerThreshold })` and returns `true`.

#### *`keepUnitSafe({ unit, layer? }) => Behavior`*
`false` when `pathing.isPositionSafe` holds at the unit, or no `closestSafeSpot` exists. Otherwise `pathUnitToTarget` to the safe spot, with `successAtDistance = 0`.

#### *`moveToSafeTarget({ unit, target, layer?, usePathing = true, successAtDistance = 1, radius = 12, ...pathOptions }) => Behavior`*
`target: Point2D`; `pathOptions` are `sensitivity`, `senseDanger`, `dangerDistance` and `dangerThreshold` of `pathUnitToTarget`. `false` when the unit is within `successAtDistance` of the target, or no safe spot is within `radius` of the target. Otherwise moves to that spot, with `pathUnitToTarget` or, without `usePathing`, a plain move.

#### *`shootAndMoveToTarget({ unit, enemies, target, layer?, distToTarget = 4, attackDestructables = true }) => Behavior`*
`enemies: Unit[]`, `target: Point2D`. `shootTargetInRange` on the enemies, then (with `attackDestructables`) on the map's destructables, then `pathUnitToTarget` with `successAtDistance = distToTarget`.

#### *`workerKiteBack({ unit, target, shouldAttack = true }) => Behavior`*
`target: Unit`. Attacks when `shouldAttack`, the target is current and `attackReady`. `false` when there are no mineral fields. Otherwise gathers: at the field closest to your main's townhall when no ground enemy (excluding eggs, larva, creep tumors, MULEs and changelings) is within 6.5, else at the field closest to the unit among those nearer to a point 6 behind the unit (away from the enemies' centre) than to the enemies' centre and more than 4 from the unit, falling back to the field closest to the townhall.

### Terran behaviors

#### *`medivacHeal({ unit, allies, layer?, keepSafe = true }) => Behavior`*
`allies: Unit[]`. `false` unless the unit is a medivac. With `keepSafe`, returns `true` when `keepUnitSafe` acted. `true` when the unit is using `EFFECT_HEAL`. Otherwise heals the ally closest to the unit among the biological, non-mechanical allies below full health, or returns `false` when there is none.

#### *`pickUpCargo({ unit, targets, layer?, switchCargoToRole? }) => Behavior`*
`targets: Unit[]`, `switchCargoToRole?: UnitRole`. Pickup range is 5 for medivacs, warp prisms and overlord transports. With no targets or another unit type, assigns the unit's passengers `switchCargoToRole` (when given) and returns `false`. Otherwise `SMART`s the closest target when within range, else `pathUnitToTarget` to it.

#### *`dropCargo({ unit }) => Behavior`*
`false` when `unit.cargoSpaceTaken` is 0 or `map.isPathable(unit.pos)` is false. Otherwise `UNLOADALLAT` at the unit.

#### *`pickUpAndDropCargo({ unit, targets, target, layer?, switchCargoToRole?, shouldDropUnits = true, keepDropshipSafe = true, successAtDistance = 2 }) => Behavior`*
`target: Point2D`. `plan(pickUpCargo, pathUnitToTarget(successAtDistance), dropCargo if shouldDropUnits, keepUnitSafe if keepDropshipSafe)`.

#### *`siegeTankDecision({ unit, closeEnemy, target, staySiegedNearTarget = false, remainSieged = false, forceUnsiege = false }) => Behavior`*
`closeEnemy: Unit[]`, `target: Point2D`. `false` unless the unit is a siege tank (sieged or not). Enemies that are flying, burrowed or changelings are ignored. Unsieged: `false` with `forceUnsiege` or an enemy within 6.5; sieges (`MORPH_SIEGEMODE`, `true`) when a bunker, planetary fortress, spine crawler or cannon is within 13, or `staySiegedNearTarget` and within 5 of `target`, or more than one enemy with at least 4 supply (`data().foodRequired`) in total, or an enemy tank; else `false`. Sieged: unsieges (`MORPH_UNSIEGE`, `true`) with `forceUnsiege` or when an enemy is within 4 and fewer than two are within 12; `false` with `remainSieged` or within 7 of `target` with `staySiegedNearTarget`; `false` when the unit is within 10 of the midpoint to `target` and three or more of your other ground units are within 12 of that midpoint, one of them within 8.5 of the tank; otherwise unsieges when no relevant enemy remains (enemy structures count only as bunkers, planetary fortresses, spine crawlers or cannons within sqrt(110)) and the target is more than sqrt(200) away, and returns `true`.

### Group behaviors
`group: Unit[]`. Each returns `false` for an empty group. One command is issued for the whole group; where "skips a duplicate" appears, `duplicateOrSimilarOrder` is checked on the named unit first.

#### *`aMoveGroup({ group, target }) => Behavior`*
Attack-moves. Skips a duplicate (the unit farthest from the target) and returns `false`; otherwise returns what `ctx.order` returned.

#### *`keepGroupSafe({ group, closeEnemy, layer?, attackInRangeEnemy = true }) => Behavior`*
Async. For each unit, `shootTargetInRange` on `closeEnemy` (with `attackInRangeEnemy`), and `keepUnitSafe` when that didn't act. `true` when at least one unit got a `keepUnitSafe` order.

#### *`pathGroupToTarget({ start, group, target, layer?, distanceCheckSquared = 26.25, successAtDistance = 0, sensitivity = 12, senseDanger = false, dangerDistance = 20, dangerThreshold = 5, preventDuplicate = true }) => Behavior`*
`start: Point2D`, `target: Point2D`. `false` when `start` is within `successAtDistance` of the target. Moves the group to `pathing.nextPoint(start, target, ...)`; with `preventDuplicate` it skips a duplicate move (checked on the unit closest to `start`, with `distanceCheckSquared`).

#### *`stutterGroupBack({ group, groupPosition, target, layer? }) => Behavior`*
`groupPosition: Point2D`, `target: Target`. Always `true` for a non-empty group. When `groupWeaponsOnCooldown(group, false)` is false, attacks the target's position (skipping a duplicate on the unit farthest from it). Otherwise, returns without an order when every unit is `isPositionSafe`; else picks the best of 8 directions (the one ending farthest from the target, 1.5 per unit of the group from `groupPosition`, clamped to the grid, only cells with a finite cost; groups of 2 or more only), takes the `closestSafeSpot` around it and moves the group one `nextPoint` towards it (sensitivity `min(group.length, 8)`), skipping a duplicate.

#### *`stutterGroupForward({ group, groupPosition?, target, enemies }) => Behavior`*
`target: Target`, `enemies: Unit[]`; `groupPosition` is unused. Also `false` for no enemies. Attacks the enemies' centre, or moves to it when not every unit has an enemy in range and `groupWeaponsOnCooldown(group, true)`; skips a duplicate (on the unit closest to the target). Otherwise `true`.

#### *`groupUseAbility({ abilityId, group, target?, syncCommand = true }) => Behavior`*
`false` unless every unit (`syncCommand`) or any unit has the ability available; then one command for the group, returning what `ctx.order` returned.

## Controllers
Macro behaviors from the same subpath. They spend through the agent's macro helpers and the [`buildings`](#buildings) and [`placement`](#placement) resources, and deduct what they spend from `agent.minerals` and `agent.vespene` when they propose it. `buildStructure` and `productionController` return `false` for Zerg; Zerg structure placement isn't supported.

```ts
ArmyComposition = Partial<Record<number, { proportion: number; priority: number }>>
```
The key is a unit type id. `proportion` is the share of the army. `priority` is an integer from 0 to 10; the lower trains first.

#### *`spawnController(options) => Behavior`*
```ts
{
    composition: ArmyComposition,
    freeflow: false, // ignore proportions, don't stop at an unaffordable type, skip validation
    ignoreProportionsBelowUnitCount: 0, // proportions apply once the composition's units (pending included) reach this
    overProduceOnLowTech: true, // with one tech-ready type and maximum > 1, top it up to `maximum`
    maximum: 20, // most units of a type per step
    spawnTarget?: Point2D, // passed to agent.train as closestTo
}
```
Throws `NodeSC2Error` at creation, unless `freeflow`, when the proportions don't sum to 1 (within 1e-6) or a priority isn't an integer from 0 to 10. Each step, in priority order, for every type with its tech done (`techRequirementProgress` 1) and an idle producer (finished, powered for Protoss, fewer orders than slots: 2 with a finished reactor, and a finished tech lab where the unit requires one): stops at an unaffordable type (skips it with `freeflow` or when proportions are ignored); skips a type whose share (units plus pending, over the composition's total) is above its proportion; otherwise `agent.train`s `min(canAffordN, supply left / supply cost, maximum)`. With `overProduceOnLowTech`, when exactly one type has its tech, `maximum` is above 1 and at least one type was affordable with an idle producer, the first such type is topped up to `maximum` (less what was already trained). `true` when anything was trained. `false` right away when warp gate research is done and a finished gateway is idle.

#### *`buildWorkers({ toCount }) => Behavior`*
Trains your race's worker through a one-type `spawnController` with `maximum = toCount - agent.supplyWorkers`. `false` when there is nothing missing or a worker isn't affordable.

#### *`buildStructure(options) => Behavior`*
```ts
{
    structureType: number,
    base?: Point2D, // placement base
    maxOnRoute: 1, // moving or ordered tracked builds of this type
    closestTo?: Point2D, // placement preference
    toCount: 0, // 0: no limit; else finished plus pending structures of the type
    techProgressCheck: 0.85, // minimum techRequirementProgress of the structure
    flags?: PlacementFlag[],
    findAlternative: true,
}
```
Calls `buildings.build(structureType, { placement: { base, closestTo, flags, findAlternative } })`. `true` when a build started; `false` when any limit is hit, no spot or worker was found, or for Zerg.

#### *`autoSupply({ base?, closestTo?, returnTrueIfSupplyRequired = true }) => Behavior`*
Does nothing at 200 supply cap. Terran and Protoss: with P finished production structures (barracks, factory, starport, gateway, warp gate, robotics facility, stargate, hatchery, lair, hive), supply is required when `supplyLeft <= max(2P, 5)` and the pending supply structures (`structurePending`) number fewer than `ceil(P / 2)`, for the difference up to 6; with no production structure, when `supplyLeft <= 2` and none is pending. It then calls `buildStructure` once (Terran with the `supplyDepot` flag). Zerg: overlords by ares' rules from `alreadyPending(OVERLORD)`, the number of townhalls and supply used, trained with `agent.train`. Returns `returnTrueIfSupplyRequired` whenever supply was required, and `false` otherwise.

#### *`expansionController(options) => Behavior`*
```ts
{
    toCount: number, // townhalls, finished plus pending
    canAffordCheck: true,
    checkLocationIsSafe: true, // pathing.isPositionSafe at the townhall position
    maxPending: 1,
    prioritize: false, // skip the affordability check
}
```
Builds your race's townhall with `buildings.build(type, { at })` at the first `map.getAvailableExpansions()` entry where `placement.canPlace` holds. `true` when a build started.

#### *`gasBuildingController({ toCount, maxPending = 1 }) => Behavior`*
`false` when `units.getGasMines()` plus tracked gas builds that haven't started reach `toCount`, when `buildings.pending(gasType)` reaches `maxPending`, or with under 35 minerals. Otherwise `buildings.buildGas({ max: maxPending })`.

#### *`upgradeCCs({ to, prioritize = false }) => Behavior`*
`to: ORBITALCOMMAND | PLANETARYFORTRESS`. Orders `MORPH_ORBITALCOMMAND` or `MORPH_PLANETARYFORTRESS` on the first finished idle command center and deducts the cost. `false` with none, or when `techRequirementProgress(to)` is under 1. When it can't afford `to`, returns `prioritize` with no command.

#### *`techUp({ desired, base?, ignoreExistingTechlabs = false }) => Behavior`*
`desired: { unit: number } | { upgrade: number }`. Works out the producing (or researching) structure and its requirements, and takes the first missing step: a lair or hive morph; a tech lab on an idle, finished barracks, factory or starport that has no add-on (`false` when a structure of that type has an idle tech lab, or a tech lab of that type exists at all, unless `ignoreExistingTechlabs`; and always `false` while another idle structure of that type has an add-on of any kind); or a missing structure through `buildStructure({ structureType, base })`. `true` when a step was started; `false` when nothing is missing, or what is missing can't be afforded or isn't unlocked.

#### *`upgradeController({ upgrades, base?, autoTechUp = true, prioritize = false }) => Behavior`*
`upgrades: number[]`. In order, skips upgrades that are owned or in research. Without a research structure, `techUp` for the upgrade (with `autoTechUp`). With one that is finished and idle (and powered for Protoss): `techUp` for a missing required building (with `autoTechUp`), skips when the required upgrade isn't done, then `agent.research(upgrade)` and `true` on success; with `prioritize` and an unaffordable upgrade, `true` without a command.

#### *`productionController(options) => Behavior`*
```ts
{
    composition: ArmyComposition,
    base: Point2D, // placement base
    addProductionAtBank: [400, 400], // [minerals, gas]
    alpha: 0.9,
    unitPendingProgress: 0.75, // an order this far along counts as free producer capacity
    maxProductionStructures: 12, // all producer types of the unit together (gateway and warp gate count as one pool)
}
```
Races other than Zerg. For each composition type by priority: `techUp` for the unit (`ignoreExistingTechlabs` while its share is at or under its proportion), then `buildStructure` of its producer (flag `production`). Skipped when the producer's tech is under 95%, a tracked build of the producer is still waiting to start, or `maxProductionStructures` is reached. Bank rule: minerals and gas at or above `addProductionAtBank` and producers fewer than `floor(collection rate / (unit cost + 1) * alpha * proportion)` for minerals and for gas. Income rule (the quotients are floored, so below 1000 combined collection it never builds): no producer capacity (idle, an order past `unitPendingProgress`, or 90% built), the share under `proportion / 1.2`, producers fewer than `floor((mineral + gas rate) / ((unit mineral + gas cost) * 4.5))`, fewer producers pending than `floor((mineral + gas rate) / 1000)`, no flight plan of a producer type within 19 of `base` (Terran), and for proportions up to 0.15 no pending producer. Collection rates come from `frame.getScore().scoreDetails` (plus 1). `true` when a tech step or build started.