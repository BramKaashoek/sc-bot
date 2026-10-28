# parity-6b: build runner upgrades (string build orders, targets, special steps, openings)

Source: parity-roadmap.md phase 6 (ares-gap.md ranked #10); user mandate 2026-10-26 "use best judgement to get ares parity" (decisions.md).
Design: .agent-work/parity-6b.design.md (technical-architect), decisions P6b-D1–P6b-D11. Scope: packages/core only.

Status: FINAL (best judgement under user mandate; assumptions listed at the end).

Ticket numbers here are local to this file. "parity-3 Tnn", "parity-4 Tnn", "parity-5 Tnn" and "parity-6a P6A-Tnn" refer to the matching .agent-work files.

## Problem Statement

Build orders in core are TypeScript arrays of task objects with supply tuples. There's no compact text format, no way to say "this depot goes on the ramp wall" or "this barracks is a proxy at the enemy natural", no scouting, chrono, cancel-gas or addon-swap steps, and no opening selection: a bot has one hard-coded build per game, can't switch builds mid-game, and doesn't learn which opening works against an opponent. ares bots write openings as short strings in a config file and pick them per opponent or race from game history.

## Solution

- **String format:** ares' `"<supply> <command> [@target] [xN]"` steps (plus the dict form for scouts) compile into today's build tasks, so strict order, earmarks, skip and pause keep working. Commands cover unit types, upgrades and ares' options (worker, supply, gas, expand, gate, core, orbital, chrono, cancel gas, worker/overlord scout, addon swap).
- **Named targets:** ramp, natural wall, reaper wall, own bases by index, enemy bases, enemy ramp, map centre, enemy natural vision, and placement-flag targets. Own-side targets use the phase-4 placement solver; proxies use the query placement near the point; scout targets expand to perimeter waypoints.
- **Openings:** named builds with ares' options (auto supply at a supply count, constant worker production with ares' supply-gate mode, persistent builder). Defined in code or in the config file, chosen per opponent id or race by cycle or winrate from a per-opponent history file, switchable mid-game with completed steps removed.
- **Game-end hook:** resources can run code when a game ends, so the opening history is recorded.

## Non-goals

- ares' look-ahead (running a later step when minerals > 470); strict order is deliberate (P6b-D4).
- A gas-steal step and handling the enemy's gas steal (ares has neither as a step; decisions.md "REVERT gas-steal step"), ENEMY_NAT_HG_SPOT and overlord spots, protoss `start_at_supply − 1` (P6b-D10).
- YAML config (P6b-D2).
- Recording mid-game switches in history (ares doesn't).
- bot/ changes (additive only; adoption is up to the user).

## User Stories

1. As a bot author, I want to write a build order as short strings like "14 supply @ramp", so that openings are readable and easy to change.
2. As a bot author, I want unit types, upgrades and ares' options as commands, so that ares openings port with no rewrite.
3. As a bot author, I want to repeat a step with x3 or *3, so that "3 barracks" is one line.
4. As a bot author, I want to mix string steps with today's task tuples, so that I can migrate gradually.
5. As a bot author, I want a bad step to fail at game start with the step's text, so that I find typos before the game runs.
6. As a bot author, I want to place a structure on the main ramp wall, natural wall or reaper wall, so that walls come from the build order.
7. As a bot author, I want the ramp wall skipped when enemies are at the ramp, so that the builder isn't sent into them.
8. As a bot author, I want to build at a named base (natural, third…), so that expansions and base-specific structures go where I mean.
9. As a bot author, I want proxy structures at enemy-side targets or the map centre, so that proxy openings work.
10. As a bot author, I want worker and overlord scout steps with waypoints, so that scouting is part of the opening.
11. As a bot author, I want a worker scout to circle the enemy main starting near its ramp, so that I see the whole base.
12. As a bot author, I want chrono, orbital, cancel-gas and addon-swap steps, so that common special steps need no custom code.
13. As a bot author, I want several named openings and one chosen per game, so that I can vary my play.
14. As a bot author, I want to choose openings per opponent id, or per enemy race, so that I can prepare per matchup.
15. As a bot author, I want a cycle that keeps a winning opening and moves on after a loss, and a winrate mode after enough games, so that the bot learns what works.
16. As a bot author, I want the history stored per opponent only when I set a data directory, so that nothing is written by default.
17. As a bot author, I want to switch openings mid-game without redoing what's done, so that I can react to scouting.
18. As a bot author, I want auto supply from a supply count, constant worker production and a persistent builder per opening, so that ares opening options work.
19. As a bot author, I want existing tuple build orders to behave exactly as today, so that nothing in my bot changes unless I opt in.
20. As a bot author, I want openings in the config file, so that I can change builds without editing code.
21. As a plugin author, I want a resource hook at game end, so that I can persist per-game data.

## Implementation Decisions

From the Architect (full contract in parity-6b.design.md, decisions P6b-D1–P6b-D11):

- The existing build system is extended rather than replaced; strings compile to today's supply/task tuples (P6b-D1).
- A pure parser covers ares' grammar and commands; build targets are a constant module. Parse errors throw at game start naming the step (P6b-D11).
- Target resolution maps own-side targets to placement-solver requests (wall/reaper wall/flags/bases), townhalls at own bases to their townhall position, and enemy-side/map-centre targets to query placement near the point (P6b-D5). Scout waypoints come from the region perimeter of map analysis.
- Openings are a new resource registered last: settings (builds, choices, cycle/winrate, minimum games, data directory), a once-per-game choice, history read at choice and written at game end (P6b-D6). Settings can come from the config file through phase 6a's registry with no 6a change (P6b-D2).
- A new game-end hook on resource definitions runs in registration order before the engine's own game-end callback; a throwing hook doesn't block others (P6b-D7).
- Worker semantics stay fill-workers by default; an opening with constant worker production switches to ares' supply-gate mode (P6b-D3).
- The worker scout and the persistent builder get ares roles via mining's worker selection (or role assignment when mining is off); the scout keeps its role afterwards; the persistent builder is released when the opening completes, and for Protoss on a pylon (P6b-D8, P6b-D9).

## Testing Decisions

- **Parser:** pure seam, string in → tasks out; a full ares-style Terran opening as the golden case.
- **Targets:** fixture seam (blueshift), with map analysis stubbed where its ticket isn't done.
- **Openings resource:** resource seam with a temporary data directory.
- **Game-end hook:** engine seam through the fake client's game end.
- **Runner:** fixture world builder with stubbed placement/buildings for tasks, targets, scouts, openings, switching and opening options; existing builder-plugin tests must keep passing.
- **Prior art:** systems/builder-plugin.test.ts, engine/create-world.test.ts, parity-6a config tests, parity-4 tracker tests.

## Out of Scope

See Non-goals.

## Further Notes

Migration notes for the user's bot/ (no tickets):
- Additive only; nothing breaks. Existing tuple build orders behave exactly as today.
- Optional adoption: express the bot's build arrays as strings; move openings to `sc-bot.config.json` under `resources.openings`; set `dataDir` for per-opponent choice; use `switchOpening` on scouting results.

Assumptions (BA, best judgement):
- PA1 Scaffolding chain: T02 (design O3) joins the chain after parity-5 T01: parity-2 T01 → parity-3 T02 → parity-4 T04 → P6A-T01 → parity-5 T01 → parity-6b T02. The design names P5-T01 and 6a-T01; this is the same chain.
- PA2 The roadmap's phase-6 goal lists "gas steal" among special steps. ares has no gas-steal build step, so it is not ported (team lead, decisions.md "REVERT gas-steal step"); GAS always goes to `buildGas` at own bases. Listed under the ares deviations in T07.
- PA3 The roadmap exit "openings are written as strings and run on fixtures/live" is met by T05's end-to-end string opening on a fixture world. No new live test.
- PA4 `parseBuildOrder` goes under api.md/readme `## Utilities`, which parity-3 T07 creates.

---

# Tickets

## T01 Build-order parser (design O1)

- Source: design O1; P6b-D11.
- What to build: the build target constants and a pure parser from string/dict steps (mixed with existing tasks) to `[supply, task]` tuples, covering ares' grammar, command resolution order, every option, and the error cases.
- API contract: design O1 `parseBuildOrder`, `BuildOrderStep`, constants/build-target.ts; output typed with a local structural task type (T02 aligns `BuildTaskI`).
- Acceptance criteria:
  - [ ] Every command and option compiles for Terran; SUPPLY, GAS, EXPAND and WORKER compile per race (Zerg SUPPLY trains an overlord; LAIR/HIVE are morph abilities).
  - [ ] Targets parse with `@ x`, `@x` and `x`; `x3` and `*3` repeat the step 3 times; command matching is case-insensitive; a non-numeric supply means 0 with a debug warning.
  - [ ] Command resolution order is unit type, then upgrade, then option.
  - [ ] The dict form gives a scout task with the listed waypoints; default waypoints are ENEMY_SPAWN (worker) and ENEMY_NAT_VISION (overlord).
  - [ ] Each error throws `NodeSC2Error` naming the step: unknown command, unknown target, ENEMY_NAT_HG_SPOT, ADDONSWAP without exactly 2 structure args, CHRONO without a target.
  - [ ] Existing task objects and tuples pass through unchanged.
  - [ ] A full ares-style Terran opening compiles to the expected task list.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new constants/build-target.ts; new utils/build-order/parse.ts (+ parse.test.ts).
  - Interfaces: design O1.
  - Follow: ares build_runner/build_order_parser.py:143, 304-392 (grammar only), consts.py:207, 226; constants/unit-role.ts (constant module pattern); `taskFunctions` in systems/builder-plugin.ts (task shapes).
  - Don't touch: builder-plugin.ts, types.ts, index.ts, constants/index.ts.
- Stack: core.
- Blocked by: None (new files only).
- Slice siblings: T02–T07.

## T02 Phase-6b scaffolding + game-end hook (design O3)

- Source: design O3; P6b-D7.
- What to build: the 6b types (task kinds/opts, targets, openings, system blueprint fields), the resource definition game-end hook and the registry's `endGame`, the engine calling it before its own game-end callback, the `openings` resource registered last as a stub, and the re-exports.
- API contract: design O3.
- Acceptance criteria:
  - [ ] `endGame` runs every definition's game-end hook in registration order, synchronously; a throwing hook is logged and doesn't stop the next.
  - [ ] The engine calls `endGame` before `options.onGameEnd` (fake client game end).
  - [ ] `openings` resolves from `resources.get()` (no registration-order assertion); its methods throw a core "not implemented" error.
  - [ ] `parseBuildOrder` is importable from the package root and `BuildTarget` from the constants entry; `BuildTaskI` matches T01's output type (T01's tests compile against it).
  - [ ] `resources.openings` is accepted in the config file's resource settings type with no 6a change.
  - [ ] Existing tests pass; lint, tsc and tests green.
- Implementation plan:
  - Where:
    - types.ts: `BuildTaskI` kinds/opts, `BuildTarget`, `BuildOrderStep`, `SystemObject` fields (`buildOrder`, `openings`, `opening`, `switchOpening`, `getOpening`), `OpeningDefinition`, `OpeningSettings`, `OpeningRecord`, `OpeningsResource`, `ResourceDefinition.onGameEnd`, `ResourceManager.endGame`, container key `openings`.
    - engine/create-resource-manager.ts: `endGame`.
    - engine/create-engine.ts: `onGameEnd` (~477) calls `world.resources.endGame(world, results)` first.
    - engine/create-world.ts: `openings` last in CORE_RESOURCES.
    - New stub resources/openings.ts.
    - index.ts: `parseBuildOrder`; constants/index.ts: `BuildTarget`.
    - utils/build-order/parse.ts: switch its local task type to `BuildTaskI` (only edit to T01's file).
    - engine/create-world.test.ts / engine tests: endGame order, throwing hook, engine order.
  - Interfaces: design O3.
  - Follow: parity-2 T01 (`onStep`/`step` pattern in create-resource-manager.ts); parity-3/5 scaffolding; 6a `ResourceSettings`.
  - Don't touch: builder-plugin.ts, actions.ts, macro.ts, phase-2–6a resource files.
- Stack: core.
- Blocked by: T01 (re-exports), parity-5 T01 and P6A-T01 (scaffolding chain, PA1).
- Slice siblings: T01, T03–T07.

## T03 Build targets (design O2)

- Source: design O2; P6b-D5.
- What to build: `resolveTarget`, `structurePlacement` and `scoutWaypoints`.
- API contract: design O2; parity-4 `PlacementRequest`/`PlacementFlag`; 6a `mapAnalysis` (`getRegion`, `getPerimeter`, `getEnemyMainRamp`).
- Acceptance criteria:
  - [ ] Every target resolves to a point on blueshift per the design table.
  - [ ] RAMP gives a main-base wall request, without the wall flag when an enemy is within 10 of the ramp top; NAT_WALL gives a natural-base wall request; REAPER_WALL and the flag targets give the matching flags; own base targets give a base request; a townhall at an own base gives its townhall position; gas and an untargeted townhall give undefined.
  - [ ] An enemy-side target or MAP_CENTER gives a `near` point.
  - [ ] Enemy-spawn waypoints start next to the enemy ramp, are spaced ≥ 4, sit 2 towards the main from the perimeter, and lie inside the region; no region gives the main only.
  - [ ] NAT waypoints are the natural's behind-mineral-line points; a list of targets concatenates in order.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new utils/build-order/targets.ts (+ targets.test.ts).
  - Interfaces: design O2.
  - Follow: ares build_runner/build_order_runner.py:463 (ramp wall check), build_order_parser.py:381-436 (scout points), `_get_target`; `map.getExpansions`, `getEnemyMain`, `getEnemyNatural`, `_expansionsFromEnemy`, `getMainBaseRamp`, `getCenter(true)`; `towards` from phase-5 behaviors helpers (or an equivalent geometry util).
  - Don't touch: map.ts, systems/map.ts, mapAnalysis and placement files.
- Stack: core.
- Blocked by: T02, P6A-T03 (mapAnalysis), parity-4 T05 (placement).
- Slice siblings: T01, T02, T04–T07.

## T04 Openings resource (design O4)

- Source: design O4; P6b-D6.
- What to build: the openings resource: definitions and settings, once-per-game `choose` (choices by opponent id then race, cycle and winrate), history read from and written to the data directory, game-end record, reset keeping settings.
- API contract: design O3 `OpeningsResource`, `OpeningSettings`, `OpeningRecord`.
- Acceptance criteria (temporary directory):
  - [ ] Cycle keeps the last opening after a victory and advances (wrapping) after anything else; with no history, or the last opening not in the cycle, the first entry.
  - [ ] Choices by opponent id beat choices by race; Random or unknown race uses 'Random'; with neither, all available builds; the list is filtered to available names; empty → undefined.
  - [ ] Winrate is used only when every entry has ≥ `minGames` records (else cycle), uses the last 10 results per build, picks the best, and breaks ties with the tied build after the last-used one, else the first tied.
  - [ ] `choose` is memoized until reset.
  - [ ] With no `dataDir` nothing is read or written.
  - [ ] At game end with `dataDir` and a chosen opening, a record (race, duration, opening, result for own player) is appended and the file written (directory created) at `<dataDir>/<opponent id or 'unknown'>-<own race>.json`.
  - [ ] A malformed history file warns and is treated as empty.
  - [ ] The game-end history write is skipped for replays (client status IN_REPLAY or equivalent): a replay game end writes nothing.
  - [ ] The history write is synchronous (`writeFileSync`, directory created synchronously): the file exists when the game-end hook returns.
  - [ ] Settings survive a game reset; chosen and history don't.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/openings.ts (replace the stub); new resources/openings.test.ts.
  - Interfaces: design O3/O4.
  - Follow: ares managers/data_manager.py:93-180; parity-2/3 resource configure/reset pattern; T02's `onGameEnd`.
  - Don't touch: types.ts, builder-plugin.ts.
- Stack: core.
- Blocked by: T02.
- Slice siblings: T01–T03, T05–T07.

## T05 Runner: string steps, targets, new tasks (design O5)

- Source: design O5; P6b-D3, D5, D8.
- What to build: the build system parses string/dict steps before normalizing; supply-gate mode via a new `buildOptions.fillWorkers?: boolean` (default true; false = ares supply-gate: no worker insertion, each step waits for its supply) — P6B-T06 sets it from an opening (decisions.md, lead: P6B-T05 supply-gate entry); build/train tasks honour `at`; ability tasks honour `on`; scout and addon-swap tasks; `taskFunctions.scout` and `addonSwap`.
- API contract: design O3 task types; design O5.
- Acceptance criteria:
  - [ ] A string opening runs end to end on a fixture world with stubbed placement/buildings: depot @ramp requests the wall flag, CC @nat is built at the natural, a proxy barracks @enemy_nat uses query placement near the enemy natural.
  - [ ] With `buildOptions.fillWorkers: false` (supply-gate mode) no workers are inserted and a task waits until supply used reaches its supply; with `fillWorkers` unset or true, string and tuple orders fill workers exactly as today.
  - [ ] A train task with `at` uses the producer closest to the target.
  - [ ] Worker scout: role BUILD_RUNNER_SCOUT (via mining's worker selection when enabled, else the closest free mineral worker), returns cargo first if carrying, then moves through the waypoints with queued moves, commands owned by `role:BUILD_RUNNER_SCOUT`; no worker → cannot satisfy.
  - [ ] Overlord scout takes the first overlord without the role and moves through the waypoints.
  - [ ] CANCEL_GAS cancels only the gas building.
  - [ ] A gas step ignores any `at` target, as in ares: `14 gas @enemy_spawn` (which parses) builds through `buildGas` on our own geysers exactly like plain `gas`; a test row asserts the geyser is at an own base, so a target on a gas step is never a gas steal.
  - [ ] An addon-swap task calls the flying resource; false → cannot satisfy.
  - [ ] `SystemObject.buildOrder` accepts `Array<BuildTask | BuildOrderStep>` (string and dict steps type-check in a build system blueprint); normalizeBuildOrder takes that type and parses before normalizing.
  - [ ] Existing builder-plugin tests pass; lint, tsc and tests green.
- Implementation plan:
  - Where: types.ts (`SystemObject.buildOrder` widened to `Array<BuildTask | BuildOrderStep>`, deferred from T02 and logged; `SystemObject.buildOptions.fillWorkers?: boolean` added; no other types.ts edits); systems/builder-plugin.ts (normalizeBuildOrder signature + parse step, build/train/ability task fns, new scout/addonSwap branches, `taskFunctions`) + systems/builder-plugin.test.ts.
  - Interfaces: design O5.
  - Follow: P4-T11's builder-plugin changes; T01 `parseBuildOrder`; T03 targets; parity-4 `buildings.build`, `mining.selectWorker`, `flying.addonSwap`; parity-3 `roles.assign`/`roles.as`; `actions.findPlacement`.
  - Don't touch: actions.ts, macro.ts, map.ts, the rest of types.ts, phase-2–6a resource files.
- Stack: core.
- Blocked by: T01, T02, T03, parity-4 T07 (selectWorker role), parity-4 T10 (flying), parity-4 T11 (builder-plugin), parity-3 T03 (roles).
- Slice siblings: T01–T04, T06, T07.

## T06 Runner: openings, switch, opening options (design O6)

- Source: design O6; P6b-D3, D4, D9.
- What to build: opening definitions (blueprint or config), choice at game start, `switchOpening` with ares' completed-step removal, `getOpening`, and the opening options (constant worker production, auto supply, persistent builder).
- API contract: design O3 `SystemObject` fields, `OpeningDefinition`; design O6.
- Acceptance criteria:
  - [ ] Openings work from the blueprint and from config (`'config'`); with openings set, `buildOrder` is ignored (warning if both).
  - [ ] `opening` as a string and as a function both pick the opening; when absent, `openings.choose` picks; an unknown or missing name throws `NodeSC2Error` at game start.
  - [ ] `switchOpening` drops completed steps per ares' rules (seeds townhall 1, overlord 1, worker 12; existing + pending counts), drops scouts and chrono; switching to the current opening is a no-op; `getOpening` returns the current name; history records the chosen name, not switches.
  - [ ] An opening with `constantWorkerProductionTill > 0` sets `buildOptions.fillWorkers = false` (T05's supply-gate mode) for as long as it is the current opening; `0` or unset leaves `fillWorkers` at its default (true), so the two never stack (P6b-D3). `switchOpening` re-applies it from the new opening.
  - [ ] Constant worker production trains up to `till` on an idle ready townhall when supply is left and affordable, and holds for the orbital morph per ares' rule.
  - [ ] Auto supply starts at `autoSupplyAtSupply` via the phase-5 controller.
  - [ ] Persistent builder: picked at ≥ 3 s or ≥ 9 s per the first supply task, role PERSISTENT_BUILDER, moved to that task's placement point, passed as the builder for non-gas builds (unless busy on a tracked build), released when the opening completes; for Protoss also on pylon completion.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: systems/builder-plugin.ts + systems/builder-plugin.test.ts.
  - Interfaces: design O6.
  - Follow: ares build_order_parser.py:520-575 (remove completed), build_order_runner.py:406, 690-744; T04 openings; T05 runner; parity-5 `behaviors.run(autoSupply(...))`; parity-4 `mining.selectWorker`/`release`, `buildings.pending`/`getTracked`.
  - Don't touch: as T05.
- Stack: core.
- Blocked by: T04, T05 (same file, serial), parity-5 T06 (autoSupply).
- Slice siblings: T01–T05, T07.

## T07 Docs + changelog (design O7)

- Source: design O7; .agent-work/docs-plan.md §2 "Phase 6b" and §3.
- What to build: readme Build systems section for strings, targets, openings and options; the openings resource section; API docs; tutorial note; internals; ares deviations; `Unreleased › Phase 6b` changelog entry.
- Acceptance criteria:
  - [ ] readme Build systems (~453-540): grammar, commands/options table, targets table, dict scout form, a full ares-style Terran opening example, openings (blueprint vs `'config'`, `resources.openings` in sc-bot.config.json, choices, cycle/winrate, `dataDir` history: the file uses ares' exact format, so an existing ares data/ folder is reused; malformed entries are dropped with a warning and removed from the file at the next write), `switchOpening`/`getOpening`, opening options, fill-workers vs supply-gate mode (`buildOptions.fillWorkers`, set automatically by an opening's constantWorkerProductionTill), persistent builder and scout roles.
  - [ ] readme `### openings` under Resources; TOC and `resources.get()` destructure line list `openings`.
  - [ ] "Where this library differs from ares-sc2": JSON not YAML; no look-ahead; fill-workers default; proxies use query placement; no gas-steal step or handling (PA2); no ENEMY_NAT_HG_SPOT; no protoss supply −1; NAT_WALL keeps its wall flag when enemies are at the main ramp (ares drops it); scout waypoints that the inset pushes outside the region are dropped (decisions.md "P6b-T03 scout waypoints").
  - [ ] docs/api.md: build system (`taskFunctions.scout`/`addonSwap`, `opts.at`), `parseBuildOrder` under `## Utilities`, `### openings`, `ResourceDefinition.onGameEnd`, World `resources.endGame`, in the docs-plan §3.2 format.
  - [ ] docs/tutorial.md Part 1 (~24-63): a short note pointing to the string format.
  - [ ] docs/internals.md: Resources list has `openings`; Engine notes that game end runs resource game-end hooks.
  - [ ] readme/api.md `ResourceDefinition.onGameEnd`: hooks must be synchronous; a crashed or disconnected game (`ConnectionClosedError` or an unknown error) doesn't call `onGameEnd`, so no opening history is written for it; replays write no history.
  - [ ] docs/changelog.md `Unreleased › Phase 6b` with Added and `Migrating bot/` (see Further Notes).
  - [ ] Every new example type-checks; the Terran opening example also parses (run through `parseBuildOrder` in the scratch check).
- Implementation plan:
  - Where: packages/core/readme.md, docs/api.md, docs/tutorial.md, docs/internals.md, docs/changelog.md.
  - Follow: docs-plan.md §3; earlier phases' docs sections.
  - Don't touch: code.
- Stack: core (docs).
- Blocked by: T01–T06, parity-5 T10 (docs chain).
- Slice siblings: T01–T06.
