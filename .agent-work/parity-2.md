# parity-2: enemy memory, spatial index, army value, influence grids, pathing

Source: parity-roadmap.md phase 2 (ares-gap.md ranked #4, #1); user mandate 2026-10-26 "use best judgement to get ares parity" (decisions.md).
Design: .agent-work/parity-2.design.md (technical-architect), decisions D1–D11 logged in core-arch.decisions.md. Scope: packages/core only.

Status: FINAL (best judgement under user mandate; assumptions listed at the end).

Ticket numbers here are local to this file. "core-arch Tnn" refers to .agent-work/core-arch.md.

## Problem Statement

Core has no notion of where the enemy is beyond the raw unit list. Out-of-vision enemies are remembered forever and never dropped, even when we look at their last position. Range queries scan every unit. There is no army value, no threat map, and pathing clones the whole graph per call on static weights. As a result the bot can't ask "is this spot safe", "where's the nearest safe cell", or "path around that tank", which every ares combat behavior depends on.

## Solution

Add four core resources that register through the core-arch registry, plus one query on units. A new registry per-step hook keeps them up to date after the engine systems run and before agent code.

- **Enemy memory:** keeps out-of-vision enemies as ghosts. A ghost expires after a configurable age, and is dropped when its last position is visible again (unless it's burrowed).
- **Spatial index:** answers range, any-in-range and closest queries for enemy/own × all/ground/air, without full scans. Ghosts count as enemies.
- **Army value:** reported for own units (optionally including pending production) and for enemy units (optionally including ghosts).
- **Influence grids:** four layers (ground, air, ground avoidance, air avoidance) built from enemy units, static defense and dangerous effects, using ares' conventions and weights. Callers can add their own costs for the current step.
- **Pathing:** cost-aware pathing on those grids, with next point, closest safe spot and is-position-safe.

Spatial and influence are built lazily, once per game loop. A bot that doesn't use them pays nothing.

## Non-goals

- Detection checks (burrowed/cloaked visibility, enemy detector ranges).
- Climber, tactical, air-vs-ground and ground-to-air layers (D8).
- KD8 and parasitic bomb avoidance, and effect landing prediction (D9).
- Replacing `map.path` or PF.js for static map analysis (D6).
- Combat sim, roles, squads, intel (phase 3).
- bot/ changes (additive only; adoption is up to the user).

## User Stories

1. As a bot author, I want enemies that left vision kept as ghosts for a while, so that I can reason about units I recently saw.
2. As a bot author, I want ghosts to expire after a configurable time, so that stale memory doesn't drive decisions or grow without bound.
3. As a bot author, I want a ghost dropped when I look at its last position and it isn't there, so that memory matches what I can see.
4. As a bot author, I want burrowed ghosts kept until they expire, so that a burrowed unit isn't forgotten just because I can't detect it.
5. As a bot author, I want an enemy seen again after being forgotten not to refire "first seen", so that first-sighting logic (e.g. race detection) runs once.
6. As a bot author, I want to list ghosts and enemies with or without ghosts and structures, so that each query gets the view it needs.
7. As a bot author, I want fast units-in-range / any-in-range / closest queries by enemy or own, ground or air, so that per-unit micro doesn't scan every unit.
8. As a bot author, I want my army value and the enemy's (including ghosts, optionally my pending production), so that I can compare strength cheaply.
9. As a bot author, I want ground and air threat grids from enemy units and static defense, so that I know where I'd take damage.
10. As a bot author, I want avoidance grids from storms, biles, liberator zones, lurker spines, blinding clouds and nukes, so that units can dodge them.
11. As a bot author, I want to add my own cost circles for this step, so that bot-specific dangers show up in pathing.
12. As a bot author, I want to tune range buffers, cost multiplier and effect costs, and have those settings survive between games, so that I can tune behavior without patching core.
13. As a bot author, I want a cheap path on any grid that avoids threat, so that units route around danger.
14. As a bot author, I want a next point toward a goal that skips pathing when no danger is near, so that I can call it per unit per step.
15. As a bot author, I want the closest safe spot and an is-safe check, so that I can retreat or hold correctly.
16. As a bot author, I want to draw a grid layer in the debug overlay, so that I can see what the bot thinks is dangerous.
17. As a bot author who doesn't use these features, I want no per-step cost from them, so that my step time is unaffected.

## Implementation Decisions

From the Architect (full contract in parity-2.design.md, decisions D1–D11):

- Registry gains an optional per-step hook on resource definitions. The registry's step runs all hooks synchronously in registration order, once per dispatch, after engine systems and before agent handlers and systems (D1).
- The new resources are memory, spatial, influence and pathing, registered as core resources after actions.
- Ghosts stay in the existing enemy unit store. Memory's step hook deletes a ghost when it has expired (30s ground and 30s air by default, configurable) or when its last cells are visible and it isn't burrowed (D3). Unit tracking remembers seen enemy tags per world, so first-seen fires once.
- Spatial uses a uniform bucket index with centre-to-centre distance. All six kinds are rebuilt together on the first query of a loop. Enemy kinds include ghosts (D4, D11).
- Army value is a query on units. It counts combat units at their full cost. For enemies it optionally includes ghosts; for own units it optionally includes pending production (D5).
- Grids use ares' conventions (D7): typed float arrays, 1 = free, above 1 = threatened, infinite = blocked, safe when ≤ 1.
  - Base layers come from pathability (ground) and the playable area (air).
  - Enemy units are stamped from the ported ares weight table or the static-defense handlers; anything else is stamped generically from its DPS and range plus a buffer. Changelings are skipped.
  - Effects use ares' default costs and ranges and are also stamped into the avoidance layers.
  - Caller-added costs last until the next loop.
- Pathing has its own 8-connected A* on typed arrays: buffers are reused between queries, there is no corner cutting, and the octile heuristic is admissible (D6).
  - A blocked goal retargets to the nearest open cell within 3.
  - Next point skips A* when no cell at or above the danger threshold is within the danger distance.
- Settings for memory and influence survive game resets; buffers are reallocated for a new map size (D10).

## Testing Decisions

All seams are offline, using the core test harness: the fixture world builder, stepping to recorded or synthetic observations, and the fake client.

- **Registry step hook:** world/dispatch seam. Hooks run in order on every dispatch, before agent systems see the world.
- **Memory:** dispatch seam with synthetic observations. Ghost created, expired, dropped on visibility, burrowed kept, no first-seen refire.
- **Pure modules:** brute-force comparisons and exact-cell tests, with no world. Covers the bucket index, circle stamp and A*.
- **Spatial, army value, influence, pathing:** resource seam on fixtures (acropolis 896 has enemies), plus a stamped cost for pathing.
- **Perf:** measured ad hoc for pathing on a fixture map and recorded in the ticket; no committed wall-clock test.
- **Prior art:** engine/create-world.test.ts (registry), systems/unit.test.ts (unit events), resources/units.test.ts, resources/map.test.ts.

## Out of Scope

See Non-goals.

## Further Notes

Migration notes for the user's bot/ (no tickets):
- Additive only; nothing breaks.
- Behavior change: enemy ghosts now expire after 30s by default and are dropped when their last position is visible. Any bot code reading `units.getAll(ENEMY)` as permanent memory will see fewer units. Raise the expiry with `memory.configure` if the old behavior is wanted.
- New entry points: `memory`, `spatial`, `influence` and `pathing` on the resources, and `units.getArmyValue`.

Assumptions (BA, best judgement):
- PA1 P0 also adds the `getArmyValue` signature to the units type in types.ts, plus a throwing stub in the units resource. That way the army-value ticket never touches types.ts. (The design says P0 adds "every interface below".)
- PA2 The pure circle stamp, the influence weight constants and the pure A* depend on nothing, so they run now, in parallel with core-arch. The Architect said the pure A* could run "any time after P0"; it touches no shared file, so I unblocked it fully. Same for the stamp and constants.
- PA3 Superseded by design addendum A3 (Architect-set perf budget, a median of at most 10 ms over 20 runs).
- PA5 T01 owns every phase-2 edit to types.ts, create-world.ts, constants/index.ts and index.ts (addendum A4). The influence constants file from T05 gets re-exported by T01, so T01 is also blocked by T05 (small and unblocked, so this costs nothing).
- PA4 Tickets here are numbered T01–T09 within this file.

---

# Tickets

## T01 Registry step hook + phase-2 scaffolding (design P0)

- Source: parity-2.design.md P0.
- What to build:
  - The per-step hook on resource definitions, and a registry step called once per dispatch after engine systems.
  - The four new resource types in the container, plus all the phase-2 interfaces and the `getArmyValue` signature.
  - The four resources registered as core resources, as stub files that throw "not implemented".
  - A throwing `getArmyValue` stub on units.
- API contract: design P0, plus the P1–P5 interfaces (types only).
- Acceptance criteria:
  - [ ] Step hooks run in registration order, once per dispatch, after engine systems and before agent handlers/systems.
  - [ ] A resource without a step hook is skipped.
  - [ ] `memory`, `spatial`, `influence` and `pathing` exist on the resources after world creation; their methods throw a core "not implemented" error.
  - [ ] The six T05 influence constants and their types are importable from the package's constants entry and root; constants/influence.ts uses `InfluenceLayer` from types.ts (no duplicate layer-name type).
  - [ ] Existing tests pass; lint, tsc and tests are green.
- Implementation plan:
  - Where:
    - types.ts: `ResourceDefinition.onStep`, `ResourceManager.step`, container keys, and the interfaces EnemyMemory, MemorySettings, SpatialKind, SpatialIndex, InfluenceLayer, InfluenceGrid, InfluenceSettings, InfluenceResource, PathOptions, PathingResource, plus `UnitResource.getArmyValue`.
    - engine/create-resource-manager.ts: `step`.
    - engine/create-engine.ts: call `world.resources.step(world)` right after the engine systems run in dispatch.
    - engine/create-world.ts: add the 4 definitions to CORE_RESOURCES after actions.
    - New stub files: resources/memory.ts, resources/spatial.ts, resources/influence.ts, resources/pathing.ts, each exporting its definition.
    - resources/units.ts: `getArmyValue` stub.
    - constants/index.ts and index.ts: re-export the T05 influence constants (WEIGHT_COSTS, STATIC_DEFENSE, UNIT_AVOIDANCE, DEFAULT_EFFECT_COSTS, EFFECT_INFLUENCE, INFLUENCE_DEFAULTS) and their types, plus any new public types/utilities phase 2 exposes. No later phase-2 ticket edits these files.
    - constants/influence.ts: replace the local `InfluenceLayerName` with `import type { InfluenceLayer } from '../types.ts'` once T01 adds that type (only edit to T05's file).
    - engine/create-world.test.ts: step-hook tests.
  - Interfaces: as design P0–P5.
  - Follow: the T01 registry code (create-resource-manager.ts), and `NodeSC2Error` from engine/errors.ts.
  - Don't touch: actions.ts, macro.ts, the arbitration/commander code in the dispatch body beyond the one call.
- Stack: core.
- Blocked by: core-arch T04 (shares types.ts, create-world.ts and create-engine.ts with the core-arch chain; T04 is the last code ticket there), T05 (re-export).
- Slice siblings: T02–T09.

## T02 Enemy memory (design P1)

- Source: design P1; D3, D10, D11.
- What to build: memory's step hook (expiry, visibility drop, burrowed kept), the ghost/enemy queries, forget and configure. Also: unit tracking stops refiring first-seen for a tag that was forgotten and then seen again.
- API contract: design P1 `EnemyMemory`, `MemorySettings`.
- Acceptance criteria:
  - [ ] An enemy that leaves vision is returned by `getGhosts` and by `getEnemies()`, but not by `getEnemies({ includeGhosts: false })`.
  - [ ] A ghost older than its expiry (air or ground setting, by flying state) is removed from the enemy store on the next step.
  - [ ] A ghost whose 4 surrounding cells are all visible is removed; a burrowed ghost in the same situation is kept until it expires.
  - [ ] `forget(tag)` removes the ghost.
  - [ ] `configure` changes expiry, and the change survives a game reset.
  - [ ] A forgotten tag that is seen again fires "entered vision" but not "first seen".
  - [ ] `getEnemies({ structures: false })` excludes structures.
  - [ ] A snapshot structure (currently reported, `isSnapshot()`) is in `getSnapshots()` and not in `getGhosts()`; it never expires while reported (design addendum A1).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where:
    - resources/memory.ts: replace the stub with the definition (onStep, no-op reset), queries and settings.
    - systems/unit.ts: per-world seen-enemy-tag set, gating the first-seen event (~:240), the same pattern as `seenUnitTagsByWorld` (~:6).
    - New resources/memory.test.ts.
  - Interfaces: design P1.
  - Follow: ares managers/unit_memory_manager.py:161-233, 361-377; `isMemory()`/`age()` in engine/create-unit.ts (~576-581); `map.isVisible`.
  - Don't touch: frame.ts dead-unit handling, resources/units.ts, types.ts.
- Stack: core.
- Blocked by: T01.
- Slice siblings: T01, T03–T09.

## T03 Spatial index (design P2)

- Source: design P2; D2, D4, D11.
- What to build: a pure bucket index and the spatial resource on top of it. The resource rebuilds lazily once per game loop.
- API contract: design P2 `SpatialIndex`, `SpatialKind`.
- Acceptance criteria:
  - [ ] The pure index matches brute force on random point sets: radius boundary (inclusive), points at map borders, empty set, distance 0.
  - [ ] `anyInRange` agrees with `unitsInRange(...).length > 0`.
  - [ ] `closest` respects `maxDistance` and returns undefined when nothing is in range.
  - [ ] Enemy kinds include ghosts; ground/air split by flying state; structures included.
  - [ ] Two queries in one loop build once; a query on the next loop rebuilds.
  - [ ] Index buffers are reused across rebuilds (no growth when the unit count is stable).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new utils/spatial/bucket-index.ts + bucket-index.test.ts; resources/spatial.ts (replace the stub); new resources/spatial.test.ts.
  - Interfaces: design P2.
  - Follow: ares unit_memory_manager.py:397-534 (semantics); `Units` in resources/units-collection.ts for return values.
  - Don't touch: resources/units.ts, types.ts.
- Stack: core.
- Blocked by: T02.
- Slice siblings: T01, T02, T04–T09.

## T04 Army value (design P3)

- Source: design P3; D5.
- What to build: `units.getArmyValue` for own and enemy units, with pending production and ghost options.
- API contract: design P3.
- Acceptance criteria:
  - [ ] It sums mineral and vespene cost over combat units only (workers and structures excluded).
  - [ ] By default it counts own units; enemy with ghosts is the default for ENEMY, and `includeGhosts: false` drops them.
  - [ ] Own with `includePending` adds units in production on own structures and eggs.
  - [ ] Any alliance other than Self or Enemy (e.g. Ally, Neutral, or an arbitrary number) throws `NodeSC2Error` at runtime, since core's Alliance constants are plain numbers and the type narrowing doesn't guard call sites; a test row covers it.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/units.ts (replace the stub); resources/units.test.ts.
  - Interfaces: design P3 (signature already in types.ts from T01).
  - Follow: ares unit_cache_manager.py:146-230; `calculateCost` on the agent; `world.data.findUnitTypesWithAbility`; existing `getCombatUnits`.
  - Design correction (technical-architect, 2026-10-26): `findUnitTypesWithAbility` returns producers, not the created unit. Pending orders map through an inverted `UnitTypeData.abilityId` lookup (available types, first in data order wins, rebuilt when `data.get('units')` changes). Counted orders: ready non-townhall structures `orders[0]` (+`orders[1]` with a reactor), eggs `orders[0]`; townhalls skipped. Existing zerglings are valued at half `calculateCost` (which prices a pair); a pending zergling egg counts the pair.
  - Don't touch: types.ts, memory.ts.
- Stack: core.
- Blocked by: T02.
- Slice siblings: T01–T03, T05–T09.

## T05 Circle stamp + influence weight constants (design P4, pure part)

- Source: design P4 (`stamp.ts`, constants); D7, D9.
- What to build:
  - The pure circle-stamp function on a flat float grid.
  - The influence constants, ported from ares:
    - the unit weight table;
    - the static-defense parameters (bunker, PF, cannon, turret, spore, spine, auto-turret);
    - the default effect costs and ranges (storm 600/3.5, bile 100/3, both liberator zone ids 500/6, lurker spines 600/1, blinding cloud 300/3.5, nuke 1000/8);
    - which layers each source writes into, including the avoidance layer lists.
- Acceptance criteria:
  - [ ] The stamp hits the exact expected cell set for radii 0, 1, 1.5, 2 and 3.5; it clips at all four edges; Infinity cells stay Infinity; it doesn't allocate (a buffer identity check; no new arrays in the hot path).
  - [ ] Constants are keyed by core unit-type and effect ids, and every ported ares entry maps to an existing id. Entries with no id are listed in a test-documented skip list.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new utils/grid/stamp.ts + stamp.test.ts; new constants/influence.ts (+ a small test checking ids).
  - Interfaces: `addCircle(data, width, height, cx, cy, radius, weight)` per design.
  - Follow: ares dicts/weight_costs.py, managers/grid_manager.py:589-712 (structure handlers) and :399-900 (avoidance lists), config.yml:49-80; constants/unit-type.ts and constants/effect.ts for ids.
  - Don't touch: types.ts, constants/index.ts, index.ts (T01 re-exports), any resources/ file.
- Stack: core.
- Blocked by: None (pure, new files only; can run now, in parallel with core-arch).
- Slice siblings: T01–T04, T06–T09.

## T06 Influence grids resource (design P4)

- Source: design P4; D2, D7–D11.
- What to build:
  - The influence resource: lazy per-loop build of the four layers from pathability and the playable area, enemy units (table, static D, generic DPS/range), and effects.
  - `addCost` for the current loop, `configure`, and a debug draw.
  - Reset keeps settings and drops buffers.
  - UNIT_AVOIDANCE is applied in addition to WEIGHT_COSTS, never instead of it. A unit in both tables stamps both, e.g. a baneling stamps 20 at 3 + rangeBuffer on ground plus 20 at 3 with no buffer on groundAvoidance. `InfluenceSource.buffer` is optional; leaving it out means no buffer.
  - Every effect radius gets `effectsRangeBuffer` added (EffectInfluence has no buffer field; ares adds it to all effects). Weights stay floats; no int() truncation (decisions.md "parity-2 T06 notes from T05 review").
- API contract: design P4 `InfluenceResource`, `InfluenceGrid`, `InfluenceSettings`, `InfluenceLayer`.
- Acceptance criteria (fixture acropolis 896 or a synthetic observation):
  - [ ] Unpathable ground cells and air cells outside the playable area are Infinity; open cells with no threat are 1.
  - [ ] A cell inside an enemy's ground range plus buffer is above 1 on ground; a cell far from all enemies is 1.
  - [ ] An air-only attacker raises air but not ground, and vice versa.
  - [ ] Ghosts are stamped; changelings are not.
  - [ ] An effect stamps out to its radius + `effectsRangeBuffer` (cell just inside raised, just outside not), and a fractional weight is stamped unrounded.
  - [ ] A baneling stamps both layers: ground (cost 20, radius 3 + rangeBuffer) and groundAvoidance (cost 20, radius 3, no buffer).
  - [ ] A present storm/bile/lib-zone effect raises its avoidance layer; it's gone the loop after the effect ends.
  - [ ] `addCost` is visible within the same loop and gone on the next.
  - [ ] Two `getGrid` calls in one loop build once (spy); the next loop rebuilds.
  - [ ] `configure` changes the range buffer / effect costs and survives a game reset; a new map size reallocates the buffers.
  - [ ] A sieged tank makes a ground cell 15 away unsafe and leaves air safe there (addendum A2).
  - [ ] A photon cannon or missile turret stamps the correct layers through the structure handlers (A2).
  - [ ] A storm stamps ground, air and both avoidance layers (A2).
  - [ ] `drawDebug` sends cells above the threshold through the debug resource.
  - [ ] `get` floors points and returns Infinity out of bounds.
  - [ ] Every finite cell cost in every layer is >= 1, including after `addCost` with a negative or fractional cost (clamped to 1). Why: the A* heuristic assumes cost >= 1; below that, paths are suboptimal (T07 review).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/influence.ts (replace the stub); new resources/influence.test.ts.
  - Interfaces: design P4; `InfluenceSource.buffer` is optional (absent = 0).
  - Follow: ares managers/grid_manager.py:209-288, 399-900; `map._grids.pathing` (`[y][x]`, 1 = blocked); `map.getEffects()`; `frame.getGameInfo().startRaw.playableArea`; `debug.setDrawCells`; T05's stamp and constants.
  - Don't touch: types.ts, systems/map.ts, resources/map.ts, the constants file (owned by T05; open a follow-up if a constant is wrong).
- Stack: core.
- Blocked by: T02 (ghosts via memory), T05.
- Slice siblings: T01–T05, T07–T09.

## T07 Pure A* (design P5, pure part)

- Source: design P5 `createAStar`; D6.
- What to build: an 8-connected A* on a flat cost grid with reused, generation-stamped buffers and a growable lazy-deletion binary heap.
- Acceptance criteria:
  - [ ] On an open grid it returns a straight-line path with the start excluded.
  - [ ] It detours around a high-cost blob when the detour is cheaper, and goes through it when it isn't.
  - [ ] It never cuts a corner between two Infinity orthogonals.
  - [ ] An unreachable goal returns null; `maxExpanded` caps the search (returns null).
  - [ ] The start cell is passable even if it is Infinity.
  - [ ] 1000 consecutive mixed queries on one instance give the same results as fresh instances.
  - [ ] Path cost equals brute-force Dijkstra on small random grids (optimality).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new utils/pathing/astar.ts + astar.test.ts.
  - Interfaces: `createAStar(width, height).findPath(costs, start, goal, maxExpanded?)` per design.
  - Follow: design P5 buffer layout.
  - Don't touch: resources/map.ts, PF.js, types.ts.
- Stack: core.
- Blocked by: None (pure, new files only; can run now, in parallel with core-arch).
- Slice siblings: T01–T06, T08, T09.

## T08 Pathing resource (design P5)

- Source: design P5; D6, D7.
- What to build: the pathing resource (findPath with goal retargeting, nextPoint with danger sensing, closestSafeSpot, isPositionSafe) on the influence grids (or a caller-provided grid), with one lazily created A* instance per map size.
- API contract: design P5 `PathingResource`, `PathOptions`.
- Acceptance criteria:
  - [ ] `findPath` returns cell centres and avoids a stamped cost circle when a cheaper detour exists.
  - [ ] A blocked goal retargets within 3 cells; it returns [] otherwise or when unreachable.
  - [ ] `nextPoint` returns the goal without running A* when no cell at or above the danger threshold is within the danger distance (spy).
  - [ ] With danger, `nextPoint` returns path point `min(sensitivity, len) - 1`, or the goal when there is no path.
  - [ ] `closestSafeSpot` returns the minimum-value finite cell within the radius, ties broken by distance; it lies outside a stamped circle around the start.
  - [ ] `isPositionSafe` honours `limit` (default 1).
  - [ ] Accepts a layer name or an `InfluenceGrid`.
  - [ ] Before calling astar, the resource guarantees start and goal are inside the grid (out-of-range points are clamped to the nearest in-bounds cell, or the call returns [] / the goal for `nextPoint`) and that the grid's width/height match the A* buffers (reallocated on mismatch). astar does not validate these (T07 review). Tests cover an out-of-bounds start, an out-of-bounds goal and a grid of a different size.
  - [ ] Perf (addendum A3): in a separate perf test on the blueshift fixture with ~20 enemies injected near the path, influence build + 50 `nextPoint` calls (danger near start so A* runs, ~60-cell paths) has a median of at most 10 ms over 20 runs, timed with `performance.now()`. Measured ad hoc (no committed wall-clock test; decisions.md "P3-T01 combat sim"); the measured median is recorded in the ticket.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/pathing.ts (replace the stub); new resources/pathing.test.ts (no committed perf test).
  - Interfaces: design P5.
  - Follow: ares managers/path_manager.py:154-403 (semantics, defaults); T06's `getGrid`/`addCost` (for stamping in tests); T07's `createAStar`.
  - Don't touch: resources/map.ts (`map.path`), systems/map.ts, types.ts, influence.ts.
- Perf measured ad hoc (2026-10-26, senior-backend-4): blueshift 896, 20 injected enemies near own base, start next to them, goal map centre (86-cell path, A* runs); influence build + 50 `nextPoint` per run, 20 measured runs after 5 warm-up: median 4.4-5.1 ms over two invocations (budget 10 ms).
- Stack: core.
- Blocked by: T06, T07.
- Slice siblings: T01–T07, T09.

## T09 Docs + changelog (design P6)

- Source: design P6; .agent-work/docs-plan.md §2 "Phase 2" and §3 (amended 2026-10-26 to match the docs plan).
- What to build: readme and API docs for memory, spatial, influence, pathing and army value; update the existing enemy-memory wording; create the readme section on deviations from ares-sc2; remove spatial from the readme's known limitations; add the `Unreleased › parity-2` changelog entry including the ghost-expiry behavior change.
- Acceptance criteria:
  - [ ] readme.md and docs/api.md document every public method in design P1–P5, with their defaults, in a `### memory`/`spatial`/`influence`/`pathing` subsection each (api.md in the docs-plan §3.2 format); `units.getArmyValue` sits under units. Settings surviving a game reset (D10) is stated. The influence section states that `costMultiplier` applies only to built-in sources, not to `addCost` (decisions.md "P2-T06 influence details"). The spatial section states that result order isn't stable: `closest` breaks ties between equal distances by ring order, and `unitsInRange` returns units in bucket order, not insertion order.
  - [ ] readme TOC and the `resources.get()` destructure line list the four new resources.
  - [ ] readme units "Enemy memory" paragraph (~585), the `onEnemyUnitLeftVision` row (~370) and api.md's memory note (~652) describe expiry and re-seen ghosts; `getClosest` (~569) points to `spatial`; `map.path` (~820) says when to use `pathing` instead.
  - [ ] New readme section "Where this library differs from ares-sc2" (after the python-sc2 one) covers D4 and the deliberate influence differences logged in decisions.md "parity-2 T05 constants": skipped ares entries (KD8Charge, ParasiticBomb, the forcefield handler; the climber, airVsGround, groundToAir, tactical and priority layers) and the two deliberate fixes (spine crawlers add ground influence, where ares has no handler; banelings go into groundAvoidance, where the ares code for it is dead), weights are floats instead of ares' truncated ints, and the circle stamp is inclusive so it can be one ring larger than ares at integer radii; our own liberator zones aren't stamped (ares stamps them), so the bot's army doesn't path around its own liberators (decisions.md "P2-T06 influence details"); "Known limitations" no longer lists spatial/range queries as O(n) and lists the skipped layers/effects; "Changes compared to node-sc2" (~993) notes memory expiry.
  - [ ] docs/internals.md Resources list has the four resources and the per-step hook.
  - [ ] docs/changelog.md `Unreleased › parity-2` with Added/Changed (ghost expiry) and `Migrating bot/`.
  - [ ] Every new example type-checks.
- Implementation plan:
  - Where: packages/core/readme.md, docs/api.md, docs/changelog.md, docs/internals.md.
  - Follow: docs-plan.md §3 conventions; core-arch T05's `Unreleased` section.
  - Don't touch: code.
- Stack: core (docs).
- Blocked by: T02, T03, T04, T06, T08, core-arch T05 (same doc files).
- Slice siblings: T01–T08.
