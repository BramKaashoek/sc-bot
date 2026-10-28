# Compatibility

How this library differs from the projects it draws on: python-sc2 and ares-sc2, which it follows for API shape and behaviour, and node-sc2, the JavaScript library it is a fork of. The last section lists what isn't supported yet. Release-by-release changes are in the [changelog](changelog.md).

## Differences from python-sc2

Where python-sc2 has a bug or its data doesn't match SC2 4.10, this library deliberately does something else:

- **`realSpeed()` off creep.** The off-creep speed bonus (hydralisk, ultralisk) needs that unit's own upgrade. python-sc2 applies it when the player owns any upgrade at all.
- **Blue flame.** `calculateDamageVsTarget()` adds a flat +5 against light targets for your own hellions once the upgrade is done. python-sc2 multiplies the bonus by the attack upgrade level, so it is 0 at level 0. Enemy hellions never get it, since enemy upgrades aren't observable.
- **`nClosestToDistance` / `nFurthestToDistance`.** They sort ascending by how far each unit's plain distance is from the given distance, for points and units alike. python-sc2 sorts in reverse and, for unit positions, compares squared against linear distance.
- **`research()`.** Besides the required building (e.g. an armory for level 2 weapons) it also checks that the previous level is done.
- **Research structures on 4.10.** The dictionaries reflect 4.10 data: `LIBERATORAGRANGEUPGRADE` and `MEDIVACCADUCEUSREACTOR` are researched at the starport tech lab. Newer SC2 versions, which python-sc2's tables follow, moved them to the fusion core. `LURKERRANGE` maps to the lurker den: 4.10 offers it at no structure (its data points at the hydralisk den, which doesn't have it), and newer versions research it there.
- **Build worker selection.** The macro helpers' builder pick (python-sc2's `select_build_worker`) skips an idle worker that already received a command this step. python-sc2 means to, but compares the worker object against a set of tags, so the check never matches.
- **Snapshots on old builds.** On SC2 before 5.0.4 (including 4.10) `isSnapshot()` and the `visible` filter use the visibility grid, because the API misreports `displayType` there. python-sc2 does the same, but reads the grid at the rounded position; this library floors it, like every other grid lookup here, so a unit near a cell edge can be judged by the neighbouring cell.
- **`distanceToWeaponReady()`.** It uses 16 game loops per second, the time base of the movement speeds it multiplies, so it is the distance the unit really covers before its weapon is ready. python-sc2 divides by 22.4 and comes out 1.4 times too short.

## Differences from ares-sc2

Where ares-sc2 does something this library deliberately doesn't, or the reverse.

### Spatial queries, influence and pathing

- **Distances in `spatial`.** Queries measure centre to centre on a bucket grid. ares uses KD-trees, also centre to centre, so results match up to the order of equal distances.
- **Skipped influence sources.** The KD8 charge, parasitic bomb and force field handlers aren't ported, and neither are the climber, air-vs-ground, ground-to-air, tactical and priority grids. Only the ground, air, ground avoidance and air avoidance layers exist, so there is nothing else to query or stamp.
- **Spine crawlers.** They add ground influence (cost 22, range 7). ares has no handler for them.
- **Banelings in ground avoidance.** They are stamped into `groundAvoidance`. ares has code for it, but it never runs, because the weight table is checked first.
- **Float weights.** Influence costs are kept as floats. ares truncates them to integers, which changes costs by less than 1.
- **Inclusive circles.** A cost circle includes the cells exactly at its radius, so at integer radii it can be one ring larger than ares'.
- **Own liberator zones.** Your own liberators' zones aren't stamped. ares stamps every liberator zone, so a Terran army paths around its own liberators.
- **Chokes.** Regions and chokes come from a distance-to-wall watershed on the start pathing grid, not from map_analyzer. Regions aren't split by height; a ramp is linked from the choke it touches (`choke.ramp`). The analysis doesn't react to buildings or pathing changes, and the per-map special cases in ares' defensive third (Oxide, Glittering) aren't ported.

### Combat, squads and intel

- **Combat sim.** `simulateFight` and `canWinFight` are this library's own focus-fire simulation on per-pair DPS, not ares' native sc2_helper simulator. Health counts shields on both sides (ares leaves out your own shields), and there is no `good_positioning` option, since in sc2_helper it only affects splash. Limits: no splash, healing (medivacs, transfuse, repair), spells, terrain, chokes or high ground, bunker passengers or micro; units don't move apart from the `timingAdjust` start delay; a sieged tank's minimum range is judged on the starting positions, so a unit that would walk inside it still gets shelled; upgrade-dependent bonuses (range, attack speed, ...) count for your own units only.
- **Squad merges.** When two squads merge, the smaller joins the larger (the newer the older on a tie), so the main squad keeps its id, and ids are counters (`'ATTACKING-3'`). ares doesn't order the merge by size, and its ids aren't deterministic.
- **Rush flags by unit type.** Intel's rush rules check for the unit types involved, not the enemy race, since only one race has those types.
- **`greedy`.** ares declares the flag but never sets it. Here it is set from townhall start times, with thresholds of our own choosing (`greedyTwoBaseBefore`, `greedyThreeHatchBefore`).
- **Roles aren't labels.** Roles live in the `roles` resource. Unit systems give labelled units special handling, so storing roles as labels would change how every unit with a default role is dispatched.
- **Chat debug.** It only handles your own chat and is off unless `features.chatDebug` is set.

### Behaviors

- **Immediate execution.** `behaviors.run` executes the behavior at once, in the caller's commander context; ares collects behaviors and runs them after the step.
- **Per-owner dedupe.** A unit is ordered once per game loop per owner by `ctx.order`, and the arbiter keeps one owner per unit. ares allows one action per unit across all owners, which would let a low-priority system block a high-priority one here.
- **Factories, one `plan`.** Behaviors are factory functions returning plain objects, with ares' option names in camelCase, not dataclasses. One `plan` replaces `CombatManeuver` and `MacroPlan`, which behave the same.
- **Dropped options.** `smoothing`, `ignored_build_from_tags`, `to_count_per_base` and the `good_positioning` of the combat sim have no counterpart.
- **Siege tank and flyers.** `siegeTankDecision` ignores enemies by their own flying state. ares tests the tank's type, so it never excludes a flyer.
- **`spawnController`.** It doesn't morph units (banelings, ravagers, archons) and validates the composition when you create it, not every step.

### Placement, buildings and mining

- **Terran spots avoid mineral lines.** The solver marks mineral-line cells unbuildable before it scans; ares doesn't ([placement](macro.md#placement)).
- **Natural bunker kernel.** It reserves 5x3 (ares 3x3), and the Protoss wall fallback is measured from the ramp's top (ares: its bottom) ([placement](macro.md#placement)).
- **Flag filters.** `placement.request` takes a list of flags tried in order, with `wall` special-cased, where ares selects by one flag ([placement](macro.md#placement)).
- **Alternatives only at your bases.** A full base falls back to your other occupied expansions, never to others ([placement](macro.md#placement)).
- **No tracker events.** The building tracker is polled and writes no events ([buildings](macro.md#buildings)).
- **Resuming untracked structures is opt-in.** ares always resumes an unfinished Terran structure without a builder; core does it only after `buildings.build` or `buildGas` returned a build in that game ([Resuming](macro.md#resuming)).
- **Low-HP cancel needs damage.** A structure is cancelled only on a step in which its health dropped, as ares' `on_structure_took_damage` does ([Cancelling at low health](macro.md#cancelling-at-low-health)).
- **`buildGas` geyser pick.** It takes the free geyser closest to one of your townhalls ([buildings](macro.md#buildings)).
- **Mining.** Assignments and safe fields are recomputed every step (ares: every fourth), and with `speedMining` mineral workers get `MOVE` plus a queued `SMART`, not `HARVEST_GATHER`/`HARVEST_RETURN` ([mining](macro.md#mining)).

### Creep

- **Kept from ares.** The first tile `nextTumorOnPath` finds is returned unchecked with `findAlternative: false`; it stops at the first path point that passes (no later point is tried when the crowded fallback finds nothing); `minSeparation` doubles as the radius of the alternative search; results are integer tile corners, not cell centres.
- **All townhall types.** The 3.5 enemy and 2.5 own townhall clearances apply to every townhall type (ares: hatchery only).
- **Both tumor orders.** A queen's pending target counts as occupied for `BUILD_CREEPTUMOR` as well as `BUILD_CREEPTUMOR_QUEEN`.
- **Spread gate.** `shouldSpreadTumors` fires when `coverage / 2` loops have passed since it last fired (ares: a modulo of the game loop); every caller in a firing loop gets `true`.

### Build orders and openings

- **JSON, not YAML.** The config file is JSON (`sc-bot.config.json`) with a fixed set of keys, where ares reads YAML. Openings live in that file under `resources.openings` (or in the blueprint), and placements are plain objects with no YAML loader.
- **Strict order, no look-ahead.** A step runs only when every step before it is done; ares may run a later step when minerals are above 470.
- **Fill workers by default.** With supply tuples the builder trains workers until a step's supply is reached, as it always has; ares' supply gate (no insertion, a step waits for its supply) is `buildOptions.fillWorkers: false`, and an opening with `constantWorkerProductionTill` sets it.
- **Proxies use query placement.** An enemy-side or `MAP_CENTER` target is placed with `actions.findPlacement`, not the solver ([Build targets](build-orders.md#build-targets)).
- **No gas-steal step.** `GAS` always builds on your own geysers, even with a target, and nothing reacts to the enemy taking your gas. The overlord-spot follow-up after an overlord scout isn't ported, and the Protoss build doesn't start at `supply - 1`.
- **Scout waypoints.** Waypoints the inset pushes outside the region are dropped, where ares keeps them ([Build targets](build-orders.md#build-targets)).
- **`NAT_WALL` with enemies at the main ramp.** It keeps its wall flag, where ares drops it ([Build targets](build-orders.md#build-targets)).
- **Unknown upgrades.** A step naming an upgrade that isn't in the game data fails at game start; see [String steps](build-orders.md#string-steps).
- **Example ports.** The ports of the ares tutorials (see [examples/README.md](../examples/README.md)) leave out what core has no API for: `find_low_priority_path`, `GateKeeper` positions and the `FirstPylon` key, and `to_count_per_base` (`toCount` instead). Each port's list is in that file.

## Changes compared to node-sc2

The changelog covers the command-return change, command arbitration, `swapBuildings`, empty-list no-ops, enemy memory expiry, live rock blocking, per-game resets and the removed API; this section lists the rest.

Bug fixes that changed a signature or a failure mode:

- `units.getByTag(tag)` returns `undefined` for an unknown tag (it used to return the tag string). The array form leaves unknown tags out and returns `Units`.
- Every `units.*` getter, including `getByTag(tags)`, returns `Units` instead of a plain array.
- `actions.attack` rejects with `ActionManagerError` when the target is missing, and `actions.attackMove` when no position is given and no enemy start location is known, instead of throwing a `TypeError`.
- `actions.gather` rejects with `GatherError` when there is no completed own base to mine at, instead of crashing.
- `actions.warpIn` rejects with `ActionManagerError` when there is no free warp-in point.
- Event handlers are called as `(world, data, event)`, apart from the system hooks listed under Events in [Agents](agents.md). `onUnitTypeChanged` and `onUnitTookDamage` pass a single payload object.
- `createEngine({ onGameEnd })` is now called. Leaving a game (including `surrender()`) ends it as a silent `DEFEAT` instead of logging "no result data".
- `map.getThirds()` / `getEnemyThirds()` never contain `undefined`. Maps without a natural wall or without known enemy start locations no longer throw during setup.
- Requests that SC2 answers with an error, and requests still pending when the connection closes, now reject. They used to never settle, which hung the game loop.
- A game SC2 can't create rejects `runGame` and `runBotVsBot` with SC2's error (e.g. `Could not create a game on "<map>" (InvalidMapName): ...`). It used to hang or fail later with a misleading error.
- A realtime game whose SC2 connection closes rejects with `ConnectionClosedError` instead of resolving `[world, undefined]`.
- `onNewEffect` and `onExpiredEffect` fire only when an effect appears or ends. The checks were inverted, so both fired for effects that were still active.
- `agent.hasTechFor` (and with it `actions.build` and `actions.train`) now requires a ghost academy for ghosts, an armory for thors and a fusion core for battlecruisers, which 4.10's data leaves out. Before, they were treated as having no requirement.
- `unit.burrow()` burrows every unit that can burrow (it used to handle only widow mines), and `unit.toggle()` switches every two-way morph (it used to handle only warp prisms and liberators).
- In a build order of `[supply, task]` pairs, a `train` task with a list of unit types no longer crashes; it counts the largest supply cost among them.
- With `createEngine({ launch: false })` or under a ladder manager, a map name is sent as a Battle.net map name instead of being resolved against a local install. A map name that isn't found locally logs a warning before falling back to Battle.net.
- Point targets with `x === 0` are no longer silently dropped by `actions.do`, `smart`, `move` and `build`.
- `units.clone()` keeps each unit's labels.
- The agent's own `onGameStart` and `onStep` now also receive `(data, event)` after `world`, and `onGameStart` keeps an `agent.opponent.id` set before the game (it used to wipe the ladder's `--OpponentId`). Under a ladder manager the engine sets the id from `--OpponentId` at setup only when it is passed, so a preset id survives otherwise.
- Units whose death SC2 reports are labelled `dead` as before, and dead own and enemy units are now also removed from the unit store (enemies are otherwise kept as memory).

Type changes that can stop existing code from compiling:

- The `Agent`, `Unit`, `UnitResource`, `MapResource`, `FrameResource`, `ActionManager`, `Debugger` and `Engine` interfaces gained required members. Code that builds its own objects of these types (test doubles, for example) has to implement them.
- A variable typed by a `units.*` getter is now `Units`. Reassigning it from `filter`, `map` or `flatMap` with a unit callback, `slice`, `reverse` and the other `Units` methods still works, but `workers = []`, `workers = Array.from(...)`, `workers = [...workers]` or a `Unit[]` from elsewhere don't; annotate the variable as `Unit[]` or wrap with `Units.from()`.
- `units.getByTag(tag)` is `Unit | undefined`, and `expansion.getBase()` is `Unit | undefined` (no base on the expansion).
- `Grid2D` is `number[][]` (it was `Array<Uint8Array>`).
- `debug.createUnit` takes `{ unitType, quantity?, pos?, playerId? }` or an array of them; the proto `owner` field is `playerId`, and arrays of arrays are gone.
- `createSystem` types its blueprint as `UnitSystemObject | BuildSystemObject | GeneralSystemObject`, so a `type: 'unit'` or `type: 'build'` blueprint gets its own `onStep` signature; a value typed `EventReader<SystemObject>` is still accepted.
- The `opts.near` of a build task is a unit type (it was declared `boolean`), and `BuildHelper` is the union of the task functions instead of `(...args: any[]) => BuildTaskI`.
- `actions.patrol` takes a `[from, to]` pair or a single point (it was declared as an array of pairs).
- `data.getEarmarkTotals` returns a `Cost`, `engine.createGame` may resolve `undefined`, and the `frame._previous`, `_observation`, `_gameInfo`, `_score`, `_render` and `_feature` fields can be `null`.

## Known limitations

- **Overlord and scout spots** are not implemented.
- **Not ported from ares.** Transfuse, queen creep and inject, creep tumors, nydus, restore power, Protoss static defence, and the archon, baneling and ravager morphs. There is no Zerg production controller.
- **Zerg placement.** Zerg has no precomputed spots (see [placement](macro.md#placement)), so `buildStructure` and `productionController` return `false` for Zerg.
- **Placement** does no burrowed-unit or blocked-spot detection beyond the placement grid.
- **Mining** has no vespene boost, and speed mining is weaker at the default step of 4 game loops than at 2 or 1.
- **Launcher.** It waits for a freshly started SC2 to listen on its port without a timeout, and SC2 under WSL isn't discovered.
