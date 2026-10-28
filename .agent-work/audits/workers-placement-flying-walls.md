# Audit: workers, build/placement, lift/swap, wall/ramp/analysis
Read-only audit. C = packages/core, B = bot. Mining is off by default (C/resources/mining.ts:87) and B never enables it. B calls no behaviors/buildings/placement/flying/mining/mapAnalysis APIs.

## 1. Workers
- agent.distributeWorkers C/agent/macro.ts:434 (public, types.ts:192): stateless; only mineral/gas ratio (resourceRatio) + workersPerGas 0..3; raw HARVEST_GATHER; ignores roles/labels. Only caller examples/ramp-wall.ts:21. B none.
- mining resource C/resources/mining.ts:82 (types.ts:1069): stateful, only if enabled; gas = fixed settings.workersPerGas (default 3, validated 0..3 at :141), no ratio; role GATHERING, priority -10; skips 'command' label/constructing. selectWorker (:109) ← actions.ts:405, macro.ts:242, buildings.ts:74.
- actions.gather actions.ts:223 (public): one worker/MULE, SMART on field; queues if 'command' label; ← actions.ts:459; B economy.ts:10,22.
- actions.mine actions.ts:267: HARVEST_GATHER, no checks; B economy.ts:17. actions.returnResource :602 unused.
- Idle: systems/unit.ts:31,123 emits unitIdle only; B economy.ts:20.
- distributeWorkers ignores mining.settings.workersPerGas; default 3 and 0..3 check duplicated (macro.ts:434-437, mining.ts:89,141). Both active → same workers at priority 0 vs -10 (arbiter not traced).
- 'command' label set only at actions.ts:443, buildings.ts:292; cleared by systems/frame.ts:69-84 (after 250 loops wipes ALL labels, adds 'stuck'). units.getMineralWorkers (units.ts:199) needs 1 gathering order + zero labels. B hard-codes 3 gas workers (economy.ts:16).

## 2. Build / placement
- Worker pickers (4): inline actions.ts:400-429 (GATHERING, fallback mineral+idle, sets 'command'); macro.ts:240 selectBuildWorker (private; only buildNear ← expandNow; no 'command'); buildings.ts:72/63 (BUILDING role; mining enabled + none → undefined); mining.selectWorker.
- actions.canPlace :280 SC2 query ≤10 random positions (← builder-plugin.ts:434,446).
- actions.findPlacement :303 SC2 ring search (← builder-plugin.ts:356,366,398,405; macro.ts:287; B economy.ts:40, military/production.ts:60).
- placement.canPlace placement.ts:580: local grid, no power/vision (← buildings.ts:316,378,408; structures.ts:198).
- placement.request/reserve/release/getPlacements/add :518/567/574/583/595: Terran/Protoss only. getPlacements/add no callers.
- map.isPlaceable/isPlaceableAt/inPlacementGrid map.ts:86/400/465. map.isPlaceableAt vs placement.canPlace differ (pathing, creep, addon, rounding).
- placer (types.ts:1205/1216): place() only builder-plugin.ts:445.
- Grids: map._grids mutated by systems/map.ts; placement keeps own FormationGrids copy (placement.ts:113; refreshLive :137 only at creation and add:601) but canPlace reads map._grids directly.
- actions.build actions.ts:355: immediate, untracked, tech/afford checks, sets 'command' (← builder-plugin.ts:328,391,439; B economy.ts:41, production.ts:64, wall.ts:35,40,49).
- actions.buildGasMine :462 unused.
- buildings.build buildings.ts:153: tracked, BUILDING role, priority 10 (← builder-plugin.ts:338, structures.ts:108,200). buildings.buildGas :173.
- buildStructure behaviors/macro/structures.ts:82 (public): wraps buildings.build, no findPlacement fallback.
- agent.expandNow macro.ts:425 → buildNear :283: untracked, unused.
- builder-plugin build step builder-plugin.ts:409 mixes all of the above; B uses it via taskFunctions (build.ts:1,12).
- Pending counters (5): agent.alreadyPending macro.ts:324 (B production.ts:27, training.ts:25), buildings.pending :210, structurePending behaviors/macro/helpers.ts:9, units.getPendingAt units.ts:211 (B wall.ts:34,39,47, production.ts:43), workerEnRouteToBuild macro.ts:375.
- Placement solver only assigns wall/bunker/productionPylon/optimalPylon/custom; supplyDepot/production/upgradeStructure/reaperWall fall back to closest non-custom spot (placement.ts:462-471).

## 3. Lift / swap
- actions.swapBuildings actions.ts:210: validates, calls flying.swap, returns void, sends nothing.
- flying.swap :84 → flying.move ×2; flying.move :75 records plan; onStep :130 lifts/moves/lands at priority 10.
- flying.addonSwap :89 no internal caller; 'addonSwap' task (types.ts:95, parse.ts:138-150) not implemented in builder-plugin.
- readme.md:754 and docs/api.md:823 claim immediate send + ResponseAction[] (stale).

## 4. Wall / ramp / analysis
- map.getMainBaseRamp map.ts:432 (B log.ts:31, wall.ts:9,22). map.getRamps :429 (only map-analysis.ts:123). Legacy map.isRamp/_ramps/setRamps.
- Ramp getters utils/map/ramp.ts:67-135 (exported): used by placement and B (barracksCorrectPlacement, barracksInMiddle, cornerDepots).
- Expansion.getWall create-expansion.ts:13 (natural only).
- mapAnalysis.getEnemyMainRamp map-analysis.ts:314; no map.getEnemyMainRamp.
- Three wall routes: Ramp getters + actions.build (B, examples); placement 'wall' flag via buildings.build/buildStructure; build-order targets RAMP/NAT_WALL (resolveTarget/structurePlacement/scoutWaypoints have no non-test callers).
- map.getThirds/getEnemyThirds vs mapAnalysis.getDefensiveThird (built on getThirds).
- map.getCombatRally :225 vs mapAnalysis.getDefensivePosition :231: independent. getCombatRally ← B combat/index.ts:38, offense.ts:93,157,216, utils.ts:34.
- Region: map.getClosestExpansion / Expansion.areas vs mapAnalysis.getRegion, no shared code.
- Expansion lists: getExpansions vs getExpansionLocations vs getAvailableExpansions/getOccupiedExpansions.
- B uses getMain, getEnemyMain, getExpansions, getOccupiedExpansions, getClosestExpansion; none of mapAnalysis/getThirds/getNatural/getWall.

## Semantic differences if one were removed
- findPlacement is SC2-authoritative; placement.canPlace local, no power/vision.
- placement.request empty for Zerg/unsolved; buildStructure has no fallback.
- actions.build checks tech/afford immediately; buildings.build at order time.
- Only distributeWorkers has a gas ratio.
- Worker pickers differ in role (GATHERING vs BUILDING) and fallback.
- swapBuildings is deferred.
