# cs-public: cross-surface consistency audit of the @sc-bot/core public API

Read-only audit. Code wins over docs. HEAD a8b1f38 plus the dirty working tree (other agents are adding not-implemented stubs to types.ts / influence / intel / pathing / buildings / behaviors during this audit; see "In-flight" at the end). Line refs are packages/core unless prefixed `bot/`. types.ts lines past ~860 may have shifted in the dirty tree.

Already handled and not re-reported: consolidation.md CN-C01 removals (getClosest, distributeWorkers, expandNow rebuild, structurePending, canAffordUnit/N, hasTechFor), CN-C02 root point helpers + GAME_LOOPS_PER_SECOND, and the "Checked, no action" list (gather vs mine, enemy queries units.* vs memory, army value vs supply, command bypasses, placement.request vs actions.findPlacement, labels vs roles, config precedence, getThirds vs getDefensiveThird, alreadyPendingUpgrade vs pendingOrComplete, Q1 map.path vs pathing split, Q11 rally vs defensive position).

Blast radius format: `bot N / ex N / core N` = hit lines in bot/, packages/core/examples, and packages/core non-test source (tests excluded). Counts are regex line hits, so approximate; "0" is reliable.

## Summary

| id | sev | title |
|---|---|---|
| PUB-01 | high | Command calls signal refusal four different ways (throw / 0 / false / undefined) |
| PUB-02 | high | NodeSC2Error subclasses are logged at a level the bot never enables; plain Errors are louder |
| PUB-03 | high | Default `queue` is true for gather/mine/toggle, false for every other command |
| PUB-04 | high | UnitResource default alliance scope differs per getter (getById own, getByType all) |
| PUB-05 | high | Townhall coordinate: `Expansion.townhallPosition` is the floored cell, helper APIs return centre (+0.5) |
| PUB-06 | high | Timestamps mix game loops and seconds with no naming signal |
| PUB-07 | high | `map.isPathable`/`isVisible`/`hasCreep`/`getHeight` crash or lie out of bounds; siblings clamp |
| PUB-08 | high | `units.getWorkers()` silently drops workers carrying the internal `command` label |
| PUB-09 | high | Units lookups throw plain Error on empty; getters (`first`, `random`, `center`) throw too |
| PUB-10 | med | `furthestNUnits` returns ascending order; `nFurthestToDistance(.., 0)` returns everything |
| PUB-11 | med | "Not found" shape: undefined / null / false / [] / goal / throw across placement, pathing, expansion, ramp |
| PUB-12 | med | Return types lie: non-optional signatures that return undefined or throw |
| PUB-13 | med | Two unit-data readers disagree (Zerg structure mineralCost -50) |
| PUB-14 | med | `agent.canAfford` is a predicate that mutates (settles the earmark) |
| PUB-15 | med | Same concept duplicated on agent and map (expansions); `OwnedExpansion` vs `Expansion` |
| PUB-16 | med | Duplicate / overlapping events fire for one occurrence |
| PUB-17 | med | `agent.train`/`research` vs `actions.train`/`upgrade`: same verb, different semantics; research vs upgrade naming |
| PUB-18 | med | Unit predicates: `orders.some` (any order) vs first-order-only, and `Units` getters disagree with `Unit` methods |
| PUB-19 | med | `Unit.isConstructing()` means "worker has a build order", not "structure under construction" |
| PUB-20 | med | Sync vs async: command-queueing calls are `async` with sync bodies; sibling resources are sync |
| PUB-21 | med | Option object vs positional params for the same concept (queue, worker, earmark, realtime) |
| PUB-22 | med | Three argument orders for "issue an ability" (actions.do, ctx.order, Unit.useAbility) |
| PUB-23 | med | Coordinates: `map.path`/`Expansion.pathFrom*` are `[x,y]` tuples; everything else `{x,y}`; proto optional points leak |
| PUB-24 | med | Grid polarity and duplicate grid queries (isPathable/inPathingGrid, 0=pathable vs 1=placeable) |
| PUB-25 | med | Settings/params in seconds vs loops; health percent vs fraction; speed per 16-loop second |
| PUB-26 | med | `getAll`/`getByTag` include dead and stale units; `getAlive` means "seen this loop" |
| PUB-27 | med | Internals exposed on public interfaces (`_fields`, `set*` mutators) |
| PUB-28 | med | Stub methods typed as callable but throw "not implemented" (in-flight) |
| PUB-29 | low | Position parameter naming: near / at / closestTo / base / from / nearPosition / center |
| PUB-30 | low | Positional argument order in Units distance helpers (`closerThan(distance, pos)`) and name pairs |
| PUB-31 | low | Squared-distance params: two spellings, mixed with plain distances |
| PUB-32 | low | Vocabulary drift: building/structure, gas/geyser/mine, base/townhall/expansion, pending/unfinished/in-progress |
| PUB-33 | low | Supply fields exist twice (`foodCap` proto vs `supplyCap` accessor); bot uses both |
| PUB-34 | low | Behavior option vocabulary (toCount/maximum/maxPending/maxOnRoute, extraRange/bonusDistance, group naming) |
| PUB-35 | low | Root exports are a partial slice of the point helpers; `center` lives in behaviors; empty-input behavior differs |
| PUB-36 | low | Tag-vs-Unit parameters and tag-collection return types vary |
| PUB-37 | low | `configure()` has no getter, validates only in mining, defaults exported only for influence |
| PUB-38 | low | Constants naming: `UnitTypeId` type vs const, `*Race` maps vs `*Types` arrays, numeric vs string statuses |
| PUB-39 | low | Typed `Unit[]` where runtime returns `Units`; `Unit[]` vs `Units` across surface |
| PUB-40 | low | Units aliasing: `take`/`randomGroupOf` return `this`; in-place `sort`/`reverse` vs copying `sorted` |
| PUB-41 | low | map expansion accessors: `getExpansions(alliance)` handles ENEMY only; Enemy* duplicates; ramp getter names |
| PUB-42 | low | Unit method naming: `getLife`/`getLabel` vs `age()`/`data()`; `isEnemy` without `isOwn`; `is(type)` |
| PUB-43 | low | `createGame` positional `realtime`; `createPlayer(settings, entity)` |

Count by severity: high 9, med 19, low 15 (43 total).

---

## PUB-01 high: refusal signalling differs per call family

Sides:
- Throws: `actions.build` BuildError (actions.ts:393,400,420,427,456), `actions.train`/`upgrade` TrainError (:499-566), `actions.warpIn`/`attack`/`attackMove`/`swapBuildings` ActionManagerError (:585-601,:211,:228,:251), `actions.gather` GatherError (:260,:285).
- Returns a number: `agent.train` returns 0 on missing tech / unaffordable / no producer (macro.ts:388-394,437,461).
- Returns boolean: `agent.research` false (macro.ts:489-508), but plain `Error` for an unknown upgrade (:484).
- Returns undefined: `buildings.build` / `buildGas` (buildings.ts:162-205), `placement.request` (placement.ts:506), `mining.selectWorker`.
- Silent void: `agent.expandNow` returns when no location or unaffordable (macro.ts:372-384).
- Behaviors return boolean "did something".

Impact: the same intent ("build a depot") has a throwing path (actions.build, used by the bot, bot/systems/economy.ts:41, production.ts:64, wall.ts:35,40,49) and a non-throwing path (buildings.build). A caller copying one pattern to the other either crashes the handler or ignores failure.

Options:
- a) Rule "actions.* throw, every higher layer (agent, buildings, behaviors) returns a value", documented, and fix the outliers: `agent.research` unknown upgrade returns false, `expandNow` returns the TrackedBuild or undefined.
- b) Every refusal returns a result (`{ ok, reason }`); actions.* stop throwing for refusals (BuildError for "cannot afford" becomes a return). Breaks all `await actions.build` error handling.
- c) Document only.
Recommend a.
Blast: bot actions.build 5, actions.train 2, agent.train 1 (bot/systems/military/training.ts:33); ex 1 train; core: agent/macro.ts + behaviors.

## PUB-02 high: NodeSC2Error handler errors are logged at `sc2:silly:system`

Evidence: systems/create-system.ts:121-130 (step handlers) and :136-146 (event handlers) route `NodeSC2Error` to `debugSilly` (`sc2:silly:system`, :123/:138) and every other Error to `debug` (`sc2:debug:system`, :129/:144). bot/index.ts:14 enables only `sc2:debug:system` with the comment "system errors are only reported through debug()". So every BuildError / TrainError / GatherError / ActionManagerError thrown by the bot's `await actions.build/train/gather/mine` is invisible, while a plain TypeError from the same handler is visible. Operational refusals are quieter than programmer bugs, inverted from what a bot author wants.

Options:
- a) Log NodeSC2Error at the same `debug` level (one-line change per branch).
- b) Add an `onSystemError(world, err)` hook / `systemError` event so bots can route them.
- c) Status quo.
Recommend a (+ b later).
Blast: behavior change only; bot 0 catch blocks, ex 0, core 33 `catch` sites unaffected.

## PUB-03 high: default `queue` differs per command

- true: `actions.gather` queue=true (actions.ts:256), `actions.mine` queue=true (:300), `Unit.toggle` `{queue: true, ...options}` (create-unit.ts:124-128).
- false: `actions.move` (:174), `smart` (:156), `patrol` (:192), `attack` (:208), `attackMove` (:224), `stop`/`holdPosition`/`repair`/`returnResource` (:616-627), `Unit.useAbility` (create-unit.ts:584 via `do`, `queue || false` at actions.ts:144), `ctx.order` (behaviors.ts `queue = false`).
- `actions.gather` additionally rewrites `queue=false` to true when the unit has a `command` label (actions.ts:263-266).

Impact: `actions.gather(unit)` on an idle worker queues behind its current order; `actions.move(unit, p)` replaces. Easy to assume one default.
Options:
- a) All default false; gather/mine/toggle callers pass `queue: true` explicitly (python-sc2 `queue=False` default).
- b) Keep, rename the two to make the queueing explicit.
- c) Document.
Recommend a.
Blast: bot actions.gather/mine 3 (bot/systems/economy.ts:10,13,17), ex gather/mine 2; no caller passes queue (bot `queue:` 0, ex 0). Behavior change for those 3 bot calls: gather would replace the order instead of queueing.

## PUB-04 high: default alliance scope per UnitResource getter

| getter | default scope | file:line |
|---|---|---|
| getById(ids, filter) | SELF | units.ts:138 |
| getByType(ids) | all alliances (getAlive() with no filter) | units.ts:213-219 |
| getBases, getCombatUnits, getStructures, getGasMines | SELF | units.ts:109,158,98,75 |
| getUnfinished(filter) | all alliances | units.ts:106 |
| inProgress(id) | SELF | units.ts:101 |
| getMineralFields, getGasGeysers | all (neutral in practice) | units.ts:69,72 |
| withLabel | all | units.ts:210 |
| getAlive(), getAll() | all except ALLY | units.ts:128-134 |

Also the filter parameter type differs: `getBases/getCombatUnits/getAll/getAlive/getGasMines` accept `number | UnitFilter` (alliance shorthand), `getById/getStructures/getMineralFields/getGasGeysers/getUnfinished` accept `UnitFilter` only (types.ts:319-345) although the runtime path is identical. `getById` vs `getByType` is the same query with different defaults (getByType returns enemy units of those types).
Options:
- a) Remove `getByType` (getById covers it), make every typed getter default SELF, accept the number shorthand everywhere.
- b) Keep both, rename `getByType` to `getAllById`/document, unify types.
- c) Leave.
Recommend a. getByType has 0 callers outside core.
Blast: getByType bot 0 / ex 0 / core 4 (map.ts:114 depends on all-alliances); getById bot 10 / ex 14 / core ~33; getUnfinished/inProgress external 0.

## PUB-05 high: townhall coordinate convention

- `Expansion.townhallPosition` = floored grid cell (utils/map/townhall.ts:20 comment, :65 `add(placement, 0.5)` vs start location; create-expansion.ts:12).
- `Unit.pos` of a townhall = centre (x.5).
- `map.getExpansionLocations()` (map.ts:438), `agent.ownedExpansions().location` (macro.ts:364), `agent.getNextExpansion()` (macro.ts:349) return `townhallCenter` = +0.5 (townhall.ts:21).
- `expandNow` passes the centre into `buildings.build({ at })` (macro.ts:385); `expansionController` passes `expansion.townhallPosition` (structures.ts, `buildings.build(townhallType, { at: expansion.townhallPosition })`) and `placement.canPlace(townhallType, at)` with the floored cell.
- `placement` `base` and `BaseThreat`/intel keys use the floored cell; `mapAnalysis.getDefensivePosition(base: Expansion | Point2D)` takes either.
- consolidation.md CN-B04 states `getExpansionLocations equals getExpansions().map(townhallPosition)`; the code applies +0.5, so that AC is not what is implemented (flagging, not re-deciding).

Impact: any `===` / key comparison between `townhall.pos` and `expansion.townhallPosition` silently fails; `distance < 1` tolerates it. Two coordinates for one townhall are reachable from the same resource.
Options:
- a) `townhallPosition` becomes the centre everywhere (matches Unit.pos); delete `townhallCenter`; placement base keys adapt. Large change.
- b) Keep the floored cell, add `Expansion.townhallCenter` (or getter) and make every helper (getExpansionLocations, ownedExpansions, getNextExpansion, expandNow, buildings.build `at` for townhalls) use one named convention; document `townhallPosition` as "grid cell".
- c) Rename `townhallPosition` to `townhallCell` so the convention is in the name.
Recommend b (smallest blast, removes the ambiguity at the API edge).
Blast: townhallPosition bot 13 / ex 7 / core 49; townhallCenter core 6; getExpansionLocations core 1; getNextExpansion/ownedExpansions bot 0 / ex 0 / core 7.

## PUB-06 high: timestamps in loops vs seconds

Seconds: `Placement.reservedAt` (placement.ts:551,559 `frame.time()`), `OpeningRecord.duration` (openings.ts:180), `Unit.age()` (create-unit.ts:581), `frame.time()`.
Loops: `TrackedBuild.requestedAt` (buildings.ts:141), `FlightPlan.startedAt` (flying.ts:81), `intel.detectedAt` (intel.ts:253) and `EnemyStrategyDetected.gameLoop`, `Unit.lastSeen` (create-unit.ts:89), `SystemEvent.gameLoop`, `frame.getGameLoop()`.
Only the event fields carry a unit in the name. A bot subtracting `placement.reservedAt` from `frame.getGameLoop()` is off by 22.4x. `buildings.timeout` compares `loopsToSeconds(loop - requestedAt)` (buildings.ts:397), i.e. the unit conversion is hand-rolled per site.
Options:
- a) Rename with unit suffix: `reservedAtSeconds` / `requestedAtLoop` / `startedAtLoop` / `detectedAtLoop`.
- b) Stored timestamps are always game loops (convert Placement.reservedAt, keep `duration` as seconds because it is a persisted ares-format field); seconds only in settings and `time()`/`age()`.
- c) Branded `GameLoop` / `Seconds` types.
Recommend a+b.
Blast: bot `.age()` 1 (bot/systems/combat/offense.ts:23), `lastSeen` 0, requestedAt/reservedAt/startedAt/detectedAt outside core 0; ex `.time()` 2.

## PUB-07 high: out-of-bounds behavior across grid queries

- `map.isPathable` (map.ts:74-77): `_grids.pathing[y][x]`; y out of range throws TypeError (undefined[x]); x out of range returns true (`!undefined`), i.e. "pathable". Same pattern in `isPlaceable` (:84), `isVisible` (:97), `hasCreep` (:105), `getHeight` (:217).
- `PixelMap.get/isSet` throw RangeError/TypeError (utils/pixel-map.ts:108-111); `map.inPathingGrid`/`inPlacementGrid` (map.ts:447-452) inherit that.
- `InfluenceGrid.get` returns `Infinity` (influence.ts:59), `mapAnalysis.getRegion` returns undefined, `isInChoke` false (map-analysis.ts:203-216).
bot/systems/combat/utils.ts:13-19 `isGroundReachable` probes `map.isPathable` at `pos ± GROUND_REACH` and will cross the map edge for units near the border.
Options:
- a) All point predicates bounds-check: out of bounds is `false` (pathable/placeable/visible/creep) and `getHeight` returns 0/undefined; PixelMap keeps its strictness (internal).
- b) Add `map.isInBounds(point)` and document that callers must guard.
- c) Leave.
Recommend a.
Blast: isPathable bot 1 / ex 0 / core 12; other predicates core only.

## PUB-08 high: `getWorkers()` hides workers with the internal `command` label

units.ts:166-176: `getWorkers(includeBusy = false)` filters out any worker whose labels include `command` (set by `actions.build` at actions.ts:467 and by the tracker). `getIdleWorkers` builds on it (units.ts:180); `getMineralWorkers` additionally requires zero labels of any kind (units.ts:186) so a user label hides a miner; `getConstructingWorkers` uses `getWorkers(true)`. The parameter name does not say what "busy" is, and 'command' is an internal label the bot never sees.
bot/index.ts:47 prints `units.getWorkers().length` as "workers"; it under-reports while any build command is in flight.
Options:
- a) Default to all workers; add `getAvailableWorkers()` for the filtered view.
- b) Make the filter explicit (`getWorkers({ excludeBusy: true })`).
- c) Document.
Recommend a.
Blast: getWorkers bot 2 / ex 5 / core 6; getIdleWorkers+getMineralWorkers bot 2 / ex 1 / core 3.

## PUB-09 high: Units empty-collection semantics

Throw plain `Error` on empty (units-collection.ts:366 `assertNotEmpty`): getters `first` (:97), `random` (:102), `center` (:107); methods `closestDistanceTo`, `furthestDistanceTo`, `closestTo`, `furthestTo`, `inClosestDistanceToGroup` (:230-291), `inDistanceOfGroup` throws if `other` empty (:279), `byTag` throws (:198).
Return undefined/fallback: `findByTag` (:194), `randomOr(fallback)` (:210), `spatial.closest` (spatial.ts:55), `units.getByTag` (units.ts:144), `pickEnemyTarget` (behaviors/combat/helpers.ts:24).
Return empty: `closestNUnits`, `take`, `randomGroupOf`.
Property getters that throw are the worst case: `units.getIdle().first` crashes a handler with a message that names no unit type.
Options:
- a) Lookups return `Unit | undefined` (`first`, `random`, `closestTo`, `furthestTo`), measures return `Infinity`/`NaN`-free defaults, `center` returns undefined. Aligns with findByTag/spatial.closest.
- b) Keep throwing but throw a typed `NodeSC2Error` subclass; add `firstOr`, `closestToOr`.
- c) Document.
Recommend a.
Blast: `.closestTo|furthestTo` bot 1 (bot/systems/combat/micro/basic.ts:51) / ex 1 / core 21; `.random` ex 2 / core 1; `.first`/`.center` bot 0 / ex 0.

## PUB-10 med: Units distance-extremes ordering and zero count

- `furthestNUnits(pos, n)` = `sortedByDistanceTo(pos).slice(-n)` (units-collection.ts:274): ascending order, so index 0 is the n-th furthest, not the furthest. `closestNUnits` returns nearest first. `furthestTo` returns THE furthest, `furthestNUnits(pos, 1)[0]` agrees only for n=1.
- `nFurthestToDistance(pos, d, n)` = `slice(-n)` (:298) with no guard, so `n = 0` returns every unit (the same bug CN-B05/B-7 fixed for `furthestNUnits`, left in the sibling).
Options: a) `furthestNUnits` returns furthest-first (reverse), guard `nFurthestToDistance` for n<=0; b) guard only; c) document ascending.
Recommend a. Blast: furthestNUnits bot 0 / ex 0 / core 0 external; nClosest/nFurthest bot 0 / ex 0 / core ~6 (mostly closestNUnits).

## PUB-11 med: "not found" shape

| call | not-found result | file:line |
|---|---|---|
| actions.findPlacement | `false` | actions.ts:386 |
| actions.canPlace | `false` | actions.ts:333 |
| placement.request | `undefined` | placement.ts:506 |
| placement.canPlace / map.isPlaceableAt | boolean | placement.ts, map.ts:396 |
| agent.getNextExpansion | `null` (async) | macro.ts:358 |
| map.queryPathing | `null` (async) | map.ts:460 |
| map.path | `[]` | map.ts:462-488 |
| pathing.findPath | `[]` | pathing.ts:65 (dirty tree) |
| pathing.nextPoint | returns `goal` | pathing.ts:79 (dirty tree) |
| pathing.closestSafeSpot | `undefined` | pathing.ts:97 (dirty tree) |
| map.getMainBaseRamp / mapAnalysis.getEnemyMainRamp | `undefined` | map.ts:417, map-analysis.ts:310 |
| Ramp getters (barracksInMiddle, depotInMiddle, protossWallPylon...) | `null` | utils/map/ramp.ts:66-111 |
| map.closestPathable | throws Error | map.ts:164 |
| map.getClosestExpansion | always returns an Expansion | map.ts:169 |
| units.getByTag / Units.findByTag | `undefined` | units.ts:144 |
| data.getUnitTypeData | throws TypeError | data-storage.ts:41-43 |

Two of these are paired: `actions.findPlacement` (false) is consumed by `placement.request` consumers (undefined). The bot does `if (position)`, which works for both, but `position !== undefined` or `?? fallback` breaks on `false`. `null` appears only where the async/Promise layer is (queryPathing, getNextExpansion) and in Ramp.
Options:
- a) Rule: absence is `undefined` everywhere (`false`/`null` become `undefined`; `[]` only for list-returning calls). Ramp getters change null to undefined.
- b) Keep per-family, document the table.
- c) Absence is `null` everywhere.
Recommend a.
Blast: findPlacement bot 2 / ex 1; `actions.canPlace` bot 0 / ex 0 / core 2; getNextExpansion bot 0 / ex 0 / core 7; Ramp getters bot 2 (bot/systems/log.ts:34 `ramp?.cornerDepots`), wall.ts.

## PUB-12 med: return types that lie

- `map.getNatural` / `getEnemyNatural` / `getMain` / `getEnemyMain` typed `Expansion` (types.ts:440-443) but return `_expansions[n]` (map.ts:123-134), undefined on custom maps (`isCustom()`); core itself writes `getNatural() ?? getMain()` (map.ts:237).
- `map.getLocations().self` typed `Point2D`, `null!` before game start (map.ts:57-60).
- `data.getUnitTypeData` typed non-undefined, TypeErrors on an unknown id (data-storage.ts:41-43); `getAbilityData` typed non-undefined, returns undefined via `?.[id]` (:56); `getUpgradeData` (:53) and `getEffectData` (:59) index bare, so undefined for a missing id.
- `closestPoint(pos, [])` typed `Point2D`, returns undefined (utils/geometry/point.ts:98-103); `avgPoints([])` returns NaN.
- `frame.getObservation/getRender/getFeatureLayer/getGameInfo` typed non-null via `!` before the first frame (frame.ts:17-31).
Options: a) make types honest (`| undefined`) and add `requireX` variants; b) throw a typed error at the call and keep the type; c) leave.
Recommend a for natural/getUnitTypeData/closestPoint, b for frame getters.
Blast: getMain/getNatural/... bot 5 / ex 0 / core ~9; getUnitTypeData bot 2 / ex 0 / core 15; getAbilityData core 9; closestPoint/avgPoints bot 0 / ex 0.

## PUB-13 med: two unit-data readers disagree

`world.data.getUnitTypeData(id)` subtracts 50 minerals from Zerg structures (data-storage.ts:44-49); `world.data.get('units')[id]` (raw, used in core 9 places incl. agent/create-agent.ts:62, `Unit.typeData(id)` create-unit.ts:259) does not. `Unit.data()` (create-unit.ts:169) is the adjusted one. So `unit.data().mineralCost` and `unit.typeData(unit.unitType).mineralCost` differ by 50 for a Zerg structure, and `data.mineralCost(id)` (:62) is adjusted. `agent.calculateCost` re-subtracts the drone for Zerg structures itself (create-agent.ts:78-79), so one path adjusts twice if it went through getUnitTypeData.
Options: a) `getUnitTypeData` returns raw API data; net/adjusted cost only from `agent.calculateCost`; b) rename the adjusted reader (`getNetUnitTypeData`); c) document.
Recommend a. Blast: getUnitTypeData bot 2 (bot/systems/military/production.ts:54,113; Terran, unaffected) / core 15; `.data()` bot 1 / ex 1 / core 11; typeData core 4.

## PUB-14 med: `canAfford` mutates

create-agent.ts:170-177: `canAfford(type, earmarkName, opts)` calls `data.settleEarmark(earmarkName)` when it returns true (also `canAffordUpgrade` :178-182). A `can*` predicate with a side effect: polling it with an earmark name releases the reservation without spending. macro.ts:242 documents the non-settling `affordable` as the internal variant; the public one is the settling one.
Options: a) predicate never settles; add `agent.spend(type, earmarkName)`/`settle`; b) rename to `tryReserve`/`afford`; c) document.
Recommend a. Blast: canAfford bot 8 (bot/systems/economy.ts:39,53; training.ts:29; production.ts:53,112; wall.ts:34,39,45) / ex 1 / core 23; the bot's one earmark use (bot/systems/military/production.ts:53-55) relies on that settle: `canAfford(type, 'production')` false adds the earmark, true clears it.

## PUB-15 med: expansions exposed twice with different shapes

- `agent.ownedExpansions(): OwnedExpansion[]` `{location, townhall}` (macro.ts:360, types.ts:208) vs `map.getOccupiedExpansions(): Expansion[]` (map.ts:148).
- `agent.getNextExpansion(): Promise<Point2D | null>` (macro.ts:341; async because it calls `map.queryPathing`) vs `map.getAvailableExpansions()` + `map.getClosestExpansion` (map.ts:154,169). In-flight: `buildings.getNextExpansion(): Point2D | undefined` sync stub (types.ts BuildingTracker), a third one.
- `Expansion.base` (string tag) vs `Expansion.getBase()` (Unit) vs `OwnedExpansion.townhall`.
Options: a) delete `OwnedExpansion` and `agent.ownedExpansions`; agent.getNextExpansion returns `Expansion | undefined`; b) keep agent helpers as thin wrappers over map, return Expansion; c) leave.
Recommend a/b hybrid: one shape (Expansion), one absence value (undefined). Blast: ownedExpansions/getNextExpansion bot 0 / ex 0 / core 7; map.getOccupiedExpansions bot 3 / core 4.

## PUB-16 med: duplicate events for a single occurrence

systems/unit.ts: own structure start fires both `buildingConstructionStarted` (:226-231, new-unit branch) and `structureConstructionStarted` (:86, "python style"); completion fires `buildingConstructionComplete` (:108, :230) and `structureConstructionComplete` (:86, :91); own damage fires `unitDamaged` (:173) and `unitTookDamage` (:182, with amount); a transform fires `unitIsTransforming` (:133) and `unitTypeChanged` (:194); new non-structures fire `unitCreated` (:220) and `unitSpawned` (:79); unit systems use `onNewUnit` (types.ts:777) for what general systems get as `onUnitCreated`. A bot that subscribes to both double-handles. The pairs differ only in payload shape and timing.
Options: a) keep one name per occurrence, payload superset (`unitTookDamage` carries unit+amount; drop `unitDamaged`), keep python-style names only if ares parity requires; b) keep all, document exact firing rules; c) leave.
Recommend a for damage/building-vs-structure; b for spawned vs created (different filters).
Blast: bot handlers onBuildingConstruction* 2 (bot/systems/log.ts:41,44), onUnitCreated 3 (log.ts:38, economy.ts:8); ex 4; core 15 hits.

## PUB-17 med: same verb, different semantics

- `agent.train(type, amount, closestTo, trainOnlyIdleBuildings)`: queues commands, sums amount, returns count, never throws, 4 positional (macro.ts:387).
- `actions.train(type, unit?)`: one command, throws TrainError, returns void (actions.ts:495).
- `agent.research(upgradeId)` returns boolean (macro.ts:481) vs `actions.upgrade(upgradeId, facility?)` returns void/throws (actions.ts:550). Same concept, two verbs; also `canAffordUpgrade`, `alreadyPendingUpgrade`, `units.getUpgradeFacilities`, `upgradeController`, build task `upgrade`.
- `actions.upgrade` throws `TrainError` for upgrades; no research/upgrade error type.
Options: a) rename `agent.research` to `agent.upgrade` and `agent.train` to a distinct verb (`agent.produce`), or move both into `actions` with a count option; b) keep, document in one table; c) pick `research` everywhere.
Recommend a (pick `upgrade` since 6 names already use it). Blast: agent.train bot 1 / ex 0, actions.train bot 2 / ex 1, agent.research/actions.upgrade 0 outside core.

## PUB-18 med: Unit predicates disagree on which order counts

Any order (`orders.some`): `isConstructing` (create-unit.ts:178), `isHolding` (:190), `isReturning` (:207), `isGathering` (:210).
First order only (`isUsingAbility`, which also resolves ability remaps): `isMoving` (:269), `isAttacking` (:272), `isPatrolling` (:275), `isRepairing` (:278), `isCollecting` (:281), `isConstructingScv` (:284), `isTransforming` (:287).
`Units` getters use a third rule: `gathering`/`returning`/`collecting` check the first order only and include the MULE gather id (units-collection.ts:159-169), while `Unit.isGathering()` uses `gatheringAbilities` without MULE and `Unit.isCollecting()` covers only HARVEST_GATHER/RETURN. So `unit.isCollecting()`, `Units#collecting` and `unit.isGathering() || unit.isReturning()` give different answers for the same unit.
Options: a) one rule (first order, remap-aware) for every `is<Activity>`, any-order variants named `hasOrder(ability)`; b) the reverse; c) document per method.
Recommend a. Blast: bot isMoving/isAttacking 2 (bot/systems/combat/micro/basic.ts:16,63), isGathering etc. 0; core ~16.

## PUB-19 med: `isConstructing` is about the worker

`Unit.isConstructing()` = has a construction build order (create-unit.ts:178; used on a builder, e.g. actions.ts:443). A structure under construction is `!isFinished()` / `buildProgress < 1`, and a unit ordered "constructing" by an SCV is `isConstructingScv()` (:284, first-order). Three names, two meanings; `units.getConstructingWorkers` (units.ts:188) returns workers; `Units#notReady` returns structures. A reader expects `structure.isConstructing()` to be true while it is being built.
Options: a) rename `isConstructing` to `hasBuildOrder`, add `isUnderConstruction()` for structures; b) swap meaning; c) document.
Recommend a. Blast: bot 0 / ex 0 / core 4.

## PUB-20 med: sync vs async for command-queueing

All of `actions.*` and `Unit.inject/blink/burrow/toggle/useAbility` are `async` but only call `queueAction` synchronously (actions.ts:135-247; create-unit.ts:93-134,584) and return `Promise<void>`. `agent.train/research/expandNow` are `async` with no awaits (macro.ts:369-517). Sibling resources that do the same job are synchronous: `buildings.build`, `flying.move/swap`, `roles.assign`, `ctx.order`. Consequences: an un-awaited `actions.build` becomes an unhandled rejection (BuildError) instead of a swallowed handler error; `Promise.all(bases.map(b => actions.train(...)))` (bot/systems/economy.ts:53) works only because the call is already queued.
Truly async calls: `findPlacement`, `canPlace`, `map.queryPathing`, `Unit.fetchAvailableAbilities`, `agent.getNextExpansion`.
Options: a) make queueing calls sync (return void / boolean), keep async only for server queries; b) keep, document "queues synchronously, await is optional"; c) leave.
Recommend a for a major version (big call-site churn is mechanical). Blast: bot `actions.*` 12 + 3 + 2 awaited sites; ex ~11; core 0 callers (behaviors use queueAction).

## PUB-21 med: option object vs positional

Positional where an option exists elsewhere: `queue` (PUB-03) on actions.move/attack/smart/patrol/gather/mine/stop/..., `worker` positional in `actions.build(type, target, worker)` (actions.ts:388) vs `buildings.build(type, { worker })` (types.ts BuildOptions); `earmark` positional in `canAfford(type, earmark, opts)` vs `BuildOptions.earmark`; `agent.train(type, amount, closestTo, trainOnlyIdleBuildings)`; `agent.expandNow(type?, location?)`; `influence.addCost(layers, center, radius, weight)`; `spatial.unitsInRange(from, distance, kind)`; booleans `getWorkers(includeBusy)`, `map.getCenter(pathable)`, `Units.sorted(key, reverse)`, `sortedByDistanceTo(pos, reverse)`; `engine.createGame(map, players, realtime, options)` while `runGame(map, players, { realtime })` (PUB-43).
Defaults live in the implementation signatures (inline), in `DEFAULT_SETTINGS` constants per resource, in config.ts (`gameStep: 4`), and `createSystem` (`stepIncrement` 8 for agent systems, 2 otherwise, create-system.ts:50): no single place.
Options: a) rule "required inputs positional, everything else one options object", migrate the booleans and `queue`; b) leave, migrate only `actions.build` worker; c) document.
Recommend b then a at the next major. Blast: positional queue see PUB-03; `agent.train` bot 1; `actions.build` bot 5 (3rd param unused by bot).

## PUB-22 med: argument order for "issue ability"

- `actions.do(abilityId, tags: string | string[], { target, queue })` (actions.ts:135; types.ts:507-508 accepts tags only, runtime also Unit[]).
- `ctx.order(units, abilityId, target?, { queue })` (types.ts BehaviorContext; behaviors.ts:26).
- `Unit.useAbility(abilityId, { target, queue })` (create-unit.ts:584); `Unit.blink(target, opts)`.
- `actions.move(units, target, queue)` etc. put units first.
`do` is the odd one (ability first, tags not Units), and ctx.order drops duplicates per owner silently unless `queue` (behaviors.ts:34), while `do` does not.
Options: a) `actions.do(units, abilityId, { target, queue })` and accept `Unit | Unit[]`; b) keep, add a Unit-accepting overload; c) leave.
Recommend a. Blast: actions.do bot 1 (bot/systems/military/production.ts:122) / ex 0; ctx.order ex 2; useAbility bot 2 / ex 3.

## PUB-23 med: coordinate types

- `map.path(start, end)` returns `number[][]` of `[x, y]` tuples (map.ts:462; types.ts:463), `Path = number[][]` (types.ts:362), `Expansion.pathFromMain/pathFromEnemy: Path`. `pathing.findPath` returns `Point2D[]`. `getCombatRally` converts tuples to Point2D internally (map.ts:249).
- Raw proto points: `WPoint.pos`, `TextDrawFn`, `Debugger.drawBox(min, max)` take `SC2APIProtocol.Point` (optional x/y/z, types.ts:558-648); `map.getSize()` returns `SC2APIProtocol.Size2DI`; `Unit.orders[].targetWorldSpacePos` proto.
- Grids: `Grid2D = number[][]` indexed `[y][x]` (`map.getGrids()`), `PixelMap` with `{x, y}` get/set, `InfluenceGrid` flat Float32Array with width/height.
- Shapes: `Shape {pos, height, width}`, `AAShape {pos, w, h}`, `Footprint {w, h}`, `BuildingSize '2x2'` strings.
Options: a) `map.path` and `pathFrom*` return `Point2D[]` (matches findPath); debug takes `Point3D | Point2D`; b) keep tuples and add `toPoints`; c) leave.
Recommend a. Blast: map.path bot 0 real (bot/systems/combat/micro/basic.ts:29 is a TODO comment) / ex 0 / core 5; pathFrom* core 3.

## PUB-24 med: grid polarity and duplicate grid queries

- `map.isPathable(p)` = `!pathing[y][x]` (0 = pathable) and `setPathable(p, true)` writes 0 (map.ts:74-81); `isPlaceable(p)` = `!!placement[y][x]` (1 = placeable) and `setPlaceable(p, true)` writes 1 (:84-96). The two grids returned by `getGrids()` have opposite truthiness for "good". `influence` uses cost 1 = free, Infinity = blocked.
- Duplicates with different data: `isPathable` (live grid, updated by structures) vs `inPathingGrid` (static start grid, map.ts:447); `isPlaceable` vs `inPlacementGrid` (:450); `isPlaceableAt(type, pos)` (grid) vs `placement.canPlace(type, pos)` (spots + power) vs `actions.canPlace(type, positions[])` (server query, random winner, actions.ts:313); `getHeight` (live /10, map.ts:217) vs `getTerrainHeight` (raw 0-255, :441) vs `getTerrainZHeight` (:444); `map.getEffects` (map.ts:208) vs `frame.getEffects` (frame.ts:35); `frame.getMapState` vs `map._mapState`.
Options: a) document `getGrids()` polarity in the type (branded `PathingGrid` / `PlacementGrid`) and rename statics `startPathable`/`startPlaceable`; b) normalize both grids to "1 = good" internally; c) leave.
Recommend a. Blast: getGrids bot 0 / ex 0; inPathingGrid/inPlacementGrid 0; getHeight/getTerrain* core 12; map/frame getEffects core 5.

## PUB-25 med: units of measure

Seconds without suffix: `BuildingSettings.timeout` (buildings.ts:124,397), `MemorySettings.expireGround/expireAir` (memory.ts:5,60), `PlacementSettings.reservationTimeout` (placement.ts:54,489), `IntelSettings.greedyTwoBaseBefore/greedyThreeHatchBefore` (intel.ts:24-25), `RunGameOptions.gameTimeLimit` (create-engine.ts:546, loop/22.4). Seconds with suffix: `maxSeconds` (combat-sim.ts:23). Loops: `config.gameStep`, `createSystem` `stepIncrement`, `attackReady(stepLoops)` (behaviors/combat/helpers.ts:11), `Unit.weaponCooldown`, `buffDurationRemain`.
Scale: `Unit.getLife()` is 0..100 (create-unit.ts:150) while `buildProgress`, `MiningSettings.fleeAtHealth` (mining.ts:93) and `selectWorker({ minHealth })` (mining.ts:226) are 0..1; `getLife` has 0 callers (core 1 = definition).
Speed: `movementSpeed()`/`realSpeed()` are per 16-loop "normal second" (create-unit.ts:54-55,389) while every time API uses 22.4 loops/s.
Options: a) suffix names (`timeoutSeconds`, `expireGroundSeconds`, `gameTimeLimitSeconds`); b) document the unit in each type; c) all loops.
Recommend a for settings, remove or rename `getLife` to `healthPercent`. Blast: bot 0 / ex 6 `.configure` (none set these); `gameTimeLimit` ex ~29 runGame sites do not all set it.

## PUB-26 med: `getAll` / `getByTag` include dead and stale units; `getAlive` = seen this loop

`isCurrent()` = `lastSeen === frame.getGameLoop()` (create-unit.ts:229). `getAlive` filters on it (units.ts:135), so an enemy out of vision, or a just-died own unit, is not "alive". `getAll(Alliance.SELF)` and `getByTag` return dead own units forever (frame.ts:108 only labels them `dead`; own units are never deleted from `_units`), `labels.has('dead')` is how `getOccupiedExpansions`/`getAvailableExpansions` detect death (map.ts:151,157). Enemy dead units are deleted (frame.ts:110).
bot/systems/combat/offense.ts:21 builds on `getAll(Alliance.ENEMY)` + `isCurrent() || isMemory()` to approximate what `memory.getEnemies()` already does.
Options: a) rename `getAlive` to `getVisible`/`getCurrent`; make `getAll` exclude `dead`; b) keep, add `getAll({ includeDead })`; c) document.
Recommend a (rename) or b. Blast: getAlive bot 4 / core 32; getAll bot 1 / core ~8; getByTag bot 0 / core ~20.

## PUB-27 med: internals on public interfaces

`MapResource` exposes `_grids/_expansions/_locations/_graph/_mapState/_ramps/...` plus mutators `setGrids/setExpansions/setLocations/setMapState/setRamps/setStartRaw/setSize/setGraph/newGraph/setActiveEffects/setPathable/setPlaceable` (types.ts:412-475); `FrameResource` `_observation/_gameLoop/_previous...` and `recordStepTime/resetStepTimes` (:661-688); `UnitResource._units` (:315); `ActionManager._client`, `Agent._world` (:167), `Unit._availableAbilities`. Underscore means private in some places and public in others (`unit.update`, `unit.fetchAvailableAbilities` public with no underscore; `frame.recordStepTime` public). Zero bot/example use of `_x` today.
Options: a) split `MapResource` / `FrameResource` into public read interface + internal writer interface (engine-only); b) prefix every engine-only mutator with `_`; c) leave.
Recommend a. Blast: bot 0 / ex 0; core set*/ _expansions ~38.

## PUB-28 med: stubs typed as callable that throw "not implemented" (in-flight, uncommitted)

Dirty tree adds interface members that throw `NodeSC2Error('not implemented: ...')`: `influence.getCleanGrid/getForcefieldPositions` and `addCost`/`drawDebug` grid overloads (influence.ts), `intel.getEnemyDetectors/isDetected/getOwnUnitsInDetectorRange` (intel.ts), `pathing.findLowPriorityPath/findFurthestSafeSpot/findLowestCostPoints` (pathing.ts), `buildings.getNextExpansion/isExpansionBlocked` (buildings.ts:185-190), behaviors `useAOEAbility/autoUseAOEAbility/placePredictiveAoE/reaperGrenade/ghostSnipe/ravenAutoTurret` (behaviors/combat/aoe.ts, spells.ts return `execute: () => false`). Because of PUB-02 a thrown stub is invisible in a bot's logs, and the behavior stubs silently no-op.
Related inconsistency introduced: `pathing.findFurthestSafeSpot` vs existing `closestSafeSpot` (find vs no verb), `findLowPriorityPath` unit-less name, `buildings.getNextExpansion` sync/undefined vs `agent.getNextExpansion` async/null (PUB-11/15).
Options: a) do not export stubs from index/types until implemented; b) mark `@deprecated not implemented`/`@experimental`; c) leave.
Recommend a. Blast: bot 0 / ex 0.

## PUB-29 low: position-parameter naming

Same concept (a reference point), different names: `near` (`mining.selectWorker(near)`, `actions.findPlacement(type, near)`, `BuildTaskOptions.near`), `at` (`BuildOptions.at`, `buildings.build`), `closestTo` (`agent.train`, `PlacementRequest.closestTo`, `autoSupply`), `base` (`PlacementRequest.base`, `getBaseChokes`, `productionController`), `from` (`spatial`, `closestSafeSpot`), `nearPosition` (`WarpInOptions`), `towards` (`getDefensivePosition` option, same name as the root `towards()` helper), `center` (`addCost`, `Squad.position` vs `Choke.center` vs `Region.center`).
Options: a) rule: `near` for proximity, `at` for exact target, `base` only for an Expansion/townhall; rename `closestTo`/`nearPosition` to `near`; b) leave.
Recommend a. Blast: `nearPosition|closestTo:|near:` ex 3 / core 14; bot 0.

## PUB-30 low: Units distance helpers

`closerThan(distance, position)` / `furtherThan(distance, position)` (units-collection.ts:254,258) put distance first; every other helper is position first: `closestNUnits(position, count)`, `inDistanceBetween(position, min, max)`, `nClosestToDistance(position, distance, count)`, `spatial.unitsInRange(from, distance, kind)`. Name pairs: `closestNUnits` vs `nClosestToDistance` (N position flips), `furthest` (Units) vs `farthest` (internal byDistanceTo), `closerThan`/`furtherThan` strict `<`/`>` while `targetInRange` is `<=`; `inDistanceBetween` exclusive at both ends.
Options: a) add position-first overloads, deprecate the old order; b) leave.
Recommend b unless a major bump happens. Blast: closerThan bot 18 (bot/systems/combat/utils.ts:26,44 ...) / ex 1 / core 9.

## PUB-31 low: squared-distance params

`duplicateOrSimilarOrder(..., distanceSquaredCheck = 2)` (behaviors/combat/helpers.ts:41) vs `pathGroupToTarget({ distanceCheckSquared = 26.25 })` (group.ts:98): two spellings of one idea; `aMove({ successAtDistance = 7 })` is a plain distance; `Unit.distanceTo` plain, `Units.closerThan` plain. `Units#sortedByDistanceTo` sorts squared internally.
Options: a) rename both to `distanceSquared` / accept plain `distance` and square inside; b) leave.
Recommend a (accept plain distance). Blast: ex 1 / core 23 (mostly internal).

## PUB-32 low: vocabulary drift

- structure vs building: `units.getStructures`, `isStructure`, `structureTypeBuildProgress`, `buildStructure` (behavior) vs `buildings` resource, `onBuildingConstruction*`, `BuildTarget`.
- gas: `getGasGeysers`, `getGasMines`, `isGasMine`, `map.freeGasGeysers` (no `get`, returns own-base geysers only), `actions.buildGasMine`, `buildings.buildGas`, behavior `gasBuildingController`, `GasMineRace`.
- base/townhall/expansion: `units.getBases`, `isTownhall`, `Expansion.getBase()`, `Expansion.townhallPosition`, `OwnedExpansion.townhall`, `BaseThreat.townhall`.
- pending: `agent.alreadyPending`, `buildings.pending`, `units.inProgress`, `units.getUnfinished`, `units.getPendingAt`, `workerEnRouteToBuild`, behaviors `notStarted`.
- producers: `units.getProductionUnits`, `getUpgradeFacilities`.
Options: a) one glossary + aliases/renames (structure, gas mine/geyser, townhall, unfinished); b) leave.
Recommend a only for new APIs. Blast: freeGasGeysers/buildGasMine/buildGas bot 0 / ex 0 / core 9.

## PUB-33 low: supply fields twice

`Agent` extends proto player data (`foodCap`, `foodUsed`, `foodArmy`, `foodWorkers`, `minerals`, `vespene`) and shadows four of them with accessors `supplyCap/Used/Left/Army/Workers` (create-agent.ts:89-118) that add the Zerg half-supply correction (`supplyUsed` != `foodUsed` for Zerg). The bot reads `foodCap/foodUsed` directly (bot/index.ts:44; economy.ts:34 recomputes `supplyLeft`). `Cost`/`Earmark` use `{minerals, vespene}`, `UnitTypeData` uses `mineralCost/vespeneCost`.
Options: a) deprecate `food*` on Agent, document supply*; b) leave.
Recommend a (doc only). Blast: food*/minerals/vespene bot 6 / ex 3; supply* bot 2 / core 40.

## PUB-34 low: behavior option vocabulary

Count targets: `toCount` (buildWorkers, expansionController, gasBuildingController, buildStructure default 0) vs `maximum` (spawnController, spawn.ts:37); caps: `maxPending` (expansion/gas) vs `maxOnRoute` (buildStructure); flags `prioritize`, `canAffordCheck`, `checkLocationIsSafe`, `returnTrueIfSupplyRequired`. Combat: `closeEnemy` / `allCloseEnemy` / `targets` (in-flight AOE stubs) for the same concept; range slack named `extraRange` (`inAttackRange`) vs `bonusDistance` (`Unit.targetInRange`, `Units#inAttackRangeOf`). Group variants: `aMoveGroup`, `keepGroupSafe`, `pathGroupToTarget` vs `groupUseAbility`, `groupWeaponsOnCooldown`. `ownUnitCount(world, type)` is positional while every behavior takes an options object. Group behaviors take `Unit[]`, not `Units`.
Options: a) normalize names in one pass before the behaviors API is released (behaviors are unreleased per CN Q6); b) leave.
Recommend a now (cheap while unreleased). Blast: bot 3 `closeEnemy|group:` / ex 3 / core 19; macro behaviors bot 0.

## PUB-35 low: root point helpers are a slice

index.ts:19 exports `avgPoints, closestPoint, distance, distanceSquared, towards` but not `nClosestPoint`, `add`, `subtract`, `multiply`, `normalize`, `areEqual`, `distanceX/Y`; `center(units)` is exported from `@sc-bot/core/behaviors` only (behaviors/index.ts:4) and `Units#center` exists too (three ways to get a centroid). Empty-input behavior differs: `closestPoint([])` undefined, `avgPoints([])` NaN, `Units#center` throws.
Options: a) export the full vector set from root and drop `behaviors.center`; b) leave. Recommend a. Blast: bot 0 `closestPoint|avgPoints|nClosestPoint`, ex 1 `center(`.

## PUB-36 low: tag vs Unit parameters, tag collections

Accept Unit or tag string: `mining.release/getAssignment/getWorkersOn/getMineralTarget`, `roles.assign/clear/roleOf`, `flying.cancel`, `behaviors hasOrdered`. Unit only: `buildings.cancel` (Unit | TrackedBuild), `actions.*`. Types of "set of tags": `mining.getWorkersOn(): string[]`, `roles.getTags(): ReadonlySet<string>`, `Squad.tags: ReadonlySet<string>`, `Units#tags: Set<string>`, `actions.unitTagsReceivedAction(): Set<string>`. `actions.do` takes tags only by type, Units at runtime; `actions.attack/smart/mine` typed `Unit[]` only, runtime accepts a single Unit (types.ts:503-519 vs actions.ts:156,300).
Options: a) accept `Unit | string` consistently, return `Units` for member lists (`getWorkersOn`); b) leave. Recommend a for the typed signatures. Blast: bot `actions.mine` 3 passes Units, others 0.

## PUB-37 low: configure()

Every resource has `configure(partial)` and no getter; only `mining.configure` validates (mining.ts:142-149, RangeError); `buildings.configure`, `memory.configure`, `intel.configure`, `placement.configure`, `flying.configure`, `roles.configure` accept anything. Defaults are exported (`INFLUENCE_DEFAULTS`) only for influence (index.ts:23-31); other defaults are private consts (memory.ts:5, intel.ts:20-25, placement.ts:54, buildings.ts:124, mining.ts ~88). `mapAnalysis.configure` also discards the cached analysis (map-analysis.ts:323).
Options: a) `getSettings()` on each resource (readonly), export defaults, validate in configure; b) leave. Recommend a. Blast: configure bot 0 / ex 6 / core 1 (all `mining.configure({ enabled: true })` style).

## PUB-38 low: constants naming

`UnitTypeId` is `type UnitTypeId = number` in types.ts:54 and a name-lookup const in `@sc-bot/core/constants` (constants/index.ts:15; same for `AbilityId`); bot/systems/log.ts:3 imports the const. Race-keyed maps are PascalCase singular (`WorkerRace`, `GasMineRace`, `TownhallRace`) while sets are camelCase plural (`workerTypes`, `gasMineTypes`, `townhallTypes`). Statuses: numeric consts (`BuildOrder`, `BuildResult`, `Alliance`, `EngagementResult`) vs string unions (`TrackedBuildStatus`, `SpatialKind`, `InfluenceLayer`, `UnitRole`, `PlacementState`). Build status has three vocabularies: `BuildOrderStatus` (numbers), `BuildResult` (numbers), `TrackedBuildStatus` (strings).
Options: a) rename the lookup consts (`unitTypeName`) or the types; b) leave. Recommend a. Blast: UnitTypeId|AbilityId bot 7 / core 54.

## PUB-39 low: `Unit[]` vs `Units`

Typed `Unit[]` while runtime returns `Units`: `map.freeGasGeysers(): Unit[]` (types.ts:434; map.ts:118 returns `units.getGasGeysers().filter(...)`, a Units). Plain arrays by design: `Cluster.mineralFields: Unit[]`, behavior params, `canWinFight/simulateFight(Unit[])`, `actions.*` params. Everything on `UnitResource`, `Squad.units`, `memory.*`, `intel.getProxies` is `Units`. `Units.map/flatMap` return Units only when every element is Unit-like (units-collection.ts:26-28), a runtime-dependent return type.
Options: a) type `freeGasGeysers` as Units, accept `Iterable<Unit>` in behaviors/combat-sim; b) leave. Recommend a. Blast: bot 0 / ex 0 / core 11 gas getters.

## PUB-40 low: Units aliasing and mutation

`take(count)` returns `this` when `count >= length` (units-collection.ts:207) and `randomGroupOf` returns `this` (:216) while `slice/filter/closestNUnits` return new collections; inherited `sort()` mutates, `reverse()`/`splice()` are overridden to return Units but still mutate in place, `sorted()` copies. A caller who `.sort()`s the result of `take(n)` mutates the source.
Options: a) always return a copy; b) leave. Recommend a. Blast: take/randomGroupOf bot 0 / ex 0 / core ~2.

## PUB-41 low: map expansion/ramp accessors

`getExpansions(alliance)` recognizes only ENEMY; ALLY/NEUTRAL silently return own order (map.ts:141-147). `getEnemyMain/getEnemyNatural/getEnemyThirds` duplicate `getExpansions(Alliance.ENEMY)[n]`. `getThirds` is `slice(2, 4)` (two) not "third" (map.ts:135). Ramps: `map.getMainBaseRamp` (upper-size heuristic, map.ts:417) vs `mapAnalysis.getEnemyMainRamp` (via defensive choke, map-analysis.ts:310) use different algorithms for symmetric concepts; neither is `getMainRamp`/`getEnemyMainBaseRamp`.
Options: a) `getExpansions(from: 'self' | 'enemy')`, drop Enemy* duplicates or keep as sugar; b) leave. Recommend b, fix doc. Blast: getMain/getNatural.. bot 5 (bot/systems/anchor.ts:5, offense.ts:54-55), getExpansions bot 9 / ex 5, getRamps/ramp bot 3.

## PUB-42 low: Unit method naming

`getLife`/`getLabel` carry `get` while sibling accessors don't (`age()`, `data()`, `buffs()`, `groundDps()`, `movementSpeed()`); `addLabel` returns the Map (chain-hostile), `removeLabel` returns boolean; `isEnemy()` exists with no `isOwn()/isNeutral()` (raw `alliance` instead); `is(type)` vs `unitType ===`; `isFlyingOrGravitoned()` (create-unit.ts:575) vs proto `isFlying` vs `Units#flying`; `isFacing(other: Unit)` takes Unit only while `distanceTo`/`inAbilityCastRange` take Unit | Point2D and `isFacing` has no angle-wrap handling near 0/2pi (create-unit.ts:591-595, radians while `getLife` is percent).
Options: a) drop `get` prefix on new APIs, add `isOwn`; b) leave. Recommend b. Blast: bot 0 / ex 0 / core ~2.

## PUB-43 low: engine entry points

`engine.createGame(map, players, realtime?, options?)` (types.ts:1326) takes `realtime` positionally while `runGame(map, players, { realtime })` and `RunGameOptions` carry it in the options object; `createPlayer(settings, entity?)` (index.ts:11) names the Agent `entity`, derives `type` from its presence (PARTICIPANT vs COMPUTER) and drops any caller-supplied `type`; `Engine.use` and `Agent.use` share a name with different parameter types (SystemWrapper<EngineObject> vs SystemWrapper<System>).
Options: a) move `realtime` into CreateGameOptions; b) leave. Recommend a. Blast: createGame/runGame/createPlayer bot 3 / ex 29 / core 7 (runGame callers do not use createGame positional realtime).

---

## In-flight (uncommitted) changes that touch this surface

Seen in `git diff` during the audit; PUB-28 covers the stubs. For the user's decision before they land:
- `influence.addCost(target: layer | layers | grid, ...)` and `drawDebug(target: layer | grid)` widen the first param to a union that throws for the grid branch (not implemented). Pathing/intel/buildings stubs listed in PUB-28.
- `buildings.getNextExpansion(opts?): Point2D | undefined` (sync) joins `agent.getNextExpansion(): Promise<Point2D | null>` (PUB-15) with different async-ness and absence value.
- New behaviors `useAOEAbility` etc. use `targets`, `bonusTags` (ReadonlySet), `minTargets`, camelCase `AOE`/`AoE` mix (`autoUseAOEAbility` vs `placePredictiveAoE`).

## Method

Read types.ts in full; read resources/{units,units-collection,map,frame,actions,buildings,mining,roles,squads,spatial,memory,intel,influence,pathing,flying,behaviors,map-analysis}.ts, placement.ts (public parts), agent/{create-agent,macro}.ts, engine/{create-unit,errors,data-storage,create-expansion,create-world}.ts, systems/{create-system,unit,frame}.ts, utils/{geometry/point,map/ramp,map/townhall,pixel-map,combat/combat-sim}.ts, behaviors/**, constants/{index,race-map,time}.ts, bot/ call sites. Counts from a regex scan over bot/, packages/core/examples and packages/core non-test source (script in the session scratchpad). Not verified in a live game: PUB-05 (whether the game snaps a floored vs centre townhall build target the same way), PUB-07 near-edge crash in practice.
