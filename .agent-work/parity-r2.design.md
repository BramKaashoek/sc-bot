# parity-r2 design: contracts

Companion to parity-r2.md. Signatures are the scaffolding target (R2-T01 for C2, C3, C5, C6, C8, C9; R2-T08 for C1, C4, C7, C10, C11); behaviour rules cite the ares source (paths relative to `ares-sc2/src/ares/`). Everything here is additive unless marked CHANGED.

## C1 Influence layers (R2-T09 mask, R2-T10 layers)

```ts
export type InfluenceLayer =
    | 'ground' | 'air' | 'groundAvoidance' | 'airAvoidance'
    | 'climber' | 'airVsGround' | 'groundToAir' | 'priorityGroundAvoidance'
    | 'tacticalGround';                                   // only if RQ3 = yes

export type InfluenceSettings = {
    rangeBuffer: number; effectsRangeBuffer: number; costMultiplier: number;
    effects: Partial<Record<number, { cost: number; range: number }>>;
    airVsGroundDefault: number;                           // 10, ares AIR_VS_GROUND_DEFAULT consts.py:138
    tacticalGround: boolean;                              // false, ares Features.TacticalGroundGrid
};

// utils/map/climber.ts (pure)
export function computeClimberMask(input: {
    width: number; height: number;
    pathing: number[][];                                  // map._grids.pathing encoding: [y][x], 0 = pathable
    terrainHeight: number[][];                            // map._grids.height, [y][x]
    playable: { x0: number; y0: number; x1: number; y1: number };
    maxGap?: number; minStep?: number; maxStep?: number;  // 3, 20, 20 (DEFAULT_MAX_GAP / DEFAULT_MIN_STEP / DEFAULT_MAX_STEP)
}): Uint8Array;                                           // 1 = climbable cliff cell (pathable cells are NOT set)
```

Mask rule: an unpathable in-playable ground cell is marked when, along any of the four line directions (E, N, NE, SE), the unpathable run through it is at most `maxGap` cells and both bounding cells are in-playable ground with height > 0 whose height difference is within `[minStep, maxStep]`. Heights are multiples of 5 and one cliff level is 20, so `minStep = maxStep = 20` means exactly one level; steps of 10-15 are ramp flanks (all sit within 3 cells of a ramp on simple64/acropolis/blueshift) and stay unmarked.

Bases (rebuilt per loop like today):
- climber = ground base, plus cells in the climber mask get 1. The mask is computed once per game from the start grid and terrain height; live structures/rocks still block (a mask cell under a live footprint stays Infinity).
- airVsGround = air base, but ground-pathable cells inside the playable area get `airVsGroundDefault` instead of 1 (ares grid_manager.py:166).
- groundToAir = air base. priorityGroundAvoidance = ground base. tacticalGround = 200 everywhere in the playable area, Infinity outside (ares get_pyastar_grid(default_weight=200)).

Routing (ares grid_manager.py:440-860), applied inside `stamp`:
- every write to `ground` also writes `climber`;
- every write to `air` also writes `airVsGround`;
- `groundToAir` gets the air cost of: non-flying enemy units (weight-cost table and generic anti-air), enemy static defence with an air layer, parasitic bombs (C4). Not storms.
- `priorityGroundAvoidance` gets: psi storm, disruptor shot, baneling, delayed bile and nuke (C4).
- `tacticalGround` (only when enabled): enemy non-flying units add their army value (×1.5 when health ≤ 100) in a disc of unit radius + 1.5; own non-flying units except disruptors subtract the same (ares grid_manager.py:229-250, 736-750). No clamp to ≥ 1 on this layer (negative values are its point); Infinity cells stay Infinity.

Climber mask rule (R2-T09, ours: ares gets it from map_analyzer's C extension, which isn't in the ares source):
- A cell is climbable when it is unpathable, inside the playable area, not out-of-map (terrain-height sentinel), and lies on a straight run (4 cardinal + 4 diagonal directions) of at most `maxGap` unpathable cells whose two ends are pathable cells with terrain heights that differ by at most `maxStep`.
- Defaults are found on the fixture maps and recorded in the ticket: start with maxGap 3 and one cliff level for maxStep. Must hold on simple64/acropolis/blueshift: a reaper path main→natural on `climber` is strictly shorter than on `ground`, and no climbable cell connects two areas that a reaper can't jump between (spot-check main-edge cliffs to the low ground; water/space edges stay unclimbable).

## C2 Clean grids and custom grids (R2-T03)

```ts
interface InfluenceResource {
    getGrid(layer: InfluenceLayer): InfluenceGrid;
    getCleanGrid(layer: InfluenceLayer): InfluenceGrid;   // NEW: fresh copy of this loop's base, no unit/effect cost; caller owns it
    addCost(target: InfluenceLayer | InfluenceLayer[] | InfluenceGrid,   // CHANGED: also a grid object
            center: Point2D, radius: number, weight: number): void;
    configure(settings: Partial<InfluenceSettings>): void;
    drawDebug(target: InfluenceLayer | InfluenceGrid, opts?: { threshold?: number }): void;  // CHANGED
    getForcefieldPositions(): Point2D[];                  // C4
}
```
- `addCost` on a grid object clamps to ≥ 1 like the layer path and doesn't apply costMultiplier (ares add_cost on a user grid does apply it; core already skips it for user addCost, P2-T06 note; keep core's rule).
- Every combat behavior option `layer?: InfluenceLayer` becomes `layer?: InfluenceLayer | InfluenceGrid`; `layerFor` returns that union; group retreat reads the grid through the same resolver the pathing resource uses.

## C3 Pathing (R2-T02)

```ts
interface PathingResource {
    findPath(start, goal, opts?: PathOptions): Point2D[];          // CHANGED: honours sensitivity (default 1 = today)
    findLowPriorityPath(start: Point2D, goal: Point2D, opts?: { layer?: InfluenceLayer | InfluenceGrid }): Point2D[];
    findFurthestSafeSpot(from: Point2D, opts?: { layer?: InfluenceLayer | InfluenceGrid; radius?: number }): Point2D | undefined; // radius 15
    findLowestCostPoints(from: Point2D, opts?: { layer?: InfluenceLayer | InfluenceGrid; radius?: number }): Point2D[];         // radius 11
    // nextPoint, closestSafeSpot, isPositionSafe unchanged
}
```
- `findPath` with sensitivity s returns path cells at indices s−1, 2s−1, … of today's full path (same indexing nextPoint already uses; map_analyzer `path[::s]` minus the start). The goal is not appended (ares).
- `findLowPriorityPath` (path_manager.py:210): full path at sensitivity 4; fewer than 10 points → `[goal]`; else the 8 points at `round(linspace(0, n−1, 8))` plus `goal`.
- `findLowestCostPoints`: cell centres within `radius` whose cost equals the minimum finite cost in that disc. `closestSafeSpot` keeps its behaviour and may reuse it. `findFurthestSafeSpot`: the lowest-cost point furthest from `from` (path_manager.py:184).

## C4 Effects parity (R2-T11)

```ts
type InfluenceSettings += {
    kd8Charge: { cost: number; range: number };          // 10, 4.5 (ares config.yml)
    parasiticBomb: { cost: number; range: number };      // 17.15, 4
    delayedEffects: {                                    // loops since first seen
        bile: { reactAfter: number; duration: number };  // 16, 50 (grid_manager.py:76-77)
        nuke: { reactAfter: number; duration: number };  // 250, 320
    };
};
```
- KD8 charge: units of type KD8CHARGE (python-sc2 fake effect, constants.py:333) → ground (+climber). Range + effectsRangeBuffer.
- Parasitic bomb: enemy-alliance PARASITICBOMBDUMMY positions, plus own units carrying the PARASITICBOMB buff → air, airAvoidance, groundToAir (+airVsGround). ares main.py:230-240, 735.
- Bile and nuke per RQ4: tracked by position from first sight; stamped only while `reactAfter ≤ loopsSinceFirstSeen ≤ duration`, also after the effect leaves the observation; layers air, airVsGround, climber, ground, airAvoidance, groundAvoidance, priorityGroundAvoidance. Bookkeeping resets per game.
- Forcefields: positions of FORCEFIELD units this loop (ares only collects them, no cost).

## C5 Detection (R2-T05)

```ts
interface IntelResource {
    getEnemyDetectors(): ReadonlyArray<{ pos: Point2D; range: number }>;
    isDetected(target: Unit | Point2D, opts?: { byEnemy?: boolean }): boolean;   // byEnemy default true
    getOwnUnitsInDetectorRange(): ReadonlySet<string>;
}
// constants/detection.ts: DETECTOR_RANGES keyed by unit type + SCANNER_SWEEP_RANGE (ares dicts/enemy_detector_ranges.py values, incl. +radius +1)
```
- Enemy detectors = live (not remembered) enemy units of a DETECTOR_RANGES type, plus scanner-sweep effects of enemy alliance. Cached once per loop.
- `isDetected(unit)` is true when the unit has the ORACLEREVELATION buff; otherwise distance < range to any detector. `byEnemy: false` checks own detectors and own scans (unit_memory_manager.py:561).
- `getOwnUnitsInDetectorRange` uses the spatial index, detector radius only (ares :600).

## C6 Blocked expansions (R2-T04)

```ts
interface BuildingTracker {
    getNextExpansion(opts?: { checkSafe?: boolean }): Point2D | undefined;  // checkSafe default true
    isExpansionBlocked(pos: Point2D): boolean;
}
```
- Candidate order = the map's expansion order (path distance from own main), available expansions only.
- Skip when: in the blocked set; `checkSafe` and the ground layer isn't safe at the townhall spot; any enemy ground unit except auto-turrets within 5.5; an own townhall within 5.5; a destructible or watchtower within 5.5 (custom_bot_ai.py:451-504).
- The tracker adds a townhall target to the blocked set when its worker gets a CantBuildLocationInvalid action error (frame action errors) or the location is blocked per the rule above, then retargets to `getNextExpansion()`, else fails `'blocked'` (building_manager.py:285-310).
- DEV-1: ares never clears its blocked set. We clear a blocked position when an own detector (unit or scan) is within 7 and no enemy is within 9 (ares' rule for burrow-blocked positions, terrain_manager.py:628). Blocked set resets per game.
- Callers move onto `getNextExpansion`: expansionController and the build runner's townhall branch (R2-T04); agent.getNextExpansion/expandNow only per RQ5 (R2-T13).

## C7 Gas-steal handling (R2-T12)

```ts
type OpeningDefinition += { shouldHandleGasSteal?: boolean };   // default true (ares build_order_runner.py:112)
```
Per step while an opening runs (build_order_runner.py:844-945), main = own start location, radius 12:
- May assign only if: the current step isn't a gas step already started, fewer than 2 own gas buildings in the main, and no gas building is pending.
- If enemy workers are in the main and assigning is allowed: for each main geyser without a gas building within 5 and without a guard, pick a worker with mining.selectWorker(geyser, { forceClose: true, role: GAS_STEAL_PREVENTER }) and move it onto the geyser.
- Each guarded geyser: drop the guard (back to GATHERING) when no enemy workers remain or a gas building is within 5, or the geyser/worker is gone; else attack an enemy worker in range when the weapon is ready; else, if the current step is a gas step and affordable, build the gas there with that worker (step marked started); else hold on the geyser.

## C8 AoE behaviors (R2-T06)

```ts
useAOEAbility(opts: { unit: Unit; abilityId: number; targets: Unit[]; minTargets: number;
    avoidOwnFlying?: boolean; avoidOwnGround?: boolean; bonusTags?: ReadonlySet<string>;
    recalculate?: boolean; stackSameSpell?: boolean }): Behavior;
autoUseAOEAbility(opts: { unit: Unit; targets: Unit[]; bonusTags?: ReadonlySet<string>;
    recalculate?: boolean; stackSameSpell?: boolean }): Behavior;
// utils/combat/aoe.ts
export function findAoePosition(radius: number, targets: Unit[], minTargets: number, bonusTags?: ReadonlySet<string>): Point2D | undefined;
// constants/aoe.ts: AOE_ABILITIES (ares dicts/aoe_ability_to_range.py: radius, range, effect/buff)
```
`findAoePosition` (ours; ares uses cython `cy_find_aoe_position`): candidates are each target position and the midpoint of every target pair closer than 2·radius; score = targets within radius, +1 per bonus-tag target inside; return the best candidate scoring ≥ minTargets; ties → closest to the targets' centroid. Deterministic.

## C9 Terran spell behaviors (R2-T07)

```ts
placePredictiveAoE(opts: { unit: Unit; path: Point2D[]; enemyCenterUnit: Unit; aoeAbility: number; abilityDelay: number; reaperGrenadeRange?: number }): Behavior;
reaperGrenade(opts: { unit: Unit; enemyUnits: Unit[]; retreatTarget: Point2D; layer?: InfluenceLayer | InfluenceGrid;
    placePredictive?: boolean; reaperGrenadeRange?: number }): Behavior;            // true, 5
ghostSnipe(opts: { unit: Unit; closeEnemy: Unit[] }): Behavior;
ravenAutoTurret(opts: { unit: Unit; allCloseEnemy: Unit[] }): Behavior;
```
Logic per the ares files of the same name (behaviors/combat/individual/). placePredictiveAoE uses the real game step (world config gameStep) for `ceil(abilityDelay / gameStep)`.

## C10 YAML (R2-T16, only if RQ6 = b or c)

- (b) `createEngine` config file may be `.yml`/`.yaml` (parsed with `Bun.YAML.parse`, no dependency). Default lookup: `sc-bot.config.json`, then `sc-bot.config.yml`, then `.yaml`; two present → NodeSC2Error naming both. Same validation as JSON.
- (c) ares-format importers, pure, exported from root:
```ts
parseAresBuilds(yamlText: string): Partial<OpeningSettings>;   // Builds/OpeningBuildOrder/AutoSupplyAtSupply/ConstantWorkerProductionTill/PersistentWorker/ShouldHandleGasSteal, BuildChoices/<race|id>/Cycle, BuildSelection, MinGamesWinrateBased, UseData → dataDir './data'
parseAresPlacements(yamlText: string): PlacementTable;          // <Map>/<UpperSpawn|LowerSpawn>/<VsRace|VsAll>/<key>: [[x,y],...] groups
createPlacer(table: PlacementTable): Placer;                    // moved from examples/ares/custom-building-placements.ts, same behaviour
```
Unknown keys warn and are skipped (BotName, test ids are kept as choices). GateKeeper/FirstPylon keys map to C11 when R2-T15 is in scope, else warn.

## C11 Protoss (R2-T14/T15, only if RQ1 includes Protoss)

```ts
type PlacementFlag += 'firstPylon';
type PlacementRequest += { firstPylon?: boolean };    // prefer firstPylon spots, fall back to normal (placement_strategy.py:188)
type UserPlacement += { gateKeeper?: true };          // a unit hold position, not a building spot
interface PlacementResource {
    getGatekeeperPositions(base?: Point2D): Point2D[];   // keyed by closest expansion (placement_manager.py:625)
    getNatGatekeeperPosition(): Point2D | undefined;     // first gatekeeper at own natural (:197)
}
restorePower(): Behavior;                                // behaviors/macro/restore_power.py
protossStaticDefence(opts?: { pylonsPerBase?: number; photonCannonsPerBase?: number; shieldBatteriesPerBase?: number;
    excludeBaseLocations?: Point2D[]; maxOnRoute?: number; techBaseLocation?: Point2D }): Behavior;  // 1,1,1,[],1
```
Build runner: Protoss pylon steps before 60 s request `firstPylon` (build_order_runner.py:653); the persistent-builder pre-move does too before 30 s (:834). A user first-pylon spot also marks a 16×16 avoid area centred on it, so generated formations keep clear of it (placement_manager.py:704-710).

---

Contracts C12–C17 added 2026-10-28 for the RQ answers (RQ1 c, RQ8 b, RQ9 "port if possible"). Research: audits/r2-zerg.md (Zerg), audits/r2-rq9.md (smoothing, RQ9 items). Scaffolding: R2-T19. Names follow packages/core/GLOSSARY.md (`near` = approximate anchor).

## C12 Path smoothing (R2-T20, RQ8 b)

```ts
type PathOptions += { smoothing?: boolean };   // findPath, nextPoint; default false
// combat behaviors that take `sensitivity` (pathUnitToTarget, moveToSafeTarget, pathGroupToTarget, nydusPathUnitToTarget) gain `smoothing?: boolean`, default false
```
- Algorithm: SC2MapAnalysis `extension/ma_ext.c` `create_smoothed_path` (public source; ares only forwards the flag, path_manager.py:257, :335). Walk the full A* node list keeping the running cost since the last kept node (`weight[next] * octile step`); a straight line from the last kept node to the next node is sampled at 5 samples per cell (cells deduped, weights summed, times flight distance / sample count); if it costs more than 1.002 × the running cost, keep the current node and reset; always keep the goal; paths under 3 nodes are untouched. Blocked cells (Infinity) make the line infinite, so shortcuts never cross them.
- Applied to the full path before sensitivity thinning (MA `Pather.pathfind`). `findLowPriorityPath` never smooths (ares).

## C13 Creep (R2-T21, RQ1 c)

New resource `creep` (registered after `influence`; Zerg-agnostic: it reads the creep grid for any race).
```ts
interface CreepResource {
    getTiles(): Point2D[];                 // creep cells, cached per loop
    getEdges(): Point2D[];                 // refreshed when ≥ 16 loops since the last refresh
    getCoverage(): number;                 // 0–100, % of pathable cells with creep; refreshed when ≥ 112 loops since the last
    closestTile(near: Point2D): Point2D | undefined;
    findEdgePosition(near: Point2D, opts?: { radius?: number; closest?: boolean; spreadDistance?: number; unitTag?: string; cache?: boolean }): Point2D | undefined;   // 15, true, 3
    nextTumorOnPath(from: Point2D, to: Point2D, opts?: { layer?: InfluenceLayer | InfluenceGrid; maxDistance?: number; minDistance?: number; minSeparation?: number; findAlternative?: boolean }): Point2D | undefined; // 999.9, 0, 5, true
    randomPosition(near: Point2D, attempts?: number): Point2D | undefined;   // 20 tries, 6–9 away
    tumorLowestCostPosition(near: Point2D): Point2D | undefined;
    shouldSpreadTumors(): boolean;         // coverage < 40, else once per coverage/2 loops
    overlordSpotterPositions(overlords: Unit[] | Units, target: Point2D): Map<string, Point2D>;
    blocksExpansion(point: Point2D): boolean;
}
```
- Semantics per ares managers/creep_manager.py (method-by-method table in audits/r2-zerg.md §1). Edge = creep cell with ≥ 2 non-creep neighbours whose 3×3 box is all statically pathable, minus cells within 2.5 of an own hatchery. Valid tumor spot: in bounds, on creep, outside the 5-radius expansion mask, pathable and safe on the ground layer.
- Cadences are "loops since last run ≥ interval", not ares' `game_loop % n` (which never fires when the game step doesn't divide n). DEV-2 (deviation).
- The per-queen edge cache (64 loops, cleared when the queen's tumor ability is available again) lives in the resource, since behaviors are stateless.
- ares quirks the senior keeps or fixes are listed in audits/r2-zerg.md §1 "Quirks"; each decision is recorded in the ticket and the docs' ares-deviations list.
- `get_creep_grid` has no wrapper: `map.hasCreep` / the map state already expose the grid.

## C14 Zerg behaviors (R2-T22, T23, T27)

```ts
tumorSpreadCreep({ unit }: { unit: Unit }): Behavior;          // tumor_spread_creep.py (dead `target` param dropped)
queenSpreadCreep({ unit, cancelIfCloseEnemy, preMove }: { unit: Unit; cancelIfCloseEnemy?: boolean; preMove?: boolean }): Behavior;  // true, true; queen_spread_creep.py
useTransfuse({ unit, targets, extraRange }: { unit: Unit; targets: Unit[] | Units; extraRange?: number }): Behavior;  // 0; use_transfuse.py
nydusPathUnitToTarget({ unit, target, layer, successAtDistance, sensitivity, smoothing, exitMaxInfluence }: { unit: Unit; target: Point2D; layer?: InfluenceLayer | InfluenceGrid; successAtDistance?: number; sensitivity?: number; smoothing?: boolean; exitMaxInfluence?: number }): Behavior;  // 0, 5, false, 10
```
- useTransfuse's "one queen per target per loop" guard uses the behaviors resource's per-loop dedupe (ares `transfused_tags`, reset every step), not new bot state.
- Transfuse: health < 40 %, healthMax ≥ 50, within 7 + both radii + extraRange, not self, not already transfused this loop.

## C15 Nydus (R2-T25, T26, RQ1 c)

```ts
interface ActionManager { unloadByTag(container: Unit, passengerTag: string): void; }   // R2-T25
interface NydusResource {                                                               // R2-T26
    findNydusAtLocation(base: Point2D, opts?: { minBaseDistance?: number; maxNydusDistance?: number; maxCost?: number }): Point2D | undefined;  // 15, 25, 20
    getEnemyMainNydusPoints(): Point2D[];                 // best first
    getOwnMainNydusPoints(): Point2D[];
    nextPoint(start: Point2D, target: Point2D, opts?: PathOptions & { large?: boolean }): { point: Point2D; exitTowards?: Point2D; nydusTags?: [string, string] };
    addTraveller(unit: Unit, entryTag: string, exitTag: string, exitTowards: Point2D): void;
    removeTraveller(tag: string): void;
    getTravellers(): ReadonlyMap<string, { entry: string; exit: string; exitTowards: Point2D; unitType?: number }>;
    isBanned(tag: string): boolean;                      // 5 s after unloading (UNIT_NYDUS_TRAVEL_BAN_DURATION)
}
interface MapAnalysisResource { getRegionCells(region: Region): Point2D[]; }            // the region's cell list (in_region_p / region points)
```
- `unloadByTag` builds ares' two-part request (raw no-op on the container, then `ActionUI.cargoPanel` unload at the passenger's index; custom_bot_ai.py:383-437). It is not a raw unit command, so it goes on the raw immediate path like `sendAction` and is not arbitrated; the docs say so.
- Nydus resource state machine per nydus_manager.py:366-427: one unload per exit nydus per loop, queens first, rally to `exitTowards`, 5 s travel ban, travellers repointed on nydus death.
- Nydus-aware path: port MA's `astar_with_nydus` from `ma_ext.c` (public) when its pair choice can be reproduced; otherwise the fallback rule in audits/r2-zerg.md §4 (compare the direct path with entry + exit legs over own ready nydus pairs, 44-loop cache keyed by start/target, cleared when a nydus dies). The ticket records which one shipped. DEV-3 if the fallback.
- Fixes over ares (DEV-3b): passengers are read from every own nydus, not `nyduses[0]`; main-spot setup tolerates fewer than 2 nearby geysers.

## C16 Overlord spots and ENEMY_NAT_HG_SPOT (R2-T28, RQ1 c + RQ9)

```ts
interface MapAnalysisResource {
    getOverlordSpots(): Point2D[];                    // high-ground hiding spots, computed once per map
    takeOverlordSpot(near: Point2D): Point2D;         // nearest unused spot, consumed (ares pops it); map centre when none left
}
// BuildTarget += 'ENEMY_NAT_HG_SPOT'                // takeOverlordSpot(towards(enemyNatural, mapCenter, 10)), terrain_manager.py:318-398
```
- Spot generation: a faithful port of SC2MapAnalysis `extension/ma_ext.c` `get_map_data` + `flood_fill_overlord` (R2-T28a; DEV-4 rejected, lead decision 2026-10-28). Inputs: raw uint8 terrain heights and walkable = max(pathing, placement). Output: float centroids, no thinning. simple64 yields none.

## C17 RQ9 items

```ts
// R2-T29 adept shades: influence skips an enemy ADEPTPHASESHIFT until 120 loops after first sight (main.py:866-889); first-seen pruned after 160 + margin.
interface AbilityTracker {                                     // R2-T30, new resource `abilityTracker`
    used(unit: Unit | string, abilityId: number): void;        // starts the cooldown at the current loop
    ready(unit: Unit | string, abilityId: number): boolean;    // true when untracked or the cooldown elapsed
    readyAt(unit: Unit | string, abilityId: number): number | undefined;   // game loop
    setCooldown(abilityId: number, loops: number): void;       // e.g. medivac boost after Rapid Reignition (update_ability_cooldown)
}
// constants/dicts/ability-cooldown.ts: ares dicts/ability_cooldowns.py, in loops = int(seconds × 22.4) + 6, truncated as ares does; locusts pad 8 (ares quirk, kept). Shipped by R2-T36
// R2-T31 build runner: Protoss non-pylon structure steps start at supply − 1 (build_order_runner.py:307-318); `system.buildCompleted` read-only getter.
// R2-T32 `loadAresProtossPlacements(): PlacementTable` over the shipped data file packages/core/data/protoss_building_placements.yml (ares 2025, patch 5.0.14); opt-in, never loaded by default. Map names normalised as ares does (lowercase, strip trailing 'le'/'aie', strip spaces).
// R2-T33 small helpers:
interface MiningResource { selectWorker(near, opts?: { …; minShield?: number }): Unit | undefined; }   // fraction, Protoss only
interface SpatialResource { anyInRangeBatch(points: Point2D[], distance: number, kind: SpatialKind): boolean[]; }
speedMining({ worker, target, townhall }: { worker: Unit; target: Unit; townhall?: Unit }): Behavior;  // wraps the mining resource's internal speed-mine step
totalSupply(units: Iterable<Unit>): number;                    // root export; replaces 3 local copies
// constants/dicts/morph-source.ts: ares dicts/does_not_use_larva.py (6 entries)
// R2-T34 previous-loop caches:
interface UnitResource { getPreviousArmy(): Units; getMorphedEnemyTags(): ReadonlySet<string>; }   // own army as of the previous loop; enemy tags dropped this loop because they morphed (unit_cache_manager.py:273, :317)
// R2-T35 arcade mode: `map.isArcade()`; resources that need start locations or townhalls (mining, placement, intel, nydus, map-analysis bases) skip their per-step work instead of throwing when the map has none (main.py:148, :357).
```
