# Commands, arbitration and errors

The `actions` resource sends commands and queries. The unit command methods (`attack` to `do` below, plus `stop`, `holdPosition`, `repair` and `returnResource`) don't send right away: they propose the command and resolve with no value. The engine sends every proposal of the step in one request after all systems have run, one command set per unit, and decides who wins when several handlers command the same unit (see [Command arbitration](#command-arbitration)). Given an empty unit list they do nothing.

A method still rejects at once when its preconditions fail (`BuildError`, `TrainError`, `GatherError`, `ActionManagerError`, see [Errors](#errors)); what happened to the command itself arrives the next step as an `onCommandResults` event (see [`CommandResult`](#commandresult)).

`queue` is the SC2 "shift-queue" flag: `false` replaces the unit's orders, `true` appends. Its default differs per method and is listed on each.

## actions

#### `actions.attack(units?: Unit[], target?: Unit, queue = false) => Promise<void>`

Attack a unit. Rejects (`ActionManagerError`) without a target unit; an empty unit list proposes nothing.

#### `actions.attackMove(units?: Unit[], position?: Point2D, queue = false) => Promise<void>`

Attack-move. Without a position, the first possible enemy start location is used; rejects (`ActionManagerError`) when neither is available.

#### `actions.move(units: Unit | Unit[], target: Point2D | Unit, queue = false) => Promise<void>`

#### `actions.smart(units: Unit[], target: Point2D | Unit, queue = false) => Promise<void>`

Move to / right-click a position or unit.

#### `actions.patrol(units: Unit | Unit[], positions: [from: Point2D, to: Point2D] | Point2D, queue = false) => Promise<void>`

Proposes a move to `from` (default: the first unit's position), then a queued patrol to `to`, from the same commander.

#### `actions.stop`, `actions.holdPosition`, `actions.returnResource` `(units: Unit | Unit[], queue = false) => Promise<void>`

#### `actions.repair(units: Unit | Unit[], target: Unit, queue = false) => Promise<void>`

Shortcuts for `do` with the matching ability.

#### `actions.gather(worker: Unit, mineralField?: Unit, queue = true) => Promise<void>`

Mine. Without a field, picks the closest finished own base that is below its ideal harvester count (or the closest base), and of that base's three nearest mineral fields the one closest to the worker. Rejects (`GatherError`) for a unit that isn't a worker or MULE, or when there is nothing to mine. A worker with the `command` label is always queued, whatever `queue` says.

#### `actions.mine(workers: Unit[], gasBuilding: Unit, queue = true) => Promise<void>`

Like `gather`, for gas. Must be given the target gas building.

#### `actions.build(unitType: number, target?: Unit | Point2D | null, worker?: Unit) => Promise<void>`

Build `unitType` on a position or on a target unit (a geyser). Pass `null` as the target and the worker third for abilities that take no target. Picks a worker when none is given (through [`mining.selectWorker`](./macro.md#mining) when mining is enabled, otherwise the rule in [macro.md](./macro.md#builder-pick); a busy worker is taken instead of rejecting; the same fallback applies when `mining.selectWorker` returns nothing). The worker gets the `command` label right away; if the build is dropped or SC2 rejects it, the label is removed again during the flush. A gas building is followed by a queued `gather` from the same commander. Nothing is refunded for a build that isn't sent.

Rejects with `BuildError` for each of: missing tech, not affordable, a target the build ability doesn't accept (or none where one is required), no builder found.

#### `actions.buildGasMine() => Promise<void>`

Build a gas building on a free geyser at an owned base. Rejects with `BuildError` when there is none.

#### `actions.train(unitType: number, producer?: Unit) => Promise<void>`

Train. Without a producer it picks a facility that can train the type and has no queue (nor an order this step), preferring a gateway over a warp gate; a warp gate warps the unit in at a free powered spot. Rejects with `TrainError` for missing tech, not affordable, no free producer, or a warp gate on cooldown or without a free powered spot.

#### `actions.upgrade(upgradeId: number, facility?: Unit) => Promise<void>`

Research. Without a facility it picks one that can research the upgrade and has no queue. Rejects with `TrainError` when the upgrade isn't affordable or there is no free facility.

#### `actions.warpIn(unitType: number, opts?: WarpInOptions) => Promise<void>`

Warp in up to `maxQty = 1` units at distinct free points of a power field near `nearPosition` (`opts = { nearPosition?, maxQty?, highground? }`), using as many ready warp gates. Rejects (`ActionManagerError`) when not even one is affordable, no warp gate is ready, or no point is free. Warp gate readiness comes from `unit.abilityAvailable`, so with `skipAvailableAbilitiesQuery` fetch it first (see [agents.md](./agents.md#settings)).

#### `actions.swapBuildings(a: Unit, b: Unit) => Promise<void>`

Lift two Terran buildings and land each in the other's spot. Delegates to [`flying.swap`](./macro.md#flying): resolves with no value once the plans are made, not when the buildings have landed. Rejects (`ActionManagerError`) if either can't lift or isn't finished.

#### `actions.do(abilityId: number, tags: string | string[] | Unit[], opts?: AbilityOptions) => Promise<void>`

Any ability. `opts = { target?: Unit | Point2D, queue = false }`; any other `target` value is ignored.

#### `actions.toggleAutocast(units: Unit | Unit[], abilityId: number) => Promise<ResponseAction>`

Sent immediately, not arbitrated.

#### `actions.chatSend(message: string, teamOnly = false) => Promise<ResponseAction>`

Sent immediately.

#### `actions.surrender() => Promise<unknown>`

Leave the game; `runGame` resolves with your `DEFEAT` (see [running-games.md](./running-games.md)).

#### `actions.canPlace(unitType: number, positions: Point2D[]) => Promise<Point2D | false>`

Queries SC2 for at most 10 of the positions (sampled at random from longer lists) and returns one random placeable position, or `false`. [`placement.canPlace`](./macro.md#placement) checks one position on the grids without a query.

#### `actions.findPlacement(unitType: number, near: Point2D, options?: FindPlacementOptions) => Promise<Point2D | false>`

Returns `near` itself when `unitType` can be placed there, otherwise searches outward in square rings `placementStep` apart and returns a position from the first ring with valid spots, or `false`. Options: `maxDistance = 20`, `placementStep = 2`, `randomAlternative = true` (pick randomly among the valid spots of that ring, instead of the closest) and `addonPlace = false` (also require room for a Terran add-on). For Terran and Protoss, [`placement.request`](./macro.md#placement) returns precomputed spots with flags and reservations.

#### `actions.sendAction(commands: ActionRawUnitCommand | ActionRawUnitCommand[]) => Promise<ResponseAction>`

#### `actions.sendQuery(query: RequestQuery) => Promise<ResponseQuery>`

Raw commands, sent immediately (see [below](#sending-immediately)), and a raw SC2 query (`pathing`, `abilities`, `placements`).

#### `actions.queueAction(commands: ActionRawUnitCommand | ActionRawUnitCommand[], opts?: { onNotSent?: (tags: string[], result: CommandResult) => void }) => void`

Proposes raw unit commands under the current commander. Throws `ActionManagerError` for a command without `unitTags`. `onNotSent` is called during the flush with the proposal's tags that were dropped or rejected, before the `commandResults` event is written.

#### `actions.flushQueuedActions() => Promise<ResponseAction | undefined>`

Arbitrates and sends the proposals now (the engine calls it after all agent systems). Writes a `commandResults` event when there were proposals, and resolves with SC2's response, or `undefined` when nothing was sent. Rejects when the request fails, after reporting every proposal in it as `rejected` with `error`.

#### `actions.clearQueuedActions() => void`

Discards the proposals and forgets the units committed this observation.

#### `actions.unitTagsReceivedAction() => Set<string>`

The tags proposed or sent for the current observation, by any commander.

#### `actions.as<T>(context: Partial<CommandContext>, fn: () => T) => T`

Runs `fn` with a different commander; what `context` (`{ owner, priority, rank }`) doesn't set is taken from the current one.

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

## Command arbitration

Every proposed command belongs to a commander `{ owner, priority, rank }` (`CommandContext`):

| Commander | `owner` | `priority` | `rank` |
|---|---|---|---|
| The agent's own handlers | `'agent'` | `settings.commandPriority`, default `0` | `-1` |
| An agent system | its `name` | its `commandPriority`, default `0` | its index in `agent.use()` order |
| Anything else (code outside any handler or system, such as a test) | `'unknown'` | `0` | `Infinity` |

The engine tracks this through `await`s and Bluebird callbacks, so a handler doesn't pass anything. At the end of the step, after all systems have run, it decides per unit tag:

- **One commander wins.** The highest priority wins; at equal priority the lowest rank (the agent, then systems in `agent.use()` order). All commands of the other commanders for that unit are dropped (`reason: 'outranked'`).
- **The winner keeps all its commands** for that unit, in the order it proposed them, so a build followed by a queued gather or two trains on a reactor both go out.
- **Repeats are dropped** (`reason: 'repeat'`). A command that repeats the unit's current order (same ability and target, not queued) is not sent, like python-sc2's `prevent_double_actions`. Re-issuing an order every step is a no-op.
- **Identical commands are merged.** Units whose only command is the same (ability, target, queue flag) get one command with all of them.
- **A dropped or rejected build frees its worker.** The worker loses its `command` label in the same step, so it isn't reported stuck. Nothing is refunded: money spent on a proposal comes back with the next observation.
- **Exclusive roles.** A command from a commander other than the unit's exclusive [role](./combat.md#roles) owner is dropped (`reason: 'not-owner'`).

A command proposed after the flush, from a promise a handler didn't await, goes out with the next step's.

`actions.as({ owner?, priority?, rank? }, fn)` overrides the commander for everything `fn` proposes, including after `await`s. `rank` is the tie-break at equal priority, lower wins.

### Sending immediately

`sendAction`, `toggleAutocast` and `chatSend` (and `surrender`) send at once, outside arbitration. Units given a command through `sendAction` count as commanded for the rest of the observation: a proposal from another commander is dropped unless it strictly outranks the sender (higher priority, or at equal priority a lower rank); the sender's own follow-ups still go out. These calls are not reported in `onCommandResults`.

### `CommandResult`

The step after a flush, handlers named `onCommandResults` receive `CommandResult[]`: one entry per proposal and outcome (a proposal for several units that partly lost gets two).

```text
CommandResult {
    owner: string;                                     // who proposed it
    command: SC2APIProtocol.ActionRawUnitCommand;      // as proposed
    tags: string[];                                    // the units this outcome covers
    outcome: 'won' | 'dropped' | 'rejected';
    reason?: 'outranked' | 'repeat' | 'not-owner';     // dropped only
    by?: string;                                       // outranked: the winning commander; not-owner: 'role:<ROLE>'
    result?: SC2APIProtocol.ActionResult;              // a sent command: SC2's result
    error?: string;                                    // rejected because the request itself failed: its message
}
```

`won` means sent and SC2 accepted it, `dropped` means not sent, `rejected` means SC2 refused it (`result` holds the code) or the request failed (`error`). A command SC2 refuses is also logged on `sc2:debug:actionManager`; it doesn't throw anywhere.

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

The commander is tracked with `AsyncLocalStorage`. To carry it through Bluebird callbacks, importing `@sc-bot/core` turns on Bluebird's `asyncHooks` for the whole process, which costs about 0.1 ms per step.

## Errors

All classes are exported from `@sc-bot/core`; check them with `instanceof`. Each carries `message`, and the three action errors (`BuildError`, `TrainError`, `GatherError`) also `data` (defaulting to `{}`) and `status` (`0`). Other throw sites set `data` only where listed.

```text
Error
 +- NodeSC2Error                 (name "NodeSC2Error")
 |   +- ActionManagerError
 |   |   +- BuildError, TrainError, GatherError
 |   +- MapDecompositionError
 +- GameEndedError               (not a NodeSC2Error)
 +- ConnectionClosedError        (not a NodeSC2Error)
```

Notable throw sites, not an exhaustive list. The `Units` collection throws are in [units.md](./units.md), `map.closestPathable` in [map.md](./map.md#mapclosestpathablepoint-point2d-radius--3--point2d), and the launcher and engine throws in [running-games.md](./running-games.md).

| Class | Thrown by | `data` |
|---|---|---|
| `BuildError` | `actions.build`: no tech, can't afford, target the ability doesn't accept or none where required, no builder found | `{ unitTypeId, pointOrUnitOrNone, worker }` |
| | `actions.buildGasMine`: no free geyser at an owned base | `{}` |
| `TrainError` | `actions.train`: no tech, can't afford, no free producer, warp gate on cooldown or without a free point | `{ unitTypeId, productionUnit }` |
| | `actions.upgrade`: can't afford, no free facility | `{ upgradeId, upgradeFacility }` |
| `GatherError` | `actions.gather`: not a worker or MULE; no field given and no finished own base with mineral fields | `{ unit, mineralField, queue }` |
| `ActionManagerError` | `actions.attack` without a target unit | `{ units, unit }` |
| | `actions.attackMove` without a position and no known enemy start | `{ units, position }` |
| | `actions.swapBuildings`: a building can't lift or isn't finished | `{ unitA, unitB }` |
| | `actions.warpIn`: nothing affordable, no ready warp gate, no free point | `{ unitType, opts }` (none for the warp gate case) |
| | `actions.queueAction`, and so every command method, given a command without `unitTags` | `{ command }` |
| `MapDecompositionError` | The first `mapAnalysis` query that needs the analysis (`getRegions` and everything built on it), when the start grids are missing. The eager run at game start (`features.eagerMapAnalysis`) logs it once on `sc2:debug:mapAnalysis` instead of throwing. | |
| `NodeSC2Error` | `parseBuildOrder` and build systems with a string step that doesn't parse (see [build-orders.md](./build-orders.md#string-steps)) | |
| | A build system with an unknown or unpickable opening at game start, and `switchOpening` with an unknown name | |
| | `createEngine` config: missing explicit config file, malformed JSON or not an object, `gameStep` not a positive integer, a non-boolean feature, `STEP_COUNT` not a positive integer (see [running-games.md](./running-games.md#config-file)) | |
| | `resources.register` of a name that is already registered | |
| | `units.getArmyValue` with an alliance other than `SELF` or `ENEMY` | |
| | `spawnController` composition: a priority outside the integers 0-10, or proportions that don't sum to 1 | |
| `GameEndedError` | The frame system when the observation carries player results (`data`: the `PlayerResult[]`), and the engine loop when the status leaves the game | `PlayerResult[]` for the first |
| `ConnectionClosedError` | Any pending or later SC2 request after the websocket closed | |

`err instanceof NodeSC2Error` matches `ActionManagerError`, its three children and `MapDecompositionError`. `GameEndedError` and `ConnectionClosedError` extend plain `Error`: they mean the game is over, so a `catch` that swallows errors should rethrow them (the engine handles them: `runGame` resolves with the results of a game that ended).

### How errors surface

An event handler that throws or rejects does not stop the game. The engine and `createSystem` catch it, and handle it by class. A rethrown `GameEndedError` ends the game through `onGameEnd`; a rethrown `ConnectionClosedError` rejects `runGame`:

| Error | Agent handlers | System handlers, resource `onStep` |
|---|---|---|
| `GameEndedError`, `ConnectionClosedError` | Rethrown | Rethrown |
| `NodeSC2Error` and subclasses | Dropped (logged only on `sc2:silly:engine`) | Dropped (logged only on `sc2:silly:system`; resources: `sc2:debug:resources`) |
| Anything else | `console.warn` | Logged on `sc2:debug:system` (resources: `sc2:debug:resources` plus `console.warn`) |

So a `BuildError` you don't catch silently ends that handler; catch the error classes you care about (see the example above) or you won't see them. A failed flush request is logged on `sc2:debug:engine` and the step goes on, except for the two fatal classes.
