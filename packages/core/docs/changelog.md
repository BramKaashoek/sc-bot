# Changelog
All notable changes to this project will be documented here.
Please note, this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- [Unreleased](#unreleased)
- [v0.8.2 - 2019-01-11](#v082---2019-01-11)
- [v0.8.1 - 2019-01-08](#v081---2019-01-08)
- [v0.8.0 - 2019-01-01](#v080---2019-01-01)
- [v0.7.1 - 2018-12-17](#v071---2018-12-17)
- [v0.7.0 - 2018-12-14](#v070---2018-12-14)

## Unreleased

### core-arch: resource registry and command executor

#### Added
- Resource registry: `world.resources.register({ name, create, reset? })` adds a resource (from a system's `setup`), typed by augmenting `ResourceContainer` in `@sc-bot/core/types`; `world.resources.reset(world)` resets every registered resource in place when a new game starts on the same engine.
- Command arbitration: every unit command is a proposal from a commander (the agent's handlers, or a system by name). At the end of the step the engine keeps one commander per unit (highest priority, then agent handlers, then `agent.use()` order), drops repeats of a unit's current order, merges identical commands and sends one request.
- `commandPriority` as an agent setting and a system option (default `0`).
- `actions.as(context, fn)` runs `fn` under another commander.
- `commandResults` event and `onCommandResults(world, results: CommandResult[])` handler: the step after each flush, per proposal and outcome, `won`, `dropped` (`outranked` with the winner in `by`, or `repeat`) or `rejected` (SC2's `result`, or the request's `error`).
- `queueAction(commands, { onNotSent })`: called during the flush for tags that weren't sent.
- `CommandResult` and `CommandContext` types.

#### Changed
- `actions.attack`, `attackMove`, `move`, `smart`, `patrol`, `gather`, `mine`, `build`, `buildGasMine`, `train`, `upgrade`, `warpIn`, `do`, `stop`, `holdPosition`, `repair`, `returnResource` and the `Unit` shortcuts (`useAbility`, `inject`, `blink`, `burrow`, `toggle`) resolve with `void` once the command is proposed, instead of with `ResponseAction` after SC2 accepted it. They no longer reject when SC2 refuses the command; that is reported through `onCommandResults` and logged on `sc2:debug:actionManager`. Precondition errors (`BuildError`, `TrainError`, `GatherError`, `ActionManagerError`) still reject.
- Commands go out after all systems have run instead of during the step. A command proposed after that flush (from a promise left dangling) goes out with the next step's.
- Conflicting commands for one unit from different systems used to go to whichever request reached SC2 last; now one commander wins per unit.
- Re-issuing a unit's current order (same ability and target, not queued) is never sent; before, only queued commands were checked.
- An empty unit list is a no-op on every high-level command method (`attack`, `attackMove`, `move`, `smart`, `patrol`, `mine`, `do`, `stop`, `holdPosition`, `repair`, `returnResource`): it resolves without proposing anything. `do` used to throw, and `attack`/`attackMove` sent an empty command. Only the raw `actions.queueAction` throws `ActionManagerError` for a command without units.
- A build that is dropped or that SC2 rejects removes the worker's `command` label during the flush, so the worker isn't marked stuck later. Nothing is refunded; the next observation restores the money.
- The macro helpers (`train`, `research`, `distributeWorkers`, `expandNow`) always propose through the queue under the calling commander.
- `actions.sendAction` still sends immediately; the units it commands count as taken for the rest of the observation: a proposal from another commander is dropped unless it strictly outranks the sender; the sender's own follow-ups still go out. `swapBuildings`, `toggleAutocast` and `chatSend` still send immediately.
- A new game on the same engine resets every registered resource (including step times and proposed commands) through the registry.
- Importing the package turns on Bluebird's `asyncHooks` for the whole process, so commanders survive Bluebird callbacks. It costs about 0.1 ms per step.

#### Removed
- The `batchActions` agent setting. Batching is the only mode.

#### Migrating bot/
- Remove `batchActions` from the agent settings if it is set.
- Don't read the value of an `actions.*` command method or `unit.useAbility`; it is now `undefined`. To react to a command SC2 refused, add an `onCommandResults` handler (it sees `won`, `dropped` and `rejected` per command, the step after).
- Same-unit conflicts between the bot's systems now resolve by `use()` order (build, economy, combat, military, log) unless a system sets `commandPriority`. Decide which system should win workers (combat pulling workers against economy, for example) and set `commandPriority` there.
- Code that repeats the same order every step to "refresh" it now sends nothing after the first time; that is intended.
- Code that relied on a command reaching SC2 mid-step (realtime) now sees it go out after all systems finish.
- A command issued after the end-of-step flush, from a promise the handler didn't await, goes out next step.
- A system mounted mid-game with `agent.use()` runs its `setup` and `onGameStart` right away inside the caller, so commands from those are attributed to the caller's commander. From the next step on, it proposes under its own name, ranked after the systems mounted before it.
- To add a bot resource, augment `ResourceContainer` in `@sc-bot/core/types` and register its definition from a system's `setup`.

### parity-2: enemy memory, spatial index, influence and pathing

#### Added
- `memory` resource: ghost expiry (`expireGround` / `expireAir`, 30 game seconds by default), `getGhosts`, `getSnapshots`, `getEnemies`, `forget`, `configure`.
- `spatial` resource: `unitsInRange`, `anyInRange` and `closest` over enemies (ghosts included) and own units, by kind (`enemy`, `enemyGround`, `enemyAir`, `own`, `ownGround`, `ownAir`).
- `influence` resource: ground, air, ground avoidance and air avoidance cost grids from enemy units and effects; `getGrid`, `addCost`, `configure`, `drawDebug`.
- `pathing` resource: `findPath`, `nextPoint`, `closestSafeSpot` and `isPositionSafe` over the influence grids.
- `units.getArmyValue(alliance, { includePending, includeGhosts })`.
- `ResourceDefinition.onStep`: a per-step hook for registered resources, run after the engine systems and before agent code.

#### Changed
- Enemy ghosts now expire. A ghost is deleted after 30 seconds, or as soon as its last position is visible and it isn't burrowed. Before, every enemy that left vision stayed in `units` for the rest of the game.
- A tag that memory forgot and that is seen again fires `onEnemyUnitEnteredVision` but not `onEnemyFirstSeen`.

#### Migrating bot/
- Code that treats `units.getAll(Alliance.ENEMY)` as a permanent record now sees fewer units. To get the old behaviour, raise the expiry with `memory.configure({ expireGround, expireAir })`, for example from a system's `setup`.
- Nothing else breaks: the new resources and `getArmyValue` are additions.

### Phase 3: combat sim, roles, squads, intel

#### Added
- `simulateFight(own, enemy, opts?)` and `canWinFight(own, enemy, opts?)`: a focus-fire fight simulation on per-pair DPS, health plus shields, with `timingAdjust` (default `true`), `workersDoNoDamage` and `maxSeconds` options. `canWinFight` returns ares' 0 to 10 `EngagementResult` scale.
- `@sc-bot/core/constants/engagement-result` (`LOSS_EMPHATIC` to `VICTORY_EMPHATIC`) and `@sc-bot/core/constants/unit-role` (ares' unit roles), also as the `EngagementResult` and `UnitRole` namespaces of `@sc-bot/core/constants/index`.
- `roles` resource: `assign`, `clear`, `switchRole`, `get`, `roleOf`, `getTags`, `as`, `mayCommand`, `configure({ defaultRole, exclusive })`. Workers other than MULEs start as `GATHERING`.
- `squads` resource: `getSquads`, `getMainSquad`, `getMainSquadPosition`, clustered lazily once per game loop.
- `intel` resource: `getBaseThreats`, `getMainThreat`, `has`, `detectedAt`, `getProxies`, `configure`, with sticky flags for worker, ling, roach, ravager, marine and marauder rushes, 4-gate, proxy zealots, proxies, reapers, expansions, greedy openings and `rushed`.
- `enemyStrategyDetected` event and `onEnemyStrategyDetected(world, { flag, gameLoop })` handler, once per flag per game.
- `parseBuildOrder(steps, race)` is documented under Utilities.
- Types: `FightOptions`, `FightSimulation`, `EngagementResult`, `UnitRole`, `RoleSettings`, `RolesResource`, `Squad`, `SquadsResource`, `IntelFlag`, `IntelSettings`, `IntelResource`, `BaseThreat`, `EnemyStrategyDetected`.

#### Changed
- `CommandResult.reason` can be `'not-owner'`: a proposal for a unit in an exclusive role from a commander other than that role, with `by: 'role:<ROLE>'`. Nothing is dropped this way unless `roles.configure({ exclusive })` is set.
- `unit.distanceToWeaponReady()` is 1.4 times larger: it divides by 16 game loops per second instead of python-sc2's 22.4, so it matches the distance the unit really covers before its weapon is ready.

#### Migrating bot/
- An exhaustive `switch` over `CommandResult.reason` needs a `'not-owner'` case.
- Code that compares `distanceToWeaponReady()` against a distance now gets values 1.4 times larger; recheck any threshold tuned on the old value.
- Optional: put army units in a role with `roles.configure({ defaultRole })` (e.g. combat units to `ATTACKING`), and wrap a system's unit commands in `roles.as(role, fn)`.
- Optional: once every system that commands a role's units does so through `roles.as`, list that role in `roles.configure({ exclusive })`.
- Optional: replace hand-rolled engage checks with `canWinFight(own, enemies) >= VICTORY_CLOSE` (or your own threshold).
- Optional: read `intel.has(flag)` or handle `onEnemyStrategyDetected` instead of scouting heuristics, and `intel.getMainThreat('ground')` for base defence.

## v0.8.2 - 2019-01-11
## Highlights:
Another small patch to get out some more important fixes:
- Launcher fixed for OSX
- Fixed 'stuck' workers being exclusively selected for building (oops.. RIP)
- Major map resource / expansion decomposition overhaul
- Initial support for exposing render and feature layer data 

Various other fixes:
- Freeing of squares on the placement grid when a unit is destroyed now actually works
- Associating a new townhall to its base / expansion location also now actually works
- Initial geyser, mineral field, and ramp plate cells now marked as unplaceable and/or unpathable as appropriate
- Fix expansion order and pathing on maps with islands or otherwise full blocked expos
- Fixed calculation of mineral line and behind behind line areas (still not perfect, but a ton better)

Also:
- default stepIncrement for engine systems bumped to 2
- sc2:DebugOnScreen now shows active earmarks
- Added utils/geometry/point getNeighbors()
- Added utils/map/cluster clusterByNeighbor()
- Expansion cluster now takes geyser placement into consideration

## v0.8.1 - 2019-01-08
## Highlights:
Small patch to get out some important fixes
- Fixed path separator issue (thanks MrRacoon!)
- Fixed height calculation just being wrong :)
- added `chatReceieved` event (yay!)
- fixed broken footprint checks (still need to document footprints...)
- builder systems can now build pylons if you really want them to
- added a plate types group (for unbuildable plates at the base of the main ramp)

##  v0.8.0 - 2019-01-01
###  Highlights:
- Initial support for in-engine unit footprinting and placements (footprints look like: { w: number, h: number }, for instance, a mineral field would be { w: 2, h: 1 })
- Initial support for custom maps (or at least the engine shouldn't explode if it doesn't understand map topography or player configuration)
###  Added
- Initial support for unit type systems (good luck figuring it out how it works before i write docs :p)- Added some more proto api enums to the built-ins 
- MORE DEBUG COLORS! yay debugging
- Added `unitHasDisengaged` event
- Constants
  - Added a bunch of group constants for convenience: structuresTypes, flyingStructureTypes, addonTypes, constructionAbilities
  - Added WarpUnitAbility which maps a warp unit to its training ability id.

- Unit Resource enhancements
  - Added support for ALLY type units  
  - `getGasMines(filter: UnitFilter) => Unit[]`  
  - `getConstructingWorkers() => Unit[]` (workers with active building orders)  

- Unit Entity enhancements
  - `canMove() => bool`
  - `isHolding() => bool` - hold position check
  - `canShootUp() => bool`
  - `isStructure() => bool` - this is very literal
  - `isFinished() => bool` - same as filtering u.buildProgress >= 1
  - `isCombatUnit() => bool` - also pretty literal
  - `isConstructing() => bool` - same as filtering u.buildProgress < 1
  - `is(type: UnitTypeId) => bool` - same as filtering unit.unitType === UnitType.FOO
  - `data() => UnitTypeData` - retrieves the static UnitTypeData for the unit type
  - `abilityAvailable(ability: AbilityId) => bool` - checks if an ability is available this frame synchronous
  - `availableAbilities() => Array<AbilityId>` - returns all available abilities this frame, synchronous
  - `getLabel(label) => any` - alias of u.label.get(l)
  - `removeLabel(label) => bool` - alias of u.label.delete(l)
  - `hasLabel(label) => bool` - alias of u.label.has(l)
  - `addLabel(label, component: any) => Map<string: UnitTag, any>` - alias of u.label.add(l, component)
  - `toggle => Promise<SC2APIProtocol.ResponseAction>` - toggles some unit transformation, currently works for warp prism and liberator
  - `burrow => Promise<SC2APIProtocol.ResponseAction>` - currently only works on widow mines (and don't ask how to unburrow them :p)

- Map Resource enhancements
  - `isCustom() => bool`
  - `isPathable(point) => bool` 
  - `isPlaceable(point) => bool`
  - `isVisible(point) => bool`
  - `hasCreep(point) => bool`
  - `freeGasGeysers() => Unit[]`
  - `getEffects() => Effect[]`
  - `getHeight() => number`
  - `getSize() => { w: number, h: number }` (the 2DI map size)  
  - `getCenter(pathable?: boolean) => Point2D` (optionally require the closest pathable point vs absolute center) 
  - `isPlaceableAt(unitType, position) => bool` (this.. surprisingly works pretty well) 
  - Added some functions for internal graph cloning and manipulation  

- Map System enhancements
  - Initial support for calculating wall-offs `onGameStart`. Currently only attempts the natural wall. Check it out with `set DEBUG=sc2:debug:*,sc2:DrawDebugWalls` and retrieve it with map.getNatural().getWall()
  - Added effect events and effect data propegation
    - `onNewEffect`
    - `onExpiredEffect`

- Actions Resource enhancements
  - `warpIn(unitType, opts?: { nearPosition?: Point2D, maxQty?: number, highground?: boolean })`
  - `patrol(u: Unit | Unit[], p: Point2D | Point2D[], queue?: boolean )`

- Frame Resource Enhancements
  - `frame.timeInSeconds()`
  - `frame.getEffects()` (for internal use)

- DataStorage enhancements
  - `getEffectData()`
  - Added additional debugging output for new earmarks

- Debug System added!
  - Handles the state of the Debug Resource
  - try setting `DEBUG=sc2:debug:*,sc2:DebugOnScreen` :)

- System Entity enhancements
  - `pause()`
  - `unpause()`

- Agent Entity enhancements
  - `canAffordN(unitType, maxN) => number` (return the max you can afford)  

- Builder System enhancements
  - Added earmarks (so your build system can still work if other systems are being greedy)  
  - `pauseBuild()`
  - `resumeBuild()`
  - `earmarkDelay()` - adjusts how long the builder waits before earmarking the current task
  - Added on screen build debugging! try it with `set DEBUG=sc2:debug:*,sc2:debug:build`

- `utils/geometry/point` enhancements
  - `createPoint(point)` (floors a Point to an integer for cell use)
  - `createPoint2D(point)` (floors a Point2D to an integer for cell use)
  - `normalize(point)` (for vector normalization)

- `utils/geometry/angle` enhancements
  - `gridsInCircle(centerPoint, radius) => Point2D[]`, returns all map cells in a given radius

- `utils/geometry/plane` enhancements
  - `cellsInFootprint(centerPoint, footprint) => Point2D[]`, returns all Point2Ds in the footprint of a unit

- `utils/map/region` enhancements
  - `frontOfGrid` useful for basically any list of points

- Other enhancements
  - workers can now be labeled as 'stuck' if given a command over 250 frames old with no confirmation that the command could be attempted or errored

###  Changed
- Updated pathfinding dep to a fork with weight support
- Fixed the way tile height is calculated to not be terrible (it's still broken, but less broken)
- Fixed a long standing bug with the event-channel
  - events will no longer be swallowed sometimes when still having readers  

- Constants
Changes are mainly for improving consistency and behavior
  - Added `UnitTypeId`, `AbilityId`, and `UpgradeId` to the main export (these are the reverses, to get the string representation of the ids from the ids - for stuff like labels / debugging)

- Unit Resource enhancements
  - `getById`, `getBases`, and `getStructures` now take consistent filter arguments 
  - `getProductionUnits` now takes into account weirdo aliased mapped units to find producers

- Agent Entity changes
  - `canAffordUpgrade` now properly respects earmarks  
  - Allows adding systems to an agent while a game is running  
  - No longer breaks in custom maps with no well defined "player" or "enemy"  

- Builder System changes
  - `build` tasks now take an extra step to verify the thing they are building has started, to stop derps, before moving on 
  - will now warp in units with a normal `train` task  
  - robustified `ability` to support more scenarios (like terran addons)  

- Map Resource changes
  - Updated `map.path` to allow to inject your own graph weights  
  - Updated the silly `combatRally` function to adjust as you expand (still silly tho)

- Map System changes
  - Fixed exploding on 4 player maps (but still doesn't really support it quite right yet)
  - Updates pathing and placement grids on building changes

- Actions Resource changes
  - Updated `gather` balancing heuristics
  - Updated `build` to try to reuse a nearby builder
  - Updated `build` to actually work properly with weird targets
  - Finally refactored the geyser/mine functions that weren't documented anyway
  - Training a unit properly reduces locally available resources

- Engine Entity changes
  - Added back battlenetmap cache support as a fallback again (by map name if no local version found)

- Debug Resource changes
  - Completely smashed the debug resource and put it back together (a third time now...)
  - Supports creating of arbitrary spheres, lines, and cells, custom labels, heigh, position, etc  

- System Entitiy changes
  - Systems now default to type 'agent' if not specified  
  - Fixed `stepIncrement` not actually affecting anything, should work now  
  - Allow for 'late setup' of systems after game is running  
  - Expose system from wrapper via escape hatch

###  Removed
- Removed phase shifting adept unit type from combat unit types group

##  [0.7.1] - 2018-12-17
### Added
- Initial support added for LADDER MANAGER COMPATIBILITY! Yay, stay tuned for docs
- Terrain height added to map grids
- `randomCirclePoints` added to geometry angle utils (random points within a radius)
- added missing `toDegrees` to geometry angle utilities (to complement `toRadians`)
- Map resouce related features:
  - isPlaceable(point)
  - getHeight(point)
- added missing constant necessary to use chrono boosts

### Changed
- Broke and fixed the debug resource (that isn't documented and no one actually uses yet anyway)... it's almost actually useful now. Soon.
- Fixed builder to not accidentally build things where the nat townhall should go
- The `frontOfNatural` map utility actually does what it's supposed to now (undocumented currently; since removed)
- `actions.attack()` and `actions.attackMove()` now can accept a unit or array of units to add consistency
- `unitEntity#isWorker()` now actually returns true for workers of any race, including mules

##  [0.7.0] - 2018-12-14
### Added
- additional type groups added: `techLabtypes`, `reactorTypes`, `returningAbilities`, `constructionAbilities`
- `units.getUnfinished()` - like `inProgress()` but for all unfinished units
- `distanceX`, `distanceY`, and `subtract` point utilities
- `unitHasEngaged` and `unitHasSwitchedTargets` events
- `hasReactor` and `hasTechLab` unit methods
- `near` unit type requests for terran builder system
- ability to load a non-standard map without the map system exploding
- `actions.swapBuildings` added (for terran addon fun)
- `actions.smart`
- `bluebird`

### Changed
- BREAKING `actions` resource changes:
  - `do` accepts array or a single tag, opts with target of a unit or point
  - `move` now accepts a point2d or a unit as a target
- `actions.buildGasMine` now works on snapshot (but current) geysers
- `actions.gather` now works with mules
- `hasTechFor` now properly includes tech aliases
- launcher correctly ignores port being held by defunct or idle processes
- clarified some tutorial language
- robustifiered terran builder system placement decisions

### Removed
- `delay`
