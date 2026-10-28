# Examples

Small runnable bots. Each needs SC2 installed.

## Environment variables

- `MAP`: map name, default `Melee/Simple64`. Read by every game-playing example.
- `GAME_TIME_LIMIT`: game seconds after which the game ends early.
- `SAVE_REPLAY=<path>`: saves a replay. Every game-playing example except `ladder.ts` reads it.
- `DIFFICULTY`: a `Difficulty` name such as `HARD`, default `MEDIUM` (`EASY` for `behaviors-bot.ts`). Read by the examples that play the built-in AI; `bot-vs-bot.ts`, `ladder.ts` and `ares/chat-debug.ts` have none.
- `RACE=terran|protoss|zerg`: `ares/build-runner.ts` only, default `terran`.
- `SC2PATH`: location of SC2; the live smoke test is skipped without it.

## Standalone examples

- `bun run examples/worker-rush.ts`: Zerg sends every worker at the enemy. The workers get the role `ATTACKING` and the attack-move runs inside `roles.as(ATTACKING, …)`, so mining never takes them back.
- `bun run examples/cannon-rush.ts`: Protoss cannon rush. Mining is on, probes come from `buildWorkers`, and the own-base pylon and forge go through `buildings.build(type, { placement: { closestTo } })`. Proxy pylons and cannons use `actions.findPlacement` and `buildings.build(type, { at })`, because the placement solver only covers your own bases.
- `bun run examples/ramp-wall.ts`: Terran main ramp wall. Depots and the barracks are built on `wall` placements (`buildings.build(type, { placement: { flags: ['wall'] } })`), SCVs come from `buildWorkers` with mining on, and depots lower and raise on `spatial.anyInRange(depot, d, 'enemyGround')` (raise under 10, lower from 15). `ramp-wall.test.ts` is its fixture test.
- `bun run examples/bot-vs-bot.ts`: `runBotVsBot`, a Terran and a Zerg worker rusher against each other.
- `bun run examples/watch-replay.ts <replay> [observedPlayerId]`: `runReplay` with an observer agent that logs the time and created units.
- `bun run examples/ladder.ts`: a Terran worker rush, started by a ladder manager with `--LadderServer`, `--GamePort`, `--StartPort`.
- `bun run examples/behaviors-bot.ts`: a Terran bio bot of only controllers and behaviors (see [behaviors](../docs/behaviors.md)): macro plan, squads, `canWinFight`, medivac heal; against the built-in AI, as `worker-rush.ts`.
- `examples/tutorial.ts` is the companion of [getting started](../docs/getting-started.md): a build system (an eight-gate all-in) to mount on an agent. It builds no pylons and has no supply handling, so as is its gateways can't be placed; add pylons to the order before using it.

## Ares ports

`examples/ares/` holds TypeScript ports of the ares-sc2 tutorials, each the tutorial's final bot with the same race, units and flow, run as `bun run examples/ares/<file>`. They read the same environment variables as above. The ports with their own logic have a fixture test next to them; `influence-and-pathing.ts` and `chat-debug.ts` are only type-checked. The ares `config_file` tutorial has no content upstream ("Coming soon"), so it has no port: config files are shown by the openings below and by the inline `features` in `chat-debug.ts`.

| File | ares tutorial | Race | Gaps and deviations from ares |
|---|---|---|---|
| `assigning-unit-roles.ts` | assigning_unit_roles | Zerg | No `get_unit_role_dict` (use `roles.roleOf` / `roles.getTags`). `get_enemy_third` is `map.getEnemyThirds()[0].townhallPosition`; `on_unit_created` is `onUnitCreated` calling `roles.assign`. The ling and roach lists are re-read after the harass split (ares keeps them stale for that step). |
| `combat-maneuver.ts` | combat_maneuver_example | Terran | `CombatManeuver` is `plan()`; the air grid is the `air` influence layer. `pathUnitToTarget` uses `successAtDistance: 3` so the drop can run; ares' default of 0 never reaches it. `has_cargo` is `cargoSpaceTaken > 0`. Mines are widow mines (the tutorial leaves the selection out). |
| `unit-squads.ts` | unit_squads_group_behaviors | Zerg | `get_units_in_range(EnemyGround)` is `spatial.unitsInRange(squad.position, 11.5, 'enemyGround')`; `squad_radius` is `squads.getSquads(role, { radius: 9 })`. `StutterGroupForward` and `AMoveGroup` are `stutterGroupForward` and `aMoveGroup` run with `behaviors.run(plan(…))`; `groupPosition` is passed but core ignores it. Structures and workers are excluded with `isStructure()` / `isWorker()`. |
| `custom-behaviors.ts` | custom_behaviors | Terran | A custom behavior is a `Behavior` object `{ name, execute(ctx) }`. `get_total_supply` is the summed `foodRequired`. Named `customSiegeTankDecision`, because core ships `siegeTankDecision`. `ctx.order(unit, MORPH_SIEGEMODE)` replaces `SIEGEMODE_SIEGEMODE`. |
| `influence-and-pathing.ts` | influence_and_pathing | Protoss | Uses the `climber`, `airVsGround` and `groundToAir` layers, `findLowPriorityPath`, `smoothing: true` on `findPath` / `nextPoint`, and `influence.getCleanGrid('ground')` as the own grid for the enemy-spawn cost. A clean grid lasts as long as you hold it (the example adds the cost once), while cost on a built-in layer lasts one game loop. No `cy_*` helpers beyond `pathing.isPositionSafe` (`cy_point_below_value`). Air cost uses `airDps` at each enemy unit; the tutorial uses ground DPS at the enemy spawn. |
| `managing-production.ts` | managing_production | Terran | `MacroPlan` is `plan()`. Mining is enabled explicitly (core's is opt-in, ares mines by default). The viking_tank composition is exported as `vikingTank`. |
| `build-runner.ts` | build_runner and build_runner_examples/*.yml | Terran, Protoss or Zerg | Partial, see Openings configs below. `ARES_YAML=1` loads ares' own YAML (`openings/<race>_builds.yml`, `ShouldHandleGasSteal` included) through `parseAresBuilds` instead of the JSON config. `build_completed` is the `buildComplete` hook, `chosen_opening` is `getOpening()`, `switch_opening` is `switchOpening()`. Zerg structures take the `findPlacement` fallback (the solver has no Zerg spots). |
| `custom-building-placements.ts` | custom_building_placements | Protoss and Terran | Partial. The tables are TS literals (`TERRAN_PLACEMENTS`, `PROTOSS_PLACEMENTS`) or ares YAML (`parseAresPlacements(text)`, and `loadAresProtossPlacements()` for the bundled Protoss table, which `createBot` merges under its own literal), fed to `createPlacer(table)` and keyed by map name (matched by prefix, since ladder names carry a suffix like " LE"), spawn (upper or lower, from own start y against the enemy's) and opponent race. A race entry wins per key and `VsAll` spots are appended, deduped, as in ares. `VsRandom` applies only if the opponent race is `Race.RANDOM`; the agent reports no race for a random opponent at game start, so only `VsAll` applies there. `FirstPylon` and `GateKeeper` keys work (`nextFirstPylon` is `placement.request(PYLON, { firstPylon: true, reserve: false })`, `natGatekeeper` is `placement.getNatGatekeeperPosition()`). `toCount` replaces `to_count_per_base`. Unmapped keys: Bunkers, Pylons, ProductionWall, StaticDefences, ThreeByThrees, UpgradeStructuresWall. No `Debug` / `ShowBuildingFormation` config; `placement.drawDebug` colours custom spots purple. No raw `placements_dict`; `placement.getPlacements({ base, size, flag })` stands in. `ConstantWorkerProductionTill` and `AutoSupplyAtSupply` aren't set. The tutorial's mixed-race snippets are split into `createBot()` (Protoss, the one the runner plays) and `createTerranBot()`. |
| `chat-debug.ts` | chat_debug | Terran | Enabled by `features: { chatDebug: true }` passed inline to `createEngine`; the game runs `realtime: true` so you can type. The command set is ares', see below. Always against a MEDIUM built-in AI. |

### Chat-debug commands

Type these into the SC2 chat (own messages only, case-insensitive):

- `make|create <count> <UnitTypeName> [playerId]`: spawn at the camera, e.g. `make 4 marine`, `make 1 hive 2`.
- `kill|destroy <count> <UnitTypeName> [playerId]`: kill anywhere on the map, e.g. `kill 4 marine`, `destroy 4 banshee 2`.
- `cooldown`, `food|supply`, `god`, `resources|money`, `show|reveal|show-map`, `tech|tech-tree`, `upgrades`.

### Openings configs

`ares/build-runner.ts` mounts one build system with `openings: 'config'` and loads its race's file through `createEngine({ configFile })`. Pick the race with `RACE=terran|protoss|zerg` (default `terran`); the opponent is always a built-in Protoss AI. Each file is a full core config (`{ "resources": { "openings": { builds, choices, method, minGames } } }`):

- `examples/ares/openings/terran.config.json`: FastCC, ThreeRax, OneOneOneStandard, OneOneOneMineDrop, ReaperOpening.
- `examples/ares/openings/protoss.config.json`: BasicOpener, AdeptOracle, AggressiveStalker, OneBaseTempests, PhoenixEconomic.
- `examples/ares/openings/zerg.config.json`: OneBaseMuta, BroRush, LingDroneRush, ProxyHatch, RavagerRush, Ultras.

`examples/ares/openings.expected.ts` holds the values of ares' YAML files that `ares/openings.test.ts` compares the configs against, and the test checks that every opening parses for its race.

The example logs `getOpening()` at game start and again at `buildComplete`, reads the `BUILD_RUNNER_SCOUT` worker with `roles.get`, and (Protoss only) calls `switchOpening('OneBaseTempests')` once when intel flags the enemy `rushed`. It lowers every ready depot, as ares' build_runner_bot does, because a raised ramp wall seals the main from builders outside it.

Gaps against ares' YAML files:

- YAML becomes JSON. `Cycle` / `WinrateBased` is `method`, `MinGamesWinrateBased` is `minGames`, `BuildChoices` is `choices`, and the options are camelCase (`autoSupplyAtSupply`, `constantWorkerProductionTill`, `persistentWorker`). Every build from the YAML files is present except the step below.
- `ShouldHandleGasSteal` is kept with `ARES_YAML=1`; the JSON configs drop it (the guard stays on, its default). Dropped: `BotName`, the `test_123` choice, `UseData` (no `dataDir`, so no history; it is opt-in), and `set_build_completed`, and Protoss' supply of -1.
- OneBaseTempests drops its `tempestgroundattackupgrade` step (see [String steps](../docs/build-orders.md#string-steps)).
- The Protoss and Zerg YAMLs don't set `MinGamesWinrateBased`; those files carry core's default (3) explicitly. The YAMLs have race keys only, no opponent ids. Zerg's ProxyHatch is defined but in no choice list, as in the YAML.

## Live smoke test

`examples/examples.live.test.ts` plays three examples against a VeryEasy Zerg on Simple64 with a game time limit, and is skipped unless `SC2PATH` is set:

- `ramp-wall` has a depot and a barracks on `wall` placements by 4:00.
- `managing-production` has a factory (standing or pending) and at least 8 marines by 6:00.
- `build-runner` (Terran, opening forced to `ThreeRax` by overriding the Zerg choices) completes the build before 7:00.

Run it with `SC2PATH=<sc2 dir> bun test examples/examples.live.test.ts`. Run live suites one at a time; each test launches SC2 on a fixed port (5410 to 5412).
