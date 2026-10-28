# examples: update existing examples + translated ares-sc2 tutorials

Source: user, 2026-10-27: "lets also plan to update the existing examples and expand them with translated ares examples" (decisions.md "examples work package"). ares source (read-only): scratchpad/ares/ares-sc2/docs/tutorials/*.md and examples/build_runner_examples/*.yml.
Scope: packages/core/examples (plus tests next to them, and the docs touch-point). No library code. If an example needs an API that core lacks, the developer reports it to the PM and doesn't patch library code.

Status: DRAFT for team-lead review. Decisions EX-D1–EX-D7 are listed at the end.

Ticket numbers are local to this file. "P4-T11" etc. refer to the parity-*.md files.

## Problem Statement

The seven runnable examples predate the command executor, resources, behaviors and the placement solver. Two of them, cannon-rush and ramp-wall, still hand-roll what core now does: placement, worker distribution, worker training and the ramp-wall geometry. ares-sc2 teaches its features through tutorials, and core has no runnable equivalent, so a user porting from ares has nothing to compare against.

## Solution

- Update the existing examples to idiomatic current APIs, and change only what a newer API supersedes.
- Add TypeScript translations of the ares tutorials under `examples/ares/`. Each one is a faithful port of the tutorial's final bot, using the same race, units and flow, with ares calls mapped to core calls.
- Translate the ares build-runner YAML files into core config files (`resources.openings`). These files double as the config-file example.
- Verification: the committed type-check (already in place), fixture tests for examples with example-specific logic, a committed parse test for every translated opening, and a live smoke for three game-playing examples (skipped without SC2).

## Translation map

| ares tutorial | core example | Status | Gaps (dropped, listed in the file header and in the docs) |
|---|---|---|---|
| assigning_unit_roles | ares/assigning-unit-roles.ts | full | `get_unit_role_dict` tip (no API; `roleOf`/`getTags` instead). `get_enemy_third` → `map.getEnemyThirds()[0]`. |
| combat_maneuver_example | ares/combat-maneuver.ts | full | `CombatManeuver` → `plan()`. Air grid → influence layer `air`. |
| unit_squads_group_behaviors | ares/unit-squads.ts | full | `get_units_in_range(EnemyGround)` → `spatial.unitsInRange(…, 'enemyGround')`. `squad_radius` → `getSquads(role, { radius })`. |
| custom_behaviors | ares/custom-behaviors.ts | full | Custom behavior = a `Behavior` object `{ name, execute(ctx) }`. `get_total_supply` → summed `foodRequired`. Named `customSiegeTankDecision`, since core already ships `siegeTankDecision`. |
| influence_and_pathing | ares/influence-and-pathing.ts | partial | No climber / airVsGround / groundToAir grids (parity-2 D8); uses ground/air. No `find_low_priority_path`: uses `findPath` with every 8th point kept. No `map_data` clean grid: "create your own grid" uses `influence.addCost` on the built-in layers. `cy_point_below_value` → `pathing.isPositionSafe`. |
| managing_production | ares/managing-production.ts | full | `MacroPlan` → `plan()`. |
| build_runner + build_runner_examples/*.yml | ares/build-runner.ts + ares/openings/{terran,protoss,zerg}.config.json | partial | YAML → JSON config (`resources.openings`). Dropped: `ShouldHandleGasSteal`, `BotName`, the `test_123` debug choice, `set_build_completed`, `ENEMY_NAT_HG_SPOT` (6b D10), Protoss supply −1. Dropped step: `16 tempestgroundattackupgrade` in OneBaseTempests, because core's upgrade constants have no such id (the parse fails; checked against the shipped parser). Zerg structures go through the findPlacement fallback (no Zerg solver). `build_completed` → the `buildComplete` hook. `chosen_opening` → `getOpening()`. `switch_opening` → `switchOpening()`. |
| custom_building_placements | ares/custom-building-placements.ts | partial | No YAML loader (P4-D9): placements come from `Placer.placements(world)`, keyed in TS by map name, spawn (upper/lower) and opponent race (VsAll fallback). Dropped: `FirstPylon` and `GateKeeper` keys, `get_nat_gatekeeper_position` / `get_gatekeeper_positions` (no API); `to_count_per_base` (P5-D12) → `toCount`. `get_placements_dict` → `placement.getPlacements({ base, size, flag })`. `request_building_placement(reserve_placement=False)` → `placement.request(type, { reserve: false })`. |
| chat_debug | ares/chat-debug.ts | full | Enabled with `features.chatDebug` (inline config). The command set is ares' (6a D17). |
| config_file | none | skipped | The ares tutorial is "Coming soon ™" and has no content. Config files are shown by ares/openings/*.config.json (build-runner) and the inline `features` in chat-debug. |
| gotchas, migrating, index | none | not examples | Not requested; prose only. |

## Existing examples

| File | Change |
|---|---|
| ramp-wall.ts | Depots and barracks via `buildings.build(type, { placement: { flags: ['wall'] } })` instead of the ramp corner math. `mining.configure({ enabled: true })` replaces `distributeWorkers`. SCVs via `behaviors.run(buildWorkers({ toCount: 16 }))`. `alreadyPending` → `buildings.pending`. The depot raise/lower rule uses `spatial.anyInRange(depot, d, 'enemyGround')` instead of the per-depot min-distance scan. |
| cannon-rush.ts | Own-base pylon and forge via `buildings.build(type, { placement: { closestTo } })`. Mining enabled. Probes via `buildWorkers`. Proxy pylons and cannons near the enemy keep `actions.findPlacement` (the solver covers own bases only, 6b D5) and go through `buildings.build(type, { at })`. |
| worker-rush.ts, bot-vs-bot.ts, ladder.ts | Workers are assigned `UnitRole.ATTACKING`, and the attack-move is issued inside `roles.as(UnitRole.ATTACKING, …)`, so mining (GATHERING) never reclaims them. Nothing else changes. |
| tutorial.ts | Unchanged: it's the companion of docs/tutorial.md (DA2). The docs ticket fixes the stale `tutorial.js` link. |
| watch-replay.ts | Unchanged (no superseded API). |

## Implementation Decisions

- EX-D1 Layout: updated examples stay at `examples/*.ts`. The ares ports go under `examples/ares/<tutorial-kebab>.ts`, and the openings under `examples/ares/openings/<race>.config.json`, each a full core config file (`{ "resources": { "openings": { builds, choices, method, minGames } } }`). build-runner.ts loads the file for its race via `createEngine({ configFile })`.
- EX-D2 An example that a test imports exports its agent (or system) and runs the engine only under `if (import.meta.main)`, so `bun run examples/…` still works. Examples without a test keep their current shape.
- EX-D3 Type-check: `tsconfig.json` already includes `**/*.ts`, so `bun run check-types` covers examples/ today (verified: all 7 files are in `tsc --listFiles`). No new script; an AC guards against excluding examples/.
- EX-D4 Fixture tests (committed, `examples/ares/*.test.ts`, `createTestWorld` with the exported agent) only where the example has its own logic: roles split, squads maneuver, combat maneuver, custom behavior, managing production, build runner, custom placements. influence-and-pathing and chat-debug are API tours and get the type-check only. Existing examples: type-check, plus the live smoke for ramp-wall.
- EX-D5 Openings parse test (committed): every opening in the three config files parses with `parseBuildOrder` for its race and is accepted by `openings.configure`. JSON errors aren't caught by tsc.
- EX-D6 Live smoke, one file, skipped without `SC2PATH`: ramp-wall, managing-production and build-runner (Terran, ThreeRax). These are the three that exercise placement, tracker, mining and runner end to end. The rest are covered by P4-T12 / P5-T09 live tests on the same APIs.
- EX-D7 Ports keep ares' race: Zerg for roles and squads, Terran for the others; build-runner has all three race files. Ports are faithful to the tutorial's final bot and don't add strategy the tutorial lacks. Like the tutorials, they assume their units exist; fixture tests spawn them.
- docs-plan §3.4 ("runnable bots only where an exit criterion asks") is superseded for this package; docs-plan.md is amended.

## Testing Decisions

- Seams: the exported agent driven by `createTestWorld` (fixture world + fake client); assertions on proposed commands and resource state. Prior art: behaviors/combat/terran.test.ts, systems/builder-plugin.test.ts.
- Live: engine/create-engine.live.test.ts skip guard; resources/*.live.test.ts from P4-T12.
- Per writing-tests: assert each example's behavior, not that it calls an API.

## Out of Scope

- Library changes. A missing API goes to the PM as a follow-up, not into an example ticket.
- A YAML loader, gate-keeper positions, a first-pylon flag, climber grids, low-priority paths, and a clean-grid API (all listed as gaps).
- Rewriting docs/tutorial.md (DA2).

## Further Notes

- P5-T09's examples/behaviors-bot.ts (Terran bio sample bot) is separate and not owned here. EX-T04 (managing-production) is the ares viking/tank tutorial; the two don't overlap in files.
- Backlog candidate (not in scope): core upgrade constants lack `TEMPESTGROUNDATTACKUPGRADE`, which python-sc2 has. Check whether the current game data still has it.

---

# Tickets

## T01 ares combat ports: roles, combat maneuver, squads, custom behaviors

- Source: ares tutorials assigning_unit_roles, combat_maneuver_example, unit_squads_group_behaviors, custom_behaviors.
- What to build: four examples under examples/ares/, each a faithful port of the tutorial's final bot (Translation map), plus a fixture test per file.
- API contract: parity-3 `RolesResource`, `SquadsResource`; parity-2 `SpatialIndex`, `InfluenceResource`; parity-5 `plan`, `Behavior`, `BehaviorsResource.run`, factories in `@sc-bot/core/behaviors`.
- Acceptance criteria:
  - [ ] assigning-unit-roles: zerglings and roaches get ATTACKING on creation. On the first step with a force, every second zergling moves to HARASSING (once only), and harassers attack `map.getEnemyThirds()[0]`.
  - [ ] combat-maneuver: a medivac with mines nearby proposes a pickup. With cargo it paths toward the enemy start and drops at its position. Empty with no pickup targets, it keeps safe on the air layer.
  - [ ] unit-squads: after 360 game s roaches move from ATTACKING to CONTROL_GROUP_ONE once. Per squad (radius 9), enemies within 11.5 → stutterGroupForward, otherwise aMoveGroup toward the enemy start.
  - [ ] custom-behaviors: `customSiegeTankDecision` sieges when no ground enemy is within 6.5 and the ground enemies within 14 number more than 3 with supply ≥ 4. It unsieges when none are within 14. Otherwise it returns false, and the plan falls through to aMove.
  - [ ] Each file's header comment lists its ares gaps from the Translation map.
  - [ ] One fixture test per example covers the AC above, spawning the needed units into a fixture world.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new examples/ares/assigning-unit-roles.ts, combat-maneuver.ts, unit-squads.ts, custom-behaviors.ts, each with a `.test.ts`.
  - Interfaces: each file `export const bot = createAgent({...})` (or exports the agent factory), runner under `import.meta.main` (EX-D2).
  - Follow: ares tutorials (final code blocks); behaviors/combat/terran.test.ts and group.test.ts for fixture setup; examples/worker-rush.ts for runner conventions (MAP, GAME_TIME_LIMIT, DIFFICULTY env).
  - Don't touch: library code, other examples.
- Stack: core (examples). Staffing: junior.
- Blocked by: None. P3 is shipped. P5-T02/T03/T04 are approved; they need to be in the tree, not yet pushed.
- Slice siblings: T02, T04, T05, T06.

## T02 ares API tours: influence and pathing, chat debug

- Source: ares tutorials influence_and_pathing, chat_debug.
- What to build: two examples under examples/ares/, type-check only (EX-D4).
- API contract: parity-2 `InfluenceResource`, `PathingResource`; parity-6a `CoreConfig.features.chatDebug`.
- Acceptance criteria:
  - [ ] influence-and-pathing covers every tutorial section with a core equivalent: `nextPoint`, `findPath`, the low-priority path as `findPath` with every 8th point kept, `pathUnitToTarget`, `pathGroupToTarget`, `closestSafeSpot`, `keepUnitSafe`, `keepGroupSafe`, cost checks via `getGrid(layer).get` and `isPositionSafe`, and custom cost via `influence.addCost` (enemy spawn radius 20 weight 100.5; per enemy unit by range + 2 and DPS), then `nextPoint` over it. The header lists the gaps.
  - [ ] chat-debug runs a Terran bot with `features: { chatDebug: true }` passed inline to `createEngine`, `realtime: true` so a human can type, and a header listing the commands from the ares tutorial.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new examples/ares/influence-and-pathing.ts, examples/ares/chat-debug.ts.
  - Follow: ares tutorials; readme `### influence` / `### pathing` / chat debug sections.
  - Don't touch: library code, other examples.
- Stack: core (examples). Staffing: junior.
- Blocked by: None.
- Slice siblings: T01, T04, T05, T06.

## T03 Update existing examples

- Source: user request (1); "Existing examples" table.
- What to build: the changes in the "Existing examples" table. Where nothing is superseded, the file stays unchanged.
- API contract: parity-4 `BuildingTracker`, `MiningResource`, `PlacementFlag`; parity-3 `RolesResource.assign`/`as`; parity-5 `buildWorkers`, `BehaviorsResource.run`; parity-2 `SpatialIndex.anyInRange`.
- Acceptance criteria:
  - [ ] ramp-wall builds its depots and barracks on `wall` placements through the tracker, with no ramp corner math and no `distributeWorkers`. Mining is enabled, and SCVs come from `buildWorkers`. Depots lower and raise on `spatial.anyInRange` (raise < 10, lower ≥ 15 as now).
  - [ ] cannon-rush: own-base pylon and forge via `buildings.build` with placement options; proxy pylons and cannons via findPlacement + `buildings.build({ at })`; probes via `buildWorkers`; mining enabled.
  - [ ] worker-rush, bot-vs-bot, ladder: workers are assigned ATTACKING, and the attack-move is issued inside `roles.as(ATTACKING, …)`.
  - [ ] tutorial.ts and watch-replay.ts are unchanged.
  - [ ] ramp-wall exports its agent with an `import.meta.main` runner (used by T07). The others keep their shape.
  - [ ] `tsconfig.json` still includes examples/ (`tsc --listFiles` lists every examples/*.ts); lint, tsc and tests green.
- Implementation plan:
  - Where: examples/ramp-wall.ts, cannon-rush.ts, worker-rush.ts, bot-vs-bot.ts, ladder.ts.
  - Follow: readme `### buildings`, `### mining`, `### roles`; behaviors/macro/spawn.ts `buildWorkers`; resources/placement.ts (Terran `wall` spots: depots and barracks at the main ramp).
  - Don't touch: tutorial.ts, watch-replay.ts, library code.
- Stack: core (examples). Staffing: junior.
- Blocked by: P5-T05 (buildWorkers; parity nits pending), P4-T11 (tracker and mining builder pick that these examples rely on).
- Slice siblings: T07.

## T04 ares port: managing production

- Source: ares tutorial managing_production.
- What to build: examples/ares/managing-production.ts, the tutorial's final TestBot with the viking_tank composition, and a fixture test.
- API contract: parity-5 B4–B7 (`autoSupply`, `buildWorkers`, `gasBuildingController`, `spawnController`, `productionController`), `plan`.
- Acceptance criteria:
  - [ ] One macro plan in ares order: autoSupply(start), buildWorkers(48), gasBuildingController(8), spawnController(viking_tank), productionController(viking_tank, start). Composition marine .69/4, siege tank .13/0, viking fighter .16/3, raven .02/1. Mining enabled.
  - [ ] Fixture test: on a fixture world with a CC, barracks and enough minerals, one step proposes supply or worker work before army work, following plan order. A composition not summing to 1 throws at creation (controller validation, D11).
  - [ ] Agent exported with an `import.meta.main` runner (used by T07).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new examples/ares/managing-production.ts (+ .test.ts).
  - Follow: ares tutorial final block; behaviors/macro/*.test.ts fixture setup.
  - Don't touch: library code, examples/behaviors-bot.ts (P5-T09).
- Stack: core (examples). Staffing: junior.
- Blocked by: P5-T08 (productionController; transitively P5-T06/T07).
- Slice siblings: T01, T02, T05, T06, T07.

## T05 ares port: custom building placements

- Source: ares tutorial custom_building_placements.
- What to build: examples/ares/custom-building-placements.ts and a fixture test:
  - A `Placer.placements(world)` that returns the tutorial's Terran entries (VsAll plus VsZerg/VsProtoss/VsTerran/VsRandom overrides, by opponent race) and the Protoss Persephone entries without FirstPylon/GateKeeper, keyed by map name and upper/lower spawn.
  - The BuildStructure snippets: `buildStructure` with flags `wall` at the natural, `supplyDepot` at the main, and `missileTurret` at the defensive third with `toCount: 3`.
  - The mediator snippets: `placement.request(…, { reserve: false })`, and `getPlacements({ base, size, flag })` for wall 2x2/3x3 and main production spots.
  - A build-runner opening using `@ nat_wall` / `@ reaper_wall`.
- API contract: parity-4 `Placer.placements`, `UserPlacement`, `PlacementFlag`, `PlacementResource.getPlacements`/`request`; parity-5 `buildStructure`; parity-6b targets NAT_WALL / REAPER_WALL.
- Acceptance criteria:
  - [ ] Key mapping documented in the file: SupplyDepots → `supplyDepot`, SupplyDepotsWall → `supplyDepot` + `wall`, Production → `production`, ThreeByThreesWall → `wall`, BunkersWall → `bunker` + `wall`, MissileTurrets → `missileTurret`, SensorTowers → `sensorTower`, UpgradeStructures → `upgradeStructure`, PylonsWall → `wall`, StaticDefencesWall → `staticDefence` + `wall`.
  - [ ] Fixture test (fixture map with an entry in the file): the custom spots appear in `placement.getPlacements` with the mapped flags, and `buildStructure` with the `supplyDepot` flag requests a custom spot first. Opponent-race override beats VsAll.
  - [ ] Header lists the gaps (no YAML, no gatekeeper API, no FirstPylon, `toCount` instead of `to_count_per_base`).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new examples/ares/custom-building-placements.ts (+ .test.ts).
  - Follow: readme placer setup (`world.resources.set({ placer })` in system setup); resources/placement.ts `addUserPlacements`; `frame.getGameInfo().mapName`. Fixture coordinates: use a fixture map (e.g. blueshift) for the test entry, and keep the tutorial's dummy coordinates for illustration.
  - Don't touch: library code.
- Stack: core (examples). Staffing: junior.
- Blocked by: P5-T06 (buildStructure), P6B-T05 (runner targets incl. NAT_WALL/REAPER_WALL).
- Slice siblings: T01, T02, T04, T06.

## T06 ares port: build runner + openings

- Source: ares tutorial build_runner; examples/build_runner_examples/{terran,protoss,zerg}_builds.yml.
- What to build:
  - examples/ares/openings/{terran,protoss,zerg}.config.json: every build from the YAML files, with Cycle/WinrateBased → `method`, MinGamesWinrateBased → `minGames`, BuildChoices → `choices` (race keys + opponent ids; BotName and test_123 dropped), OpeningBuildOrder → `buildOrder`, AutoSupplyAtSupply / ConstantWorkerProductionTill / PersistentWorker → camelCase, UseData → `dataDir` omitted (opt-in, noted).
  - examples/ares/build-runner.ts: a build system with `openings: 'config'` that loads its race file via `createEngine({ configFile })`. It hands control to dynamic play on `buildComplete`, logs `getOpening()`, takes control of the `BUILD_RUNNER_SCOUT` worker via `roles.get`, and shows `switchOpening` behind a guard (intel `rushed` → a defensive opening from the file). Race from the `RACE` env (default terran).
- API contract: parity-6b `OpeningSettings`, `OpeningDefinition`, `SystemObject.openings`/`opening`/`switchOpening`/`getOpening`, `parseBuildOrder`; parity-6a config file.
- Acceptance criteria:
  - [ ] Every ares build is present except the dropped step (`16 tempestgroundattackupgrade`, noted in the file and docs). The parse test (EX-D5) parses every opening with `parseBuildOrder` for its race and passes each file's `resources.openings` through `openings.configure` without error.
  - [ ] Fixture test: with the Terran config, the build system picks an opening from `choices` for the fixture's enemy race, `getOpening()` returns it, and the first step's task matches the parsed first step.
  - [ ] Agent and system exported with an `import.meta.main` runner (used by T07).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new examples/ares/build-runner.ts (+ .test.ts), examples/ares/openings/*.config.json, examples/ares/openings.test.ts.
  - Follow: parity-6b.md T04/T06 and the readme Build systems section (once P6B-T07 lands); engine/config.ts (`resolveConfig`, `configFile`); utils/build-order/parse.ts.
  - Don't touch: library code.
- Stack: core (examples). Staffing: junior.
- Blocked by: P6B-T06 (openings in the runner; transitively P6B-T05).
- Slice siblings: T05, T07.

## T07 Examples live smoke

- Source: EX-D6.
- What to build: one live test file, skipped without `SC2PATH`, running three examples' exported agents through `engine.runGame` vs built-in AI (VeryEasy) on simple64 with a game time limit.
- Acceptance criteria:
  - [ ] ramp-wall: by 4:00 game time a depot and a barracks stand on `wall` placements (`getPlacements({ flag: 'wall', state: 'taken' })`).
  - [ ] managing-production: by 6:00 game time ≥ 1 factory exists or is pending, and ≥ 8 marines are alive or were produced (from `commandResults` / unit counts).
  - [ ] build-runner (Terran, opening forced to ThreeRax): `getOpening()` is `ThreeRax` and `buildComplete` fires before 7:00 game time.
  - [ ] Actual numbers recorded in the ticket. A failure goes back to the owning example ticket, or to the PM if it's a library bug.
  - [ ] Skips cleanly without SC2; lint, tsc and tests green.
- Implementation plan:
  - Where: new examples/examples.live.test.ts.
  - Follow: engine/create-engine.live.test.ts (skip guard, engine setup); P4-T12 live tests.
  - Don't touch: examples' source (fixes go to their tickets), library code.
- Stack: core (live tests). Staffing: junior.
- Blocked by: T03, T04, T06.
- Slice siblings: T03, T04, T06.

## T08 Docs: examples

- Source: docs-plan.md §2 "Examples" and §3.4 (amended).
- What to build:
  - readme "Examples" (~1471): the updated list (what each existing example shows now), a sub-list "Translated from ares-sc2 tutorials" with one line per port (which tutorial, run command, gaps link), how to pick an opening race file (`RACE`), and that chat-debug runs in realtime.
  - readme "Where this library differs from ares-sc2": a pointer to the Translation-map gaps not already listed (low-priority path, clean grid, gatekeeper, FirstPylon).
  - docs/tutorial.md:227: link `tutorial.js` → `tutorial.ts`.
  - docs/changelog.md: `Unreleased › Examples` (Changed: existing examples; Added: ares ports, openings configs, examples live test).
- Acceptance criteria:
  - [ ] Every file in examples/ and examples/ares/ is listed in the readme Examples section with its run command; nothing listed is missing on disk.
  - [ ] Gaps per port are stated once, in the readme (Examples or ares-differences), matching the file headers.
  - [ ] docs/tutorial.md link fixed; changelog entry present.
  - [ ] No mention of removed example behavior remains (ramp corner math, distributeWorkers in ramp-wall).
- Implementation plan:
  - Where: packages/core/readme.md, docs/tutorial.md (link only), docs/changelog.md.
  - Follow: docs-plan.md §3; earlier phases' docs tickets.
  - Don't touch: code, examples.
- Stack: core (docs). Staffing: junior.
- Blocked by: T01–T07, P6B-T07 (docs chain: … → P6B-T07 → examples T08).
- Slice siblings: all.

## Dependency order

Unblocked now: T01, T02. Then T03 (after P5-T05, P4-T11), T04 (after P5-T08), T05 (after P5-T06, P6B-T05), T06 (after P6B-T06), T07 (after T03/T04/T06), T08 last.
No two tickets edit the same file.

## EX-T01 gaps (for EX-T08)
- assigning-unit-roles: no equivalent for the `get_unit_role_dict` tip (use `roles.roleOf` / `roles.getTags`). `get_enemy_third` → `map.getEnemyThirds()[0].townhallPosition`. `on_unit_created` → `onUnitCreated` calling `roles.assign`. Ling/roach lists are re-read after the harass split (ares keeps stale lists for that step).
- combat-maneuver: `CombatManeuver` → `plan()`. Air grid → `air` influence layer. Deviation: `pathUnitToTarget` uses `successAtDistance: 3` so the drop can run; ares' default 0 never reaches it. `has_cargo` → `cargoSpaceTaken > 0`. Mines are WIDOWMINE (tutorial leaves mine selection out).
- unit-squads: `get_units_in_range(EnemyGround)` → `spatial.unitsInRange(squad.position, 11.5, 'enemyGround')`. `squad_radius` → `squads.getSquads(role, { radius: 9 })`. `StutterGroupForward`/`AMoveGroup` → `stutterGroupForward`/`aMoveGroup` via `behaviors.run(plan(...))`; `group_tags`/`group_position` not needed (`groupPosition` passed but unused by core). Structure/worker exclusion uses `isStructure()`/`isWorker()`.
- custom-behaviors: custom behavior = `Behavior` object `{ name, execute(ctx) }`. `get_total_supply` → summed `foodRequired`. Named `customSiegeTankDecision` (core ships `siegeTankDecision`). `ctx.order(unit, MORPH_SIEGEMODE)` replaces `SIEGEMODE_SIEGEMODE`.
- All four: runner follows worker-rush conventions (MAP, GAME_TIME_LIMIT, DIFFICULTY, SAVE_REPLAY env); each exports a `createBot()` factory.

## EX-T02 gaps and commands (for EX-T08)
influence-and-pathing (port of ares influence_and_pathing). Gaps vs ares:
- No air_vs_ground, climber or ground_to_air grids; core layers are ground, air, groundAvoidance, airAvoidance.
- No clean/blank grid API: custom cost goes onto the built-in grids via influence.addCost and lasts one game loop.
- No find_low_priority_path: the example's lowPriorityPath rebuilds it from findPath (assumes map_analyzer thins by stride 4).
- No cy_* grid helpers beyond isPositionSafe (cy_point_below_value).
- Air cost uses airDps at the enemy unit; the tutorial uses ground_dps at the enemy spawn.

chat-debug (port of ares chat_debug). Type in SC2 chat (own messages only, case-insensitive):
- make|create <count> <UnitTypeName> [playerId]: spawn at the camera (e.g. `make 4 marine`, `make 1 hive 2`)
- kill|destroy <count> <UnitTypeName> [playerId]: kill anywhere on the map (e.g. `kill 4 marine`, `destroy 4 banshee 2`)
- cooldown, food|supply, god, resources|money, show|reveal|show-map, tech|tech-tree, upgrades

## EX-T05 gaps (for EX-T08)
custom-building-placements (port of ares custom_building_placements):
- No YAML loader: tables are TS literals (`TERRAN_PLACEMENTS`, `PROTOSS_PLACEMENTS`) fed to `createPlacer(table)`.
- No FirstPylon, no GateKeeper / get_nat_gatekeeper_position; `nextFirstPylon` = `placement.request(PYLON, { reserve: false })`.
- `toCount` replaces `to_count_per_base`.
- Unmapped enum keys: Bunkers, Pylons, ProductionWall, StaticDefences, ThreeByThrees, UpgradeStructuresWall.
- VsRandom only when opponent race is Race.RANDOM; the agent reports NORACE for random at game start, so only VsAll applies.
- Map names matched by prefix (ladder names carry suffixes like " LE"). Upper/lower spawn decided as in ares: own start y vs enemy start y.
- A race entry (VsZerg etc.) wins per key and VsAll spots are appended (deduped), as in ares merge_defaults_no_override.
- No Debug / ShowBuildingFormation config; placement.drawDebug colours custom spots purple, not white.
- No raw placements_dict; `getPlacements` stands in.
- Split into a Protoss and a Terran bot (the tutorial mixes both races' snippets).
- ConstantWorkerProductionTill / AutoSupplyAtSupply not set.

## EX-T06 gaps (for EX-T08)
build-runner (port of ares build_runner tutorial + example YAMLs):
- Openings are core config files examples/ares/openings/{terran,protoss,zerg}.config.json loaded via createEngine({ configFile }).
- Dropped YAML keys: BotName, the test_123 choice, UseData (no dataDir), ShouldHandleGasSteal.
- OneBaseTempests drops "16 tempestgroundattackupgrade" (not in game data; BG-T08).
- Protoss/Zerg YAMLs don't set MinGamesWinrateBased; files carry core's default 3 explicitly. Zerg ProxyHatch defined but in no cycle (as in the YAML).
- No opponent-id choices in the example YAMLs (race keys only).
