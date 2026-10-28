# parity-2 design

Author: technical-architect (recorded verbatim by business-analyst, 2026-10-26).

Covers ares-gap ranked #4 (enemy memory with expiry, spatial index, army value) and #1 (influence grids plus cost-aware pathing). Builds on the T01 registry and the T03 executor. All paths are under packages/core/, checked against the worktree.

## Current state (verified)
- Enemy memory: out-of-vision enemies stay in `units._units[ENEMY]` forever. Only death removes them (systems/frame.ts:105). `isMemory()` and `age()` exist (engine/create-unit.ts:576-581). Nothing expires, and a ghost is never dropped even when we look at its last position.
- Range queries: `getClosest`/`closerThan` are O(n) scans (resources/units.ts:16).
- Army value: does not exist.
- Pathing: `map.path` runs PF.js A* on a full graph clone per call (resources/map.ts:493). Its weights are static wall-proximity values (:316). There are no threat grids.
- Effects: map.ts:212 `getEffects()`, kept up to date by systems/map.ts:446.
- Grid conventions: `map._grids.pathing` is `number[][]` indexed `[y][x]`, with 1 = blocked. `map.isVisible` means visibility == 2. Map size comes from `map.getSize()`.

## Conventions (all four resources)
- Grids are `Float32Array`, index `y * width + x`, width = `mapSize.x`.
- Values: 1 = free, above 1 = threatened, `Infinity` = blocked. A cell is safe when its value is at most 1.
- These are ares' conventions, so its weight tables and thresholds port 1:1.
- Hot paths allocate nothing per step: buffers are allocated once per map size and refilled with `.set()` and loops.
- Spatial and influence data are built lazily, once per game loop, on first access. A bot that never calls them pays nothing.

## P0. Registry step hook + scaffolding (blocks everything below)
types.ts:
```ts
export type ResourceDefinition<K ...> = { ...; onStep?(resource: NonNullable<ResourceContainer[K]>, world: World): void };
export interface ResourceManager { ...; step(world: World): void }
export interface ResourceContainer { ...; memory: EnemyMemory; spatial: SpatialIndex; influence: InfluenceResource; pathing: PathingResource }
```
- `step` runs each definition's `onStep` synchronously, in registration order.
- In engine/create-engine.ts `dispatch`: call `world.resources.step(world)` right after `Bluebird.mapSeries(engineSystems)`. At that point the frame, unit and map systems have refreshed units, visibility and effects, and no agent code has run yet.
- P0 also adds every interface below to types.ts, adds `memory`, `spatial`, `influence` and `pathing` to `CORE_RESOURCES` (engine/create-world.ts) after `actions`, and creates the four resource files as stubs whose methods throw `NodeSC2Error('not implemented')`.
- After that, P1-P5 each touch only their own files, plus the one file named per ticket.
- Follow: the T01 registry code.
- Tests: `onStep` order, and that it runs on every dispatch.

## P1. Enemy memory: resources/memory.ts
```ts
export type MemorySettings = { expireGround: number; expireAir: number };   // game seconds, default 30 / 30 (ares)
export interface EnemyMemory {
    getGhosts(): Units;                                                      // enemies out of vision, not yet forgotten
    getEnemies(opts?: { includeGhosts?: boolean; structures?: boolean }): Units;   // defaults true / true
    forget(tag: string): void;
    configure(settings: Partial<MemorySettings>): void;
}
```
Ghosts stay in the existing units store, so there is no parallel store.

The definition's `onStep` walks `units._units[ENEMY]` and skips current units. It deletes a ghost from the store when either:
- `age()` is past the expiry, using `expireAir` if `isFlying`, else `expireGround`; or
- all 4 cells around `floor(pos)` are visible and the unit is not burrowed (ares unit_memory_manager.py:184-215).

Burrowed ghosts are kept until they expire. Detection checks are a separate gap item.

`reset` is a no-op, so settings survive between games and per-game state lives in the units store, which T01 already resets.

Second file, systems/unit.ts: a forgotten tag that is seen again must not fire `enemyFirstSeen` again (:240). Track seen enemy tags per world, the same way as `seenUnitTagsByWorld` (:6). `enemyUnitEnteredVision` still fires.

Tests: use `createTestWorld` and `stepTo` with synthetic observations (FakeClient `setObservation`):
- an enemy leaves vision and becomes a ghost;
- the loop advances past 30s and the ghost is gone;
- the ghost's cells become visible and it is dropped;
- a burrowed ghost is kept;
- a re-seen tag does not refire `enemyFirstSeen`.

Follow: ares managers/unit_memory_manager.py:161-233, 361-377.
Don't touch: frame.ts dead-unit handling, units.ts.

## P2. Spatial index: utils/spatial/bucket-index.ts (pure) + resources/spatial.ts
```ts
export type SpatialKind = 'enemy' | 'enemyGround' | 'enemyAir' | 'own' | 'ownGround' | 'ownAir';
export interface SpatialIndex {
    unitsInRange(from: Point2D | Unit, distance: number, kind: SpatialKind): Units;
    anyInRange(from: Point2D | Unit, distance: number, kind: SpatialKind): boolean;   // exits at the first hit
    closest(from: Point2D | Unit, kind: SpatialKind, maxDistance?: number): Unit | undefined;
}
```
Bucket index (pure):
- Uniform grid with cell size 4. Built by counting sort: `Int32Array` bucket starts (prefix sums) and an `Int32Array` order holding unit indices.
- Buffers grow but never shrink.
- A query visits only the buckets that overlap the circle and compares squared distance. Distance is centre to centre, as ares does with its KD-tree, with no radius.

Resource:
- Rebuilds all 6 kinds together on the first query of each game loop. That is one pass over `memory.getEnemies()`, which includes ghosts like ares' enemy trees, plus own units from `getAlive(SELF)`.
- Ground/air split is by `isFlying`. Structures are included.
- `reset`: default.

Tests: the pure index against brute force on random points (radius edges, map borders, empty). One resource test that ghosts are included.
Follow: ares unit_memory_manager.py:397-534 (semantics only).

## P3. Army value: on the existing `units` resource (resources/units.ts + `UnitResource` type)
```ts
getArmyValue(alliance?: Alliance.SELF | Alliance.ENEMY, opts?: { includePending?: boolean; includeGhosts?: boolean }): number;   // minerals + vespene
```
- Counts `isCombatUnit()` units, valued at `world.agent.calculateCost(unitType)`.
- ENEMY with `includeGhosts` (default true) reads `memory.getEnemies()`.
- SELF with `includePending`: also counts production orders on own structures and eggs, mapped from ability to unit type through `world.data.findUnitTypesWithAbility`.
- Follow: ares unit_cache_manager.py:146-230.

## P4. Influence grids: constants/influence.ts + utils/grid/stamp.ts (pure) + resources/influence.ts
```ts
export type InfluenceLayer = 'ground' | 'air' | 'groundAvoidance' | 'airAvoidance';
export interface InfluenceGrid {
    readonly layer: InfluenceLayer; readonly width: number; readonly height: number;
    readonly data: Float32Array;            // read-only by contract
    get(point: Point2D): number;            // floors the point; out of bounds gives Infinity
}
export type InfluenceSettings = {
    rangeBuffer: number;          // 4  (ares RangeBuffer)
    effectsRangeBuffer: number;   // 1
    costMultiplier: number;       // 1
    effects: Partial<Record<number, { cost: number; range: number }>>;   // keyed by EffectId
};
export interface InfluenceResource {
    getGrid(layer: InfluenceLayer): InfluenceGrid;   // built on first call per game loop
    addCost(layers: InfluenceLayer | InfluenceLayer[], center: Point2D, radius: number, weight: number): void;   // lasts until the next loop
    configure(settings: Partial<InfluenceSettings>): void;
    drawDebug(layer: InfluenceLayer, opts?: { threshold?: number }): void;   // debug.setDrawCells, cells above threshold
}
```
Build (on first access per loop):
1. Base layers. ground and groundAvoidance come from `map._grids.pathing`: 1 if pathable, else Infinity. air and airAvoidance are 1 inside `frame.getGameInfo().startRaw.playableArea`, else Infinity. Re-reading pathing every build (about 35k cells) avoids invalidation when structures change pathing.
2. Units: one pass over `memory.getEnemies()`, skipping changelings (constants/unit-type.ts:71-73).
   - Units in `WEIGHT_COSTS` (ported from ares dicts/weight_costs.py) use the table.
   - Static D gets ares' structure handlers (grid_manager.py:589-712: bunker, PF, cannon, turret, spore, spine, auto-turret).
   - Everything else is generic: if `groundDps()` is above 0, stamp ground with weight = groundDps and radius = `groundRange() + rangeBuffer` (melee units, range < 2, use radius = rangeBuffer). The same with `airDps`/`airRange` for air.
3. Effects from `map.getEffects()`, with defaults from ares config.yml: storm 600/3.5, bile 100/3, liberator zones (both morph effect ids) 500/6, lurker spines 600/1 per position, blinding cloud 300/3.5, nuke 1000/8. Stamp them while the effect is present; there is no landing-time prediction. Effects also go to the avoidance layers, following ares' grid lists per handler. Units that ares writes into avoidance grids do the same here; the dev ports the list from grid_manager.py.

`stamp.ts`:
```ts
addCircle(data: Float32Array, width: number, height: number, cx: number, cy: number, radius: number, weight: number): void
```
- Row spans: for each dy, half-width = floor(sqrt(r² - dy²)), add over that contiguous span, clipped to the grid.
- No allocation. Infinity stays Infinity.

`reset`: keep settings, drop buffers. They are reallocated lazily for the new map size.

Tests:
- stamp: exact cell set for small radii, clipping, Infinity preserved.
- resource (fixture with enemies, acropolis 896):
  - a cell inside enemy range is above 1 and a cell far away is 1;
  - air vs ground split;
  - an effect stamps the avoidance layer;
  - `addCost` survives within the loop and is gone next loop;
  - two `getGrid` calls in one loop build once (spy).

Follow: ares managers/grid_manager.py:209-288, 399-900; dicts/weight_costs.py; config.yml:49-80.

## P5. Pathing: utils/pathing/astar.ts (pure) + resources/pathing.ts
Pure A*:
```ts
export function createAStar(width: number, height: number): {
    findPath(costs: Float32Array, start: number, goal: number, maxExpanded?: number): Int32Array | null;   // cell indices, start excluded
};
```
- 8-connected. The cost of entering a cell is its value, times √2 on diagonals.
- No corner cutting: a diagonal move is not allowed if either orthogonal neighbour is Infinity.
- Heuristic: octile distance with minimum cell cost 1, so it is admissible.
- The start cell is always passable.
- Buffers allocated once per instance:
  - `Float32Array g`
  - `Int32Array parent`
  - `Uint32Array` open/closed generation stamps; a generation counter replaces clearing, so per-query reset is O(1)
  - a binary heap on `Int32Array`/`Float32Array` with lazy deletion (stale entries are skipped on pop), growing when full.

Resource:
```ts
export type PathOptions = { layer?: InfluenceLayer | InfluenceGrid; sensitivity?: number; maxExpanded?: number };   // default layer 'ground'
export interface PathingResource {
    findPath(start: Point2D, goal: Point2D, opts?: PathOptions): Point2D[];      // cell centres; [] when unreachable
    nextPoint(start: Point2D, goal: Point2D,
        opts?: PathOptions & { senseDanger?: boolean; dangerDistance?: number; dangerThreshold?: number }): Point2D;
    closestSafeSpot(from: Point2D, opts?: { layer?: InfluenceLayer | InfluenceGrid; radius?: number }): Point2D | undefined;
    isPositionSafe(point: Point2D, opts?: { layer?: InfluenceLayer | InfluenceGrid; limit?: number }): boolean;
}
```
- `findPath`: if the goal is blocked, retarget it to the nearest finite cell within 3; otherwise return [].
- `nextPoint` (ares semantics, path_manager.py:251-340; defaults sensitivity 5, senseDanger true, dangerDistance 20, dangerThreshold 5):
  - With senseDanger, scan the square of radius dangerDistance around start for a finite cell at or above the threshold. If there is none, return goal without running A*.
  - Otherwise return path point index `min(sensitivity, len) - 1`, or goal when there is no path.
- `closestSafeSpot` (default radius 11): one scan of the circle for the minimum finite value, with ties broken by distance.
- `isPositionSafe` (default limit 1): `grid.get(point) <= limit`.
- One `createAStar` instance per map size, created lazily.

Tests:
- Pure A*: straight line on an open grid, detours around a cost blob when that is cheaper, no corner cutting, unreachable gives null, and 1000 consecutive queries match a fresh instance (generation reuse).
- Resource on a fixture with a stamped cost: nextPoint skips A* when there is no danger nearby, closestSafeSpot leaves a stamped circle, isPositionSafe.

Don't touch: `map.path`, PF.js, systems/map.ts. Static map analysis keeps PF.

## P6. Docs
readme.md + docs/api.md sections for memory, spatial, influence, pathing and army value. Remove spatial from the readme's "Known limitations". Add a changelog entry.

## Order / file ownership
- P0 is blocked by T04, because it shares types.ts, create-world.ts and create-engine.ts with the T01-T04 chain.
- After P0: P1 (memory.ts, systems/unit.ts) comes first.
- Then P2 (spatial), P3 (units.ts) and P4 (influence) run in parallel. They need memory at runtime and their files don't overlap.
- The pure A* (utils/pathing/astar.ts + test) can run in parallel any time after P0. The pathing resource follows P4.
- P6 comes after all of them and after T05.
- bot/: additive only, no breakage.

## Decisions taken (for the team lead's log)
- D1. Per-step updates go through `ResourceDefinition.onStep` (sync, registration order), run after engine systems and before agent code. A new manager is then fully self-contained in its definition, which is the goal of Fix 1. A separate engine system per resource would bring back the "touch several places" problem.
- D2. Spatial and influence are built lazily once per game loop: zero cost for bots that don't use them, and no ordering problems.
- D3. Ghosts stay in the units store instead of a parallel store, so every existing `getAll(ENEMY)` user sees the same truth. Expiry deletes them, which also fixes unbounded growth. Re-seen tags don't refire `enemyFirstSeen`. Expiry defaults are 30s/30s as in ares. Burrowed ghosts are kept until they expire, because detection is a separate gap item.
- D4. The spatial index uses uniform buckets, not a KD-tree: O(n) build on typed arrays, simpler in JS, and as fast at SC2 unit counts. Distances are centre to centre, like ares.
- D5. Army value is a `units.getArmyValue` query, not a new resource. It is a stateless query like `getCombatUnits`, so a resource would be ceremony.
- D6. Pathing uses its own typed-array A* with generation-stamped buffers instead of PF.js. PF.js needs a node graph clone per call, which is the bottleneck named in the gap. `map.path` and PF.js stay for static map analysis.
- D7. Grids use ares conventions (1 free, Infinity blocked, safe at most 1), so weights and thresholds port without retuning.
- D8. Layers are ground, air, groundAvoidance and airAvoidance. Climber, tactical, airVsGround and groundToAir are left out: the Terran bio bot doesn't need them, and they can be added later as extra layers in the same build pass.
- D9. Effects are storm, bile, lib zones, lurker spines, blinding cloud and nuke, stamped while present. KD8 is skipped because it is not an API effect, and parasitic bomb is skipped because it is a buff on a unit. Delayed-landing prediction is skipped too. All can be revisited.
- D10. Settings survive game resets, through a custom `reset` that keeps them.
- D11. Ghosts are included in the enemy spatial kinds and in influence, matching ares, which merges memory units into enemy_units.

Nothing needs the user.

## Addendum (technical-architect, 2026-10-26): roadmap exit gaps

A1. Snapshots apart from moved units (roadmap exit 1):
- `EnemyMemory` gets `getSnapshots(): Units`: enemy structures SC2 currently reports with `isSnapshot()` (engine/create-unit.ts:567).
- `getGhosts()` stays "out of observation, not yet forgotten". Snapshots are current units, so they never expire. When they go out of observation they become ghosts and are forgotten by the visibility rule.
- P1 test: a snapshot structure is in `getSnapshots()` and not in `getGhosts()`.

A2. Avoidance fixture tests (roadmap exit 6). P4 tests add three cases on top of the existing ones:
- A sieged tank (SIEGETANKSIEGED, range 13 + buffer) makes a cell 15 away unsafe on ground and leaves air safe.
- A photon cannon or missile turret stamps the right layers through the structure handlers.
- A storm effect stamps ground, air and both avoidance layers.

A3. Perf budget (roadmap exit 7; A3 says the budget is set in the phase design):
- New resources/pathing.perf.test.ts on the blueshift fixture, with about 20 enemy units injected near the path.
- Per run: build influence plus 50 `nextPoint` calls, with danger near the start so A* actually runs, across about 60-cell paths.
- Median over 20 runs must be at most 10 ms, measured with `performance.now()` around the same span the frame step timer records.
- It belongs to P5.

A4. P0 scope:
- "Every interface" includes `UnitResource.getArmyValue` in types.ts, with a throwing stub in resources/units.ts.
- So P3 only touches resources/units.ts, and P0 is the only phase-2 ticket that edits types.ts, create-world.ts, constants/index.ts or index.ts.
