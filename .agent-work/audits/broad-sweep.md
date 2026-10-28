# Audit: broad sweep (costs, race tables, unit sets, tech lookups, bases, clustering, grids, footprint, time, config, debug)
Read-only audit. Paths relative to packages/core unless bot/. pub = exported, int = internal. Counts exclude tests/docs/examples. Line numbers not re-verified by the auditor.

## A. Costs / affordability / supply
- A1 canAfford family (agent/create-agent.ts): canAfford :178 pub (getUnitTypeData cost, Zerg struct −50, earmark-aware, settles earmark, no supply, no net-morph); canAffordUnit :147 pub (calculateCost net morph + supply, no earmarks); canAffordN :198 pub (raw cost, no earmark/supply); canAffordUpgrade :214 pub (earmark-aware); calculateUpgradeCost :127 earmark-free.
  - Private non-settling copies: affordable() resources/buildings.ts:78; affordable() systems/builder-plugin.ts:337 (new in P4-T11 rework).
  - calculateCost :120 pub (net morph + hardcoded REACTOR/TECHLAB/BANELING/ARCHON/ZERGLING). data.getUnitTypeData().mineralCost data-storage.ts:33-47 (applies Zerg −50). data.mineralCost() data-storage.ts:52: zero callers. getArmyValue units.ts:269-272 raw cost on purpose.
  - Int callers: canAfford ×14; canAffordUnit ×4 (macro.ts); calculateCost ×7.
  - bot: canAfford ×8 (military/production.ts:53,112; wall.ts:34,39,45; economy.ts:39,53; training.ts:29); hand-rolls getUnitTypeData + addEarmark after failed canAfford (production.ts:54-55,113-114).
  - agent.train (macro.ts:542) vs actions.train (actions.ts:366) use different cost models.
- A2 subtract-cost-after-order ×6: spend() macro.ts:277; deduct() tech.ts:58; inline structures.ts:247-249; actions.ts:445-448, :503-506; buildings.ts:290-294.
- A3 supply cost: calculateSupplyCost create-agent.ts:130 pub; morphCost() create-agent.ts:34-47 re-derives; raw foodRequired at builder-plugin.ts:116, intel.ts:202, terran.ts:160, systems/debug.ts:54,57. bot canFeed training.ts:10.
- A4 supply* getters (create-agent.ts:90-118, Zerg half-supply correction, setter shadows getter) vs raw food* (PlayerData). Core uses supply*, bot uses food*.

## B. Race → unit tables (5 hand-written copies)
constants/race-map.ts:5-35 pub (SupplyUnitRace, HarvestGatheringRace no callers; TownhallRace lacks flying); structures.ts:30-49; spawn.ts:22 WORKER_BY_RACE; macro.ts:18-33 RACE_TOWNHALLS/START_TOWNHALL; build-order/parse.ts:15-35 RACE_UNITS; HATCHERIES intel.ts:28. bot none.

## C. Unit-type sets re-declared
- Worker: groups.workerTypes (incl. MULE) → Unit.isWorker; callers re-exclude MULE (roles.ts:8, actions.ts:226). units.getWorkers uses WorkerRace (drops 'command'-labelled unless includeBusy). WORKER_TYPES macro.ts:36. bot uses isWorker, getWorkers.
- Gas: groups.gasMineTypes lacks RICH → Unit.isGasMine() misses rich gas (bug); GAS_TYPES re-declared buildings.ts:27, placement.ts:59, targets.ts:42; GAS_BUILDING_TYPES macro.ts:38; units.getGasMines 3-type.
- Mineral: mineralFieldTypes groups.ts:116 vs MINERAL_TYPES macro.ts:47 vs RESOURCE_TYPES expansion-locations.ts:10.
- Verbatim copies: CREEP_TUMORS intel.ts:27 = buildings.ts:27; layerFor and positionOf in group.ts and individual.ts.
- isStructure re-implemented inline in units.getStructures units.ts:112-116.
- Flying: isFlying() units-collection.ts:26 (field OR gravitoned) → Unit.isFlyingOrGravitoned; bot uses raw unit.isFlying (ignores gravitoned); flyingStructureTypes.includes in systems/map.ts, flying.ts, placement.ts.

## D. Tech / producer / research lookups
- Tech requirement: hasTechFor create-agent.ts:234 pub (UnitTypeData + dict + reverse alias scan; bot ×3); techRequirementProgress macro.ts:366 (dict + techEquivalents); requirementsOf tech.ts:79 (dict); dict direct macro.ts:538.
- Equivalents: techEquivalents macro.ts:149; RESEARCH_EQUIVALENT_STRUCTURES macro.ts:138; inline reverse scan tech.ts:192; Units.sameTech/sameUnit; raw unitAlias production.ts:38.
- Producer: trainedFrom dict vs units.getProductionUnits (ability lookup); researchedFrom dict vs units.getUpgradeFacilities. agent.train/research use dicts, actions + builder-plugin use ability lookup; may disagree (WarpGate, Lair).
- Research ability expression duplicated macro.ts:208, tech.ts:43.

## E. Expansions / bases
- Two base-position computations: map.getExpansions() (cluster 15.0 + townhallPlacement, path-ordered) vs map.getExpansionLocations() (separate merge 10.5 + own search, bare Points); can disagree. getExpansionLocations callers macro.ts:405,420 only.
- Own bases: map.getOccupiedExpansions; agent.ownedExpansions (townhall within 15); units.getBases (bot economy.ts:48, defense.ts:8); mapAnalysis region.expansions.
- Next base: agent.getNextExpansion (async queryPathing); map.getAvailableExpansions()[0]; map.getClosestExpansion.
- Copy-paste expansion.base assignment systems/map.ts:489-498 and :532-540.
- Free geysers: map.freeGasGeysers (actions.ts:466) vs private freeGeysers buildings.ts:98 (progress-gated, excludes pending).

## F. Clustering / centroids
createClusters cluster.ts:5; mergeResourceGroups expansion-locations.ts:37; deadHullClusters inline systems/map.ts:181-203; cluster() squads.ts:26; clusterByNeighbor cluster.ts:46 dead (test-only); PixelMap.floodFillAll. Centroids: see pathing-closest-geometry.md.

## G. Grids
- Two ImageData decoders: consumeImageData/consumeRawGrids grid.ts → map._grids (pathing inverted) vs PixelMap via createStartGrids ramp.ts:175.
- Two terrain query families on MapResource: dynamic (isPathable, isPlaceable, getHeight) vs static (inPathingGrid, inPlacementGrid, getTerrainHeight, getTerrainZHeight).
- Direct map._grids/_mapState reads: placement.ts:139-146,177-185; influence.ts:79; map-analysis.ts:68.
- Flood fill ×2: utils/map/flood.ts vs PixelMap.floodFill.
- Footprint → blocked-cells loop repeated ×5 in systems/map.ts (:133 FIXME admits it).
- debugGrid grid.ts:5 console printer.

## H. Footprint
getFootprint utils/geometry/units.ts:101: data-driven vs data-less hardcoded tables at townhall.ts:31,36. footprintData(world) declared ×3. Hardcoded sizes in units.ts:11-33, debug.ts:115, map-analysis.ts:25, mining/targets.ts:4, placement.ts:61-62.

## I. Time
22.4 declared ×6 in core + ×2 in bot (none exported). frame.time() (loop/22.4) vs frame.timeInSeconds() (round(loop*44/1000)) disagree; timeInSeconds has no callers. bot reimplements formatGameTime (log.ts:8).

## J. Settings / config
- gameStep 4 ways (defaults, config file, inline, STEP_COUNT env). process.env.DELAY read directly create-engine.ts:518.
- Ports/hosts: EngineOptions.port/host vs yargs ladder args.
- bot reads own env (DIFFICULTY, AI_RACE, SC2_HOST, SC2_PORT, MAP, REALTIME); RunGameOptions.realtime/gameTimeLimit separate from config.
- Command priority 4 shapes: AgentSettings.commandPriority; createSystem option; per-resource settings.priority; roles.as/behaviors.run {priority}.
- configure() per resource is the only runtime path; config.resources via applyConfig; config.features has no runtime setter.

## K. Debug drawing (3 triggers)
- Env-flag gated in map code (systems/map.ts:244,305,452; map.ts:270,363).
- Explicit: placement.drawDebug, influence.drawDebug, mapAnalysis.drawDebug (different null guards / draw ids).
- debug.setRegions duplicates setDrawCells (sole caller systems/map.ts:305). gridsInCircle Debugger param unused; debug.drawBox, useDebugWidget no int callers.
- Flush gate: systems/debug.ts:139 only calls updateScreen() when sc2:debug:DebugSystem is on, so drawDebug() is invisible otherwise. sc2:DebugOnScreen gates text. features.chatDebug is a third switch.

## L. Small copies
randomOf macro.ts:168 = utils/get-random.ts; getRandomN actions.ts:27 variant; createPoint2D resources/map.ts:23 shadows point.ts createPoint2D (map.ts floors). KITE_IGNORED_TYPES / CHANGELINGS overlap groups.

## No overlap
Enemy-race detection; commandResults vs onNotSent.
