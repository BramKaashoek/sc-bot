# parity-4 design

Author: technical-architect-2 (recorded verbatim by business-analyst-2, 2026-10-26).
Paths are under packages/core/, checked against the worktree (core-arch T03 in progress in actions.ts). Section "Phase-3 contract" is provisional until technical-architect confirms; a delta follows if names change.

Covers ares-gap #5 (placement solver + building tracker), #6 (mining manager), #12 (flying structures / addon swap). Terran-first. Builds on core-arch (registry, executor, onNotSent) and parity-2 (onStep D1, pathing/influence/spatial).

## Current state (verified)
- Placement: `actions.findPlacement` (resources/actions.ts:320) rings outward from a point and asks SC2 `query.placements` per ring (plus a second query for addon room). `actions.canPlace` (:297) queries up to 10 random spots. builder-plugin (systems/builder-plugin.ts:332-387) calls findPlacement from a fixed anchor 8 towards map centre; `placer.place()` hook (:428, types.ts:818) returns raw positions that are still query-checked. No precomputed formations, no reservation: two systems in one step can get the same spot.
- Ramp wall maths exist (utils/map/ramp.ts:45-168: barracksCorrectPlacement, cornerDepots, protoss wall), reachable via `map.getMainBaseRamp()` (resources/map.ts:432). Natural wall = cells only (systems/map.ts:123 calculateWall → expansion.areas.wall), used by `getCombatRally` (resources/map.ts:242).
- Construction tracking: builder-plugin resets COMMAND_GIVEN after 250 loops (:270); frame.ts:74-85 labels a worker `stuck` when its `command` label isn't echoed in 250 loops. No reissue, no worker replacement, no low-HP cancel.
- Mining: SC2 auto-mining plus `agent.distributeWorkers` (agent/macro.ts:434, python-sc2 port, re-gathers surplus/idle workers). No patch bookkeeping, no speed mining, no worker safety. Builder pick: actions.build (:417-442, closest mineral worker) and macro.selectBuildWorker (:239); neither removes the worker from any bookkeeping.
- Flying: only `actions.swapBuildings` (:207-240), raw sends with two 100ms `Bluebird.delay`s; unused by bot/ and core.
- Grid bug that phase 4 depends on: systems/map.ts marks footprints unplaceable on unitCreated (:469) and free on unitDestroyed (:500), but a Terran structure lifting/landing is a type change, not create/destroy, so a lifted barracks leaves its cells blocked and a landed one at a new spot isn't blocked.

## Conventions
- Each phase-4 manager is a registered resource (core-arch Fix 1) whose per-step work runs in `ResourceDefinition.onStep` (D1: sync, after engine systems, before agent code).
- (Superseded by the Phase-3 contract delta below: role-managed commands use `roles.as`.) Resource-issued commands go through the executor: `actions.as({ owner: '<resource name>', priority: settings.priority }, () => actions.queueAction(cmd, { onNotSent }))`. Defaults: buildings 10, flying 10, mining -10. So the tracker and flying beat bot systems (priority 0) on their units, and any bot system command beats mining for that step.
- Settings via `configure(partial)`; `reset` keeps settings and drops per-game state (D10 pattern).
- Everything is opt-in or only acts on what the bot handed it: placement only answers requests; buildings/flying only drive builds/flights the bot asked for; mining does nothing until `mining.configure({ enabled: true })`. A bot that ignores phase 4 sees no behaviour change (except the map grid fix).
- Registration order (CORE_RESOURCES, after phase 2 and phase 3 resources): placement, buildings, mining, flying. placement bookkeeping (taken/expired) runs before the tracker reads it; the tracker claims builders before mining's pass so mining never proposes for them.
- Game time: 22.4 loops per game second for every "seconds" setting.

## P0 Scaffolding (types.ts, engine/create-world.ts, stubs)
types.ts additions (all phase-4 interfaces live in types.ts, like parity-2 P0):
```ts
export type BuildingSize = '2x2' | '3x3' | '5x5';
export type PlacementFlag =
    | 'wall' | 'reaperWall' | 'bunker' | 'supplyDepot' | 'production' | 'upgradeStructure'
    | 'missileTurret' | 'sensorTower' | 'staticDefence' | 'productionPylon' | 'optimalPylon' | 'custom';
export type PlacementState = 'available' | 'reserved' | 'taken';
export type Placement = {
    readonly pos: Point2D; readonly size: BuildingSize; readonly base: Point2D;   // base = expansion townhallPosition
    readonly flags: ReadonlySet<PlacementFlag>;
    readonly state: PlacementState; readonly tag?: string; readonly reservedAt?: number;   // reservedAt: game loop
};
export type PlacementRequest = {
    base?: Point2D;              // default: own main townhallPosition; snapped to the closest solved base
    closestTo?: Point2D;         // default: base (main + wall: main ramp top centre)
    flags?: PlacementFlag[];     // preference filters, see P1 selection
    findAlternative?: boolean;   // default true: other OWN occupied bases by distance to `base`
    reserve?: boolean;           // default true
    powered?: boolean; pylonBuildProgress?: number;   // protoss, P1b
};
export type UserPlacement = { pos: Point2D; size?: BuildingSize; unitType?: number; flags?: PlacementFlag[] };
export type PlacementSettings = { reservationTimeout: number /* game s, 60 (ares WorkerOnRouteTimeout) */ };
export interface PlacementResource {
    request(unitType: number, opts?: PlacementRequest): Point2D | undefined;
    reserve(pos: Point2D): boolean;           // false if not a known available spot
    release(pos: Point2D): void;              // reserved -> available; no-op otherwise
    canPlace(unitType: number, pos: Point2D, opts?: { includeAddon?: boolean }): boolean;   // grid-only, no SC2 query
    getPlacements(filter?: { base?: Point2D; size?: BuildingSize; state?: PlacementState; flag?: PlacementFlag }): Placement[];
    add(placements: UserPlacement[]): void;   // after solve too; validated with canPlace, invalid ones skipped with debug log
    configure(settings: Partial<PlacementSettings>): void;
    drawDebug(): void;
}
export type Placer = {
    place?: (world: World, unitTypeId: number) => Point2D[] | undefined;      // unchanged
    placements?: (world: World) => UserPlacement[] | undefined;               // NEW: per-map user placements, read once at solve time
};

export type TrackedBuildStatus = 'moving' | 'ordered' | 'constructing' | 'done' | 'failed';
export type TrackedBuild = {
    readonly id: number; readonly unitType: number;
    readonly target: Point2D; readonly geyserTag?: string;
    readonly workerTag?: string; readonly status: TrackedBuildStatus;
    readonly requestedAt: number; readonly attempts: number; readonly structureTag?: string;
    readonly failure?: 'timeout' | 'cancelled' | 'noWorker' | 'noPlacement' | 'blocked';
};
export type BuildOptions = {
    at?: Point2D | Unit;          // position, or geyser for gas; default: placement.request(unitType, opts.placement)
    placement?: PlacementRequest; worker?: Unit; earmark?: string;   // earmark passed to agent.canAfford
};
export type BuildingSettings = {
    priority: number;             // 10
    timeout: number;              // game s, 120 (ares BUILDING_WORKER_TIMEOUT); applies to non-Terran and gas
    maxAttempts: number;          // 5 rejected/dropped build orders before re-requesting a placement
    cancelLowHp: 'tracked' | 'all' | 'off';   // 'tracked'
};
export interface BuildingTracker {
    build(unitType: number, opts?: BuildOptions): TrackedBuild | undefined;   // undefined: no placement / no worker
    buildGas(opts?: { geyser?: Unit; max?: number }): TrackedBuild | undefined;   // max simultaneous gas builds, default 1
    cancel(target: Unit | TrackedBuild): void;   // CANCEL_BUILDINPROGRESS if started; drops tracking; releases placement + worker
    pending(unitType?: number): number;          // tracked builds not done/failed (ares building_counter / is_pending)
    getTracked(): readonly TrackedBuild[];       // includes done/failed from the current game loop only
    configure(settings: Partial<BuildingSettings>): void;
}

export type MiningSettings = {
    enabled: boolean;               // false
    priority: number;               // -10
    workersPerGas: number;          // 3; integer 0..3, other values throw RangeError (review delta 5)
    speedMining: boolean;           // true
    townhallDistanceFactor: number; // 1.08 (ares Mining.TownhallDistanceFactor)
    keepSafe: boolean;              // true
    fleeAtHealth: number;           // 0.5
    weightSafetyLimit: number;      // 12
    selfDefence: boolean;           // true
    longDistanceMine: boolean;      // true
};
export type MiningAssignment = { kind: 'mineral' | 'gas'; resourceTag: string; townhallTag: string };
export interface MiningResource {
    selectWorker(near: Point2D, opts?: { forceClose?: boolean; minHealth?: number; role?: UnitRole }): Unit | undefined;   // removes it from bookkeeping and sets `role` (default BUILDING; see review delta 1)
    release(worker: Unit | string): void;            // back to role GATHERING; reassigned on the next pass
    getAssignment(worker: Unit | string): MiningAssignment | undefined;
    getWorkersOn(resource: Unit | string): string[];
    getMineralTarget(mineral: Unit | string): Point2D | undefined;
    configure(settings: Partial<MiningSettings>): void;
}

export type FlightPlan = { readonly tag: string; readonly destination: Point2D; readonly land: boolean; readonly state: 'lifting' | 'flying' | 'landing'; readonly startedAt: number };
export interface FlyingStructures {
    move(structure: Unit, destination: Point2D, opts?: { land?: boolean }): void;   // land default true; replaces an existing plan
    swap(a: Unit, b: Unit): void;                     // each lands on the other's position
    addonSwap(structure: Unit | number, addon: number): boolean;   // ares AddonSwap; addon = REACTOR/TECHLAB or a precise type
    cancel(structure: Unit | string): void;
    getPlans(): readonly FlightPlan[];
    configure(settings: Partial<{ priority: number }>): void;   // 10
}
export interface ResourceContainer { ...; placement: PlacementResource; buildings: BuildingTracker; mining: MiningResource; flying: FlyingStructures }
```
- engine/create-world.ts: four definitions appended to CORE_RESOURCES after the phase-3 resources, in the order above; each `reset` keeps settings.
- Stubs resources/placement.ts, buildings.ts, mining.ts, flying.ts: `configure` works, `onStep` is a no-op, every other method throws `NodeSC2Error('not implemented')`.
- Follow: parity-2 P0 (T01). P0 is the only phase-4 ticket that edits types.ts, except P5 which changes the one `swapBuildings` line.

## P1 Placement solver: utils/placement/formation.ts (pure) + resources/placement.ts
Pure formation (no world access; typed arrays, index y*width+x, like utils/pathing/astar.ts):
```ts
export type FormationGrids = {
    width: number; height: number;
    placeable: Uint8Array;   // 1 = placeable now (live placement grid: minerals, geysers, rocks, structures already cleared by systems/map.ts)
    pathable: Uint8Array;    // 1 = pathable
    height: Uint8Array;      // terrain height (start grids)
    creep?: Uint8Array;      // 1 = creep
    avoid: Uint8Array;       // 1 = don't use; mutated by the solver
};
export function floodArea(grids: FormationGrids, start: Point2D, maxDist: number): Int32Array;   // BFS, same terrain height, placeable in START grid, within maxDist (euclidean)
export function findBuildingLocations(grids: FormationGrids, area: Int32Array, opts: {
    xStride: number; yStride: number; buildingWidth: number; buildingHeight: number;
    kernelWidth: number; kernelHeight: number; avoidCreep: boolean; dropInterval?: number;
}): Point2D[];   // building centres; marks each accepted kernel in grids.avoid
export function markAvoid(grids: FormationGrids, x0: number, y0: number, w: number, h: number): void;
```
- floodArea is iterative BFS (Int32Array queue, generation stamps); the existing recursive utils/map/flood.ts is O(n²) per call (`filled.some`) and stays for systems/map.ts.
- findBuildingLocations (ares cy_find_building_locations, placement_manager.py:929-1003): scan the area's bounding box on the stride lattice; accept a kernel when every cell is in the area, placeable, pathable, not avoid, and not creep (if avoidCreep). Centre = (x + buildingWidth/2, y + buildingHeight/2). Accepted kernels are written to `avoid` so later passes can't overlap. The terran 3x3 kernel is 5x3 so the addon's 2x2 (centre +2.5, -0.5, Unit.addOnPosition create-unit.ts:307) is inside it.
- `reduceXStride`: if xStride >= 7 and area < 300 cells, use 5 (ares).

Terran solve (ares _solve_terran_building_formation :1005-1072), once per game on the first onStep where `map.getExpansions().length > 0`:
1. avoid := own and enemy main mineral-line cells: every expansion's `areas.mineralLine` (decision: core already computes it; ares only does this for protoss).
2. User placements (`placer.placements?.(world)` then anything passed to `add`): added first with flag `custom`, footprint marked avoid (5x3 for addon hosts).
3. Natural bunker (:1559-1601): avoid 9x9 around nat; goal = towards(towards(nat, mainRamp.bottomCenter, 4), mapCenter, 6) floored; first canPlace(BUNKER) of the 4x4 offsets +0.5 → 3x3 flag bunker.
4. Per expansion `el` (map.getExpansions()): avoid 8x8 around el. Main only: ramp wall from `map.getMainBaseRamp()`: barracksCorrectPlacement → 3x3 wall (avoid 5x3), cornerDepots → 2x2 wall (skip any null; ramp getters can throw on odd ramps: catch and skip). 3x3 pass: maxDist 22 main / 16 other, xStride 6 for own and enemy start else 5, yStride 3, kernel 5x3, building 3x3, reduceXStride. Then avoid 13x13 around el, 2x2 pass: maxDist 16, stride 2/2, kernel 2x2. Drop any candidate within 6 of the main ramp top centre (ares: dist² > 36).
- Sizes come from `getFootprint(unitType, data)` (utils/geometry/units.ts), no new size table: w=2 → '2x2', 3 → '3x3', 5 → '5x5'.

Resource:
- `canPlace(unitType, pos, { includeAddon })` (ares cy_can_place_structure): footprint cells placeable (live `map._grids.placement`), pathable, no creep unless race Zerg or unitType hatchery/nydus. `includeAddon` defaults true for BARRACKS/FACTORY/STARPORT (decision). Gas types: no own/enemy gas building within 3.5 of pos (squared 12.25).
- `request(unitType, opts)`: candidates = spots at the snapped base of the matching size that are `available` and pass canPlace. If none and findAlternative: own occupied bases (`map.getOccupiedExpansions()`) by distance to base. Selection (generalised ares UnpoweredPlacementStrategy, placement_strategy.py:172-380): for each flag in opts.flags in order, if any candidate has it pick the closest-to-closestTo among those; with 'wall' requested but no wall spot left, fall back to non-wall closest to ramp top centre (main) / base. With no flags: closest non-custom spot to closestTo, else closest custom. Reserves unless `reserve: false`.
- onStep bookkeeping (cheap, every step after solve): own structures of any buildProgress within 0.5 of a spot → `taken` + tag (ares on_building_started); `taken` whose tag is gone or labelled dead → `available` (on_building_destroyed); `reserved` older than reservationTimeout → `available` (_track_requested_placements, checked every 16 loops).
- drawDebug: `debug.setDrawCells('placement', …)` coloured by state/flag (ares _draw_building_placements).
- Zerg: request returns undefined (ares asserts); callers fall back to findPlacement.
- Perf: full solve on the blueshift fixture ≤ 100 ms (median of 5, performance.now in the test); request ≤ 0.5 ms; zero `client.query` calls from request/canPlace (FakeClient call count).
- Tests (createTestWorld on blueshift + acropolis): every solved spot passes canPlace on the fixture's start state; no two spots' footprints (incl. addon 5x3) overlap; ramp wall spots equal Ramp getters; bunker at nat; two requests return different spots; reserved spot not returned until release/timeout (stepTo past 60 s); spot becomes taken when a structure appears and available after it dies; user placement via `resources.set({ placer })` comes first and is flagged custom; Zerg → undefined.
- Follow: ares placement_manager.py:233-264, 319-434, 499-511, 791-928, 1005-1072, 1362-1398, 1520-1601; utils/pathing/astar.ts for typed-array style.

P1b Protoss (after P1, same two files): production pylons (stride 7, kernel 2x2), 3x3 stride 3, extra 2x2 (stride 2/3), mineral-line avoidance (already in step 1), optimal pylon per base (most 3x3 within 6.5), main ramp wall (protossWallPylon/protossWallBuildings), `powered` requests (spot within 6.5 of a pylon of same terrain height with buildProgress >= pylonBuildProgress; PoweredPlacementStrategy :76-170). Pylons never take staticDefence spots. Follow :1074-1240.

## P2 Map grid lift/land fix: systems/map.ts
- Add `onUnitTypeChanged(world, { unit, previousType })`: if previousType is a landed structure and unit.unitType is its flying variant (flyingStructureTypes, constants/groups.ts) → free previousType's footprint at unit.pos (setPlaceable/setPathable true). Reverse (flying → landed) → block the landed footprint at unit.pos.
- Tests (systems/map.test.ts): synthetic observations lift a barracks then land it 6 cells away; grid cells follow.
- Don't touch: calculateWall, expansion areas.

## P3 Building tracker: resources/buildings.ts
Port of ares building_manager.py:143-436, 456-489, 491-584, 647-718, as a state machine per tracked build (keyed by id; the worker can change):
- `build`: target = opts.at ?? placement.request(unitType, opts.placement); worker = opts.worker ?? mining.selectWorker(target, { forceClose: true }) when mining is enabled, else the closest worker without a `command` label from `units.getMineralWorkers()` then `getWorkers()`. Returns undefined (and releases a reservation it made) if either is missing. Sets the worker's role BUILDING.
- onStep per build (skip done/failed):
  1. Worker gone (not in units or labelled dead): replace via mining.selectWorker(target, forceClose) / closest free worker; none → failed 'noWorker'.
  2. Timeout (non-Terran or gas): now - requestedAt > timeout → failed 'timeout'.
  3. Worker carrying resources → HARVEST_RETURN, continue.
  4. Worker `isConstructingScv()` → status constructing, continue.
  5. Structure of unitType within 1.5 of target: Terran done at buildProgress >= 1, P/Z at > 0 → done (structureTag set). Terran with an unfinished structure there and no constructing SCV → SMART worker on it (worker died mid-build; ares update :164-212 also scans untracked unfinished Terran structures; include it).
  6. Townhall target and `!placement.canPlace` → next free expansion from `map.getAvailableExpansions()` that canPlace; none → failed 'blocked'.
  7. Distance > threshold (1.0; gas 3.2; unfinished-structure 4.5) → MOVE to `pathing.nextPoint(worker.pos, target)` (repeat dedupe makes re-proposing the same point free).
  8. In range: gas → enemy gas on geyser → retarget to another free geyser near own townhalls; else BUILD on geyser. Non-gas: !canPlace(target) → release + placement.request again (attempts reset), continue. Else if `world.agent.canAfford(unitType, opts.earmark)` and `agent.techRequirementProgress(unitType) === 1` → propose BUILD with `onNotSent`: increments attempts; at maxAttempts → release + re-request placement. Status ordered.
- Issuing BUILD mirrors actions.build (:456-469): sets `command` label (cleared in onNotSent), deducts cost from world.agent. No refund (core-arch Q4).
- done/failed → release worker (mining.release when enabled, else role GATHERING) and the placement reservation (failed only; done spots are taken by bookkeeping).
- Low-HP cancel (ares :704-718), every step: own unfinished structures (tracked ones when 'tracked', all when 'all') with health < max(50, 0.09 × healthMax), not creep tumours → CANCEL_BUILDINPROGRESS. Tracked → failed 'cancelled'.
- `cancel`: CANCEL_BUILDINPROGRESS if started, else drop; release worker + placement.
- Tests (createTestWorld, FakeClient results): build issues move then BUILD when close; a 'rejected' result reissues next step and after maxAttempts gets a new placement; dropped (outranked) reissues; worker death → replacement; structure appears → done, worker back to GATHERING (and mining assigns it a patch next pass when enabled); gas retargets on enemy gas; low HP cancel; P/Z timeout; `pending` counts.

## P4 Mining manager: utils/mining/targets.ts (pure) + resources/mining.ts
Pure:
```ts
export function circleIntersections(c0: Point2D, r0: number, c1: Point2D, r1: number): Point2D[];   // 0 or 2 points (sharpy, resource_manager.py:884-940)
export function mineralTargets(minerals: { tag: string; pos: Point2D }[], townhalls: Point2D[], radius = 1.35): Map<string, Point2D>;   // :853-882
export function townhallTarget(townhall: Point2D, from: Point2D, factor = 1.08): Point2D;   // towards(townhall, from, 2.75 × factor)
```
Bookkeeping (onStep, only when enabled; ares resource_manager.py):
- Maps worker→patch, patch→workers, worker→gas, gas→workers, worker→townhall (string tags).
- Managed workers: own workers with role GATHERING (phase 3). New workers default to GATHERING (phase 3 default role).
- Pass each step: drop dead/mined-out resources and dead townhall bases (:715-809); gas first: per ready gas with a townhall within 12, add one worker per pass via selectWorker(forceClose) up to workersPerGas, remove one when above (:502-563); then unassigned managed workers → available minerals (visible, not snapshot, < 10 from a townhall with buildProgress > 0.85, < 2 workers) by ares rules (:565-631), with the initial split on the first pass (:658-688).
- Mineral targets computed once per game from all mineral fields and expansion townhallPositions.
- selectWorker (:322-470): prefer unassigned gatherers (unless forceClose), else a worker on the far patch of a townhall with ≥ 8 fields not carrying resources; removes it from bookkeeping and sets role BUILDING. minHealth filters by health/healthMax.
Commands (onStep, enabled, in `actions.as({ owner: 'mining', priority })`), per managed worker (ares mining.py:88-246):
- Skip workers with a `command` label or a construction order (builder handoff for plain actions.build callers).
- keepSafe: if not `pathing.isPositionSafe(pos, { layer: 'groundAvoidance' })`, or health% ≤ fleeAtHealth and unsafe on 'ground', or ground value > weightSafetyLimit → MOVE to `pathing.closestSafeSpot(pos, { layer: 'ground' })`.
- selfDefence: unsafe on 'ground', threats near own townhalls (phase-3 intel), and (not collecting or > 1 from its resource) → ATTACK the lowest-health enemy in range via `spatial.unitsInRange(worker, worker.groundRange() + worker.radius + 0.5, 'enemyGround')` when `weaponReady()` (mining.py:521-532).
- Assigned and > 6 from its resource, not carrying → MOVE `pathing.nextPoint(pos, resource.pos)`.
- Stray gather (gathering a different tag) → SMART its resource.
- speedMining on minerals (speed_mining.py:58-125): 2 orders → leave; carrying/returning with < 2 orders: if 0.75 < dist(pos, townhallTarget) < 2 → MOVE townhallTarget + queued SMART townhall; else if not returning → SMART townhall. Not returning: if 0.75 < dist(pos, mineralTarget) < 2 or idle → MOVE mineralTarget + queued SMART mineral; elif dist > 2 and gathering → MOVE mineralTarget. Idle fallbacks as ares. Move + queued smart are one owner, kept together by the arbiter.
- Otherwise standard mining (mining.py:264-301) with the 0.5 s per-worker lock.
- longDistanceMine (mining.py:303-418): unassigned workers mine the closest safe unassigned field (pending townhall's fields first; nat-closest before 260 s), pathing around danger.
- Tests (createTestWorld): initial split puts 2 on the 4 closest patches and 1 on the rest; never > 2 per patch; gas fills to workersPerGas one per pass and drains when lowered; selectWorker removes from bookkeeping and the next pass doesn't re-add a BUILDING worker; speed-mining command shapes at the window edges; flee when the influence grid at the worker is stamped (addCost); a bot system at priority 0 commanding a gathering worker wins over mining (commandResults 'dropped' for mining); disabled = zero proposals.
- Perf: onStep with 66 workers on 3 bases ≤ 2 ms (median, performance.now).
- Live (P7): 12 SCVs, one base, simple64, step 2: minerals at loop 6720 with speedMining > with enabled:false. Also record step 4 (engine default STEP_COUNT) without asserting.
- Not replaced: `agent.distributeWorkers` stays (python-sc2 parity). Docs: don't use both; distributeWorkers runs at the caller's priority and would fight mining.

## P5 Flying structures: resources/flying.ts (+ actions.swapBuildings)
State per tag, re-derived each step from the unit, no timers (ares flying_structure_manager.py:111-160):
- Gone → drop.
- Landed at destination (within 0.5) → drop (done).
- Landed elsewhere → if it has orders: CANCEL_QUEUE5 then queued LIFT; else LIFT. State lifting.
- Flying: dist ≥ 5.5 → MOVE destination (flying); < 5.5 and land → LAND destination (landing); not land → hover.
- A rejected LAND (spot still occupied, e.g. the other half of a swap hasn't lifted) is simply re-proposed next step; the repeat filter only drops identical non-queued orders the unit already has.
- `swap(a, b)`: move(a, b.pos) and move(b, a.pos), both land.
- `addonSwap(structure, addon)` (addon_swap.py:55-131): resolve a ready host type without addon; closest ready idle addon of the required kind (REACTOR/TECHLAB via reactorTypes/techLabTypes, or a precise type); if a structure is attached (addOnTag) move it to the host's position; move the host to `addon.addOnLandPosition()` (create-unit.ts:310). Returns false if nothing found.
- actions.swapBuildings (resources/actions.ts:207-240): becomes `world.resources.get().flying.swap(a, b)` after the same preconditions; returns `Promise<void>` (types.ts:497). Supersedes core-arch Q7 (raw send + 100 ms sleeps). No bot/ or core caller.
- Tests: synthetic observations (FakeClient) walk lift → flying type → land; swap with both structures completes; addonSwap picks the closest idle reactor and moves the attached factory; a busy structure gets CANCEL_QUEUE5 + queued LIFT; swapBuildings no longer sends raw actions (client.sent empty until flush).
- Live (P7): barracks+reactor ↔ factory swap completes; both land at the swapped positions within 30 game s.

## P6 Integration (replace/extend)
- systems/builder-plugin.ts: Terran/Protoss `build` tasks (not townhall/gas/addon): position = `placer.place` result if given (unchanged), else `placement.request(task.id, { flags: depot ? ['supplyDepot'] : addonHost ? ['production'] : [] })`; then `buildings.build(task.id, { at: position, earmark })` → COMMAND_SENT. Fallback to today's findPlacement path when request returns undefined (Zerg, full base). COMMAND_GIVEN's 250-loop reset (:270) only fires when `buildings.pending(task.id) === 0`, so a still-tracked build isn't duplicated. Gas tasks → `buildings.buildGas()`. Townhall/addon branches unchanged.
- resources/actions.ts `build` (:417-442): when no worker is given and mining is enabled, builder = `mining.selectWorker(pos, { forceClose: true })` (falls back to today's pick if undefined). findPlacement and canPlace stay (query-based, Zerg and ad-hoc use); docs point to placement.
- agent/macro.ts selectBuildWorker (:239): same mining.selectWorker preference when enabled. distributeWorkers unchanged.
- systems/map.ts calculateWall / areas.wall: unchanged (still feeds getCombatRally; natural wall buildings come from user placements, as in ares).
- Tests: builder-plugin.test.ts Terran build path makes zero `client.query` calls and tracks the build; COMMAND_GIVEN not reset while pending; actions.build with mining enabled takes the selectWorker worker.

## P7 Live smoke (needs SC2; skipped like create-engine.live.test.ts without it)
- resources/placement.live.test.ts: on simple64 and blueshift, every solved Terran spot (with addon spot for 3x3) is accepted by a real `query.placements` at game start (allow ≤ 2% misses; report them).
- resources/mining.live.test.ts: speed-mining income vs auto (P4).
- resources/flying.live.test.ts: addon swap (P5).

## P8 Docs (docs-plan.md §2 Phase 4 + §3)
- readme.md: Resources › new `### placement`, `### buildings`, `### mining`, `### flying` (method tables, defaults, one Terran example each); TOC + `resources.get()` destructure line; actions: findPlacement/canPlace rows point to placement; `swapBuildings` row (now flying-backed, resolves on proposal); Macro helpers: builder handoff and "distributeWorkers vs mining: pick one"; Build systems: Terran/Protoss build tasks use precomputed placements + tracker; map: grid now follows lift/land; ares deviations (mineral-line avoidance for Terran, flag-filter selection, alternatives limited to own bases, no events from the tracker, low-HP cancel default 'tracked'); Known limitations (no burrowed/blocked-placement detection, Zerg placement not precomputed, vespene boost off as in ares, speed mining weaker at step 4).
- docs/api.md: the four resources in §3.2 format; actions.swapBuildings return; Placer.placements.
- docs/internals.md: Resources list + registration order rationale.
- docs/changelog.md: Unreleased › parity-4 with Added/Changed (swapBuildings return, builder-plugin placement + tracker, map grid lift/land) and Migrating bot/ (replace findPlacement for depots/production with placement.request or buildings.build; wall.ts can use placement wall spots; enable mining instead of relying on SC2 auto-mining; don't call distributeWorkers with mining enabled).

## Order / file ownership
- P0 (types.ts, engine/create-world.ts, 4 stub files) blocked by parity-2 T01 and the parity-3 scaffolding ticket (same files).
- Unblocked now (new files only): pure formation (utils/placement/formation.ts + test), pure mining targets (utils/mining/targets.ts + test), P2 map lift/land (systems/map.ts + systems/map.test.ts; no other in-flight ticket touches it).
- P1 (resources/placement.ts + test) after P0 + formation. P1b after P1 (same files).
- P4a mining bookkeeping/selectWorker/gas/split/standard mining (resources/mining.ts + test) after P0 + parity-3 roles; P4b speed/safety/self-defence/LDM (same file) after P4a, mining targets, parity-2 pathing (T08) + spatial (T03), parity-3 intel threats.
- P3 tracker (resources/buildings.ts + test) after P1, P4a, parity-2 pathing.
- P5 flying (resources/flying.ts + test, resources/actions.ts swapBuildings, types.ts:497 only) after P0 and core-arch T04 (actions.ts chain).
- P6 integration (systems/builder-plugin.ts + test, resources/actions.ts build, agent/macro.ts selectBuildWorker) after P3, P5 (actions.ts), core-arch T04 (macro.ts).
- P7 after P1, P4b, P5, P6. P8 after all + parity-3 docs ticket.
- Don't touch (other in-flight work): core-arch T03/T04 files until they land (actions.ts, macro.ts, create-engine.ts, types.ts); parity-2 files (resources/memory.ts, spatial.ts, influence.ts, pathing.ts, units.ts, systems/unit.ts, utils/pathing/*, utils/grid/*, constants/influence.ts); parity-3 files (per its design); bot/.

## Phase-3 contract (confirmed by technical-architect; delta from technical-architect-2 replacing the provisional section)
- Roles: `roles` resource. `assign(units|tags, role)` (replaces previous role), `clear`, `get(role|role[], { types?, excludeTypes? }): Units`, `roleOf(unit|tag)`, `getTags(role)`, `as(role, fn, { priority? })` (owner `role:<ROLE>`, wraps actions.as), `configure({ defaultRole, exclusive })`. `UnitRole` type in types.ts, values in constants/unit-role.ts ('GATHERING', 'BUILDING', …), re-exported as `UnitRole`. Workers except MULE default to GATHERING once per tag (a cleared role isn't re-defaulted).
- CORE_RESOURCES order: … pathing, roles, squads, intel, placement, buildings, mining, flying.
- Command context (replaces the Conventions bullet and P3/P4 wording): mining proposes inside `roles.as(UnitRole.GATHERING, fn, { priority: settings.priority })`; tracker inside `roles.as(UnitRole.BUILDING, fn, { priority: settings.priority })`; flying inside `actions.as({ owner: 'flying', priority })`. Handoff: `roles.assign(worker, BUILDING)` happens before the tracker proposes (assignment is immediate, the exclusive filter runs at flush, so the order is safe). Managed workers = `roles.get(UnitRole.GATHERING, { types: worker type })`.
- Intel: self-defence gate = `intel.getMainThreat('ground')?.ground` (non-empty). Replaces `intel.getMainGroundThreatsNearTownhall()`.
- Dropped: the "roles stored as labels / getMineralWorkers" bullet (technical-architect's roles aren't labels).
- Edges: P0 after parity-3 scaffolding (Q1) as well as parity-2 T01. Every phase-4 ticket that edits resources/actions.ts (P5 flying, P6 integration) must not run in parallel with parity-3 Q5 (exclusive filter: actions.ts flushQueuedActions + command-arbiter.ts); either order. P4a mining blocked by parity-3 roles ticket; P4b by parity-3 intel ticket.
- Phase 6a vs systems/map.ts: unknown (asked technical-architect-3). P2 stays unblocked with "re-check against parity-6a design".

## Risks
1. Speed mining at the default STEP_COUNT 4 (create-engine.ts:57) hits the 0.75-2 window less reliably than ares' step 2; the live assertion runs at step 2. Phase 6a's per-bot step size closes this.
2. Grid-only canPlace can't see units, burrowed or unseen enemy structures; SC2 then rejects the BUILD and the tracker re-requests after maxAttempts.
3. Resource onStep runs before agent systems, so tracker/flying/mining decide on this step's observation and the bot can still override them in the same step by priority.
4. addonSwap cancels the host's queue (ares does the same).
5. `gasMineTypes` (constants/groups.ts:131) lacks the RICH variants; mining/gas checks use units' `vespeneContents`/isGasMine instead of the list.

## Decisions taken (technical-architect-2, verbatim; accepted by team lead, see core-arch.decisions.md)
P4-D1 Four registered resources with onStep (D1): placement, buildings, mining, flying, registered in that order after phase-3's intel. Why: placement bookkeeping first; the tracker claims builders before mining's pass.
P4-D2 Resource-issued commands go through the executor. Role-managed units propose inside `roles.as(role, fn, { priority })` (mining: GATHERING, -10; tracker: BUILDING, 10); units with no managed role use `actions.as({ owner: '<resource>', priority })` (flying: 'flying', 10). Why: tracker/flying beat bot systems; any bot command beats mining; an exclusive GATHERING/BUILDING role never drops our own commands.
P4-D3 Everything opt-in: mining only acts after configure({enabled:true}); buildings/flying only drive what the bot handed them. Why: no behaviour change for bots that ignore phase 4.
P4-D4 Placement formations: port ares' Terran solver (5x3 kernel for addon room, ramp wall from the existing Ramp getters, nat bunker) as a pure typed-array util + resource; protoss solver is a follow-up ticket in the same phase; Zerg returns undefined (ares doesn't support it either). Why: Terran-first; exit "no queries in the common case".
P4-D5 Building sizes come from getFootprint data, not a new size table. Why: one source of truth.
P4-D6 Terran solver also avoids each expansion's mineralLine cells. Why: cheap, keeps depots out of mining paths; ares only does it for protoss.
P4-D7 Selection = generalised flag filters (request.flags in order) instead of ares' per-flag booleans; alternatives only at own occupied bases. Why: smaller API; no placing at bases we don't own.
P4-D8 canPlace includes addon room by default for barracks/factory/starport. Why: a host without addon room is the main Terran placement bug.
P4-D9 Per-map user placements = new optional Placer.placements(world) on the existing placer resource, plus placement.add(); no YAML loader. Why: roadmap's "hook on the existing placer"; the bot owns its file format.
P4-D10 Tracker: ares state machine (move via pathing.nextPoint, reissue, worker replacement, Terran resume, townhall retarget, gas retarget); a dropped/rejected BUILD (onNotSent) retries, after maxAttempts=5 re-requests a placement; timeout 120 s for non-Terran and gas; no tracker events (poll getTracked/pending). Why: ares parity; YAGNI on events.
P4-D11 Low-HP cancel default 'tracked' (tracker builds only), configurable 'all'/'off'. Why: ares does 'all', but core shouldn't silently cancel structures a bot built itself.
P4-D12 Mining manages only role GATHERING workers (phase-3 roles), skips workers with a command label or construction order; distributeWorkers stays unchanged and docs say use one or the other. Why: ares semantics; builder handoff also works for plain actions.build callers.
P4-D13 Flying structures as a per-step state machine re-derived from the unit (no timers); actions.swapBuildings delegates to flying.swap and returns Promise<void>. Supersedes core-arch Q7. Why: exit "no timing sleeps"; no caller depends on the old return.
P4-D14 systems/map.ts gets onUnitTypeChanged to free/block footprints on lift/land. Why: existing bug; grid-based canPlace and addon swaps depend on it.

## Review delta (technical-architect-2, 2026-10-26)
1. `MiningResource.selectWorker(near: Point2D, opts?: { forceClose?: boolean; minHealth?: number; role?: UnitRole }): Unit | undefined`; `role` defaults to BUILDING. Why: plain `actions.build`/macro callers aren't tracked, so nobody would release a BUILDING worker. They pass `role: GATHERING`: the worker leaves patch bookkeeping but stays GATHERING; mining skips it while it has a `command` label or construction order, and reassigns it on the next pass once idle after the build (D12 handoff). P6: `actions.build` and macro selectBuildWorker call `mining.selectWorker(pos, { forceClose: true, role: UnitRole.GATHERING })`.
2. P0: no index.ts edit; `export type * from './types.ts'` already re-exports, and phase 4 adds no runtime exports.
3. P4-T01 formation solver deviations (accepted by team lead, core-arch.decisions.md): `FormationGrids.height` (terrain) renamed `terrainHeight` (the design declared `height` twice). New optional `startPlaceable?: Uint8Array`: floodArea floods `startPlaceable ?? placeable`; findBuildingLocations uses live `placeable`. Stride reduction is opt-in via a `reduceXStride` scan option (ares param). The placement resource (P1) must pass `terrainHeight` and `startPlaceable` (the start-of-game placement grid).
4. Perf rule (team lead, core-arch.decisions.md "P3-T01 combat sim"): wall-clock perf tests are not committed. The P1 and P4 perf budgets are measured ad hoc, and the median is recorded in the ticket. Deterministic checks (zero `client.query` calls) stay as tests.
5. P4-T01 review notes (team lead, 2026-10-26), for the placement resource:
   a. After each scan, P1 calls the formation module's new `unmarkAvoid(grids, x0, y0, w, h)` export for every kernel it filters out (terrain height mismatch, ramp-top dist² > 36), so the following 2x2 pass can reuse those cells.
   b. P1 builds one `FormationGrids` object per game and reuses it, because the formation module caches its scratch buffers per object. No per-call grids literal.
   c. The P1b (Protoss) review must confirm the scan order (y outer, x inner) matches ares for `dropInterval`.
5. PA4-7 resolved (technical-architect-3): phase 6a doesn't touch systems/map.ts, resources/map.ts or systems/frame.ts; P2 unblocked. `MiningSettings.workersPerGas` is an integer from 0 to 3 (default 3); `mining.configure({ workersPerGas })` with any other value throws RangeError and leaves settings unchanged (matches phase 6a `distributeWorkers(resourceRatio, { workersPerGas })`, same name and semantics). P6 must not run in parallel with the parity-6a ticket that edits agent/macro.ts; either order.
