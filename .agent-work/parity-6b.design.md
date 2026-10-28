# parity-6b design

Author: technical-architect (2026-10-26). Covers ares-gap ranked #10: string build-order format, named targets, special steps (worker/overlord scout, chrono, orbital, cancel gas, addon swap), and opening selection/switch. It builds on the existing build system (systems/builder-plugin.ts) as phase 4 leaves it (P4-T11), on phase-4 placement/buildings/mining/flying, on phase-5 autoSupply, and on 6a config + mapAnalysis + enemy race. Paths are under packages/core/. ares paths are relative to ares-sc2/src/ares/.

## Current state (verified)
- Build system (systems/builder-plugin.ts):
  - `createSystem({ type: 'build', buildOrder })` takes `BuildTask = BuildTaskI | [supply, BuildTaskI]` (types.ts:71-91), built with `taskFunctions.build/train/upgrade/ability` (:46).
  - `normalizeBuildOrder` (:126-159) fills worker tasks up to each tuple's supply, starting at 12.
  - Execution: strict order, one task at a time (:163-303), with earmarks after a delay, `opts.skip` from system state, pause/resume, and a 250-loop COMMAND_GIVEN reset.
  - Task opts today: `near`, `on` (addon host), `skip`, `target` (ability target unit type).
  - Townhall tasks go to `map.getAvailableExpansions()[0]` (:409).
  - The ability task picks the first unit with the ability available and a random finished unit of `opts.target` (:518-541).
  - There is no runtime supply gate: tuples only drive worker fill.
- P4-T11 changes the structure/gas branches to `placement.request` → `buildings.build` / `buildings.buildGas`. The townhall/addon branches are unchanged.
- ares (build_runner/*):
  - String steps are `"<supply> <command> [@ target] [xN|*N]"`. Dict steps are `{ "<supply> <OPTION>": [targets] }`.
  - Commands are a UnitTypeId, UpgradeId or option: ADDONSWAP, CANCEL_GAS, CHRONO, CORE, GAS, GATE, EXPAND, ORBITAL, OVERLORD_SCOUT, SUPPLY, WORKER, WORKER_SCOUT (consts.py:207).
  - Targets: consts.py:226.
  - Each opening has AutoSupplyAtSupply / ConstantWorkerProductionTill / PersistentWorker / ShouldHandleGasSteal.
  - Supply is a start gate.
  - Look-ahead runs a later step when minerals > 470.
  - switch_opening(remove_completed).
  - Opening choice is a per opponent-id or enemy-race cycle, or winrate-based over a JSON history in data/ (managers/data_manager.py).
- 6a (contract from technical-architect-3):
  - JSON config `sc-bot.config.json`. `resources.<name>` is passed to that resource's `configure()`, and `ResourceSettings` is derived from each resource's configure parameter.
  - The `mapAnalysis` resource provides `getRegion(point)`, `getPerimeter(region)` (angle-sorted cell centres), `getEnemyMainRamp()` and `getDefensiveThird()`.
  - `agent.opponent.race` is set on first sighting, with an `enemyRaceDetected` event.
  - No overlord spots.
- No game-end hook reaches resources or systems. Only `EngineOptions.onGameEnd` exists (create-engine.ts:477-487).

## O1. Parser: utils/build-order/parse.ts (pure) + constants/build-target.ts
```ts
// constants/build-target.ts: one `export const X = 'X'` per target, re-exported as BuildTarget
// RAMP NAT NAT_WALL REAPER_WALL THIRD FOURTH FIFTH SIXTH SPAWN MAP_CENTER
// ENEMY_SPAWN ENEMY_NAT ENEMY_THIRD ENEMY_FOURTH ENEMY_RAMP ENEMY_NAT_VISION
// SUPPLY PRODUCTION UPGRADE BUNKER
export type BuildOrderStep = string | Record<string, string[]>;
export function parseBuildOrder(steps: Array<BuildOrderStep | BuildTask>, race: SC2APIProtocol.Race): BuildTask[];   // BuildTask entries pass through unchanged
```
- String grammar (ares build_order_parser.py:304-392):
  - Split on spaces. Word 0 is the supply; non-numeric means 0, with a debug warning as in ares. Word 1 is the command, case-insensitive.
  - Remaining words: `@` alone is skipped; `@x` is the same as `x`. `xN`/`*N` repeats the step N times. Anything else is a target: a BuildTarget, or a UnitType name for CHRONO.
- Command resolution order (as ares): UnitType key → Upgrade key → option.
  - Structure type → `{ type: 'build', id, qty: 1, opts: { at? } }`. LAIR/HIVE → `ability` with the morph ability.
  - Non-structure unit → `{ type: 'train', id, qty: 1, opts: { at? } }`.
  - Upgrade → `{ type: 'upgrade', id }`.
  - WORKER → train(worker type of race).
  - SUPPLY → build(SUPPLYDEPOT or PYLON); for Zerg, train(OVERLORD).
  - GAS → build(gas type). EXPAND → build(base townhall: COMMANDCENTER/NEXUS/HATCHERY). GATE → GATEWAY. CORE → CYBERNETICSCORE.
  - ORBITAL → ability(MORPH_ORBITALCOMMAND).
  - CHRONO → ability(EFFECT_CHRONOBOOSTENERGYCOST, { target: <unit type> }). The target is required, else throw.
  - CANCEL_GAS → ability(CANCEL_BUILDINPROGRESS, { on: gas type }).
  - WORKER_SCOUT → `{ type: 'scout', opts: { scout: 'worker', waypoints } }`, default waypoints ['ENEMY_SPAWN'].
  - OVERLORD_SCOUT → `{ type: 'scout', opts: { scout: 'overlord', waypoints } }`, default ['ENEMY_NAT_VISION'].
  - `ADDONSWAP <host> <addon>` → `{ type: 'addonSwap', id: host, opts: { addon } }`. This needs exactly 2 structure args, else throw (ares :143).
- Dict form `{ "<supply> <OPTION>": [targets] }` is for scouts only (ares only uses it for scouts). It gives `waypoints` = the targets. An unknown target throws.
- Every entry is emitted as a `[supply, task]` tuple, so the existing normalizer applies.
- Errors throw `NodeSC2Error` naming the step: unknown command, unknown target, ENEMY_NAT_HG_SPOT, wrong ADDONSWAP arity, CHRONO without a target.
- Not supported: ENEMY_NAT_HG_SPOT, because overlord spots are deferred in 6a.
- Tests:
  - every command and option for Terran, plus SUPPLY/GAS/EXPAND/WORKER per race;
  - targets with `@`, `@x` and `x`; `x3`/`*3` repeats;
  - the dict form;
  - each error case;
  - tuples pass through;
  - a full ares-style Terran opening compiles to the expected tasks.
- Follow: ares build_order_parser.py (grammar only).
- Don't touch: builder-plugin.ts.

## O2. Targets: utils/build-order/targets.ts
```ts
export function resolveTarget(world: World, target: BuildTarget): Point2D;                    // ares _get_target
export function structurePlacement(world: World, unitType: number, target?: BuildTarget):
    { at: Point2D } | { placement: PlacementRequest } | { near: Point2D } | undefined;
export function scoutWaypoints(world: World, targets: BuildTarget[]): Point2D[];
```
resolveTarget:
- Own bases: SPAWN = `map.getMain()`. Then indexes into `map.getExpansions()` (main first): NAT = [1] (`map.getNatural()`), THIRD = [2], FOURTH = [3], FIFTH = [4], SIXTH = [5]. Each resolves to `.townhallPosition`.
- Enemy bases: ENEMY_SPAWN = `map.getEnemyMain()`, ENEMY_NAT = `getEnemyNatural()`, and ENEMY_THIRD/FOURTH = `map._expansionsFromEnemy[2]/[3]` (main first). Each resolves to `.townhallPosition`.
- RAMP = `map.getMainBaseRamp().topCenter`.
- ENEMY_RAMP = `mapAnalysis.getEnemyMainRamp()?.topCenter` (else ENEMY_SPAWN).
- MAP_CENTER = `map.getCenter(true)`.
- ENEMY_NAT_VISION = towards(enemy nat, map centre, 10).
- NAT_WALL = nat. REAPER_WALL, SUPPLY, PRODUCTION, UPGRADE and BUNKER resolve to the start location.

structurePlacement(type, target):
- Townhall type:
  - with an own-base target, `{ at: townhallPosition }`;
  - with no target, undefined, which keeps P4-T11's existing townhall branch.
- Gas: undefined (P4-T11's `buildGas` path).
- RAMP:
  - `{ placement: { flags: ['wall'] } }` (main base);
  - but without the flag when any enemy is within 10 of the ramp top (ares build_order_runner.py:463).
- NAT_WALL: `{ placement: { base: nat, flags: ['wall'] } }`.
- REAPER_WALL: flags ['reaperWall'].
- SUPPLY/PRODUCTION/UPGRADE/BUNKER: flags ['supplyDepot'] / ['production'] / ['upgradeStructure'] / ['bunker'].
- NAT…SIXTH, SPAWN: `{ placement: { base } }`.
- Enemy-side targets and MAP_CENTER: `{ near: resolveTarget(target) }`. These are proxies. Phase-4 `placement.request` snaps to the closest solved base and offers alternatives only at own bases, so proxies use the query path.

scoutWaypoints (ares _get_main_scouting_points, build_order_parser.py:381-436):
- SPAWN/ENEMY_SPAWN:
  - Get the region from `mapAnalysis.getRegion(main)` and its points from `getPerimeter(region)`, which are already angle-sorted.
  - Start index: for ENEMY_SPAWN, among the points within (minimum distance to the enemy ramp top + 0.5), the one closest to the main. For SPAWN, the point closest to the main.
  - Rotate the list to that start. Keep a point only if it is ≥ 4 from the previous kept point. Move each kept point 2 towards the main.
  - No region gives `[main]`.
- NAT: `getNatural().areas.behindMineralLine` points (ares NAT).
- Others: `[resolveTarget(t)]`. The result concatenates the targets in order.
- Tests, on fixtures with stubbed mapAnalysis where its ticket isn't done:
  - every target resolves on blueshift;
  - RAMP drops the wall flag when an enemy is at the ramp;
  - a proxy target gives `near`;
  - waypoints start next to the enemy ramp, are spaced ≥ 4 and are inside the region;
  - NAT gives the behind-mineral-line points.

## O3. Scaffolding (types.ts, create-resource-manager.ts, create-engine.ts, create-world.ts, index.ts, stub resources/openings.ts)
types.ts:
```ts
export type BuildTaskI = {
    type: 'build' | 'train' | 'upgrade' | 'ability' | 'worker' | 'scout' | 'addonSwap';
    ...;
    opts?: { near?; on?; skip?; target?; at?: BuildTarget; waypoints?: BuildTarget[]; scout?: 'worker' | 'overlord'; addon?: number };
};
export type BuildTarget = (typeof BuildTargets)[keyof typeof BuildTargets];
export type BuildOrderStep = string | Record<string, string[]>;
export interface SystemObject {
    ...;
    buildOrder?: Array<BuildTask | BuildOrderStep>;
    openings?: Record<string, OpeningDefinition> | 'config';
    opening?: string | ((world: World) => string);
    switchOpening?: (name: string, opts?: { removeCompleted?: boolean }) => void;
    getOpening?: () => string | undefined;
}
export type OpeningDefinition = {
    buildOrder: Array<BuildTask | BuildOrderStep>;
    autoSupplyAtSupply?: number;            // 200 = off (ares default)
    constantWorkerProductionTill?: number;  // 0 = off; > 0 switches to supply-gate mode (O5)
    persistentWorker?: boolean;             // true (ares default); Terran/Protoss only
};
export type OpeningSettings = {
    builds: Record<string, OpeningDefinition>;   // {}
    choices: Record<string, string[]>;           // key: opponent id, or 'Terran'|'Zerg'|'Protoss'|'Random'; {}
    method: 'cycle' | 'winrate';                 // 'cycle'
    minGames: number;                            // 3
    dataDir?: string;                            // unset: no history read or written
};
export type OpeningRecord = { race: string; duration: number; opening: string; result: 'victory' | 'defeat' | 'tie' | 'undecided' };
export interface OpeningsResource {
    configure(settings: Partial<OpeningSettings>): void;
    getDefinitions(): Readonly<Record<string, OpeningDefinition>>;
    choose(available?: string[]): string | undefined;   // decides once per game; later calls return the same
    getChosen(): string | undefined;
    getHistory(): readonly OpeningRecord[];
}
export type ResourceDefinition<K> = { ...; onGameEnd?(resource, world: World, results: SC2APIProtocol.PlayerResult[]): void };
export interface ResourceManager { ...; endGame(world: World, results: SC2APIProtocol.PlayerResult[]): void }
export interface ResourceContainer { ...; openings: OpeningsResource }
```
- create-resource-manager.ts: `endGame` runs each definition's `onGameEnd` in registration order, synchronously. An exception is logged via debug and doesn't stop the others.
- create-engine.ts `onGameEnd` (:477): call `world.resources.endGame(world, results)` before `options.onGameEnd?.(results)`.
- create-world.ts: register `openings` last (after `behaviors`).
- `ResourceSettings` (6a, derived from configure) picks up `openings` automatically, so `"resources": { "openings": { "builds": {…}, "choices": {…} } }` in sc-bot.config.json works with no 6a change.
- index.ts: value export `parseBuildOrder`. constants/index.ts: `BuildTarget`.
- Tests:
  - endGame order;
  - one throwing hook doesn't block the next;
  - the engine calls endGame before `options.onGameEnd` (FakeClient game end);
  - existing tests pass.

## O4. Openings resource: resources/openings.ts
- `choose(available = Object.keys(builds))`:
  - Cycle list: `choices[opponent.id]`, else `choices[raceName(opponent.race)]` (Random or unknown gives 'Random'), else `available`. It is filtered to names in `available`; an empty list gives undefined.
  - History: when `dataDir` is set, read `${dataDir}/${opponent.id ?? 'unknown'}-${ownRace.toLowerCase()}.json` (ares path). A missing file is empty history. A malformed file gets a warning and is treated as empty.
  - cycle (data_manager.py:93-118): with no history, the first entry. Otherwise, if the last record's opening is in the cycle, a victory keeps it and anything else moves to the next (wrapping). If the last opening is not in the cycle, the first entry.
  - winrate (:120-180): only when every cycle entry has ≥ minGames records, else fall back to cycle.
    - Per build, take the last 10 results.
    - Pick the best winrate.
    - Ties: the tied build after the last-used one, else the first tied.
  - The result is memoized until reset.
- onGameEnd: when `dataDir` and a chosen opening exist:
  - append `{ race: raceName(opponent.race at game end), duration: frame.time(), opening: chosen, result }`;
  - write the file (mkdir -p, synchronous).
  - result is mapped from `results` for `agent.playerId` (Victory/Defeat/Tie/Undecided).
- reset: clear chosen and history, keep settings (D10). Settings arrive from config through 6a's registry.
- Tests (tmp dir):
  - cycle keeps after a win and advances after a loss;
  - choices by opponent id beat race;
  - winrate needs minGames, picks the best, and cycles ties;
  - unset dataDir writes nothing;
  - onGameEnd appends and writes;
  - a malformed file warns;
  - choose is memoized.

## O5. Runner: tasks + targets (systems/builder-plugin.ts)
- normalizeBuildOrder: first `parseBuildOrder(buildOrder, agent.race)` (strings and dicts → tuples), then today's normalizer.
  - New `fillWorkers` flag, default true (today's semantics).
  - When the opening has `constantWorkerProductionTill > 0`, `fillWorkers = false`. Tuples then keep their `supply`, and the runner skips a task until `agent.supplyUsed >= task.supply` (ares start gate). Plain-array orders behave exactly as today.
- build task:
  - With `opts.at`, `structurePlacement(world, task.id, opts.at)`:
    - `{ at }` → `buildings.build(id, { at, earmark })`;
    - `{ placement }` → `buildings.build(id, { placement, earmark })`;
    - `{ near }` → `actions.findPlacement(id, near)` → `buildings.build(id, { at })`;
    - undefined → today's branch.
  - Without `at`: the P4-T11 behaviour, unchanged.
  - With a persistent builder (O6), it is passed as `worker`.
- train task with `opts.at`: `agent.train(id, 1, resolveTarget(at))` (closest producer).
- ability task: with `opts.on`, casters are limited to that unit type (CANCEL_GAS). Otherwise unchanged.
- scout task:
  - Worker:
    - `mining.selectWorker(main, { role: 'BUILD_RUNNER_SCOUT' })` when mining is enabled. Otherwise the closest `getMineralWorkers()` worker without a `command` label, then `roles.assign(worker, 'BUILD_RUNNER_SCOUT')`.
    - Then, inside `roles.as('BUILD_RUNNER_SCOUT')`: HARVEST_RETURN if it is carrying, then MOVE to waypoint 1 (queued only if it returned) and queued MOVEs to the rest of `scoutWaypoints(world, opts.waypoints)`.
    - SUCCESS. No worker gives CANNOT_SATISFY.
  - Overlord: the first OVERLORD without that role. Assign the role, then MOVE/queued MOVEs.
  - The scout keeps the role afterwards, as in ares; the bot reassigns or releases it.
- addonSwap task: `flying.addonSwap(task.id, opts.addon)`, true → SUCCESS, else CANNOT_SATISFY.
- taskFunctions gains `scout(kind: 'worker' | 'overlord', waypoints?: BuildTarget[])` and `addonSwap(host, addon)`. `build`/`train` already take opts, so `{ at }` works there too.
- Tests:
  - a string opening runs end to end on createTestWorld with stubbed placement/buildings: depot @ramp requests the wall flag, cc @nat is built at the nat, and a proxy rax @enemy_nat uses findPlacement;
  - the supply gate holds a task until supplyUsed;
  - fill mode is unchanged for tuple orders;
  - worker scout: role, return plus queued moves, owner `role:BUILD_RUNNER_SCOUT`;
  - overlord scout;
  - CANCEL_GAS cancels only the gas;
  - addonSwap calls flying;
  - existing builder-plugin tests pass.

## O6. Runner: openings, switch, opening options (systems/builder-plugin.ts)
- Definitions: blueprint `openings` (an object), or with 'config' `openings.getDefinitions()`. When `openings` is set, `buildOrder` is ignored. A blueprint that sets both gets a warning.
- Choice at onGameStart:
  - Name: the blueprint `opening` (a string, or a function called with the world), else `openings.choose(Object.keys(defs))`.
  - Unknown name or none: NodeSC2Error.
  - The chosen name is the one recorded in history. Switches are not recorded, as in ares.
- `switchOpening(name, { removeCompleted = true })`:
  - No-op if `name` is current.
  - Otherwise re-normalize `defs[name]` and clear the complete flag.
  - With removeCompleted, port ares _remove_completed_steps (build_order_parser.py:520-575):
    - Seed counts: townhall 1, overlord 1, worker 12.
    - Drop every scout task and every chrono task.
    - For build/train/worker tasks, present = existing + pending. Structures: own of that type, including unfinished, plus `buildings.pending(type)`. Units: count + `alreadyPending`. Worker tasks count as the worker type.
    - Drop the task while seen < present, incrementing seen.
- `getOpening()` returns the current name.
- Opening options, run each step while the opening is not complete, after the current task:
  - `constantWorkerProductionTill`: train a worker on an idle ready townhall when `supplyWorkers < till`, supplyLeft > 0, and it can afford one. Skip when the current task is the orbital morph and `supplyUsed >= task.supply`, unless orbital tech < 0.95 (ares _produce_workers :690-713).
  - `autoSupplyAtSupply`: when `supplyUsed >= value`, run `behaviors.run(autoSupply({}))` (P5-T06).
  - `persistentWorker` (Terran/Protoss, default true):
    - Pick the worker once. The game time is ≥ 3s if the first supply task's supply is ≤ 13 or its target is NAT, else ≥ 9s (ares :729-744).
    - Use `mining.selectWorker(main, { role: 'PERSISTENT_BUILDER' })` (fallback: closest mineral worker + `roles.assign`).
    - MOVE it to that supply task's resolved placement point, if one resolves.
    - Build tasks other than gas pass it as `worker`, unless it is the worker of a tracked build in status moving/ordered/constructing.
    - Release it (`mining.release`, or `roles.assign(GATHERING)` when mining is off) when the opening completes. For Protoss, also release it when a PYLON task completes (ares :406).
- Not ported, documented: look-ahead (core's strict order is deliberate), gas-steal handling, ares' `start_at_supply − 1` for protoss structures.
- Tests:
  - openings from the blueprint and from config;
  - `opening` as string and as function;
  - choose() is used when absent;
  - switchOpening drops completed steps per the ares rules (including the worker seed of 12) and drops scouts;
  - a switch to the same name is a no-op;
  - constant worker production obeys till and the orbital rule;
  - autoSupply starts at the threshold;
  - persistent worker: picked at the right time, used for the next depot, released at completion;
  - Protoss release on pylon.

## O7. Docs (docs-plan.md §2 Phase 6b)
- readme.md › Build systems (~453-540):
  - The string format: grammar, commands/options table, targets table, the dict scout form.
  - A full Terran opening as an example (ares-style, e.g. reaper expand into 3 rax).
  - Openings: blueprint vs `'config'`, sc-bot.config.json `resources.openings`, choices, cycle/winrate, dataDir history.
  - `switchOpening`/`getOpening`.
  - Opening options, and fill-workers vs supply-gate mode.
  - Persistent builder and scouts' roles.
  - Resources: an `### openings` subsection (TOC, destructure line).
  - "Where this library differs from ares-sc2":
    - JSON, not YAML;
    - no look-ahead (strict order);
    - fill-workers default;
    - proxies use query placement;
    - no gas-steal handling;
    - no ENEMY_NAT_HG_SPOT;
    - no protoss supply −1.
- docs/api.md: build system (`taskFunctions.scout`/`addonSwap`, `opts.at`), `parseBuildOrder` under `## Utilities`, `### openings`, `ResourceDefinition.onGameEnd`, World `resources.endGame`.
- docs/tutorial.md Part 1 (~24-63): a short note pointing to the string format.
- docs/internals.md: Resources list gets `openings`; Engine: game end runs resource `onGameEnd` hooks.
- docs/changelog.md: `Unreleased › Phase 6b`, with Added and Migrating bot/ (optional: express the bot's TS build arrays as strings; move openings to sc-bot.config.json; set dataDir for per-opponent choice).

## Order / file ownership
- O1 (utils/build-order/parse.ts + test, constants/build-target.ts): new files, unblocked now. It types its output with a local structural `ParsedTask`; O3 aligns BuildTaskI with it.
- O3 scaffolding (types.ts, engine/create-resource-manager.ts, engine/create-engine.ts, engine/create-world.ts, index.ts, constants/index.ts, resources/openings.ts stub):
  - Blocked by O1 (re-exports), P5-T01 and 6a-T01 (same shared files; the scaffolding chain).
  - It is the only 6b ticket touching those files.
- O2 (utils/build-order/targets.ts + test): blocked by O3, 6a-T03 (mapAnalysis) and P4-T05 (PlacementRequest/flags).
- O4 (resources/openings.ts + test): blocked by O3.
- O5 (systems/builder-plugin.ts + test): blocked by O1, O2, O3, P4-T11 (builder-plugin), P4-T10 (flying), P4-T07 (selectWorker role) and P3-T03 (roles).
- O6 (systems/builder-plugin.ts + test): blocked by O4, O5 (same file, serial) and P5-T06 (autoSupply).
- O7: blocked by O1–O6 and P5-T10 (docs chain).
- Don't touch: bot/, resources/actions.ts, agent/macro.ts, map.ts, systems/map.ts, and every phase-2–6a resource file.

## Decisions taken (for the team lead's log)
- P6b-D1. Extend the existing build system (builder-plugin) instead of adding an ares-style runner. It keeps strict order, earmarks, skip, pause and existing build orders; strings compile to today's `[supply, task]` tuples.
- P6b-D2. Openings live in JSON: the 6a config's `resources.openings`, or inline in code. 6a chose JSON with no YAML dependency, and `ResourceSettings` is derived from `configure`, so no 6a change is needed.
- P6b-D3. Default worker semantics stay core's fill-workers. `constantWorkerProductionTill > 0` switches an opening to ares' supply-gate mode. Existing builds are unchanged, ares-style builds work, and the two worker sources never stack.
- P6b-D4. ares' look-ahead (running a later step when minerals > 470) is not ported, because the user made strict order deliberate (commit 4c6dce6).
- P6b-D5. Proxy targets (enemy side, MAP_CENTER) use the query placement (`findPlacement`) near the point. Phase-4 `placement.request` only solves and offers alternatives at own bases.
- P6b-D6. Opening selection is an `openings` resource porting ares' data manager (cycle and winrate, per opponent id then race, JSON history in `dataDir`). It is opt-in via dataDir, so there are no file writes by default.
- P6b-D7. A new `ResourceDefinition.onGameEnd` hook, called from the engine's onGameEnd before `options.onGameEnd`. History has to be written at game end, and no system or resource runs then today. It is general, like onStep (D1).
- P6b-D8. The worker scout uses `mining.selectWorker(…, { role: 'BUILD_RUNNER_SCOUT' })` and commands inside `roles.as`. The scout keeps its role afterwards, as in ares.
- P6b-D9. The persistent builder (ares) is ported via `selectWorker({ role: 'PERSISTENT_BUILDER' })` and passed as `worker` to `buildings.build`. It is released at opening end, and for Protoss on pylon.
- P6b-D10. Not ported (documented): ENEMY_NAT_HG_SPOT (overlord spots are deferred in 6a), gas-steal handling, and the protoss `start_at_supply − 1`. Overlord scout defaults to ENEMY_NAT_VISION.
- P6b-D11. Parse errors throw at game start with the step text, instead of ares' assert, so a bad opening fails loudly before the first step.

Nothing needs the user.
