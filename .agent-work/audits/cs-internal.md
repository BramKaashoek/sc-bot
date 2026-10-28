# cs-internal: internal consistency audit of packages/core

Read-only audit, code only, 2026-10-27. Paths relative to packages/core. Every file:line was checked against the code at audit time. Already handled in .agent-work/consolidation.md (CN-A*/CN-B*, "Checked, no action") is not repeated. Residue of CN-A01 that is still present is flagged "CN-A01 residue".

Counts: high 0, med 7, low 18 (25 findings).

Effort is junior unless marked senior with a reason. PUBLIC = fix would change a public export, type or observable behaviour.

## Summary table

| id | sev | area | one-line | PUBLIC | effort |
|---|---|---|---|---|---|
| INT-01 | med | resources | One definition pattern in 14 files, a different one for the 6 core resources, and 3 construction shapes | no | junior |
| INT-02 | med | resources | Default `reset` (recreate + Object.assign) silently splits state for WeakMap-backed resources; `memory.reset(){}` exists only to dodge it | no | senior (per-game reset semantics) |
| INT-03 | low | resources | `debug` optional in `ResourceContainer` but always registered; 7 `debug!` vs 1 `debug?.` | PUBLIC (type) | junior |
| INT-04 | low | resources | State-holder naming and reset/step shapes vary (7 WeakMap names, arrow vs method, buildings `step` closure) | no | junior |
| INT-05 | med | cross-state | Raw `map._grids/_mapSize/_ramps` reads while getters exist | no | junior |
| INT-06 | low | cross-state | Units store `_units` has 5 writers across 3 modules and 3 write styles; abilities cache written in 2 places | no | junior |
| INT-07 | low | cross-state | `actions._client` reached from 4 non-engine modules; `!` on a non-optional field | no | junior |
| INT-08 | med | cross-state | Per-game state in module WeakMaps keyed by World in systems, outside the resource reset lifecycle, 3 init styles | no | senior (per-game state reset semantics) |
| INT-09 | med | layout | `agent/macro.ts` is imported by resources, systems and behaviors (resource -> agent layering inversion) | no | junior |
| INT-10 | low | layout | `resources/units-collection.ts` is a util imported by utils/, engine/, behaviors/; `positionOf` = `toPoint` | no | junior |
| INT-11 | low | layout | Tag/array normalisation re-implemented ~10 times | no | junior |
| INT-12 | low | layout | `getRandom` bypassed 3 times; 2 shuffle copies (CN-A01 residue for randomOf) | no | junior |
| INT-13 | low | layout | `remapsToAbilityId \|\| abilityId` general-ability lookup inlined 5 times | no | junior |
| INT-14 | low | layout | Small leftovers: NOOP x5, `createPoint2D` copy, `context()` wrapper, point-key strings, CHANGELINGS x2, distance via hypot/sqrt | no | junior |
| INT-15 | med | errors | "Rethrow fatal, silly-log NodeSC2Error, debug-log the rest" copied 5 times with different sinks | PUBLIC (logging) if sinks unified | junior |
| INT-16 | low | errors | Plain `Error` / Range / TypeError vs `NodeSC2Error` in internal paths; error name casing mismatch | partly PUBLIC | junior |
| INT-17 | low | logging | Debug namespace naming: 3 shapes, mixed case, `debugDebug`, leveless draw namespaces | PUBLIC (documented DEBUG names) | junior |
| INT-18 | low | logging | Dead debug code: `debugGrid` (+ `chalk` dep), 2 commented-out console lines | no | junior |
| INT-19 | med | tests | Observation-edit helper (`structuredClone(fixture.observations[896])` + set loop + push units) re-written in 27 files | no | junior |
| INT-20 | low | tests | `fixture.data.units![id] = unitTypeData(...)` x~25 and 3 `worldWith` builders | no | junior |
| INT-21 | low | tests | 2 live suites re-implement `test/live.ts`; `skipIf(!SC2PATH)` x6; `22.4` x6 despite `GAME_LOOPS_PER_SECOND` | no | junior |
| INT-22 | low | tests | Combat/macro behavior tests each re-declare `place`/`fixture`/`run`/`setup`/`execute` | no | junior |
| INT-23 | low | tests | `command-executor.test.ts` has no matching module; frame.ts/event-channel.ts have no test | no | junior |
| INT-24 | low | layout | Constants imported 3 ways; engine/agent/systems barrels used only by root index.ts | no | junior |
| INT-25 | low | layout | utils/ mixes pure algorithms with World-dependent code; `utils/grid/` vs `utils/map/grid.ts` | no | junior |

## 1. Resource definition patterns

Registration: `engine/create-world.ts:28-59` (`coreResources`) feeds `engine/create-resource-manager.ts:30-43` (`register`), `:44-51` (`reset`), `:62-77` (`step`), `:52-61` (`endGame`). `applyConfig` (`:12-21`) detects `configure` by duck typing, run after `register` and after each `reset`.

### INT-01 med: three construction shapes, two definition locations

- 14 resources export a `ResourceDefinition` const from their own file: `memoryResource` (memory.ts:29), `spatialResource` (spatial.ts:11), `influenceResource` (influence.ts:159), `pathingResource` (pathing.ts:33), `rolesResource` (roles.ts:42), `squadsResource` (squads.ts:73), `intelResource` (intel.ts:182), `placementResource` (placement.ts:502), `buildingsResource` (buildings.ts:120), `miningResource` (mining.ts:82), `flyingResource` (flying.ts:71), `mapAnalysisResource` (map-analysis.ts:338), `behaviorsResource` (behaviors.ts:59), `openingsResource` (openings.ts:104).
- The 6 core resources (frame, map, debug, units, events, actions) are defined inline in create-world.ts:30-44, and their files default-export a `createX` factory under 6 different names: `createFrame` (frame.ts:5), `createMapManager` (map.ts:34), `createDebugger` (debug.ts:31), `createUnits` (units.ts:39), `createEventChannel` (event-channel.ts:7), `createActionManager` (actions.ts:55). create-world.ts imports them under yet other names (`Frame`, `MapManager`, `Debugger`, `UnitManager`, `EventChannel`, `ActionManager`, lines 3-9). Their `reset` lives in create-world.ts (frame :30, units :34-37, actions :41-44), not next to the resource; map/debug/events rely on the default recreate.
- Inside the 14, `create` has 3 shapes: (a) everything inline in `create(world)` (memory, spatial, pathing, roles, squads, intel, mining, flying, openings, placement, buildings, influence), (b) inline definition that only calls a private factory: behaviors.ts:59-62 (`createBehaviors`), map-analysis.ts:171 (`createMapAnalysis`) + definition at :338, (c) `this`-based object literal with `_`-prefixed fields (map.ts, units.ts, frame.ts, debug.ts).
- Fix (internal only): export a `xResource` definition from each of the 6 core files; move the three `reset` bodies with them; create-world.ts becomes a pure list. Pick one create shape (inline `create(world)` calling a private helper is already the majority). No public export or type changes; `docs/internals.md:49-52` already describes `{ name, create, reset? }` as the only pattern.
- Touches: engine/create-world.ts, resources/{frame,map,debug,units,event-channel,actions}.ts, optionally behaviors.ts, map-analysis.ts.
- Effort: junior (mechanical moves; the 6 default exports are not reachable from index.ts, checked: index.ts:4-8,25-45 export none of them).

### INT-02 med: default `reset` is a trap for the common (WeakMap) pattern

- Default reset = `Object.assign(resource, definition.create(world))` (create-resource-manager.ts:47-49). For resources whose state lives in a module `WeakMap<Resource, State>` (roles.ts:19, intel.ts:37, openings.ts:28, mining.ts:39, influence.ts:46, map-analysis.ts:61, placement.ts:62, buildings.ts:59, flying.ts:23, squads.ts:16, memory.ts:7) the recreate creates a new object + new state entry, copies the new methods (closing over the NEW state) onto the OLD object, while `onStep(resource)` does `stateByX.get(resource)` and finds the OLD state. Methods and onStep then operate on different states with no error.
- This is why `memory` has an empty `reset() {}` (memory.ts:59) and why every WeakMap resource has a hand-written `reset` that clears each field by hand (roles.ts:99, intel.ts:239, mining.ts:154, openings.ts:159, buildings.ts:545, flying.ts:127, map-analysis.ts:341, influence.ts:213, placement.ts:616, squads.ts:129). Hand-clearing drifts: any new state field must be added to both `create` and `reset`.
- Closure-only resources (spatial, pathing, behaviors) have no `reset` and silently rely on the recreate path being safe for them. Nothing in the type says which resources may omit `reset`.
- Fix: make `reset` required on `ResourceDefinition` is PUBLIC (type), so internally instead: add a `freshState()` per WeakMap resource (placement.ts:64 `freshState` already does it) and have `reset` do `stateByX.set(resource, freshState(keepSettings))`; add one test in engine/create-world.test.ts that resets every core resource and asserts old-vs-new state parity for resources with a WeakMap. Keep the decision "which settings survive reset" (placement keeps `state.settings`, others never touch settings) explicit and uniform.
- PUBLIC: no for the internal fix. Making `reset` mandatory or removing the default would be PUBLIC (bots register resources, internals.md:49).
- Effort: senior, per-game state reset semantics (which fields survive: settings, history in openings, `optedIn` in buildings.ts:552).

### INT-03 low: `debug` optionality

- types.ts:1205 `debug?: Debugger` but create-world.ts:32 always registers it. Consumers: 7x `debug!` (systems/map.ts:446,507,658; resources/map.ts:266,359; systems/chat-debug.ts:84,100,103; systems/builder-plugin.ts:373) vs 1x `debug?.` (resources/placement.ts:610) and a guarded read in systems/debug.ts:40. `placer?` (types.ts:1206) is genuinely optional (injected through `resources.set`).
- Fix: drop the `?` on `debug`, delete the `!`/`?.`. PUBLIC (type only, narrowing is source-compatible for readers; bots that assign `debug` via `set` still type-check since `IncomingResources` is `Partial`).
- Touches: types.ts, the 8 call sites above. Junior.

### INT-04 low: shape drift inside the "same" pattern

- WeakMap names: `stateByRoles`, `stateByIntel`, `stateByOpenings`, `stateByMining`, `stateByResource` (influence.ts:46), `states` (map-analysis.ts:61), `stateByPlacement`, `stateByTracker` (buildings.ts:59), `stateByFlying`, `statesBySquads` (squads.ts:16, holds a `Map`, not a state), `settingsByMemory` (memory.ts:7, settings only).
- `reset`/`onStep` written as methods (roles, intel, mining, openings, buildings, squads, memory) vs arrow properties (flying.ts:127,130; map-analysis.ts:341,347; placement.ts:616,620; also `create: (world) =>` at flying.ts:72, behaviors.ts:61).
- buildings.ts stores `step: () => void` inside its state (buildings.ts:56) and `onStep` just calls it (:554-556); every other resource implements onStep with free functions over `(world, state)`.
- Fix: rename to `stateByX` (singular resource name), use method shorthand everywhere. Effort junior, no public change. Pairs with INT-01.

## 2. Cross-resource / system state access

### INT-05 med: `map._*` fields read directly although getters exist

- `_grids`: resources/placement.ts:127,165 (`map._grids`), resources/influence.ts:79; getter `map.getGrids()` (resources/map.ts:211) is already used by systems/map.ts:255,282,331,660.
- `_mapSize`: utils/map/blockers.ts:8, systems/map.ts:590-591; getter `map.getSize()` (resources/map.ts:287).
- `_ramps`: systems/map.ts:543-549 (reads back what it just set via `setRamps`). Note the name clash: `map.getRamps()` (map.ts:414) returns the closure `ramps: Ramp[]`, while `_ramps` is a different `Point3D[]` that backs `isRamp` (map.ts:103); two "ramps" stores behind similar names.
- `_mapState.creep`: placement.ts:128,166,625; no getter exists (only `hasCreep(point)` at map.ts:107).
- `_graph: any` typed on the interface (types.ts:418).
- Fix: swap the first three to the getters (no public change); for `_mapState.creep` either keep (performance loop reads) or add a getter, which would be a PUBLIC type addition, so leave and note; rename or document the two ramp stores.
- Touches: resources/placement.ts, resources/influence.ts, utils/map/blockers.ts, systems/map.ts. Junior.

### INT-06 low: units store and frame written through different styles

- Direct `_units[alliance]` access outside units.ts: read-only in roles.ts:51,107 (could use `units.getByTag`/`getAlive`); writes/deletes in memory.ts:33,60-66 (`forget`, expiry), systems/frame.ts:110 (dead enemies), systems/unit.ts:260,295 (set), create-world.ts:36 (clear). Five writers, no single owner method; docs/internals.md:49 says one system is the sole mutator of each resource, which memory.onStep violates.
- Three write styles for system -> resource: map uses setters (`setGrids`, `setMapState`, ... map.ts:254-317), frame is assigned field by field from systems/frame.ts:20-59 (`frame._gameLoop = ...`), units is mutated in place.
- Abilities cache duplicated: engine/create-unit.ts:165-166 (`fetchAvailableAbilities`) vs systems/unit.ts:278,293-294 (writes `_availableAbilities`/`_availableAbilitiesLoop`, plus a redundant `units._units[SELF].set(...)` of the same unit at :295).
- Fix: internal helper (not on the public `UnitResource`) for "forget enemy tag" used by memory/frame, and a single `setAvailableAbilities(unit, ids, loop)` used by both spots; delete the redundant `.set`. No public change.
- Touches: resources/memory.ts, resources/roles.ts, systems/frame.ts, systems/unit.ts, engine/create-unit.ts. Junior.

### INT-07 low: protocol client reached through `actions`

- `world.resources.get().actions._client` from resources/debug.ts:39,48,396, resources/openings.ts:168,173, utils/map/blockers.ts:25, systems/frame.ts:14,26, engine/create-engine.ts:136,231 (the engine legitimately owns it), test/live.ts:32. debug.ts:39 adds `!` on a non-optional field (types.ts:502).
- Fix: remove the `!`; optional: one internal `clientOf(world)` helper. Low value, junior, no public change.

### INT-08 med: per-game state outside the resource lifecycle

- Systems keep per-world WeakMaps: systems/unit.ts:7,9 (`seenUnitTagsByWorld`, `seenEnemyTagsByWorld`: set in `onGameStart` :15-16 AND lazily re-created :64-67), systems/map.ts:47 (`blockedStructures`) and :157 (`blockerCells`) (deleted in `onGameStart` :521-522, lazily created :53-56,160-163), utils/map/blockers.ts:18 (`liveGrids`, never deleted, invalidated by `game`/`gameLoop` identity). Comment at systems/map.ts:46 says why (shared module object).
- Three init/clear styles for the same need; none participates in `resetGameState` (create-world.ts:77-80), which only resets resources and earmarks.
- Also module-level mutable: `pluginCount` (systems/builder-plugin.ts:45, used :81 for earmark prefix): process-global monotonic counter, harmless but is the only global counter; earmarks themselves are in `world.data` (data-storage.ts:13, cleared at create-world.ts:79), not in a resource.
- Fix: either a tiny `perWorld(factory)` helper (WeakMap + get-or-create) used by all four sites with an explicit clear in `onGameStart`, or move the state into the owning resources (units/map) so `reset` covers it. Needs a decision on reset semantics, hence senior.
- PUBLIC: no.

## 3. Layout and helpers

### INT-09 med: `agent/macro.ts` as shared-helper module

- Imported "upward" by resources/actions.ts:12 (`researchAbilityOf`, `spend`), resources/buildings.ts:8 (`affordable`, `spend`), systems/builder-plugin.ts:14 (`affordable`), behaviors/macro/tech.ts:1 (`researchAbilityOf`, `spend`, `techEquivalents`), behaviors/macro/structures.ts:1 (`spend`), behaviors/macro/spawn.ts:1 (`REQUIRES_TECHLAB`). Resource files depend on the agent mixin file, which depends on resources at runtime (`agent._world.resources`, macro.ts:136).
- Signature split: `spend(agent, ...)` (macro.ts:236), `researchAbilityOf({_world})` (:168) take the Agent; `affordable({agent, data}: World)` (:243) takes the World.
- Fix: move `spend`, `affordable`, `researchAbilityOf`, `techEquivalents`, `REQUIRES_TECHLAB` to a util module (e.g. utils/economy.ts) taking `World`; macro.ts keeps only the Agent mixin. `agent/macro.ts` is not exported from index.ts (checked), so no public change.
- Touches: agent/macro.ts, agent/create-agent.ts, resources/actions.ts, resources/buildings.ts, systems/builder-plugin.ts, behaviors/macro/{tech,structures,spawn}.ts, their tests. Junior.

### INT-10 low: `units-collection.ts` is a util living in resources/

- `isFlying`, `toPoint`, `Units` imported from `resources/units-collection.ts` by utils/combat/combat-sim.ts:17, engine/create-unit.ts:45, behaviors/combat/{helpers,group,individual,terran}.ts, and 8 resources. utils -> resources and engine -> resources are upward imports.
- `positionOf` (behaviors/combat/helpers.ts:7) is the same function as `toPoint` (units-collection.ts:11); more inline copies at behaviors/combat/helpers.ts:43 and resources/debug.ts:373, create-unit.ts:407.
- Fix: move `toPoint`, `isFlying` next to `utils/geometry/point.ts`/units util, delete `positionOf`. `Units` stays (public re-export at index.ts:25 only changes its internal path). Junior.

### INT-11 low: unit/tag/array normalisation copies

- Tag-from-unit-or-string: roles.ts:21-22 (`tagsOf`), roles.ts:80, mining.ts:41 (`tagOf`), behaviors.ts:29,44, flying.ts:113, actions.ts:53 (`tagsOf`), actions.ts:136-137, debug.ts:40-41 (`tagsOf`). Unit/array-to-array: `Array.isArray(x) ? x : [x]` at actions.ts:157,175,193,209,225,301,629,753, debug.ts:393, squads.ts:19, influence.ts:181, roles.ts:25.
- Fix: one `toTag`/`toTags`/`asArray` util, used by all. Junior, no public change.

### INT-12 low: random helpers (CN-A01 residue)

- `getRandom` (utils/get-random.ts) used by builder-plugin.ts:3, debug.ts:3, actions.ts:2, but bypassed by: agent/macro.ts:131 `randomOf` (consolidation A-4 said merge; still there), actions.ts:33 (`getRandomN` inline pick), units-collection.ts:104 (`random`). Two Fisher-Yates variants: actions.ts:39-45 `shuffled` and units-collection.ts:218-221 `randomGroupOf`.
- Fix: use `getRandom`; one `shuffle` util. Junior.

### INT-13 low: general-ability lookup inlined

- `world.data.getAbilityData(id)?.remapsToAbilityId || id`: agent/macro.ts:164-166, behaviors/combat/helpers.ts:31-32, resources/actions.ts:123, plus variants systems/builder-plugin.ts:99, engine/create-unit.ts:266, engine/data-storage.ts:29.
- Fix: one internal `generalAbility(data, id)` function. Adding it as a DataStorage method would be a PUBLIC type addition, so keep it a function. Junior.

### INT-14 low: small leftovers

- `NOOP = () => {}` x5: agent/create-agent.ts:10, engine/create-engine.ts:62, systems/builder-plugin.ts:43, systems/create-system.ts:22, systems/unit-plugin.ts:3.
- `createPoint2D` redefined at resources/map.ts:22 although exported from utils/geometry/point.ts:117,157 (systems/map.ts:11 already imports it).
- `context(world)` = `world.resources.get()` at resources/buildings.ts:68, used 27 times; no other file wraps it (122 direct `resources.get()` destructures elsewhere). `context(agent)` at agent/macro.ts:135 is an unrelated object with the same name.
- Point keys: `${x},${y}` at systems/map.ts:64 (`cellKey`), resources/mining.ts:347 (`positionKey`), agent/macro.ts:329,336 inline; test/fake-client.ts:90,92.
- `CHANGELINGS` (same 6 types): behaviors/combat/terran.ts:17-24 and resources/influence.ts:28-35; not in constants/groups.ts (CN-A03/B01 did not cover it). `STATIC_DEFENCE` (terran.ts:15) vs `STATIC_DEFENSE` (constants/influence.ts:56): different shape, spelling differs.
- Distance: create-unit.ts:415 `Math.sqrt(distanceSquared(...))`, :589 and utils/combat/combat-sim.ts:113 `Math.hypot`, vs `distance` in utils/geometry/point.ts:16 (CN-A01 residue).
- Fix: use the shared symbol in each case; add CHANGELINGS to constants/groups.ts (internal unless exported through constants/*, which it would be: constants/* is in the package.json exports map, so adding an export is a PUBLIC addition, keep it private in a shared internal module instead). Junior.

### INT-24 low: constants import style and barrels

- `UnitType`/`Ability`/`Upgrade` come from `constants/index.ts` in 38 files incl. tests (e.g. resources/units.ts:13, agent/macro.ts:2), as `import * as UnitType from '../constants/unit-type.ts'` namespaces in 27 (e.g. resources/buildings.ts:6, engine/create-unit.ts:1-5), and as single-line named picks in 21+ (e.g. resources/mining.ts:6, behaviors/macro/spawn.ts:5). Same file mixes them: systems/builder-plugin.ts:6 (`import * as ability`, lowercase alias) and :9 (barrel).
- Barrels engine/index.ts, agent/index.ts, systems/index.ts are one-line default re-exports used only by root index.ts:4-6; nothing else imports them (all internal code imports `create-*.ts`). behaviors/index.ts and constants/index.ts are real public barrels.
- Fix: choose barrel `{ UnitType, Ability }` for namespaces, direct file for single named picks; delete the three one-line barrels and import `create-*.ts` from index.ts. Junior; no public change (package.json exports map does not list them).

### INT-25 low: utils/ boundary

- World-dependent modules in utils/: map/blockers.ts, map/townhall.ts, map/region.ts, workers/select-builder.ts, build-order/targets.ts, geometry/units.ts. Pure algorithms (astar, flood, chokes, distance-field, bucket-index, stamp, formation) sit beside them.
- `utils/grid/` (cell.ts, stamp.ts) and `utils/map/grid.ts` overlap in name; 5 single-file folders (mining, workers, pathing, placement, spatial); get-random.ts and pixel-map.ts at utils root; ramp.ts, region.ts, townhall.ts, blockers.ts have no test file.
- Fix: optional, low value: split `utils/` (pure) from World-taking helpers (e.g. `resources/helpers/` or `systems/`), or document the rule. Junior but wide import churn; do last or skip.

## 4. Logging / debug

### INT-17 low: namespace pattern

Inventory (all `createDebug`): level-prefixed `sc2:debug:<Name>`: Bot (agent/create-agent.ts:9), Macro (agent/macro.ts:23), MapSystem (systems/map.ts:39), frameSystem (systems/frame.ts:7), placement (resources/placement.ts:33), actionManager (resources/actions.ts:22), buildOrder (utils/build-order/parse.ts:12), engine (create-engine.ts:58), client (create-client.ts:14), system / state (create-system.ts:18,20), mapAnalysis (map-analysis.ts:18), earmark (data-storage.ts:9), build (builder-plugin.ts:36), launcher (launcher.ts:9), resources (create-resource-manager.ts:5). `sc2:silly:<Name>`: MapSystem, EventChannel, resources, engine, system, build. Level-less draw/overlay: `sc2:DrawPlacementMap`, `sc2:DrawDebugMap`, `sc2:DrawDebugWalls` (systems/map.ts:36-38), `sc2:DebugOnScreen` (systems/debug.ts:7), `sc2:DebugWeights`, `sc2:DebugPathable` (resources/map.ts:14-15), `sc2:DebugWidget` (resources/debug.ts:8), `sc2:DrawDebug` (builder-plugin.ts:37).
Inconsistencies: PascalCase (Bot, Macro, MapSystem, EventChannel) vs camelCase (frameSystem, actionManager, buildOrder, mapAnalysis) vs lowercase (placement, build, engine); "Draw..." vs "Debug..." prefixes for the same kind of overlay; variable names `debug`, `debugX`, `debugDebug` (systems/map.ts:39); no namespace at all for mining, buildings, openings, flying, intel.
Fix: `sc2:<level>:<camelCaseModule>` for logs, `sc2:draw:<name>` for overlays, variable `debugX`/`sillyX` consistently. PUBLIC (behaviour): readme.md:255,608,1201 and docs/changelog.md document `sc2:debug:buildOrder`, `sc2:debug:actionManager`, `sc2:DebugOnScreen`, `sc2:DrawDebugWalls`, `sc2:debug:*`; renaming needs a changelog line. Safe internal subset: variable names and `debugDebug`.

### INT-18 low: dead and commented-out logging

- utils/map/grid.ts:4-60 `debugGrid` + `console.log` (:11) is exported (:125) with zero callers in the repo (checked across .ts/.md); it is also the only user of the `chalk` dependency (package.json). Delete both.
- Commented-out logging: utils/map/flood.ts:29, engine/create-engine.ts:510 (inside an empty `if`; the `if` at :509 then does nothing).
- console.warn vs debug for the same class of event: user-visible warns at systems/map.ts:539, resources/actions.ts:264 ("erroniously"), resources/openings.ts:71,76, utils/map/blockers.ts:29, engine/config.ts:48, engine/create-resource-manager.ts:20, systems/builder-plugin.ts:274, engine/create-engine.ts:335,351,422,483,539,577; swallowed step errors go to debug only (see INT-15).

## 5. Errors

### INT-15 med: one error-triage block, five copies, inconsistent sinks

- Rule "rethrow GameEnded/ConnectionClosed, NodeSC2Error to silly, everything else to debug with stack" is hand-copied at systems/create-system.ts:120-145 (twice), engine/create-resource-manager.ts:66-76 (onStep), engine/create-engine.ts:574-581 (agent handlers) and :600 (flush), utils/map/blockers.ts:28. The sinks diverge: systems and resources log unexpected errors only to `debug` (invisible without the DEBUG env), agent handlers `console.warn` them (create-engine.ts:577), flush uses `debugEngine`, `endGame` hooks use `debug` only (create-resource-manager.ts:55-58).
- Effect: a TypeError bug inside `intel.onStep` or any system `onStep` is silent by default, while the same bug in an agent handler is printed.
- Fix: one helper in engine/errors.ts, e.g. `isFatalGameError(err)` and `handleStepError(label, err)`, used by all five sites; pick one sink for non-NodeSC2Error (console.warn matching the agent handler). Unifying the sink changes logging behaviour, so PUBLIC (behaviour, log output only); extracting the helper without touching sinks is not.
- Touches: engine/errors.ts, engine/create-resource-manager.ts, engine/create-engine.ts, systems/create-system.ts, utils/map/blockers.ts. Junior.

### INT-16 low: plain Error vs the engine/errors.ts classes

- Same module, both styles: resources/units.ts:229 `NodeSC2Error` vs resources/units-collection.ts:201,279,287,366 plain `Error`; resources/map-analysis.ts:74 `MapDecompositionError` wrapping resources/map.ts:43 plain `Error`; resources/mining.ts:146 `RangeError` for config validation vs `NodeSC2Error` for config validation in engine/config.ts:14-72 and builder-plugin.ts:282,301.
- Plain `Error` in internal paths: resources/map.ts:43,164; engine/create-unit.ts:617; agent/macro.ts:484; utils/map/grid.ts:51; utils/map/ramp.ts:138 (`'Not implemented...'`); engine/launcher.ts:23,53,155; create-engine.ts:163,305,378,433. Argument validation with Range/TypeError in pure utils (pixel-map.ts:108,111; ramp.ts:17) is fine.
- Consequence: resource/system triage (INT-15) logs plain errors at `debug` level with stack and NodeSC2Error at `silly`, so the class choice changes log level.
- errors.ts:11 `createError('NodeSc2Error')` vs exported `NodeSC2Error` (and the `ErrorClass` name union at :31 also says 'NodeSc2Error'): `err.name` casing differs from the identifier. Changing it is PUBLIC (observable `err.name`).
- Fix: rule "internal precondition/state failures throw NodeSC2Error; pure-util argument checks keep Range/TypeError"; apply to the internal ones above. Changing units-collection.ts/map.ts (public methods) is PUBLIC only in `name`/`instanceof NodeSC2Error`; `instanceof Error` still holds. Junior.

## 6. Tests

Helpers today: test/factories.ts (`rawUnit`, `packBits`, `observation`, `unitTypeData`, `toyFixture`), test/create-test-world.ts (`loadFixture`, `stepTo`, `createTestWorld`), test/fake-client.ts, test/live.ts, test/spawn-units.ts. 83 test files; live suites are consistently `*.live.test.ts` (6 files), gated by `describe.skipIf(!process.env.SC2PATH)`.

### INT-19 med: observation-edit helper copied per file

- `structuredClone(world.client.fixture.observations[896])` (or `[0]`) appears in 27 test files (actions.test.ts alone 6 times); wrapped in a local helper named `stepWith` in 6 files (examples/ares/{assigning-unit-roles,combat-maneuver,custom-behaviors,managing-production,unit-squads}.test.ts, resources/squads.test.ts:10) and `observation` in 5 (resources/{flying,intel,memory,mining,roles}.test.ts:17,31,14,23,13), with near-identical bodies (clone, set gameLoop, push/filter units, step).
- Fix: add `observationAt(world, loop, { hide, add, edit })` and `stepWith(world, loop, units)` to test/create-test-world.ts, migrate. No product code touched. Junior.

### INT-20 low: toy-world construction

- `fixture.data.units![id] = unitTypeData(id, {...})` about 25 times (systems/map.test.ts x15, agent/macro.test.ts:141,437, agent/create-agent.test.ts:132, engine/create-unit.test.ts:38, resources/units-collection.test.ts:16) and 3 near-identical `worldWith` builders: resources/units-collection.test.ts:10, engine/create-unit.test.ts:29, agent/create-agent.test.ts:125.
- Fix: `toyWorld({ units, unitTypes, abilities, upgrades, playerCommon, race })` in test/factories.ts. Junior.

### INT-21 low: live-test plumbing and constants

- engine/behaviors.live.test.ts:17-40 and engine/create-engine.live.test.ts:36-78 re-implement `sc2Pids`, the kill-new-SC2 `afterEach`, and (create-engine.live.test.ts:59) `clientOf` that already exist in test/live.ts:13,23,32; `computer()` (create-engine.live.test.ts:52) is `veryEasyZerg` (test/live.ts:34) plus options.
- `skipIf(!process.env.SC2PATH)` x6 (placement.live:50, mining.live:49, create-engine.live:81, flying.live:32, behaviors.live:43, examples.live:54); could be `describeLive` in test/live.ts.
- Loops per second: `22.4` redefined as `LOOPS_PER_SECOND` in resources/{intel,memory,placement}.test.ts:11,10,11, resources/flying.live.test.ts:12, `TICKS_PER_SECOND` engine/create-engine.live.test.ts:23, literal in mining.live.test.ts:8 and buildings.test.ts:12,277,365,448, while `GAME_LOOPS_PER_SECOND` exists (constants/time.ts:1).
- Fix: reuse test/live.ts and the constant. Junior.

### INT-22 low: behavior test scaffolding

- behaviors/combat/{group,helpers,individual,terran}.test.ts each define `place` (group:32, individual:40, terran:19, helpers:18; identical), `fixture()` loading `createTestWorld('blueshift', { loop: 896 })` with tag consts, and `run()` (group:37, individual:45, terran:33, plus macro/spawn.test.ts:34) that clears the queue, runs under an owner, flushes and extracts sent commands.
- behaviors/macro/{production,spawn,structures,tech}.test.ts each define `setup()` (production:18, spawn:14, structures:11, tech:8: `loadFixture('blueshift')` + `observation(...)` + `createTestWorld`) and `execute` (production:51, structures:28, tech:26), also `composition` (production:10, spawn:48).
- Fix: `placeUnit`, `runBehavior(world, behavior)` and `macroWorld(units, opts)` in test/. Junior.

### INT-23 low: naming gaps

- resources/command-executor.test.ts has no command-executor.ts; it exercises the command arbiter end to end (header imports agent, system, createTestWorld), while resources/command-arbiter.test.ts is the unit test. Rename to `command-arbiter.integration.test.ts` or fold in.
- resources/frame.ts and resources/event-channel.ts have no direct test (covered indirectly via systems/frame.test.ts).
- `.test.ts` vs `.live.test.ts` is consistent; no finding there.

## Checked, no finding

- Resource name/keys: `ResourceContainer` order (types.ts:1185-1207) matches `coreResources` order except `debug`/`placer` extras; registration order is documented in docs/internals.md:28,67-69.
- Module-level mutable state: only `pluginCount` (INT-08 note) and `nextTag` in test/factories.ts:7 (test-only, fine); scripts/ module state is script-local.
- Casts: `as unknown as` use is confined to errors.ts, proto client shims (create-client.ts:92,111), data-storage.ts:23, systems/*-plugin.ts, test helpers; no `as any` in internal code (only `: any` on public handler types in types.ts and `ResourceDefinition<any>` at create-resource-manager.ts:10).
- File naming is kebab-case throughout; `create-*.ts` prefix for factories in engine/agent/systems, none in resources/ (covered by INT-01).
