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
} from '@sc-bot/core';
```
Types are exported from the same entry (`import type { World, Unit } from '@sc-bot/core'`), constants from `@sc-bot/core/constants/<module>`.

### *`createPlayer(settings, bot?) => Player`*
This is a convenience function for creating player objects to be passed to `Engine#runGame`. You can construct the player objects manually instead, for more control. If the 'player' should be an Agent, you must pass it as the second parameter.
```js
settings = {
    race: Race.RANDOM, // required
    difficulty: Difficulty.MEDIUM, // only set this for a built-in AI player
}
```

### *`taskFunctions`*
The task builders (`build`, `train`, `upgrade`, `ability`) for the `buildOrder` of a `build` system. See [Build systems](../readme.md#build-systems) in the readme.

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
}
```
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

`runGame` can be called again on the same engine after a game ends. From the second game on, each game starts with the unit store cleared and the `map`, `events` and `debug` resources reset in place (no units or enemy memory from the previous game, no cached combat rally or paths), no earmarks, every system unpaused, its `state` back to a deep copy of its initial `state` and its step timing reset, and a build system's `buildOptions` (`paused`, `earmarks`) back to their initial values. The build and unit plugins are applied only once.

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
    interface: { raw: true, rawCropToPlayableArea: true }, // SC2APIProtocol.InterfaceOptions; `raw: true` is required
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
agent.distributeWorkers(resourceRatio = 2) => Promise<void> // moves idle and surplus workers to undersaturated bases and gas
agent.train(unitType, amount = 1, closestTo?, trainOnlyIdleBuildings = true) => Promise<number> // returns how many were started
agent.research(upgradeId) => Promise<boolean>
```
These follow python-sc2's `BotAI` helpers of the same names. `distributeWorkers` fills gas first when minerals/vespene is at least `resourceRatio` (or there is no vespene), otherwise minerals. `research` also checks the required building (eg. an armory for level 2 upgrades) and the previous level, and throws for an upgrade missing from the researched-from dictionary. They propose their commands through `actions.queueAction` under the calling commander, so they go out with the rest at the end of the step. They deduct what they spend from the agent's minerals and gas right away, and `train` adds the supply it uses to `foodUsed`, so later calls in the same step see what is left.

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

A blueprint with `type: 'build'` is typed as `BuildSystemObject`: its `onStep` is `(world, gameLoop, task?: BuildTaskI, result?: BuildResult)`, where `task` and `result` are `undefined` while the order is paused or finished.

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
}
```

`onBuildingConstructionStarted` fires when a new own structure appears unfinished, `onBuildingConstructionComplete` when one finishes or a new one appears already finished. The python-sc2 equivalents are `onStructureConstructionStarted` (also fires when an own unit turns into an unfinished structure while keeping its tag; on SC2 4.10 a drone's building gets a new tag instead, so for drones it fires alongside `onBuildingConstructionStarted` with the building, and the drone is reported destroyed when the building finishes), `onStructureConstructionComplete` (also for structures first seen finished, such as the starting townhall) and `onUnitSpawned` (own non-structure units, once per tag per game — unlike `onUnitCreated`, which also fires for structures). `onUnitTypeChanged` (own units only) receives `{ unit, previousType }` (morphs, sieging, lowering depots). `onUnitTookDamage` (own units only) receives `{ unit, amount }`, the health and shield lost since the previous frame. Event handlers are called as `(world, data, event)`, where `event` is the raw `SystemEvent` (`name`, `gameLoop`, ...); extra event fields are never spread into further arguments. This includes the agent's own `onStep` (`data` is the game loop) and `onGameStart` (`data` is `null`). The system hooks with their own arguments are the exceptions: a unit system's `onStep(world, units)`, `onNewUnit`, `onUnitIdle`, `onUnitDestroyed` and `idleFunctions` (`(world, unit)`), a build system's `onStep(world, gameLoop, task?, result?)` and `buildComplete(world, gameLoop)`, `onStepPaused(world)`, and `onGameStart(world)` of a system mounted after the game started. `event` is optional in the handler types, so handlers can also be called directly with two arguments. `onEnemyUnitLeftVision` fires for an enemy that was visible last frame and is not now; the unit stays in `units` as a memory (see `unit.isMemory()`). `onCommandResults` receives, the step after each flush of proposed commands, one entry per (proposal, outcome):
```ts
CommandResult {
    owner: string; // the proposing commander
    command: SC2APIProtocol.ActionRawUnitCommand; // as proposed
    tags: string[]; // the units this outcome covers
    outcome: 'won' | 'dropped' | 'rejected';
    reason?: 'outranked' | 'repeat'; // dropped only
    by?: string; // dropped and outranked: the winning owner
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
World { agent: Agent, data: DataStorage, resources: ResourceManager }
```
The `world` context is given as the first argument of every event consumer handler, and therefore available in any invokable part of your agent and/or systems. The easiest way to utilize it is via destructuring. Here is an example of a system logging the agent's race:

```js
    onGameStart({ agent }) {
        console.log(`My race this game is ${agent.race}`);
    }
```

### *`world.resources.register<K>(definition: ResourceDefinition<K>) => NonNullable<ResourceContainer[K]>`*
Creates and stores a resource from `{ name: K, create(world), reset?(resource, world) }` and returns it. Registering the same definition object again returns the existing resource, so it is safe from a system's `setup`; another definition under a taken name throws `NodeSC2Error`. Type the resource by augmenting `interface ResourceContainer` in `declare module '@sc-bot/core/types'`.

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
unit.weaponReady(), distanceToWeaponReady()
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
frame.getScore() => SC2APIProtocol.Score // needs `score: true` in the agent's `interface`
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
Enemy units that leave vision are kept in `units` with their last known state. `getAll(Alliance.ENEMY)` includes them, `getAlive` does not; use `unit.isMemory()` and `unit.age()` to tell them apart.

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
Given a start and end point as coordinates, does an A* search and returns the resulting path as a 2D array of sets of coordinates. Returns an empty array if pathing is impossible. The path graph also blocks the cells the map system marks unplaceable (structures, minerals, geysers, rocks, xel'naga towers), so an `end` on such a cell, or a `start` surrounded by them (such as `townhallPosition` of an occupied base), gives an empty path; start from a unit's `pos` or `map.closestPathable(point)`. NOTE: this is *not* the same as querying the API, this is significantly faster (exponentially) and done synchronously. It cannot, however, take into account any information about the map or paths not known to the system.

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
Command a given worker to build a `unitType` on either a position or a target unit. If no worker is given, the least busy, closest worker is selected. The worker gets the `command` label right away; if the build is dropped or SC2 rejects it, the label is removed again during the flush. A gas building is followed by a queued `gather` from the same commander. Nothing is refunded for a build that isn't sent.

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

#### *`actions.swapBuildings(unitA: Unit, unitB: Unit) => Promise<SC2APIProtocol.ResponseAction[]>`*
Lifts, swaps and lands two Terran buildings, sending each step immediately (not through arbitration). Resolves with both land responses; rejects if either building can't lift or isn't finished, or SC2 refuses a step.

#### *`actions.toggleAutocast(units: Unit | Unit[], abilityId: number) => Promise<SC2APIProtocol.ResponseAction>`*
Sent immediately.

#### *`actions.chatSend(message: string, teamOnly?: boolean) => Promise<SC2APIProtocol.ResponseAction>`*
Sent immediately. `teamOnly = false`.

#### *`actions.surrender() => Promise<unknown>`*
Leaves the game and resolves with the leave-game response; `runGame` resolves with `DEFEAT`.

#### *`actions.canPlace(unitType: number, positions: Point2D[]) => Promise<Point2D | false>`*
Given a `unitType` and an array of positions, queries the game to check placability (of at most 10 positions, sampled randomly from longer lists). Returns either *a random position which returned a success*, or false.

#### *`actions.findPlacement(unitType: number, near: Point2D, options?: FindPlacementOptions) => Promise<Point2D | false>`*
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

### events
TBD