# Changelog

Release notes of this fork. Releases of the upstream node-sc2 project are in [changelog-node-sc2.md](changelog-node-sc2.md).

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Command executor and resource registry

**Added**
- Resource registry: `world.resources.register({ name, create, reset? })` adds a resource (from a system's `setup`), typed by augmenting `ResourceContainer` in `@sc-bot/core/types`; `world.resources.reset(world)` resets every registered resource in place when a new game starts on the same engine.
- Command arbitration: every unit command is a proposal from a commander (the agent's handlers, or a system by name). At the end of the step the engine keeps one commander per unit (highest priority, then agent handlers, then `agent.use()` order), drops repeats of a unit's current order, merges identical commands and sends one request.
- `commandPriority` as an agent setting and a system option (default `0`).
- `actions.as(context, fn)` runs `fn` under another commander.
- `commandResults` event and `onCommandResults(world, results: CommandResult[])` handler: the step after each flush, per proposal and outcome, `won`, `dropped` (`outranked` with the winner in `by`, or `repeat`) or `rejected` (SC2's `result`, or the request's `error`).
- `queueAction(commands, { onNotSent })`: called during the flush for tags that weren't sent.
- `CommandResult` and `CommandContext` types.

**Changed**
- `actions.attack`, `attackMove`, `move`, `smart`, `patrol`, `gather`, `mine`, `build`, `buildGasMine`, `train`, `upgrade`, `warpIn`, `do`, `stop`, `holdPosition`, `repair`, `returnResource` and the `Unit` shortcuts (`useAbility`, `inject`, `blink`, `burrow`, `toggle`) resolve with `void` once the command is proposed, instead of with `ResponseAction` after SC2 accepted it. They no longer reject when SC2 refuses the command; that is reported through `onCommandResults` and logged on `sc2:debug:actionManager`. Precondition errors (`BuildError`, `TrainError`, `GatherError`, `ActionManagerError`) still reject.
- Commands go out after all systems have run instead of during the step. A command proposed after that flush (from a promise left dangling) goes out with the next step's.
- Conflicting commands for one unit from different systems used to go to whichever request reached SC2 last; now one commander wins per unit.
- Re-issuing a unit's current order (same ability and target, not queued) is never sent; before, only queued commands were checked.
- An empty unit list is a no-op on every high-level command method (`attack`, `attackMove`, `move`, `smart`, `patrol`, `mine`, `do`, `stop`, `holdPosition`, `repair`, `returnResource`): it resolves without proposing anything. `do` used to throw, and `attack`/`attackMove` sent an empty command. Only the raw `actions.queueAction` throws `ActionManagerError` for a command without units.
- A build that is dropped or that SC2 rejects removes the worker's `command` label during the flush, so the worker isn't marked stuck later. Nothing is refunded; the next observation restores the money.
- The macro helpers (`train`, `research`, `distributeWorkers`, `expandNow`) always propose through the queue under the calling commander.
- `actions.sendAction` still sends immediately; the units it commands count as taken for the rest of the observation: a proposal from another commander is dropped unless it strictly outranks the sender; the sender's own follow-ups still go out. `toggleAutocast` and `chatSend` still send immediately.
- A new game on the same engine resets every registered resource (including step times and proposed commands) through the registry.
- Importing the package turns on Bluebird's `asyncHooks` for the whole process, so commanders survive Bluebird callbacks. It costs about 0.1 ms per step.

**Removed**
- The `batchActions` agent setting. Batching is the only mode.

**Upgrading**
- Remove `batchActions` from the agent settings if it is set.
- Don't read the value of an `actions.*` command method or `unit.useAbility`; it is now `undefined`. To react to a command SC2 refused, add an `onCommandResults` handler (it sees `won`, `dropped` and `rejected` per command, the step after).
- Same-unit conflicts between your systems now resolve by `use()` order unless a system sets `commandPriority`. Decide which system should win workers (combat pulling workers against economy, for example) and set `commandPriority` there.
- Code that repeats the same order every step to "refresh" it now sends nothing after the first time; that is intended.
- Code that relied on a command reaching SC2 mid-step (realtime) now sees it go out after all systems finish.
- A command issued after the end-of-step flush, from a promise the handler didn't await, goes out next step.
- A system mounted mid-game with `agent.use()` runs its `setup` and `onGameStart` right away inside the caller, so commands from those are attributed to the caller's commander. From the next step on, it proposes under its own name, ranked after the systems mounted before it.
- To add a bot resource, augment `ResourceContainer` in `@sc-bot/core/types` and register its definition from a system's `setup`.

### Enemy memory, spatial index, influence and pathing

**Added**
- `memory` resource: ghost expiry (`expireGround` / `expireAir`, 30 game seconds by default), `getGhosts`, `getSnapshots`, `getEnemies`, `forget`, `configure`.
- `spatial` resource: `unitsInRange`, `anyInRange` and `closest` over enemies (ghosts included) and own units, by kind (`enemy`, `enemyGround`, `enemyAir`, `own`, `ownGround`, `ownAir`).
- `influence` resource: ground, air, ground avoidance and air avoidance cost grids from enemy units and effects; `getGrid`, `addCost`, `configure`, `drawDebug`.
- `pathing` resource: `findPath`, `nextPoint`, `closestSafeSpot` and `isPositionSafe` over the influence grids.
- `units.getArmyValue(alliance, { includePending, includeGhosts })`.
- `ResourceDefinition.onStep`: a per-step hook for registered resources, run after the engine systems and before agent code.

**Changed**
- Enemy ghosts now expire. A ghost is deleted after 30 seconds, or as soon as its last position is visible and it isn't burrowed. Before, every enemy that left vision stayed in `units` for the rest of the game.
- A tag that memory forgot and that is seen again fires `onEnemyUnitEnteredVision` but not `onEnemyFirstSeen`.

**Upgrading**
- Code that treats `units.getAll(Alliance.ENEMY)` as a permanent record now sees fewer units. To get the old behaviour, raise the expiry with `memory.configure({ expireGround, expireAir })`, for example from a system's `setup`.
- Nothing else breaks: the new resources and `getArmyValue` are additions.

### Combat simulation, roles, squads and intel

**Added**
- `simulateFight(own, enemy, opts?)` and `canWinFight(own, enemy, opts?)`: a focus-fire fight simulation on per-pair DPS, health plus shields, with `timingAdjust` (default `true`), `workersDoNoDamage` and `maxSeconds` options. `canWinFight` returns ares' 0 to 10 `EngagementResult` scale.
- `@sc-bot/core/constants/engagement-result` (`LOSS_EMPHATIC` to `VICTORY_EMPHATIC`) and `@sc-bot/core/constants/unit-role` (ares' unit roles), also as the `EngagementResult` and `UnitRole` namespaces of `@sc-bot/core/constants/index`.
- `roles` resource: `assign`, `clear`, `switchRole`, `get`, `roleOf`, `getTags`, `as`, `mayCommand`, `configure({ defaultRole, exclusive })`. Workers other than MULEs start as `GATHERING`.
- `squads` resource: `getSquads`, `getMainSquad`, `getMainSquadPosition`, clustered lazily once per game loop.
- `intel` resource: `getBaseThreats`, `getMainThreat`, `has`, `detectedAt`, `getProxies`, `configure`, with sticky flags for worker, ling, roach, ravager, marine and marauder rushes, 4-gate, proxy zealots, proxies, reapers, expansions, greedy openings and `rushed`.
- `enemyStrategyDetected` event and `onEnemyStrategyDetected(world, { flag, gameLoop })` handler, once per flag per game.
- `parseBuildOrder(steps, race)` is documented under Utilities.
- Types: `FightOptions`, `FightSimulation`, `EngagementResult`, `UnitRole`, `RoleSettings`, `RolesResource`, `Squad`, `SquadsResource`, `IntelFlag`, `IntelSettings`, `IntelResource`, `BaseThreat`, `EnemyStrategyDetected`.

**Changed**
- `CommandResult.reason` can be `'not-owner'`: a proposal for a unit in an exclusive role from a commander other than that role, with `by: 'role:<ROLE>'`. Nothing is dropped this way unless `roles.configure({ exclusive })` is set.
- `unit.distanceToWeaponReady()` is 1.4 times larger: it divides by 16 game loops per second instead of python-sc2's 22.4, so it matches the distance the unit really covers before its weapon is ready.

**Upgrading**
- An exhaustive `switch` over `CommandResult.reason` needs a `'not-owner'` case.
- Code that compares `distanceToWeaponReady()` against a distance now gets values 1.4 times larger; recheck any threshold tuned on the old value.
- Optional: put army units in a role with `roles.configure({ defaultRole })` (e.g. combat units to `ATTACKING`), and wrap a system's unit commands in `roles.as(role, fn)`.
- Optional: once every system that commands a role's units does so through `roles.as`, list that role in `roles.configure({ exclusive })`.
- Optional: replace hand-rolled engage checks with `canWinFight(own, enemies) >= VICTORY_CLOSE` (or your own threshold).
- Optional: read `intel.has(flag)` or handle `onEnemyStrategyDetected` instead of scouting heuristics, and `intel.getMainThreat('ground')` for base defence.

### Behaviors and macro controllers

**Added**
- `behaviors` resource: `run(behavior, { role?, priority? })` executes a behavior at once, in the caller's commander context, as a role (`role:<ROLE>`) or at a priority. `ctx.order` allows one non-queued order per unit per game loop per owner.
- `@sc-bot/core/behaviors` subpath with `plan(...behaviors)` (first behavior to return `true` wins; synchronous and asynchronous mixed).
- Combat helpers: `attackReady`, `inAttackRange`, `pickEnemyTarget`, `duplicateOrSimilarOrder`, `groupWeaponsOnCooldown`, `center`, `towards`.
- Individual combat behaviors: `aMove`, `attackTarget`, `shootTargetInRange`, `useAbility`, `stutterUnitForward`, `stutterUnitBack`, `keepUnitSafe`, `pathUnitToTarget`, `moveToSafeTarget`, `shootAndMoveToTarget`, `workerKiteBack`.
- Terran behaviors: `medivacHeal`, `pickUpCargo`, `dropCargo`, `pickUpAndDropCargo`, `siegeTankDecision`.
- Group behaviors: `aMoveGroup`, `keepGroupSafe`, `pathGroupToTarget`, `stutterGroupBack`, `stutterGroupForward`, `groupUseAbility`.
- Macro controllers: `spawnController`, `buildWorkers`, `buildStructure`, `autoSupply`, `expansionController`, `gasBuildingController`, `upgradeCCs`, `techUp`, `upgradeController`, `productionController`, with the helpers `ownUnitCount` and `structurePending`.
- `examples/behaviors-bot.ts`: a Terran bio bot made only of controllers and behaviors.
- Types: `Behavior`, `BehaviorContext`, `BehaviorsResource`, `ArmyComposition`.

**Changed**
- The agent's default `interface` now has `score: true` (it was `{ raw: true, rawCropToPlayableArea: true }`), so `frame.getScore()` is available out of the box; `productionController` reads it. An agent that passes its own `interface` has to add `score: true` itself.

**Upgrading**
- Nothing breaks; the behaviors are additive and opt-in. Import factories from `@sc-bot/core/behaviors`.
- Optional: replace per-unit micro in the combat systems with behaviors run under `behaviors.run(behavior, { role: ATTACKING })`.
- Optional: replace hand-rolled supply, production, expansion, gas and upgrade code with a macro `plan` of controllers run each step.
- Enable mining (`mining.configure({ enabled: true })`) so the controllers' builds get their workers through `mining.selectWorker`; controllers that build go through the `buildings` tracker.
- If the bot passes its own `interface` to `createAgent` and uses `productionController`, add `score: true`.

### Placement, building tracker, mining and flying structures

**Added**
- `placement` resource: Terran and Protoss building spots solved once per game (add-on room for 3x3 spots, mineral lines avoided, main ramp wall, natural bunker; Protoss wall, pylon and optimal-pylon spots), `request` with flags, reservations and powered requests, `reserve`, `release`, `canPlace`, `getPlacements`, `add`, `configure`, `drawDebug`. Per-map spots through the optional `placer.placements(world)` hook.
- `buildings` resource, the building tracker: `build`, `buildGas`, `cancel`, `pending`, `getTracked`, `configure`. It picks the spot and worker, retries dropped commands, re-places a failing building, replaces a dead builder, times builds out, resumes unfinished Terran structures (after the first `build` or `buildGas` call of a game that returns a build) and cancels structures that drop below `max(50, 9% of max health)` (`cancelLowHp`: `'tracked'` by default, `'all'`, `'off'`).
- `mining` resource, off until `mining.configure({ enabled: true })`: worker assignment for `GATHERING` workers, speed mining, danger avoidance, self-defence and long-distance mining. `selectWorker`, `release`, `getAssignment`, `getWorkersOn`, `getMineralTarget`, `isEnabled`, `configure`.
- `flying` resource: `move`, `swap`, `addonSwap`, `cancel`, `getPlans`, `configure`; per-step lift, fly and land plans.
- Types: `BuildingSize`, `PlacementFlag`, `PlacementState`, `Placement`, `PlacementRequest`, `UserPlacement`, `PlacementSettings`, `PlacementResource`, `TrackedBuild`, `TrackedBuildStatus`, `BuildOptions`, `BuildingSettings`, `BuildingTracker`, `MiningSettings`, `MiningAssignment`, `MiningResource`, `FlightPlan`, `FlyingStructures`, `Placer.placements`.

**Changed**
- `actions.swapBuildings(a, b)` delegates to `flying.swap` and resolves with `void` once both plans are made; it used to send the lift, move and land commands itself and resolve with `ResponseAction[]`. It still rejects with `ActionManagerError` when either building can't lift or isn't finished.
- Build-system `build` tasks for Terran and Protoss structures (add-ons excepted) go through `buildings.build` with a placement request, and gas tasks through `buildings.buildGas`. Spots differ from the old ring search: add-on room is always kept and mineral lines are avoided. A `placer.place` result still wins and is built on as a tracked build. When the tracker can't start the build (and for Zerg) the old `findPlacement` path runs.
- The building tracker tracks blocked townhall spots and retargets: a townhall build whose worker gets CantBuildLocationInvalid (as an action error, or as the rejection of its BUILD command) marks the spot blocked, and the next step moves the build to the next safe, placeable expansion, or fails it as `blocked`. A blocked spot clears once an own detector or scan covers it with no enemy near.
- The build runner's townhall (untargeted or `expand @target`) is a tracked build for Terran and Protoss, so it gets that retarget.
- `expansionController` relies on the tracker's retarget instead of choosing a new spot itself.
- A build task whose command was sent is only reset after 250 game loops when the tracker has no build of that type pending.
- With `mining` enabled, `actions.build` and the macro helpers' builder pick (when no worker is given) take a mining worker from `mining.selectWorker`.
- The map placement and pathing grids free a structure's footprint when it lifts off and block the cells where it lands.

**Upgrading**
- Everything is additive and opt-in. The only compile-time change is `actions.swapBuildings`, which resolves with no value.
- Build-system Terran and Protoss structure tasks now use precomputed spots and the tracker. Spots differ from the ring search; a `placer.place` hook still wins.
- The map placement grid now frees cells when a structure lifts off.
- Optional: replace `findPlacement` for depots and production with `placement.request` or `buildings.build`; use the spots flagged `wall` for walls; supply hand-tuned spots through `placer.placements`.
- Optional: enable mining with `mining.configure({ enabled: true })` instead of relying on SC2's auto-mining, and then stop calling `distributeWorkers`, which competes with it (`distributeWorkers` was removed, see API consolidation). Worker pulls from the bot's systems keep working: they run at priority 0 against mining's -10.
- Optional: use `flying.addonSwap` instead of hand-rolled add-on swaps. Note that flying commands run at priority 10, so commands from the bot to a structure in transit are dropped as outranked until its plan ends or you call `flying.cancel`; a plan whose destination never accepts a landing is re-proposed every step until then.

### Map analysis, config file, chat debug and enemy race

**Added**
- `mapAnalysis` resource: the start pathing grid split into regions joined by chokes (distance-to-wall watershed), once per game. `getChokes`, `getRegions`, `getRegion`, `isInChoke`, `getBaseChokes`, `getDefensivePosition`, `getDefensiveThird`, `getPerimeter`, `getEnemyMainRamp`, `configure({ maxChokeWidth: 14, peakRatio: 2.2, minRegionArea: 150, defenseOffset: 4 })`, `drawDebug`. Ramps are linked through `choke.ramp`; regions are not split by height.
- JSON config file (`sc-bot.config.json` in the working directory, `SC_BOT_CONFIG`, or `createEngine({ configFile })`) and `createEngine({ config })`: `gameStep`, `features` (`chatDebug`, `eagerMapAnalysis`) and per-resource settings under `resources.<name>`, passed to each resource's `configure()` on creation and after every game reset. `world.config` holds the frozen result; other top-level sections are kept unvalidated.
- Chat debug (`features.chatDebug`, off by default): your own chat as debug commands (`create`/`make`, `kill`/`destroy`, `cooldown`, `food`, `god`, `resources`, `reveal`, `tech`, `upgrades`), with errors answered in chat.
- `onEnemyRaceDetected(world, race)` handler and `enemyRaceDetected` event: once per game, against a random opponent.
- `distributeWorkers(resourceRatio, { workersPerGas })`, an integer from 0 to 3 (default 3).
- Types: `CoreConfig`, `CoreConfigInput`, `ResourceSettings`, `MapAnalysisSettings`, `MapAnalysisResource`, `Choke`, `Region`, `BaseChoke`, `DefensivePosition`.

**Changed**
- A `sc-bot.config.json` in the working directory is now read when it exists. A malformed one, or a named file that doesn't exist, fails engine creation. `STEP_COUNT` still overrides `gameStep` from every source.
- Against a random opponent, `agent.opponent.race` is `NORACE` at game start and changes to the opponent's race on the first step an enemy unit is alive.
- Map analysis runs in the first step by default; turn it off with `features.eagerMapAnalysis: false`.

**Upgrading**
- Nothing breaks. `STEP_COUNT` keeps its meaning.
- If the bot runs from a directory with a `sc-bot.config.json`, that file is now read.
- Code that cached `agent.opponent.race` at game start should read it again later or handle `onEnemyRaceDetected`.
- Optional: use `mapAnalysis.getDefensivePosition(map.getNatural())` instead of hand-coded natural defence spots, and `getDefensiveThird()` for the safer third.
- Optional: set `features.chatDebug` to spawn and kill units from chat while testing.
- Optional: pass `{ workersPerGas }` to `distributeWorkers` for a mineral-heavy split. Superseded: `distributeWorkers` was removed in the API consolidation; `workersPerGas` is a `mining` setting.
- A `configure()` call made once after `createEngine` is overridden by the config file's section from the second game on; call it from `setup` or `onGameStart`.

### Build runner: string build orders and openings

**Added**
- String build steps in a build system's `buildOrder`, in ares' format `'<supply> <command> [@target] [x<n>]'`, mixed freely with `[supply, task]` pairs and task objects: unit types, upgrades, and the options `WORKER`, `SUPPLY`, `GAS`, `EXPAND`, `GATE`, `CORE`, `ORBITAL`, `CANCEL_GAS`, `CHRONO`, `WORKER_SCOUT`, `OVERLORD_SCOUT` and `ADDONSWAP`. An object step (`{ '17 worker_scout': ['enemy_nat'] }`) gives a scout its waypoints. A bad step throws `NodeSC2Error` naming it, at game start.
- `parseBuildOrder(steps, race)`, exported from the package root.
- Build targets (`@sc-bot/core/constants/build-target`): `RAMP`, `NAT_WALL`, `REAPER_WALL`, `SUPPLY`, `PRODUCTION`, `UPGRADE`, `BUNKER`, your bases (`SPAWN`, `NAT`, `THIRD` to `SIXTH`), enemy bases (`ENEMY_SPAWN`, `ENEMY_NAT`, `ENEMY_THIRD`, `ENEMY_FOURTH`), `ENEMY_RAMP`, `ENEMY_NAT_VISION` and `MAP_CENTER`. Own-side targets use the placement solver, proxies use `actions.findPlacement` near the point.
- Task functions `taskFunctions.scout(kind, waypoints?)` and `taskFunctions.addonSwap(host, addon)`, and `opts.at` on `build` and `train` tasks (`train` uses the producer closest to the target).
- Worker and overlord scouts: the worker takes the role `BUILD_RUNNER_SCOUT` (through `mining.selectWorker` when mining is on) and keeps it.
- `buildOptions.fillWorkers` on a build system (default `true`): `false` is ares' supply-gate mode, with no worker insertion and each step waiting for its supply.
- Openings: a build system takes `openings` (named definitions or `'config'`) and `opening` (a name or a function), with `switchOpening(name, { removeCompleted })` and `getOpening()`. Options per opening: `constantWorkerProductionTill`, `autoSupplyAtSupply` and `persistentWorker` (a `PERSISTENT_BUILDER` worker for the opening's builds).
- `openings` resource: definitions and settings (`builds`, `choices`, `method` `'cycle'` or `'winrate'`, `minGames`, `dataDir`), `choose`, `getChosen`, `getHistory`, `getDefinitions`, `configure`. Settings come from the config file's `resources.openings`. With `dataDir` set, each game is appended to `<dataDir>/<opponent id or 'unknown'>-<race>.json` in ares' format, so an ares `data/` folder is reused. `openings.record` is for the runner and must not be called from a bot.
- `onGameEnd(resource, world, results)` on resource definitions and `world.resources.endGame(world, results)`: hooks run synchronously in registration order before the engine's own `onGameEnd`, and a throwing hook doesn't stop the next.
- Types: `BuildTarget`, `BuildOrderStep`, `BuildTaskOptions`, `OpeningDefinition`, `OpeningSettings`, `OpeningRecord`, `OpeningsResource`.

**Changed**
- `buildOrder` accepts strings and objects besides tasks and pairs. A build order without them behaves exactly as before.
- `SystemObject.buildOptions` has the optional `fillWorkers`, and a new game resets it with `paused` and `earmarks`.
- `ResourceDefinition` has an optional `onGameEnd`, and `ResourceManager` has `endGame`.
- A game that crashes or loses its connection doesn't call resource game-end hooks (no opening history is written for it), the same as `createEngine`'s `onGameEnd`.

**Upgrading**
- Nothing breaks; every addition is opt-in and tuple build orders run as before.
- Optional: write the build arrays as strings (`'14 supply @ramp'`), and replace hand-placed ramp walls with the `@ramp` target.
- Optional: move builds into `openings` on the build system, or into `sc-bot.config.json` under `resources.openings` with `openings: 'config'`; set `dataDir` to choose per opponent from history; call `switchOpening` on scouting results.
- Don't call `openings.record`.
- Ares openings that use `tempestgroundattackupgrade` don't parse: that upgrade isn't in the game data.

### API consolidation: one way to do each thing

**Added**
- `distance`, `distanceSquared`, `towards`, `avgPoints` and `closestPoint` exported from the package root.
- `GAME_LOOPS_PER_SECOND` (22.4) in `@sc-bot/core/constants/time`.
- `mining.selectWorker(near, { exclude })`: tags that are never picked.
- Shared unit-type tables in `@sc-bot/core/constants/groups`: `addonHost`, `addonHostTypes`, `creepTumorTypes`, `researcherEquivalents`, `creationAbilityOverrides`.
- `FlyingTownhallRace` (Terran: flying command center and orbital) and `TownhallWithFlyingRace` (each race's townhalls plus its flying ones) in `@sc-bot/core/constants/race-map`.
- `bun run check:data`: fails and names each committed generated file in `constants/` that differs from a fresh `generate:data` run; the test suite runs it too. `generate:data` now formats its output with the repo's biome, so a regeneration on a clean tree leaves no diff, and `CONSTANTS_DIR` changes its target folder.

**Fixed**
- Rich gas buildings (`EXTRACTORRICH`, `ASSIMILATORRICH`, `REFINERYRICH`) are in `gasMineTypes` and the `MINERALFIELD450`, opaque and purifier variants in `mineralFieldTypes`, so `Unit.isGasMine`, `units.getGasMines` and mineral-field consumers cover them.
- `drawDebug` output shows without the `sc2:debug:DebugSystem` env: the debug system flushes whenever `debug.touched` is set.
- A stuck-worker check removes only the worker's `command` label and adds `stuck`; it used to wipe every label, including the bot's own.
- `Units#furthestNUnits(pos, 0)` returns no units (it returned all of them).
- Two build systems no longer share earmarks. Each build system names its earmarks with its own prefix (`build<n>:task<i>`, it was `task<i>` in every system), so a second system's earmark for the same task index is added instead of ignored, and one system spending or switching openings no longer settles the other's earmark.
- `placement.add` on Zerg, which has no placement grids, is a no-op with a debug log; it threw a `TypeError` once the solver had run.
- `unit.isStructure()` returns `false` for a unit type missing from the game data. It threw, which stopped the unit system's step, so every unit after it in the observation got no create, update or events that step.
- A lowered supply depot is pathable (still not placeable) and blocks pathing again when raised; any type change of a ground structure re-marks its pathing cells. A nydus canal leaves its four corner cells pathable, like a townhall, and a burrowed creep tumor its cell.
- Uprooted spine and spore crawlers hold no grid cells: uprooting frees the crawler's footprint and rooting blocks it where it roots.
- A townhall that lifts off stops being its expansion's base, and one that lands on an expansion becomes it, so `ownedExpansions` and `getNextExpansion` follow lift and land.
- `data.findUnitTypesWithAbility(abilityId)` takes a specific or generic id and reads the generated unit abilities (an ability that remaps to `abilityId` counts too), plus the hand-captured `AbilitiesByUnit` map only while the game data marks the ability available. It read only the hand-captured pre-4.10 map, so it returned `[]` for e.g. `BUILD_TECHLAB_BARRACKS`, `BUILD_LURKERDEN` and the armory's plating research, and `[HYDRALISKDEN]` for the unavailable `MORPH_LURKERDEN`. Build-system ability tasks find their casters through it and cast when the unit offers the task's id or one that remaps to it, so generic tasks such as `BUILD_REACTOR` are sent (SC2 only offers the specific ids).

**Changed**
- One cost model: `canAfford`, `actions.train`, `actions.build`, the building tracker and build-runner earmarks use the net cost of `calculateCost`, as `agent.train` already did. Morphs used to be checked and charged at the API's total: an orbital command is now 150 instead of 550, a lair 150/100 instead of 500/100, a baneling 25/25 instead of 50/25; a zergling pair costs 50 instead of 25; a lowered supply depot 0.
- `actions.upgrade` rejects with `TrainError` when the upgrade is unaffordable and deducts its cost, so later systems in the step see the reduced bank.
- `units.getProductionUnits` and `units.getUpgradeFacilities` read `trainedFrom` / `researchedFrom` instead of the API's ability data, so `actions.train`, `actions.upgrade` and the builder find the producer for lurkers (hydralisks), lurker dens (drones), warp-gate units (warp gates) and 24 upgrades that had none (e.g. hallucination, vehicle and ship plating, anabolic synthesis); an add-on is built only by its own host; grooved spines and muscular augments no longer offer the lurker den. `actions.train` warps in from a warp gate, sends `MORPH_LURKER` for lurkers and skips facilities already ordered this step; `actions.upgrade` sends the armory's plating ability.
- `researchedFrom[LURKERRANGE]` (the lurker range upgrade) is the lurker den (was the hydralisk den, which can't research it).
- A build-runner train task settles its own earmark when it trains; it used to keep it, so the next task waited for that money too.
- `agent.alreadyPending` also counts tracked builds whose worker hasn't got its build order yet (still walking, or ordered this step), and counts an unfinished Terran structure once, from the SCV's build order or, with no SCV on it, from the structure. An abandoned unfinished Terran structure (its SCV died) counts as pending until something resumes or cancels it: the building tracker resumes it once the bot has built through it, but bots not using the tracker must resume or cancel it themselves. `ownUnitCount` is finished units plus `alreadyPending` (an unfinished structure used to count twice).
- `agent.canAfford(unitType, earmarkName?, { count = 1, supply = false })` checks `count` units on net cost, and with `supply: true` the supply too.
- `agent.train` (including warp-ins and the second reactor unit) and the `behaviors` spawn controller subtract every earmark from the bank before training (they used `canAffordUnit` / `canAffordN`, which ignored earmarks), so they train nothing while earmarks hold the money.
- `agent.hasTechFor` is `techRequirementProgress >= 1`, so it shares the requirement and equivalent-structure rules with `train`. A plain Hatchery no longer satisfies a Lair requirement (the old alias scan accepted it); a Lair or Hive does.
- `agent.expandNow(unitType?, location?)` builds through `buildings.build(townhall, { at })`, so the build is tracked and the worker walks there. The `maxDistance` parameter is gone (it searched for a placement near the expansion), so the signature went from `(unitType, maxDistance, location)` to `(unitType, location)` and a positional `location` call breaks. It does nothing when the townhall is unaffordable, or while a tracked build of that townhall is still `moving` (BUILD not yet sent) at the target, so calling it every step sends one worker.
- One build-worker fallback for `actions.build` and the building tracker (used when mining is off or, for `actions.build`, finds no one): it only takes `GATHERING` or role-less workers without a `stuck` label that aren't constructing or didn't receive a command this observation, the closest idle or gathering one first, else any. With mining off the tracker used to take any free worker, including a persistent builder or a defender. User labels no longer keep a worker out of the pick, and `actions.build` takes a busy worker instead of rejecting when none is idle or gathering. A Protoss build is still queued on a probe already constructing within 20, now only one in `GATHERING` or no role. A worker `actions.build` picks that carries cargo returns it first.
- A tracked build whose worker stalls (stands still for 10 s away from the target) is re-placed with a new worker, and the stalled worker goes back to `GATHERING`. A build given a `worker`, and a build started with `at` (which fails `'blocked'` instead of being re-placed), get no replacement worker. A second stall fails the build `'blocked'`. Either way, the stalled worker isn't picked by the tracker or `actions.build` for builds of that type for 60 s, with mining on or off. It used to keep the same worker, so a builder outside a sealed main stalled again.
- A tracked build started with `at` is never re-placed by the solver. Where the tracker used to ask the placement solver for a new spot (the spot became unplaceable, `maxAttempts` build commands were dropped or rejected, or the worker stalled), it fails `'blocked'`; it used to move to a solver spot, or fail `'noPlacement'`. A townhall whose spot is blocked still moves to an available expansion, and a gas build still moves off a geyser an enemy took. The build runner retries the task 250 loops after its command once nothing of that type is pending, which resolves the target again.
- Enemy structures block the placement and pathing grids from the step they are seen, with the same footprints as your own (townhall and nydus corners, lowered depots). A structure's cells are freed when it dies, lifts off, or its spot is seen empty, and move when it is seen landed elsewhere; out of vision they stay blocked. Before, only your own structures were on the grids, so `placement.canPlace`, `map.isPlaceable`, `map.isPathable` and `map.path` treated cells under enemy buildings as free.
- `map.setPlaceable` no longer changes `map.path`'s walkability; the path graph follows `setPathable` only, so lowered depots and townhall and nydus corners are walkable for `map.path` too.
- Build-system ability tasks earmark the net cost of what they create (an orbital command 150, a reactor 50/50) and settle it when the ability is sent; while no caster of that type exists the earmark is dropped. They used to earmark the unit data of the ability's own id (a wrong cost, or none) and never settle it.
- Rocks and towers are blocked from the live pathing grid, requested from SC2 once the game has stepped (the grid at game start lacks flat rocks and towers), instead of from known footprints, so diagonal and very large rocks block `isPlaceable` and `map.path` too. A rock's cells are released from the live grid when it dies. The natural's wall is recalculated once, when the first rocks are claimed at game start, if they changed cells it searched. When the request fails, rocks keep their known footprints.
- `map.getExpansionLocations()` returns the townhall center of every expansion in `getExpansions()` order (same coordinates; it came from a separate algorithm that could disagree). `agent.getNextExpansion` and `agent.ownedExpansions` use the same `Expansion` objects: enemy-held expansions are excluded from `getNextExpansion`, a macro hatchery (not assigned as a base) no longer counts as owning its location, and ties between equal pathing distances may resolve in another order.
- Both pairs stay, each for its own purpose: `map.path` is for static map structure (placement, expansion ordering, regions) and `pathing.findPath` for unit movement; `map.getCombatRally()` is a rally point and `mapAnalysis.getDefensivePosition` a choke hold point.

**Removed**
- `frame.timeInSeconds()`. Use `Math.round(frame.time())`; it counts 22.4 loops per second where `timeInSeconds` used 0.044 s per loop.
- `towards` from the combat helpers and from `@sc-bot/core/behaviors`; it comes from the package root.
- `units.getClosest`: use `Units.from(list).closestNUnits(pos, n)`, or `closestTo` when the list is known non-empty (it throws on empty). A list from `units.*` getters is already a `Units`.
- `agent.distributeWorkers`: `mining` is the only worker manager; `workersPerGas` is a `mining` setting.
- `agent.canAffordUnit(type, checkSupply)`: use `canAfford(type, null, { supply: true })` (or without the option when `checkSupply` was `false`), which also subtracts earmarks.
- `agent.canAffordN(type, max)`, which returned how many were affordable: use `canAfford(type, null, { count })`, which answers for exactly `count` and also subtracts earmarks.
- `structurePending` from `behaviors`: use `agent.alreadyPending`.

**Upgrading**
- Import `distance` and `towards` from `@sc-bot/core` instead of local copies, and `GAME_LOOPS_PER_SECOND` instead of a literal `22.4`. Replace `frame.timeInSeconds()` with `Math.round(frame.time())`.
- `agent.alreadyPending` now includes tracked builds whose worker is still walking, so code that counts pending structures no longer misses a build whose SCV is on its way.
- An abandoned unfinished Terran structure (its SCV died) counts as pending until something resumes or cancels it. Code that builds with `actions.build` instead of the building tracker has nothing that resumes it, so its pending count stays one short until it resumes or cancels the structure itself.
- Count finished units as `.ready` plus `alreadyPending`, as `ownUnitCount` does, so an unfinished unit no longer counts twice.
- Don't add `buildings.pending(type)` to `alreadyPending(type)`; it now double-counts.
- `actions.build` calls that pass no worker get the new builder pick (see Changed): a busy worker when none is idle or gathering instead of a rejection, user labels no longer exclude a worker, and a worker that carries cargo returns it before walking to the site.
- `units.getClosest(pos, units, n)` becomes `units.getMineralWorkers().closestNUnits(pos, n)`.
- `canAfford`, `canFeed` and `hasTechFor` keep their signatures. `canAfford` checks the net cost (see Changed), and `hasTechFor` no longer accepts a plain Hatchery for a Lair requirement.
- `agent.train` now returns 0 while earmarks hold the money it needs.
- `isGasMine()` is true on rich geysers now, so gas-worker logic keyed on it runs there too.
- `agent.getNextExpansion` skips enemy-held expansions and `ownedExpansions` ignores macro hatcheries; `map.getExpansionLocations()` keeps its coordinates but follows `getExpansions()` order.
- `agent.getNextExpansion` delegates to `buildings.getNextExpansion()` (center coordinates, no pathing query): it takes the first expansion in `map.getAvailableExpansions()` order instead of the closest by SC2 ground distance, and skips blocked, unsafe and pending-townhall spots. `agent.expandNow()` without a location builds at the picker's corner spot and orders nothing while a townhall build of that type is still `moving`. The picker also skips expansions with no ground path from the main.
- `map.isPathable` is now false under enemy ground structures, so a flying-enemy filter built on it drops a flier hovering over one.
- Train tasks settle their earmarks now (see Changed), so an `earmarkDelay(0)` workaround for train tasks that kept their earmarks can be removed. Earmark names are per build system, which only matters with several build systems.

### Examples

**Added**
- `examples/ares/`: TypeScript ports of the ares-sc2 tutorials (assigning unit roles, combat maneuver, unit squads, custom behaviors, influence and pathing, managing production, build runner, custom building placements, chat debug). Gaps are listed in `examples/README.md`.
- `examples/ares/openings/{terran,protoss,zerg}.config.json`: ares' build-runner openings as core config files, loaded by `examples/ares/build-runner.ts` through `createEngine({ configFile })` (`RACE` picks the file).
- Fixture tests for the ports with their own logic, a parse test for every opening, and `examples/examples.live.test.ts` (ramp-wall, managing-production and build-runner against the built-in AI; skipped without `SC2PATH`).

**Changed**
- `ramp-wall.ts` builds its depots and barracks on `wall` placements through `buildings`, enables `mining` and trains SCVs with `buildWorkers`, and raises and lowers depots with `spatial.anyInRange`; it no longer computes the ramp corners or calls `distributeWorkers`. It exports `createBot()` and runs only when started directly.
- `cannon-rush.ts` builds its own-base pylon and forge with `buildings.build` placement options, trains probes with `buildWorkers` and enables mining; the proxy structures still use `actions.findPlacement`.
- `worker-rush.ts`, `bot-vs-bot.ts` and `ladder.ts` give their workers the role `ATTACKING` and attack-move inside `roles.as(ATTACKING, …)`.
- The tutorial links `examples/tutorial.ts` instead of the old `.js` path.


### Consistency

**Changed**
- Docs reorganised: the readme is a landing page and each topic has one page under `docs/`; the old API reference, overview, design, internals and tutorial pages are retired (merged into the topic pages, [getting started](getting-started.md) and [architecture](architecture.md)).
- `map.isPathable`, `isPlaceable`, `isVisible` and `hasCreep` return `false` and `map.getHeight` returns `0` for points off the grid. Previously an off-grid x returned `true` ("pathable") and an off-grid y threw a `TypeError`.
- `Units.take(n)` with a negative `n` returns an empty collection; it returned `slice(0, n)`, everything but the last |n|.
- `nFurthestToDistance` with a count of 0 or below returns an empty collection.
- `take` and `randomGroupOf` always return a new collection.
- Agent handlers rethrow `GameEndedError` and `ConnectionClosedError`, matching system handlers; before, they were logged with `console.warn`. Other errors are still swallowed.
- The `NodeSC2Error` `name` changed from "NodeSc2Error" to "NodeSC2Error".
- Internal precondition failures throw `NodeSC2Error` instead of a plain `Error` (still `instanceof Error`).
- `runGame` rejects with `NodeSC2Error` when no player has an agent (it threw a `TypeError`), and `createGame` rejects with `NodeSC2Error` (`Could not create a game on ...`) when SC2 doesn't move to the game, so a `createGame` plus `joinGame` caller needs no check of its own.
- `NodeSC2Error`s thrown by system handlers are logged on `sc2:debug:system` (they were on `sc2:silly:system`), so `DEBUG=sc2:debug:system` shows `BuildError`s and `TrainError`s; resources log them on `sc2:debug:resources`.
- A protocol error response and a request on a closed websocket reject with `NodeSC2Error` (a plain `Error` before).
- Command options: `queue` is an option, `actions.attack(units, target, { queue })`, on `attack`, `attackMove`, `move`, `smart`, `patrol`, `gather`, `mine`, `stop`, `holdPosition`, `repair` and `returnResource` (it was a trailing boolean). `actions.build(type, target, { worker })` takes the worker in an options object. `actions.do(units, abilityId, { target, queue })` takes the units first and accepts a `Unit`, a tag or an array of them. `actions.mine`'s parameter is `gasMine`. Update call sites: a stale `true` is a type error.
- Return types say what they return: `map.getMain`, `getNatural`, `getEnemyMain` and `getEnemyNatural`, `data.getAbilityData`, `getUpgradeData` and `getEffectData` and `closestPoint` can be `undefined`; `map.getLocations().self` is `undefined` before the game starts; `frame.getPrevious()` is `GameFrame | undefined`. Nothing returns a different value.
- `buildings.getNextExpansion`, an untargeted townhall step and a townhall retarget skip a spot another active tracked townhall build is heading to, so two builds no longer pick the same expansion.

**Added**
- `new PixelMap(imageData)` takes an `ImageData` (`startRaw.pathingGrid`) directly and throws a `TypeError` when a field is missing.
- `expansion.getMineralFields()` and `expansion.getVespeneGeysers()`: the fields and geysers that are still current. `cluster.mineralFields` and `cluster.vespeneGeysers` stay the game-start snapshot.

**Fixed**
- An event written with `type: 'build'` or `'unit'` reaches the readers created with `'build'`, `'unit'` or `'agent'`; it used to reach none. The delivered event keeps the type it was written with.
