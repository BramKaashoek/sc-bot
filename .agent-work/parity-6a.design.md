# parity-6a design

Recorded verbatim by business-analyst-3 from technical-architect-3's message, 2026-10-26. Decisions 6a-D1–D19 were sent to the team lead separately (core-arch.decisions.md).

Author: technical-architect-3, 2026-10-26. Paths under packages/core/, checked against the worktree (HEAD b1040d7 + uncommitted core-arch work). Covers ares-gap #11 (chokes/regions/defensive positions, defensive third) and #13 (enemy race on first sight, chat debug, config file, workers per gas). Build-runner upgrades are 6b. Depends on parity-2 T01 (`ResourceDefinition.onStep`, `resources.step`).

## Current state (verified)
- Map analysis: only ramps + vision blockers (utils/map/ramp.ts:217, resources/map.ts:413) and a natural wall (systems/map.ts:123). No choke/region finder, no defensive third.
- Start pathing grid: `map.inPathingGrid` (resources/map.ts:462) reads startRaw. Probed on all fixtures: own start townhall cells are UNpathable, the enemy's are pathable; mineral fields/geysers are pathable in it.
- Enemy race: create-agent.ts:306 sets `opponent.race = NORACE` for random opponents, TODO to fill on first sighting. UnitTypeData has `race` (`world.data.getUnitTypeData`, data-storage.ts:31).
- Chat: frame system writes `chatReceived` (systems/frame.ts:88-95, default 'agent' event type, so engine-type readers never see it). Debug primitives exist: resources/debug.ts:349-416 (`createUnit`, `killUnit`, `god`, `cooldown`, `food`, `allResources`, `showMap`, `techTree`, `upgrade`).
- Config: env only. `STEP_COUNT` is a module const (create-engine.ts:57, used :505, :509, :519, :525). No file, no per-engine setting.
- Workers per gas: `distributeWorkers` (agent/macro.ts:434) uses `surplusHarvesters()` (= assigned - ideal, create-unit.ts:313), so gas is always filled to 3.

## Prototype evidence (choke algorithm below, run on the fixtures, not committed)
With 4-connectivity, maxChokeWidth 14, peakRatio 2.2, minRegionArea 150:
- simple64: 4 regions, 4 chokes; acropolis: 13 regions, 20 chokes; blueshift: 9 regions, 14 chokes.
- On all three: main and natural townhalls are in different regions, the main region has exactly one choke and it is the main ramp (to the natural region), every expansion's region has at least one choke.
- Watershed + region merge + choke extraction: 12–16 ms on 140x136 (EDT was brute force in the prototype; the real one is O(n)).
- 8-connectivity leaks regions diagonally through 1-cell cliff lines (seen on simple64), hence 4-connectivity. peakRatio 1.8 / minRegionArea 64 split the main into spurious sub-regions with many 2-wide "chokes" along pillars.

## C1. Pure analysis: utils/map/chokes.ts + utils/map/distance-field.ts (new)
```ts
export type ChokeSettings = { maxChokeWidth: number; peakRatio: number; minRegionArea: number };   // 14 / 2.2 / 150
export type ChokeAnalysis = {
    labels: Int32Array;            // region id per cell (y * width + x), -1 = unwalkable
    clearance: Float32Array;       // Euclidean distance (cells) to the nearest unwalkable cell; out of grid counts as unwalkable
    regions: Array<{ area: number; peak: number }>;   // peak = cell index of max clearance
    chokes: Array<{ cells: Int32Array; center: number; sides: [number, number]; width: number; regions: [number, number] }>;
};
export function analyzeChokes(walkable: Uint8Array, width: number, height: number, settings: ChokeSettings): ChokeAnalysis;

// distance-field.ts
export function createDistanceField(width: number, height: number): {
    compute(walkable: Uint8Array, start: number, out: Float32Array): Float32Array;   // returns out
};
```
analyzeChokes (all neighbourhoods 4-connected unless stated):
1. Clearance: exact squared EDT (Felzenszwalb–Huttenlocher, separable), then sqrt.
2. Order walkable cells by clearance desc, index asc.
3. Watershed with union-find basins (`peak` = max clearance of the basin). For each cell in order, collect distinct basin roots among already-labelled neighbours: none → new basin; else join the root with the highest peak (A). For every other root B: merge B into A if `2 * c > maxChokeWidth || min(peakA, peakB) < c * peakRatio` (c = this cell's clearance); otherwise leave them apart.
4. Small regions: repeatedly take the smallest region (ties: lower root) with area < minRegionArea that has a neighbour region; merge it into the neighbour whose shared boundary has the highest clearance (ties: lower id). Regions with no neighbour (islands) stay.
5. Relabel regions 0..R-1 by ascending smallest cell index.
6. Chokes: boundary cells = walkable cells with a 4-neighbour in another region. Group by region pair (lo, hi); each 8-connected component of a pair's boundary cells is one choke (two passages between the same regions = two chokes). `center` = component cell with max clearance (ties: lowest index); `sides` = the two component cells farthest apart (ties: lowest index pair); `width` = 2 * clearance[center]; `cells` sorted ascending. Drop a component if width > maxChokeWidth (safety). Order chokes by (regions[0], regions[1], center).
Deterministic: same input → identical output.

createDistanceField: Dijkstra, 8-connected, cost 1 / √2, no corner cutting (diagonal blocked if either orthogonal neighbour is unwalkable; same rule as parity-2 utils/pathing/astar.ts), Infinity when unreachable. Buffers (heap, stamps) allocated once per instance. Own small binary heap; do not import from or edit astar.ts (in flight).

Tests (chokes.test.ts, distance-field.test.ts), synthetic grids:
- one open room → 1 region, 0 chokes;
- two 20x20 rooms joined by a 3-wide corridor → 2 regions, 1 choke, center in the corridor, width within [2, 4];
- two rooms joined by two separate 3-wide doors → 2 regions, 2 chokes with the same `regions`;
- two rooms joined by an opening wider than maxChokeWidth → 1 region;
- a pocket smaller than minRegionArea behind a 2-wide gap → merged, no choke;
- a diagonal 1-cell wall line between two rooms does not leak (4-connectivity);
- determinism (two runs deep-equal);
- distance field: open grid octile values, wall detour, unreachable = Infinity, no corner cutting, buffer reuse across 100 calls matches a fresh instance.
Follow: parity-2 typed-array conventions (index y * width + x, no per-call allocation in hot loops), utils/map/ramp.ts style.

## C2. Resource `mapAnalysis`: resources/map-analysis.ts (new)
types.ts:
```ts
export type MapAnalysisSettings = ChokeSettings & { defenseOffset: number };   // 14 / 2.2 / 150 / 4
export type Choke = {
    id: number;
    center: Point2D;                 // cell centre (x + 0.5, y + 0.5) of the narrowest cell
    sides: [Point2D, Point2D];       // cell centres of the two ends of the choke line
    points: Point2D[];               // integer cells of the choke line
    width: number;                   // cells
    regions: [number, number];       // region ids, ascending
    ramp?: Ramp;                     // map.getRamps() entry touching the choke
};
export type Region = {
    id: number;
    area: number;                    // walkable cells
    center: Point2D;                 // cell centre of the cell farthest from any wall
    chokes: Choke[];
    expansions: Expansion[];         // whose townhallPosition is in this region
};
export type BaseChoke = { choke: Choke; pathDistance: number };    // ground distance base → choke.center
export type DefensivePosition = BaseChoke & { position: Point2D };
export interface MapAnalysisResource {
    getChokes(): Choke[];
    getRegions(): Region[];
    getRegion(point: Point2D): Region | undefined;          // undefined off-map or on an unwalkable cell
    isInChoke(point: Point2D): boolean;                       // ares get_map_choke_points membership
    getBaseChokes(base: Expansion | Point2D): BaseChoke[];   // the base region's chokes, by pathDistance asc; ares get_base_to_choke_information
    getDefensivePosition(base: Expansion | Point2D, opts?: { towards?: Point2D; offset?: number }): DefensivePosition | undefined;
    getDefensiveThird(): Expansion | undefined;
    configure(settings: Partial<MapAnalysisSettings>): void;
    drawDebug(): void;
}
// ResourceContainer gains: mapAnalysis: MapAnalysisResource
```
Analysis grid: width/height from `map.getSize()`, walkable = `map.inPathingGrid(cell)`, then the own start townhall's 5x5 footprint (`map.getLocations().self`, cells floor(x)-2..floor(x)+2) set walkable. Minerals/geysers stay walkable, structures and later pathing changes are ignored (static start terrain, symmetric between spawns, no mineral-gap chokes).

Lifecycle:
- Definition: `name: 'mapAnalysis'`, appended last to CORE_RESOURCES (after parity-2's resources).
- Analysis runs once per game, lazily inside any accessor. `onStep(resource, world)`: if `world.config.features.eagerMapAnalysis`, call `resource.getRegions()` inside try/catch (log once via debug `sc2:debug:mapAnalysis`; onStep must never throw). The first onStep is in setupGame's dispatch, after MapSystem.onGameStart (parity-2: resources.step runs after engine systems), so analysis is ready before the agent's onGameStart runs.
- Start grids missing (map.setStartRaw failed): accessors throw `MapDecompositionError`.
- `configure()` merges settings and drops the analysis and distance-field cache (recomputed on next access).
- `reset`: keep settings, drop analysis and caches (D10 pattern).
- Custom maps (no expansions): chokes/regions work; `expansions` empty; getDefensiveThird undefined.

Derived data:
- Region.center = cell centre of the region's peak; Region.chokes = chokes with the region in `regions`; Region.expansions = `map.getExpansions()` whose townhallPosition resolves (see base resolution) to the region.
- choke.ramp = first `map.getRamps()` ramp with a point within Chebyshev distance 1 of any choke cell.
- isInChoke: Uint8Array mask of all choke cells.

Base resolution (getBaseChokes, getDefensivePosition, Region.expansions): point = `base.townhallPosition` for an Expansion; start cell = floor(point) if walkable, else the nearest walkable cell within radius 4 (ties lowest index); none → `[]` / undefined.

Distance fields: one `createDistanceField` instance per map size; computed fields cached by start cell index, at most 32, FIFO eviction; cache dropped on reset/configure.

getBaseChokes(base): region R of the start cell; for each of R.chokes, pathDistance = field(start)[choke center cell]; drop Infinity; sort asc, ties by id.

getDefensivePosition(base, { towards, offset = settings.defenseOffset }):
- target = towards ?? `map.getLocations().enemy[0]` ?? `map.getCenter(true)`; target cell resolved like a base.
- defensive choke = among getBaseChokes(base): argmin of distBase[c] + distTarget[c] (c = choke center cell), ties: smaller distBase, then lower id. undefined if none.
- position: from the choke center cell, step up to `offset` times to the 8-neighbour (no corner cutting) with the smallest distBase that is strictly smaller than the current; stop early when none. Return that cell's centre.
- `towards` should be a static point (each distinct target is one cached field).

getDefensiveThird(): of `map.getThirds()` (third and fourth by path from main), the one with the longer `pathFromEnemy` (unreachable = length 999, as systems/map.ts sets it); ties → first; undefined when there are none. ares terrain_manager.py:194 minus its per-map Oxide/Glittering special case.

drawDebug(): `debug.setDrawCells('mapAnalysisChokes', …)` for choke cells with text `C<id>`, and region centres with text `R<id>`.

Game-start budget (resources/map-analysis.perf.test.ts, acropolis fixture, median of 10 runs, `performance.now()`):
- full analysis (grid build + analyzeChokes + linking) ≤ 50 ms;
- cold `getDefensivePosition` for every expansion (fresh cache) ≤ 100 ms total.

Tests (resources/map-analysis.test.ts) on simple64, acropolis, blueshift via createTestWorld:
- main and natural townhalls are in different regions;
- `getDefensivePosition(map.getMain())`: choke.ramp === `map.getMainBaseRamp()`; position walkable, in the main region, within offset + 1.5 of the choke center;
- `getDefensivePosition(map.getNatural())`: defined, choke is not the main ramp choke, position in the natural's region;
- every expansion's region has ≥ 1 choke;
- getDefensiveThird ∈ getThirds() and has the max pathFromEnemy length;
- getRegion on an unwalkable cell → undefined; isInChoke true on every choke point;
- eager: analysis exists after createTestWorld (spy on analyzeChokes called once across two steps); `features.eagerMapAnalysis: false` → not called until first access;
- configure({ peakRatio }) recomputes on next access; settings survive `world.resources.reset`.
If the defaults can't satisfy every fixture property, the dev reports the failing map/property to the architect; don't weaken the assertions.

Follow: parity-2 resource definitions (reset keeping settings, lazy per-game compute), resources/map.ts accessor style.
Don't touch: resources/map.ts, systems/map.ts, utils/map/ramp.ts, utils/pathing/astar.ts.

## C3. Config file: engine/config.ts (new)
types.ts:
```ts
export type ResourceSettings = {
    [K in keyof ResourceContainer]?: NonNullable<ResourceContainer[K]> extends { configure(settings: infer S): void } ? S : never;
};
export type CoreConfig = {
    gameStep: number;                                          // game loops per step, default 4
    features: { chatDebug: boolean; eagerMapAnalysis: boolean };   // false / true
    resources: ResourceSettings;                               // default {}
};
export type CoreConfigInput = {
    gameStep?: number;
    features?: Partial<CoreConfig['features']>;
    resources?: ResourceSettings;
};
// World gains: config: Readonly<CoreConfig>
// EngineOptions gains: config?: CoreConfigInput; configFile?: string | false
```
engine/config.ts:
```ts
export const DEFAULT_CONFIG: Readonly<CoreConfig>;
export function resolveConfig(inline?: CoreConfigInput, opts?: { file?: string | false; env?: Record<string, string | undefined>; cwd?: string }): Readonly<CoreConfig>;
```
- File: JSON. Path = `opts.file` ?? `env.SC_BOT_CONFIG` ?? `<cwd>/sc-bot.config.json`. `file: false` skips the file. A missing default-path file is fine; a missing explicitly named file (option or env) throws NodeSC2Error; malformed JSON throws NodeSC2Error naming the path.
- Merge: defaults ← file ← inline. `features` shallow-merged; `resources` merged per resource name (shallow per section).
- `env.STEP_COUNT` (positive integer) overrides gameStep last, so today's env usage keeps its meaning.
- Validation: gameStep positive integer, features booleans, else NodeSC2Error; unknown top-level or feature keys → one console.warn each.
- Result frozen (shallow).

Wiring:
- engine/create-world.ts: `createWorld(client?, config = DEFAULT_CONFIG)`; sets `world.config` before registering CORE_RESOURCES.
- engine/create-resource-manager.ts: after `create` in `register`, and after each definition's reset in `reset`, if `world.config.resources[name]` is set: call `resource.configure(section)` when the resource has `configure`, else console.warn once per name. Code's own `configure()` calls (system setup / onGameStart) run later and win.
- engine/create-engine.ts: `const config = resolveConfig(options.config, { file: options.configFile })`, pass to `World(client, config)`. Replace the `STEP_COUNT` const with `world.config.gameStep` at all four uses. After `engine.use([frame, unit, map])`: `if (world.config.features.chatDebug) engine.use(createChatDebugSystem())`.
- test/create-test-world.ts: pass `configFile: false` to createEngine; `TestWorldOptions.config?: CoreConfigInput` passed through, so tests are hermetic and can set features.

Tests (engine/config.test.ts, engine/create-world.test.ts additions): defaults with no file; file merge; inline over file; STEP_COUNT over both; explicit missing file throws; malformed JSON throws; unknown key warns; invalid gameStep throws; registry applies `resources.<name>` on register and again after reset; config section for a resource without configure warns once. engine: a `createEngine({ client, launch: false, configFile: false, config: { gameStep: 2 } })` run steps with `count: 2` (FakeClient `sent.step`).

## C4. Chat debug: systems/chat-debug.ts (new)
```ts
export type ChatCommand =
    | { kind: 'create' | 'kill'; count: number; unitType: number; playerId?: number }
    | { kind: 'cooldown' | 'food' | 'god' | 'resources' | 'showMap' | 'techTree' | 'upgrades' };
export function parseChatCommand(message: string): ChatCommand | { error: string } | null;   // null = not a command
export default function createChatDebugSystem(): SystemWrapper;
```
- Aliases (ares consts.py:150-158), case-insensitive first token: create|make, kill|destroy, cooldown, food|supply, god, resources|money, reveal|show|show-map, tech|tech-tree, upgrades.
- `create|kill <count> <UnitTypeName> [playerId]`: count positive integer; unit name = key of constants UnitType after upper-casing, falling back to the name minus a trailing "S" ("marines"); bad args → `{ error }`.
- System: `createSystem({ name: 'ChatDebugSystem', type: 'agent', onChatReceived })`. Held in engine.systems (added by C3 wiring), but typed 'agent' so its reader receives `chatReceived` (frame.ts writes it as an agent event). It sends no unit commands.
- Only messages with `chat.playerId === world.agent.playerId` are handled; others ignored.
- create: `debug.createUnit({ unitType, quantity: count, pos, playerId: playerId ?? own })`, pos = `frame.getObservation().rawData.player.camera`, falling back to `map.getCenter(true)`.
- kill: own playerId (or none given) → `units.getAlive(Alliance.SELF)`, else `units.getAlive(Alliance.ENEMY)` with `owner === playerId`; filter by unitType; first `count`; `debug.killUnit(list)`; none → `actions.chatSend("Can't find any of those")`.
- Game-state commands → `debug.cooldown/food/god/allResources/showMap/techTree/upgrade`.
- `{ error }` → `actions.chatSend(error)`; `null` → nothing.
Tests (systems/chat-debug.test.ts): parse table (aliases, case, plural fallback, bad count, unknown unit, non-command → null); via createTestWorld with `config.features.chatDebug: true` and an observation carrying `chat`: create sends a createUnit debug at the camera; other player's chat ignored; kill 1 of own type sends killUnit with one tag; god sends gameState GOD; unknown unit sends a chat reply (FakeClient `sent.debug` / `sent.actions`).
Follow: ares chat_debug.py:40-215; resources/debug.ts primitives.

## C5. Enemy race on first sight: agent/create-agent.ts
- In the agent's `onStep`, before `blueprint.onStep`: when `this.opponent?.race` is not TERRAN/ZERG/PROTOSS, take the first unit of `units.getAlive(Alliance.ENEMY)`; if one exists and `world.data.getUnitTypeData(unit.unitType).race` is TERRAN/ZERG/PROTOSS, set `this.opponent = { ...this.opponent, race }` and `events.write({ name: 'enemyRaceDetected', data: race })`.
- types.ts EventConsumer: `onEnemyRaceDetected?(world: World, race: SC2APIProtocol.Race, event?: SystemEvent): Promise<any>`.
- Remove the @TODO at create-agent.ts:306.
- Fires at most once per game, only for opponents not known at game start (random). Agent systems see it the same step; the agent blueprint's own handler sees it next step (it already read its events this dispatch).
Tests (agent/create-agent.test.ts): random opponent (NORACE at start) + an enemy zergling in the next observation → opponent.race ZERG and a system's onEnemyRaceDetected called once with ZERG; not again on later steps; known-race opponent never fires.
Don't touch: systems/unit.ts (parity-2 T02).

## C6. Workers per gas: agent/macro.ts
- `distributeWorkers(resourceRatio = 2, { workersPerGas = 3 }: { workersPerGas?: number } = {}): Promise<void>` (types.ts Agent signature).
- workersPerGas must be an integer 0–3, else RangeError.
- For gas buildings, surplus = `assignedHarvesters - Math.min(idealHarvesters, workersPerGas)` instead of `surplusHarvesters()`. Townhalls unchanged. Surplus gas workers enter the pool and go to minerals through the existing logic.
- Per call, like the other macro helpers; no persisted setting (ares mediator.set_workers_per_gas is persistent).
Tests (agent/macro.test.ts): refinery with 3 assigned + workersPerGas 1 → two of its workers re-gathered to minerals; workersPerGas 0 → an idle worker goes to minerals despite a gas deficit and a gas-favouring ratio; RangeError for 4, -1, 1.5; existing distributeWorkers tests pass unchanged.

## Tickets
| T | scope | files | blocked by |
|---|---|---|---|
| T01 | config file + 6a scaffolding (C3 complete; C2/C4 types + stubs) | types.ts (all 6a types/interfaces from C2–C6, World.config, EngineOptions), engine/config.ts + config.test.ts (new), engine/create-world.ts, engine/create-world.test.ts, engine/create-resource-manager.ts, engine/create-engine.ts, test/create-test-world.ts, resources/map-analysis.ts (stub: definition + methods throwing NodeSC2Error('not implemented'), no-op onStep), systems/chat-debug.ts (stub: createChatDebugSystem with no handlers) | parity-2 T01; core-arch T01 nits; any other phase's scaffolding ticket touching the same shared files (serialize) |
| T02 | pure choke analysis + distance field (C1) | utils/map/chokes.ts, utils/map/chokes.test.ts, utils/map/distance-field.ts, utils/map/distance-field.test.ts (all new) | none — can start now |
| T03 | mapAnalysis resource (C2) | resources/map-analysis.ts, resources/map-analysis.test.ts, resources/map-analysis.perf.test.ts | T01, T02 |
| T04 | chat debug (C4) | systems/chat-debug.ts, systems/chat-debug.test.ts | T01 |
| T05 | enemy race (C5) | agent/create-agent.ts, agent/create-agent.test.ts | T01 |
| T06 | workers per gas (C6) | agent/macro.ts, agent/macro.test.ts | T01, core-arch T04 (macro.ts); not concurrently with any phase-4 ticket editing macro.ts |
| T07 | docs + changelog | readme.md, docs/api.md, docs/internals.md, docs/changelog.md | T01, T03–T06; previous docs ticket in the docs-plan §3.6 chain |
T02 runs in parallel with everything. After T01: T03 (after T02), T04, T05, T06 run in parallel (disjoint files).
index.ts: no change (types flow through `export type *`; no new value exports).
Don't touch (all tickets): bot/; resources/map.ts, systems/map.ts, systems/frame.ts, systems/unit.ts; utils/pathing/*; parity-2 resource files (memory, spatial, influence, pathing); resources/actions.ts and the command executor files (core-arch).

## Docs (T07; amends docs-plan.md §2 "Phase 6a")
- readme.md:
  - Resources: new `### mapAnalysis` subsection (TOC line + `resources.get()` destructure line), method table, settings + defaults, one example (defensive position at the natural); the map section (~788) gets a one-line pointer to it instead of hosting chokes.
  - Running games: new "Config file" subsection after Environment variables (~226): file name, `SC_BOT_CONFIG`, JSON shape with defaults, precedence (STEP_COUNT > inline `createEngine({ config })` > file > defaults), `resources.<name>` → `configure()`, feature toggles. Env table: add `SC_BOT_CONFIG`; STEP_COUNT row mentions it overrides config.
  - Events table: `onEnemyRaceDetected` (random opponents only, once).
  - Agents › Player data: `agent.opponent.race` filled on first sighting.
  - debug (~887): chat debug commands table, own-player only, enabled by `features.chatDebug`.
  - Macro helpers (~299): `distributeWorkers(resourceRatio, { workersPerGas })`.
  - ares deviations section: clearance-watershed chokes instead of map_analyzer (no height-based region split; ramps linked via `choke.ramp`); JSON config instead of YAML; chat debug own-player only; workers per gas per call, not persistent.
  - Known limitations: overlord/scout spots not implemented (deferred, see decisions).
  - Drop "overlord/scout spots" from the 6a map docs (not built).
- docs/api.md: createEngine options (`config`, `configFile`), World (`config`), `### mapAnalysis` under Resources (§3.2 format, types Choke/Region/BaseChoke/DefensivePosition/MapAnalysisSettings), EventConsumer `onEnemyRaceDetected`, Agent `distributeWorkers`, debug chat commands.
- docs/internals.md: Resources list gains `mapAnalysis`; World gains `config`; registry applies `config.resources` on register/reset.
- docs/changelog.md: `Unreleased › parity-6a` (Added: mapAnalysis, config file, chat debug, enemyRaceDetected, workersPerGas). Migrating bot/: nothing breaks; STEP_COUNT unchanged; random opponents now get `opponent.race` set mid-game; chat debug is opt-in via config.

## Decisions (logged by team lead)
6a-D1–D19, sent to the team lead separately.

## Addendum (technical-architect-3, 2026-10-26)
A1. Config sections (C3). `CoreConfig` is an `interface`, not a type, so other phases and plugins can add top-level sections by declaration merging (e.g. 6b's `builds`). Unknown top-level keys are kept verbatim on `world.config`, without validation or a warning. Only gameStep, features and resources are validated. An unknown key inside `features` warns. Top-level merge is defaults ← file ← inline, with each section replaced whole, except features and resources, which merge shallow as before. `CoreConfigInput = { [K in keyof CoreConfig]?: K extends 'features' ? Partial<CoreConfig['features']> : CoreConfig[K] }`. Test: an extra `builds` key in the file shows up on world.config unchanged and causes no warning.
A2. `mapAnalysis.getPerimeter(region: Region): Point2D[]`, added for the 6b worker scout. It returns the cell centres of region cells that are 4-adjacent to an unwalkable or off-grid cell, sorted by atan2 angle around region.center ascending (ties: lower cell index). It is computed lazily and cached per region, and the cache is dropped on reset/configure. Test: every perimeter point is in the region and next to an unwalkable cell, and the angles are non-decreasing. T03 implements it, and T01 adds it to the interface.
A3. `mapAnalysis.getEnemyMainRamp(): Ramp | undefined` = `getDefensivePosition(map.getEnemyMain(), { towards: map.getLocations().self })?.choke.ramp`. It returns undefined when there is no enemy main expansion. Test: on all three fixtures it is defined and is not `map.getMainBaseRamp()`. T03 implements it, and T01 adds it to the interface.
A4. Shared-file list for the ticket file: 6a edits types.ts, engine/create-world.ts (+test), engine/create-resource-manager.ts, engine/create-engine.ts, test/create-test-world.ts, agent/create-agent.ts and agent/macro.ts. It does NOT edit index.ts, package.json, systems/builder-plugin.ts, resources/map.ts or systems/map.ts.
A5. The D11 budget is no longer a committed test. Drop resources/map-analysis.perf.test.ts from T03. The T03 dev measures the same two spans ad hoc on acropolis (the analysis at most 50 ms median of 10; a cold getDefensivePosition for every expansion at most 100 ms total) and records the numbers in the T03 ticket. This follows the general perf rule in decisions.md.
A6. Scheduling. Scaffolding chain: P2 T01 → P3 T02 → P4 T04 → 6a-T01 → P5 T01. 6a-T06 (agent/macro.ts) must never run in parallel with P4-T11 (selectBuildWorker in macro.ts), in either order. Phase 4's mining manager uses `mining.configure({ workersPerGas })` with the same semantics as the C6 option.
