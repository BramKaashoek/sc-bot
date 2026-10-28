# Agents, events and systems

An agent is the bot: an object of event handlers plus a few settings, created with `createAgent(blueprint)` and handed to the engine as a player (see [running-games.md](./running-games.md)). A system is a reusable piece of a bot: the same kind of object, with its own state, mounted on an agent with `agent.use()`.

Everything that reacts to the game is an event consumer. The engine writes events (a unit appeared, a step started, a chat line arrived), and each agent and system reads those addressed to it and calls the handler named `on` + the PascalCase event name. Every handler gets the `World` first (`{ agent, data, resources }`, see [resources.md](./resources.md#world)). Handlers return a promise, and the engine waits for all of them before the next step, which keeps a step's commands in that step.

Each step runs in this order: engine systems (frame, units, map, ...), then the agent's own handlers, then the mounted systems concurrently with each other, then one flush of the proposed commands (see [commands.md](./commands.md#command-arbitration)).

## Agent

#### `createAgent(blueprint?: EventReader<AgentObject>) => Agent`

```text
createAgent({
    settings: {
        race: Race.RANDOM,                    // requested by joinGame; runGame and runBotVsBot use the player entry's race instead
        type: PlayerType.PARTICIPANT,
        commandPriority: 0,                   // see Command arbitration
        skipAvailableAbilitiesQuery: false,   // opt-in, see below
    },
    interface: { raw: true, score: true, rawCropToPlayableArea: true },  // SC2APIProtocol.InterfaceOptions
    setup(world) { },                         // synchronous, runs before onGameStart
    ...event handlers                         // see Events
})
```

`settings` is `SC2APIProtocol.PlayerSetup & AgentSettings`; `type` and `race` default as shown, and anything else from `PlayerSetup` (`difficulty`, `playerName`) is passed through. `interface` must include `raw: true`. The default also has `score: true` (for `frame.getScore()`, which `productionController` reads); if you pass your own `interface`, add it yourself. You can add `render` / `featureLayer` camera setups; their data is available unprocessed from `frame.getRender()` and `frame.getFeatureLayer()`.

#### `agent.use(systems: SystemWrapper<System> | SystemWrapper<System>[]) => void`

Mounts systems, in order; the order matters for [command arbitration](./commands.md#command-arbitration). A system mounted after the game started is set up at once and gets `onGameStart(world)` without the `data` and `event` arguments.

```ts
import { createAgent, createSystem } from '@sc-bot/core';

const logger = createSystem({ name: 'Logger', async onGameStart() { console.log('started'); } });
const bot = createAgent();
bot.use(logger);
bot.use([logger]);
```

### Settings

- **`commandPriority = 0`**. The priority of the commands the agent's own handlers propose, against those of its systems (see [Command arbitration](./commands.md#command-arbitration)).
- **`skipAvailableAbilitiesQuery = false`**. By default the engine asks SC2 every step which abilities each of your units can use. With many units that query is expensive. When `true`, it is skipped. Call `await unit.fetchAvailableAbilities()` for the units you care about; the answer is cached for the current game loop, and the synchronous accessors (`unit.availableAbilities()`, `abilityAvailable()`, `canInject()`, `canBlink()`, `canMove()`) return what was fetched this loop, or nothing. Anything built on those accessors, such as `unit.inject()`, `unit.blink()`, `actions.warpIn` and build-order `ability` tasks, needs the fetch too. Without the setting, `fetchAvailableAbilities()` returns the result of the per-step query without asking again.

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

### Player data

The agent is updated every step with the player fields from the observation: `playerId`, `minerals`, `vespene`, `foodCap`, `foodUsed`, `foodArmy`, `foodWorkers`, `idleWorkerCount`, `armyCount`, `warpGateCount`, `larvaCount`, `powerSources`, `upgradeIds` and `camera`.

`agent.race` is the race you actually got (useful with random). `agent.opponent` holds `{ race, id }` as far as they are known:

- At game start `opponent.race` is the requested race, or `NORACE` when the opponent picked random. A race known at game start never changes.
- Against a random opponent it is set the first step an enemy unit is alive, from that unit's race, together with an `onEnemyRaceDetected` event. Code that cached it at game start should read it again or handle that event.
- `id` is whatever you set before the game, kept when the race is filled in. Under a ladder manager it is `--OpponentId` (see [running-games.md](./running-games.md#ladder-play)).

### Cost, supply and affordability

#### `agent.supplyCap`, `supplyUsed`, `supplyLeft`, `supplyArmy`, `supplyWorkers`

Number getters. For Zerg, `supplyUsed` and `supplyArmy` correct the API's rounding of an odd count of half-supply units (zerglings, banelings and their burrowed or cocoon forms).

#### `agent.calculateCost(unitType: number) => Cost`

`{ minerals, vespene }`. Morphs (a baneling, an orbital command) are net of the unit they consume. Zerg structures are net of the drone, a zergling costs for the pair, and free morphs (lower, raise, lift, land) cost nothing.

#### `agent.calculateUpgradeCost(upgradeId: number) => Cost`

#### `agent.calculateSupplyCost(unitType: number) => number`

The supply a unit adds, net for morphs.

#### `agent.canFeed(unitType: number) => boolean`

Enough supply left (always `true` for a cost of 0).

#### `agent.canAfford(unitType: number, earmarkName?: string | null, opts?: { count = 1, supply = false }) => boolean`

Net-cost minerals and gas for `count` of `unitType`, respecting earmarks (see [resources.md](./resources.md#earmarks)). With `supply: true` it also needs `count` times `calculateSupplyCost` supply left. With an `earmarkName` it settles that earmark when the answer is `true`.

#### `agent.canAffordUpgrade(upgradeId: number, earmarkName?: string | null) => boolean`

Like `canAfford`, for upgrades.

#### `agent.hasTechFor(unitType: number) => boolean`

Whether the required tech structure (or an equivalent) is finished: `techRequirementProgress(unitType) >= 1`.

The pending counts, expansion helpers, `agent.train` and `agent.research` are in [macro.md](./macro.md#agent-macro-helpers).

## Events

Event handlers are called as `(world, data, event)`: `data` depends on the event, and `event` is the raw `SystemEvent` (`name`, `type`, `gameLoop`, ...). That includes the agent's own `onGameStart` (`data` is `null`) and `onStep` (`data` is the game loop being stepped to); handlers that only take `world` keep working. `event` is optional in the handler types, so you can also call handlers directly with two arguments (in tests, for example).

The exceptions, with their own arguments, are the system hooks of [unit systems](#unit-systems) and [build systems](./build-orders.md#build-system-members), `onStepPaused(world)`, and `onGameStart(world)` of a system mounted after the game started.

Handlers must return a promise (declare them `async`); the engine waits for all of them before the next step. If you deliberately want work to span several steps, leave the promise dangling and guard against piling up calls yourself. How a thrown error surfaces is in [commands.md](./commands.md#how-errors-surface).

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
| `onUnitTookDamage` | Same moment as `onUnitDamaged` | `UnitDamage`: `{ unit, amount }`, health plus shield lost since last frame |
| `onUnitDestroyed` | A tracked unit died (own, enemy or neutral) | `Unit` |
| `onUnitIsTransforming` | A unit's type changed | `Unit` |
| `onUnitTypeChanged` | An own unit's type changed (morphs, sieging, lowering depots) | `UnitTypeChange`: `{ unit, previousType }` |
| `onUnitHasBurrowed` | A unit burrowed | `Unit` |
| `onUnitHasEngaged` / `onUnitHasDisengaged` / `onUnitHasSwitchedTargets` | A unit's engaged target was set / cleared / changed | `Unit` |
| `onEnemyFirstSeen` | An enemy tag is seen for the first time. A tag that [memory](./units.md#memory) forgot and that is seen again doesn't fire it again. | `Unit` |
| `onEnemyUnitEnteredVision` | An enemy is visible now but wasn't last frame (first sightings included) | `Unit` |
| `onEnemyUnitLeftVision` | An enemy was visible last frame but isn't now. It stays in `units` as a ghost until [memory](./units.md#memory) forgets it (30 s by default). | `Unit` |
| `onBuildingConstructionStarted` | A new own structure appears unfinished | `Unit` |
| `onBuildingConstructionComplete` | An own structure finishes, or a new one appears already finished | `Unit` |
| `onStructureConstructionStarted` | An own unit is an unfinished structure and wasn't a structure last frame: a new unfinished structure, or a unit that turned into one while keeping its tag. On SC2 4.10 a drone's building gets a new tag (the drone leaves the observation and is reported destroyed when the building finishes), so for drones this fires together with `onBuildingConstructionStarted`, with the building as `data`. | `Unit` |
| `onStructureConstructionComplete` | An own structure finishes, or a structure is first seen already finished (the starting townhall, debug-spawned buildings) | `Unit` |
| `onUnitSpawned` | An own non-structure unit is seen for the first time; once per tag per game, even if it later disappears from the observation (loaded into a transport, say) | `Unit` |
| `onNewEffect` / `onExpiredEffect` | An effect (a storm, say) appeared / ended | The effect merged with its effect data (`onNewEffect` also has `effectGrid`) |
| `onCommandResults` | The step after proposed commands were flushed, once per flush that had any | `CommandResult[]`: per proposal, whether it was sent (`won`), `dropped` or `rejected` (see [commands.md](./commands.md#commandresult)) |
| `onEnemyRaceDetected` | A random opponent's race was identified, from the first enemy unit alive. Once per game; never fires when the race was known at game start. Agent systems see it in the step it is detected, the agent's own handler in the next one. | `SC2APIProtocol.Race` |
| `onEnemyStrategyDetected` | [intel](./combat.md#intel) detects a strategy flag for the first time this game, in the same step | `EnemyStrategyDetected`: `{ flag, gameLoop }` |

`onStructureConstructionStarted`, `onStructureConstructionComplete` and `onUnitSpawned` correspond to python-sc2's `on_building_construction_started`, `on_building_construction_complete` and `on_unit_created`. The other events keep node-sc2's behaviour. Several occurrences fire more than one event: a new structure fires `onUnitCreated`, `onBuildingConstruction*` and `onStructureConstruction*`; damage fires `onUnitDamaged` and `onUnitTookDamage`.

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
            const nearby = units.getMineralWorkers().closestNUnits(structure.pos, 3);
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

`events.write({ name, data })` publishes your own event (the `events` resource is in [resources.md](./resources.md#events)). Any agent or system with a handler named `on` + the PascalCase name receives it the next time it reads events. Events default to type `'agent'`, which agents and agent, build and unit systems all read. A falsy `data` arrives as `null`.

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

#### `createSystem(blueprint: UnitSystemObject | BuildSystemObject | GeneralSystemObject, options?: SystemOptions) => SystemWrapper<System>`

`GeneralSystemObject` is the shape for `type: 'agent'` (or no type), `UnitSystemObject` for `type: 'unit'` and `BuildSystemObject` for `type: 'build'`; all three are `SystemObject` plus the event handlers. Pass the result to `agent.use()`.

```text
createSystem({
    name: 'MySystem',            // used in logs and as the commander name
    type: 'agent',               // 'agent' (default), 'build' or 'unit'
    defaultOptions: {            // SystemOptions
        state: {},               // initial state
        stepIncrement: 8,        // agent systems: skip onStep until more than N game loops have passed;
                                 // defaults to 8 with an explicit type: 'agent', to 2 when type is left out
        commandPriority: 0,      // priority of this system's commands, see Command arbitration
    },
    setup(world) { },            // synchronous, before onGameStart
    ...event handlers
})
```

The options (`state`, `stepIncrement`, `commandPriority`) can also be passed as `createSystem`'s second argument, which overrides `defaultOptions`. `stepIncrement` only throttles agent systems, and only their `onStep`; build and unit systems step every time, and other events are never skipped.

Inside handlers, `this.state` is the system's state and `this.setState(partial)` shallow-merges into it (or pass a function `current => next`, which must not mutate `current`). `this.pause()` and `this.unpause()` stop and resume the system's handlers; while paused, an `onStepPaused(world)` handler, if the system has one, is called each step instead. State and the paused flag reset to the initial values when a new game starts.

```ts
import { createSystem } from '@sc-bot/core';
import type { World } from '@sc-bot/core';

const counter = createSystem({
    name: 'Counter',
    defaultOptions: { state: { steps: 0, label: 'none' } },
    async onStep(world: World) {
        this.setState((current: { steps: number }) => ({ steps: current.steps + 1, label: 'running' }));
        if (this.state.steps > 100) this.pause();
    },
});
```

When two systems command the same unit in one step, the one with the higher `commandPriority` wins; at equal priority, the one mounted first by `agent.use()` wins, and the agent's own handlers beat every system. See [Command arbitration](./commands.md#command-arbitration). Engine systems (chat-debug among them) and the debug system run outside `runAsCommander`, so their commander is `'unknown'`.

### Agent systems

The default type. A plain bag of event handlers with its own state, as above. `stepIncrement` throttles its `onStep`.

### Unit systems

A system with `type: 'unit'` manages units by type (`units: number | number[]`) and/or label (`labels: string | string[]`). Besides the event handlers common to all systems, it gets:

- `onNewUnit(world, unit)` when a matching unit is created or finished.
- `idleFunctions`: handlers for idle units, keyed by unit type, by label, or `labeled` (any labelled unit; it also receives the label). A unit's idle event picks the first match in this order: a function keyed by one of the system's labels the unit carries, `labeled` for a unit with any label, a function keyed by the unit type. Unmatched idle units fall through to `onUnitIdle(world, unit)`.
- `onUnitDestroyed(world, unit)` only for matching units.
- `onStep(world, units: UnitSystemUnits)`: the matching finished units, `{ all, unlabeled, labeled }`. `unlabeled` is keyed by unit type and leaves out units that carry one of the system's labels; `labeled` is keyed by label.

```ts
import { createSystem } from '@sc-bot/core';
import type { UnitSystemUnits, World } from '@sc-bot/core';
import { MARINE } from '@sc-bot/core/constants/unit-type';

const marines = createSystem({
    name: 'Marines',
    type: 'unit',
    units: [MARINE],
    labels: ['defender'],
    idleFunctions: {
        defender: async ({ resources }: World, unit) => {
            await resources.get().actions.holdPosition(unit);
        },
    },
    async onNewUnit(world: World, unit) {
        unit.labels.set('defender', true);
    },
    async onStep({ resources }: World, { all, unlabeled, labeled }: UnitSystemUnits) {
        const { actions, map } = resources.get();
        await actions.attackMove(unlabeled[MARINE] ?? [], map.getEnemyNatural().townhallPosition);
    },
});
```

### Build systems

A system with `type: 'build'` follows a build order or an opening. Its fields, string steps and `onStep(world, gameLoop, task?, result?)` are in [build-orders.md](./build-orders.md#build-system-members).
