# Macro

Everything that spends money on structures and units: the agent's macro helpers, the placement solver, the building tracker, worker mining and flying structures.

The pieces stack. `placement` knows where structures can go and reserves the spots. `buildings` takes a spot (or asks `placement` for one), picks a worker, walks it there, sends the build command, retries it and watches the structure until it is done. `mining` is the only worker manager: it keeps workers gathering and hands them out when something else needs one. `flying` moves Terran structures around. The agent helpers (`agent.train`, `agent.expandNow`, ...) sit on top and are what most bots call each step. [Build orders](build-orders.md) drive the same pieces from a list of steps, and the [controllers](behaviors.md#controllers) wrap them into plan steps.

All the commands in this page are proposed like every other command and go out at the end of the step; see [Command arbitration](commands.md#command-arbitration). Settings given to `configure` survive a new game on the same engine; the state each resource builds up (spots, tracked builds, assignments, plans) does not; see [Per-game reset](resources.md#per-game-reset).

```ts
import { createAgent } from '@sc-bot/core';
import { Race } from '@sc-bot/core/constants/enums';
import { MARINE, SCV, SUPPLYDEPOT } from '@sc-bot/core/constants/unit-type';
import { TERRANINFANTRYWEAPONSLEVEL1 } from '@sc-bot/core/constants/upgrade';

const bot = createAgent({
    settings: { race: Race.TERRAN },
    async onGameStart({ resources }) {
        resources.get().mining.configure({ enabled: true });
    },
    async onStep({ agent, resources }) {
        const { buildings } = resources.get();

        if (agent.supplyLeft < 3 && agent.alreadyPending(SUPPLYDEPOT) === 0 && agent.canAfford(SUPPLYDEPOT, { supply: true })) {
            buildings.build(SUPPLYDEPOT, { placement: { flags: ['wall'] } });
        }

        if (agent.supplyWorkers < 22) await agent.train(SCV);
        await agent.train(MARINE, { count: 2 });
        await agent.research(TERRANINFANTRYWEAPONSLEVEL1);

        if ((agent.minerals ?? 0) > 400) await agent.expandNow();
    },
});
```

## Agent macro helpers

These follow python-sc2's `BotAI` helpers of the same names. For `canAfford`, `calculateCost`, supply getters and the earmark rules, see [Cost and supply](agents.md#cost-supply-and-affordability).

`train` and `research` deduct what they spend from `agent.minerals` and `agent.vespene` right away, and `train` also adds the supply it uses to `foodUsed`, so a second call in the same step doesn't spend the same money or supply twice. The deduction happens when the command is proposed, even if the command later loses arbitration or SC2 rejects it, until the next observation corrects it. `train` and `research` skip structures that already received a command for the current observation (`actions.unitTagsReceivedAction()`). `expandNow` deducts nothing on proposal: the tracker spends the cost when it sends the build command, so `canAfford` keeps passing while the worker walks.

#### `agent.alreadyPending(unitType: number) => number`

Count of that unit or structure in production: from orders, unfinished units (an unfinished Terran structure counts once, whether or not an SCV is on it) and tracked builds whose worker has no build order yet. An archon counts half of its warp targets. Returns `0` and logs on `sc2:debug:Macro` for a type without a creation ability.

An abandoned unfinished Terran structure (its SCV died) counts as pending until something resumes or cancels it. The building tracker [resumes it](#resuming) once the bot has built through it; a bot that doesn't use the tracker must resume or cancel it itself.

#### `agent.alreadyPendingUpgrade(upgradeId: number) => number`

`1` if owned, otherwise the research progress from 0 to 1 (`0` when it isn't being researched).

#### `agent.structureTypeBuildProgress(unitType: number) => number`

Best build progress among your structures of that type and its equivalents, and among units in production by their creation ability.

#### `agent.techRequirementProgress(unitType: number) => number`

Progress (0 to 1) of the structure `unitType` requires; `1` when it requires none. `agent.hasTechFor(unitType)` is `techRequirementProgress(unitType) >= 1`.

#### `agent.workerEnRouteToBuild(unitType: number) => number`

Workers whose orders are the build ability for `unitType`, not counting orders that target a structure already placed (an SCV on its building).

#### `agent.getNextExpansion() => Promise<Point2D | null>`

The townhall center of the spot `buildings.getNextExpansion()` picks: the first of `map.getAvailableExpansions()` that isn't blocked, targeted by a pending townhall build, unreachable or unsafe (see [buildings](#buildings)); `null` when none is left. No pathing query is made. `buildings.getNextExpansion` returns the floored cell, this adds `0.5` to each axis.

#### `agent.ownedExpansions() => Array<{ location: Point2D, townhall: Unit }>`

Your occupied expansions with their townhalls.

#### `agent.expandNow(unitType?: number, location?: Point2D) => Promise<void>`

Builds a townhall (`unitType`, default your race's first townhall type) at `location` (default `getNextExpansion()`) through [`buildings.build`](#buildings) with `at`, so it is tracked. Without a `location` it builds at the spot `buildings.getNextExpansion()` picks (corner coordinates, not the `getNextExpansion()` centre). Does nothing when there is no location, while an active townhall build of that type exists (`moving`, `ordered` or `constructing`; with a `location`, only one within 1 of it), or when the townhall is unaffordable.

#### `agent.train(unitType: number, opts?: { count = 1, near?: Point2D, idleOnly = true }) => Promise<number>`

Starts up to `count` units across your production structures, larva and warp gates, and resolves with how many were started. A reactor structure with no orders gets two at once for non-tech-lab units. Without `near`, structures with a reactor come first and ones with a tech lab last; with it, the nearest producer first. `idleOnly` allows one queued order per structure (two with a reactor) when `true`; `false` queues without limit.

Resolves `0`, starting nothing, when the tech requirement is unmet or the unit isn't affordable with its supply (`canAfford(unitType, { supply: true })`). A structure is skipped when it is unfinished, has already received a command this observation, is unpowered (Protoss; a nexus never is), or lacks the tech lab the unit needs. A warp gate warps in 4 away from a random pylon, and stops the whole call when there is no pylon.

#### `agent.research(upgradeId: number) => Promise<boolean>`

Starts the upgrade if it is affordable, the required building exists and is finished, the required previous level is owned, and an idle (and, for Protoss, powered) research structure is free. Resolves `false` otherwise; `true` when the command was proposed. Throws `Error` for an upgrade that isn't in the researched-from dictionary.

## placement

Precomputed building spots for Terran and Protoss, with reservations. In the first step in which the map's expansions, your race and the first map state are known, `placement` solves every base once and then answers `request` from that list without asking SC2. For Zerg nothing is solved: `request` returns `undefined` and `getPlacements` is empty (`canPlace` still works).

**What gets solved.** Terran: per base, 3x3 spots on a lattice that always leave room for an add-on (a 5x3 kernel), then 2x2 depot spots, with mineral lines kept free; at the main, the ramp wall (the barracks spot and the two corner depots, flag `wall`); at the natural, a bunker spot (flag `bunker`). Protoss: the wall pylon (flags `wall` and `productionPylon`) and wall buildings (flag `wall`) at the main ramp, then per base 2x2 pylon spots (flag `productionPylon`), 3x3 spots and more 2x2 spots, with one pylon per base flagged `optimalPylon` (the one with the most 3x3 spots in power range; the last on a tie, as in ares). Scanned spots on a different terrain height than their base, or within 6 of the main ramp's top, are dropped. The solver only sets the flags `wall`, `bunker`, `productionPylon`, `optimalPylon` and `custom`; the other `PlacementFlag` values (`reaperWall`, `supplyDepot`, `production`, `upgradeStructure`, `missileTurret`, `sensorTower`, `staticDefence`) exist for your own placements.

A spot is `available`, `reserved` or `taken`. It becomes `taken` when a grounded structure stands on it and `available` again when that structure is gone (a lifted-off building frees it). A reservation that nothing builds on is released after `reservationTimeout` seconds of game time; the check runs every 16 game loops.

```text
type BuildingSize = '2x2' | '3x3' | '5x5';
type PlacementState = 'available' | 'reserved' | 'taken';
type PlacementFlag =
    | 'wall' | 'reaperWall' | 'bunker' | 'supplyDepot' | 'production' | 'upgradeStructure'
    | 'missileTurret' | 'sensorTower' | 'staticDefence' | 'productionPylon' | 'optimalPylon' | 'custom';
type Placement = {
    readonly pos: Point2D; readonly size: BuildingSize; readonly base: Point2D;
    readonly flags: ReadonlySet<PlacementFlag>; readonly state: PlacementState;
    readonly tag?: string; readonly reservedAt?: number;
};
type UserPlacement = { pos: Point2D; size?: BuildingSize; unitType?: number; flags?: PlacementFlag[] };
```

(Signature sketch; the definitions are in `types.ts`.)

#### `placement.request(unitType: number, opts?: PlacementRequest) => Point2D | undefined`

A spot for a 2x2 or 3x3 structure, or `undefined`: for Zerg, before the solve, for any other size, or when no candidate is left. The picked spot is reserved unless `reserve: false`; you own the reservation: build on it, or `release` it.

```text
type PlacementRequest = {
    base?: Point2D; // default map.getMain().townhallPosition; the solved base closest to it is used
    closestTo?: Point2D; // default: the base (for `wall` at your main: the ramp's top)
    flags?: PlacementFlag[]; // tried in order; a flag no candidate carries is skipped
    findAlternative?: boolean; // = true; false: only the chosen base
    reserve?: boolean; // = true
    powered?: boolean; // = false; Protoss: only spots in range of a pylon
    pylonBuildProgress?: number; // = 1; minimum build progress of that pylon
};
```

Candidates are the `available` spots of the chosen size at that base that are free on the live grid right now (`canPlace`, add-on room included), powered when `powered` is set (a Protoss pylon at least `pylonBuildProgress` built, at the same height, within 6.5), and, for a pylon, not a spot meant for static defence. When there are none and `findAlternative` isn't `false`, the same is tried at your other occupied bases, nearest to `base` (default your main) first. The fallback only tries bases you own; an explicit `base` is used as given. Then:

- With the flag `wall`, wall spots that also carry another requested flag go first, then any wall spot, then non-wall spots, each closest to `closestTo` (default: the main ramp's top when the base is your main, else the base).
- Otherwise each flag in `flags` is tried in order and the first one with a candidate wins (closest to `closestTo`, default the base); a flag no candidate carries is skipped. With none left, the closest candidate that isn't `custom`, and `custom` ones only when nothing else exists.

#### `placement.reserve(pos: Point2D) => boolean`

Reserves the `available` spot at `pos`; `false` when there is none.

#### `placement.release(pos: Point2D) => void`

Makes the `reserved` spot at `pos` `available` again. Does nothing otherwise.

#### `placement.canPlace(unitType: number, pos: Point2D, opts?: { includeAddon?: boolean }) => boolean`

Whether the cells are free on the live placement and pathing grids (and off creep, unless Zerg or a hatchery or nydus canal), without a query to SC2. `includeAddon` defaults to `true` for barracks, factory and starport, which then include their add-on's cells. A gas building is placeable when no gas building is within 3.5.

#### `placement.getPlacements(filter?: { base?: Point2D; size?: BuildingSize; state?: PlacementState; flag?: PlacementFlag }) => Placement[]`

Frozen copies of the spots matching every given field.

#### `placement.add(placements: UserPlacement[]) => void`

Adds spots flagged `custom` (plus their own `flags`). `size` defaults to that of `unitType`, else `'3x3'`. Before the solve they are queued; a spot that can't be placed, overlaps another or is `5x5` is skipped.

#### `placement.configure(settings: Partial<{ reservationTimeout: number }>) => void`

`reservationTimeout = 60`, in game seconds.

#### `placement.drawDebug() => void`

Draws the spots through `debug` as the cell layer `'placement'`: green available, yellow reserved, red taken, aqua wall, purple custom.

### placer

`placer` is an optional resource, set with `resources.set({ placer })`, that supplies your own positions to the [build system](build-orders.md#how-the-builder-places-structures) and to the solver.

```text
type Placer = {
    place?: (world: World, unitTypeId: number) => Point2D[] | undefined;
    placements?: (world: World) => UserPlacement[] | undefined;
};
```

- `place` returns candidate positions for a unit type. For a structure other than gas or a townhall, the build system builds on the first one SC2 accepts, as a tracked build, before it consults the solver; `undefined` or an empty list falls through. Only the build system calls it: `actions.build` and `buildings.build` don't.
- `placements` returns per-map spots, added with `placement.add` at solve time. Use `placement.add` directly when you learn about spots later.

```ts
import type { World } from '@sc-bot/core';
import { SUPPLYDEPOT } from '@sc-bot/core/constants/unit-type';

export function setup(world: World) {
    world.resources.set({
        placer: {
            place: ({ resources }, unitTypeId) =>
                unitTypeId === SUPPLYDEPOT ? resources.get().map.getMainBaseRamp()?.cornerDepots : undefined,
        },
    });
}
```

```ts
import type { World } from '@sc-bot/core';
import { SUPPLYDEPOT } from '@sc-bot/core/constants/unit-type';

export async function onStep({ agent, resources }: World) {
    const { actions, placement } = resources.get();
    if (agent.supplyLeft >= 4 || agent.alreadyPending(SUPPLYDEPOT) > 0) return;

    const spot = placement.request(SUPPLYDEPOT, { flags: ['wall'] });
    if (!spot) return;
    try {
        await actions.build(SUPPLYDEPOT, spot);
    } catch (error) {
        placement.release(spot);
        throw error;
    }
}
```

## buildings

The building tracker. Nothing runs until you call `build` or `buildGas`.

```text
status: 'moving' -> 'ordered' -> 'constructing' -> 'done'      or 'failed' (failure: reason)
```

```ts
// signature sketch
type TrackedBuild = {
    readonly id: number; readonly unitType: number; readonly target: Point2D;
    readonly geyserTag?: string; readonly workerTag?: string;
    readonly status: 'moving' | 'ordered' | 'constructing' | 'done' | 'failed';
    readonly requestedAt: number; readonly attempts: number; readonly structureTag?: string;
    readonly failure?: 'timeout' | 'cancelled' | 'noWorker' | 'noPlacement' | 'blocked';
};
```

(Signature sketch.) A build that finishes or fails stays in `getTracked()` for that step only. There are no tracker events; poll `getTracked()`.

#### `buildings.build(unitType: number, opts?: BuildOptions) => TrackedBuild | undefined`

Starts a tracked build and returns it, or `undefined` when there is no spot or no worker (a reservation it made is released).

```text
type BuildOptions = {
    at?: Point2D | Unit; // a position, or a geyser for a gas building; default placement.request(unitType, placement)
    placement?: PlacementRequest; // used when `at` is absent, and again to re-place
    worker?: Unit; // forces the builder; default: see Builder pick
    earmark?: string; // an earmark name whose money is kept until the command is sent
};
```

#### `buildings.buildGas(opts?: { geyser?: Unit; max = 1 }) => TrackedBuild | undefined`

Builds your race's gas building on `geyser`, or on the free geyser closest to one of your townhalls (within 15 of a townhall that is at least 98% built, or 55% after 5:00 of game time). `undefined` when the tracked and unfinished gas buildings already number `max` or more, or no geyser is free. An enemy gas building within 4.5 of the geyser moves the build to the next free geyser. A geyser whose gas build SC2 rejected `maxAttempts` times is skipped, here and in that retarget, for 60 s; an explicit `geyser` ignores this.

#### `buildings.cancel(target: Unit | TrackedBuild) => void`

Cancels the structure with `CANCEL_BUILDINPROGRESS` if it is unfinished, and fails the active build with `'cancelled'`. Given a unit, it finds the build by structure tag or by position.

#### `buildings.pending(unitType?: number) => number`

Number of active builds you started, of that type if given. Resumed builds don't count.

#### `buildings.getTracked() => readonly TrackedBuild[]`

The active builds, resumed ones included, plus those that finished or failed this step.

#### `buildings.getNextExpansion(opts?: { checkSafe = true }) => Point2D | undefined`

The townhall position of the first available expansion (`map.getAvailableExpansions()` order) that isn't blocked (see `isExpansionBlocked`), isn't the target of another active tracked townhall build (within the same distance as the blocked check, so a worker still walking there counts) and, with `checkSafe`, is safe on `pathing.isPositionSafe`; expansions with no ground path from the main are skipped too. `expansionController` passes its `checkLocationIsSafe` to the pick.

#### `buildings.isExpansionBlocked(pos: Point2D) => boolean`

Whether a townhall at `pos` is blocked: `pos` is on the tracker's own list of spots SC2 rejected a townhall at (a spot leaves the list when an own detector unit or scan centre is within 7 of it and no enemy is within 9), an enemy ground unit other than an auto-turret is within 5.5, one of your townhalls is within 5.5, or a destructible or watchtower is within 5.5.

#### `buildings.configure(settings: Partial<BuildingSettings>) => void`

```ts
type BuildingSettings = {
    priority: number; // = 10, of the BUILDING-role commands
    timeout: number; // = 120, game seconds
    maxAttempts: number; // = 5
    cancelLowHp: 'tracked' | 'all' | 'off'; // = 'tracked'
};
```

Commands go out as the `BUILDING` role at `priority`, so they beat your agent's default priority 0 and `mining`'s -10.

### Builder pick

`buildings.build` and `actions.build` pick the worker the same way, from `selectBuilder` (`utils/workers/select-builder.ts`), unless a worker is forced.

1. A forced `worker` (`buildings.build` option, or the `worker` option of `actions.build`) is used as given.
2. With [`mining`](#mining) enabled, `mining.selectWorker(site, { forceClose: true, exclude })`: a mining worker near the site. The tracker takes it with the `BUILDING` role and, when this finds nobody, returns `undefined`. `actions.build` asks for `role: GATHERING`, so the worker stays in `GATHERING`, and falls through to the next step when this finds nobody. With mining disabled this step is skipped.
3. `selectBuilder`, for Protoss in `actions.build` (`reuseConstructing`) first: a worker that is already constructing (and otherwise a candidate) within 20 of the site is reused, with the new build queued behind its current one.
4. `selectBuilder`: candidates are workers with no role or the `GATHERING` role, without the `stuck` label, not in the exclusion set, not already constructing (an order of a build ability), and that have not received a command this observation. Workers that are idle, or whose only order is gathering, are preferred; when there are none, any candidate. The closest to the site wins.
5. `actions.build` queues the build behind a `HARVEST_RETURN` when a worker that `selectBuilder` picked carries resources (not for a forced or mining-picked one), and rejects with `BuildError` when no worker is found.

`exclude` is the workers of the tracker's other active builds plus the stalled workers of that unit type (see [Workers](#workers)); `actions.build` excludes only the stalled ones.

### Workers

The builder gets the `BUILDING` role and goes back to `GATHERING` (and to `mining`) when the build ends. A dead builder is replaced. `build` returns `undefined` when the pick finds nobody; `'noWorker'` is only set when a dead builder can't be replaced mid-build.

A moving worker that stands still for 10 s away from the target has stalled: the build is re-placed and gets a new worker (the stalled one goes back to `GATHERING`; a `worker` you passed is kept); a second stall fails it `'blocked'` (a build started with `at` fails on the first). For 60 s a stalled worker isn't picked for builds of that type, by the tracker or `actions.build`, with mining on or off.

### Each step

The worker moves to the target (within 1, or 3.2 for gas; a worker carrying resources returns them first), then the tracker waits for tech and money (minus other earmarks) and sends the build command. If that command is dropped or rejected the build goes back to `'moving'` and `attempts` goes up. After `maxAttempts` the building is re-placed by the placement solver (`'noPlacement'` when there is no spot; a build started with `placement` repeats that request), or, for gas, it fails `'blocked'` and puts its geyser on a 60 s cooldown (see `buildGas`). A spot that has become unplaceable before the command is re-placed too. A build started with `at` is never re-placed by the solver: where it would be, it fails `'blocked'` (the gas and townhall moves below still apply).

A townhall is moved to the next available expansion that can hold it (`getNextExpansion()` with the default `checkSafe: true`, plus `placement.canPlace`) when SC2 rejects the location (which puts the spot on the blocked list), the spot is on that list, or the spot can't be placed; it fails `'blocked'` when there is none. An enemy unit, rock or tower near the spot doesn't move it. An enemy gas building within 4.5 of the geyser moves a gas build to the next free geyser (`'blocked'` when none is left).

Terran builds are done at `buildProgress` 1 and an SCV that isn't building is sent back to the structure. Protoss and Zerg builds are done once the structure exists, and fail with `'timeout'` after `timeout` seconds if it never does (gas builds of every race have the timeout too). A reservation the build owns is refreshed every step, so a long wait doesn't lose the spot.

### Resuming

Once a `build` or `buildGas` call has returned a `TrackedBuild` in a game, the tracker adopts an own, unfinished Terran structure that has no builder and isn't a tracked build (an add-on, or an orbital or planetary fortress morph, is skipped): it sends a worker to finish it, one structure per step. Before the first call it leaves your workers alone. Adopted builds appear in `getTracked()` but not in `pending()`.

### Cancelling at low health

An unfinished structure that lost health since the previous step and is below `max(50, 9% of its max health)` is cancelled with `CANCEL_BUILDINPROGRESS`, which refunds most of its cost. `cancelLowHp: 'tracked'` covers the builds you started, Protoss and Zerg ones included after they count as done, but not adopted ones; `'all'` covers every unfinished structure; `'off'` turns it off.

```ts
import type { World } from '@sc-bot/core';
import { BARRACKS, SUPPLYDEPOT } from '@sc-bot/core/constants/unit-type';

export async function onStep({ agent, resources }: World) {
    const { buildings, units } = resources.get();

    if (agent.supplyLeft < 4 && agent.alreadyPending(SUPPLYDEPOT) === 0) {
        buildings.build(SUPPLYDEPOT, { placement: { flags: ['wall'] } });
    }
    if (units.getById(BARRACKS).filter((barracks) => barracks.isFinished()).length + agent.alreadyPending(BARRACKS) < 3) {
        buildings.build(BARRACKS, { placement: { flags: ['production'] } });
    }
    buildings.buildGas();
}
```

## mining

A worker-saturation manager with speed mining, danger avoidance and self-defence, after ares' mining. It is off by default and manages only workers in the `GATHERING` role (every worker but MULEs starts there) that aren't `command`-labelled or constructing. Until `mining.configure({ enabled: true })`, it assigns and commands nothing.

Each step it drops assignments to dead, mined-out or orphaned resources (no own townhall within 10 of a mineral field or 12 of a gas building), assigns gas first (up to `workersPerGas` for each ready gas building, one new gas worker per step, one worker released from each overfull building per step), then minerals (up to two workers per field of a townhall more than 85% built; the very first assignment is the opening split over the fields closest to your main). Its commands (`HARVEST_GATHER`, `HARVEST_RETURN`, `MOVE`, `SMART`, `ATTACK`) are proposed as the `GATHERING` role at `priority` -10, so a bot command for a worker (priority 0) wins and a worker you pull is simply not managed that step.

#### `mining.selectWorker(near: Point2D, opts?: { forceClose = false, minHealth = 0, minShield = 0, role = BUILDING, exclude?: ReadonlySet<string> }) => Unit | undefined`

Takes a worker for your own use, or `undefined`. It is unassigned and given `role`. Tags in `exclude` are never picked, nor are `command`-labelled or constructing workers. `minHealth` is a fraction of max health. `minShield` is a fraction of max shield and only applies to Protoss; other races ignore it. Without `forceClose` the closest unassigned worker is preferred; otherwise (and when none is unassigned) a mining worker not carrying resources, preferring ones at the base closest to `near`. Nothing is assigned while mining is disabled, so `forceClose` then finds no one.

#### `mining.release(worker: Unit | string) => void`

Unassigns the worker and puts it back in `GATHERING`.

#### `mining.getAssignment(worker: Unit | string) => MiningAssignment | undefined`

`{ kind: 'mineral' | 'gas', resourceTag: string, townhallTag: string }`, or `undefined` when the worker has none.

#### `mining.getWorkersOn(resource: Unit | string) => string[]`

Tags of the workers assigned to a mineral field or gas building.

#### `mining.getMineralTarget(mineral: Unit | string) => Point2D | undefined`

The point speed mining steps to for that field.

#### `mining.isEnabled() => boolean`

Whether `enabled` is set.

#### `mining.configure(settings: Partial<MiningSettings>) => void`

Throws `RangeError` when `workersPerGas` isn't an integer from 0 to 3.

```ts
type MiningSettings = {
    enabled: boolean; // = false
    priority: number; // = -10
    workersPerGas: number; // = 3
    speedMining: boolean; // = true
    townhallDistanceFactor: number; // = 1.08
    keepSafe: boolean; // = true
    fleeAtHealth: number; // = 0.5, fraction of health (plus shield for Protoss)
    weightSafetyLimit: number; // = 12, ground cost above which a worker flees
    selfDefence: boolean; // = true
    longDistanceMine: boolean; // = true
};
```

- **Speed mining** (`speedMining`, minerals only): when a worker is near the field's mining point, or the townhall's return point (`townhallDistanceFactor` scales its distance from the townhall's centre), it is sent to that point and then queued onto the field or the townhall, so it skips the slow turn-around. Gas workers use plain gather and return commands. It is weaker at the default step size of 4 game loops than at 2 or 1. The `speedMining({ worker, target, townhall? })` behavior runs the same move for one worker outside `mining`.
- **Safety** (`keepSafe`): a worker moves to the closest safe spot when its position is in the ground-avoidance layer, when it is not on a safe ground cell and its health (plus shield, for Protoss) is at or below `fleeAtHealth`, or when the ground cost at its position is over `weightSafetyLimit`. These use [`pathing`](map.md#pathing) and [`influence`](map.md#influence). With no safe spot it gets no command.
- **Self-defence** (`selfDefence`): while an enemy ground unit threatens one of your bases (`intel.getMainThreat('ground')`, see [`intel`](combat.md#intel)) and the worker's cell is not safe, a worker with its weapon ready attacks the weakest enemy in its range instead of fleeing, unless it is collecting and within 1 of its resource.
- **Long-distance mining** (`longDistanceMine`): a worker without an assigned resource (its base is gone, or all fields are full) mines at an unassigned field that is safe, close to the natural early on, or at the fields of a townhall under construction, and returns its cargo to the closest ready townhall. With no ready townhall it does nothing.

```ts
import { createAgent } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import { ATTACKING } from '@sc-bot/core/constants/unit-role';

const bot = createAgent({
    async onGameStart({ resources }: World) {
        resources.get().mining.configure({ enabled: true, workersPerGas: 2 });
    },
    async onStep({ resources }: World) {
        const { actions, intel, mining } = resources.get();
        const threat = intel.getMainThreat('ground');
        if (!threat) return;
        const worker = mining.selectWorker(threat.townhall.pos, { minHealth: 0.5, role: ATTACKING });
        if (worker) await actions.attack([worker], threat.ground.closestTo(worker));
    },
});
```

## flying

Lifts Terran structures, flies them and lands them, one plan per structure, advanced a step at a time. A structure is only commanded while it has a plan.

Each step, for every plan: a grounded structure is lifted (a `LIFT` replaces its queue first when it has other orders); a flying one moves towards the destination until it is within 5.5, then, when `land` is set, lands. A plan ends when the structure is gone or has landed within 0.5 of its destination. Two things it doesn't do for you: a plan whose destination never accepts a landing is re-proposed every step until you call `flying.cancel`, and a plan with `land: false` also lasts until you cancel it.

Flying commands are proposed as owner `'flying'` at priority 10, so your own commands for a structure in transit (priority 0) are dropped as outranked until the plan ends or you cancel it. `actions.swapBuildings(a, b)` is `flying.swap` after a check that both can lift and are finished (rejecting with `ActionManagerError` otherwise); it resolves with no value once the plans are made, not when the buildings have landed.

#### `flying.move(structure: Unit, destination: Point2D, opts?: { land = true }) => void`

Plans a flight, replacing any plan for that structure.

#### `flying.swap(a: Unit, b: Unit) => void`

Each structure plans a landing on the other's current position. No checks.

#### `flying.addonSwap(structure: Unit | number, addon: number) => boolean`

Plans a swap so the structure gets an add-on. `structure` is a unit, or a unit type (the first finished one without an add-on). `addon` is `REACTOR` or `TECHLAB` (any of their variants), or a specific add-on type. The add-on is the closest finished idle one; the structure it belongs to flies to the host's position, and the host lands at the add-on. Returns `false`, planning nothing, when there is no finished host or no such add-on.

#### `flying.cancel(structure: Unit | string) => void`

Drops the plan (a unit or its tag).

#### `flying.getPlans() => readonly FlightPlan[]`

`{ tag: string, destination: Point2D, land: boolean, state: 'lifting' | 'flying' | 'landing', startedAt: number }`; `startedAt` is a game loop.

#### `flying.configure(settings: Partial<{ priority: number }>) => void`

`priority = 10`.

```ts
import type { World } from '@sc-bot/core';
import { BARRACKS, REACTOR } from '@sc-bot/core/constants/unit-type';

export async function onStep({ resources }: World) {
    const { flying } = resources.get();
    if (flying.getPlans().length === 0) flying.addonSwap(BARRACKS, REACTOR);
}
```
