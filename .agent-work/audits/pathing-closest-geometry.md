# Audit: pathing, closest/in-range, geometry duplicates
Read-only audit. Paths under packages/core unless prefixed bot/.

PUBLIC SURFACE: package.json exports only ".", "./constants/*", "./behaviors", "./types". utils/** is NOT importable from bot/. index.ts exports Units, Ramp, PixelMap, canWinFight, simulateFight, parseBuildOrder, influence consts, errors, types. Resources are public via world.resources.get(). bot/ never imports @sc-bot/core/behaviors.

## 1. Pathing
- map.path (resources/map.ts:477, types.ts:465, public): sync, PathFinding.js PF.Grid in map._graph (weights 2-5 by blocked neighbours; mutated only by setPathable map.ts:80 / isPlaceable :99), Manhattan heuristic, returns floored integer [x,y][] ([] = unreachable), cached in determinedPaths (cleared on setPathable/setGraph/isPlaceable; opts.force/opts.graph bypass). NOT influence-aware. Core callers: map.ts:181 (getClosestExpansion), map.ts:247, systems/map.ts:224 (custom graph), systems/map.ts:281, utils/map/region.ts:8. bot/: none.
- map.queryPathing (map.ts:468, types.ts:476, public): async, engine query via actions.sendQuery, live pathing incl. buildings, returns float|null. Core caller: agent/macro.ts:408 only. bot/: none.
- pathing resource (resources/pathing.ts, types.ts:874, public): sync, own createAStar (octile) over influence grid (default layer 'ground'; Infinity = unpathable from map._grids.pathing, else 1 + enemy weights; rebuilt lazily once per game loop, influence.ts:167-170). Influence-aware; accepts layer name or raw grid; blocked goal retargeted within radius 3; results are cell centres +0.5.
  - findPath :68 → NO callers. nextPoint :73 → group.ts:118,166; individual.ts:147; buildings.ts:382; mining.ts:414,526,536. closestSafeSpot :91 → group.ts:164; individual.ts:167,194; mining.ts:394. isPositionSafe :121 → group.ts:160; individual.ts:166; behaviors/macro/structures.ts:198; mining.ts:387,389,408,498. bot/: none.
- createAStar utils/pathing/astar.ts:4: internal, only pathing.ts.
- mapAnalysis distance field utils/map/distance-field.ts:4: internal, used only by map-analysis.ts fieldFrom (:183); Dijkstra over static walkable Uint8Array, cached per start cell, not live, not influence-aware; exposed only as BaseChoke.pathDistance in getBaseChokes (:220-229) and getDefensivePosition (:231-270). bot/: none.
- map.getClosestExpansion (map.ts:173) uses map.path().length with Euclid fallback; core callers systems/map.ts:491,534; bot/systems/combat/scout.ts:57.
- Merge-relevant: map.path = weighted PF nodes, Manhattan, integer cells; pathing = influence cost, octile, +0.5 centres, goal retarget. Both derive from map._grids.pathing via different structures. queryPathing is the only async/live-engine one.

## 2. Closest / in-range (center-to-center unless noted)
- units.getClosest(pos, arr, n=1) (units.ts:18-37, attached :82, types.ts:327-328, public): sorts copy, slices n, returns Units; PowerSource[] overload type lies; no ghost logic. Core callers: actions.ts:246,247,417,421,424,427,547; buildings.ts:69; engine/create-unit.ts:101; examples/tutorial.ts:77. bot/: economy.ts:16.
- Units collection (resources/units-collection.ts, exported; private squaredDistance :12): center :109; inAttackRangeOf :228 (edge-based); closestDistanceTo/furthestDistanceTo :232/:237; closestTo/furthestTo :242/:249 (first wins ties, throws on empty); closerThan :256 (strict <); furtherThan :260; inDistanceBetween :264; closestNUnits :271; furthestNUnits :275 (n=0 returns all — bug); inDistanceOfGroup :279; inClosestDistanceToGroup :286; nClosestToDistance/nFurthestToDistance :295/:299; sortedByDistanceTo :316.
  - Core callers: closestTo → mining.ts (many), flying.ts:104, terran.ts:48,77, individual.ts:256,270. closerThan → mining.ts:204,210,234,238,260,287,337. sortedByDistanceTo → mining.ts:235,238,289,311,314. Other Units distance methods: zero core callers.
  - bot/: closerThan → defense.ts:9,41; offense.ts:28,29,40,117; scout.ts:62,79,104; combat/utils.ts:16,34; military/wall.ts:29,33,38; military/production.ts:42. closestTo → combat/micro/basic.ts:51. .center → offense.ts:117.
- spatial resource (resources/spatial.ts, types.ts:842, public): per-loop bucket index; enemies from memory.getEnemies() (includes ghosts); own from units.getAlive(SELF). unitsInRange :45 (inclusive <=, unsorted) → mining.ts:373, intel.ts:175, terran.ts:181, individual.ts:253. anyInRange :51 → no callers. closest :54 → intel.ts:178. bot/: none.
- Unit methods (engine/create-unit.ts): distanceTo :587 (center) → core mining.ts:243, buildings.ts:94,380; bot micro/basic.ts:37, scout.ts:61,104,107, offense.ts:36,93. targetInRange :394 and inAbilityCastRange :405 are EDGE-based.
- plane.ts:22/:28 distanceAAShapes/distanceAAShapeAndPoint edge-to-edge, only systems/map.ts:69-70.
- behaviors/combat/helpers.ts (public via behaviors; bot uses none): attackReady :5, inAttackRange :16 (= Units.inAttackRangeOf), pickEnemyTarget :20, duplicateOrSimilarOrder :33, groupWeaponsOnCooldown :47, center :53, towards :57 (re-export). Private dupes: group.ts:24 byDistanceTo, terran.ts:145 within.
- Other non-public closest code: point.ts closestPoint :88, nClosestPoint :95; placement.ts:82 closest; inline reduces squads.ts:50-57, agent/macro.ts:445, buildings.ts:112; bot/systems/military/wall.ts:60-61 duplicates examples/ramp-wall.ts:48-49.
- Merge-relevant: getClosest (array, n, sorted) vs closerThan (filter, strict <) vs spatial (inclusive <=, unsorted, includes ghosts) vs targetInRange/attackReady (edge gap). closestNUnits == getClosest functionally (0 core callers).

## 3. Geometry duplicates
- towards: point.ts:135 (canonical, zero-length returns copy); helpers.ts:57 (public re-export); utils/mining/targets.ts:6 and placement.ts:76 (private, identical to each other, return `from` by reference); examples/cannon-rush.ts:13; bot/systems/anchor.ts:6-12 inline; scripts/capture-fixtures.ts:647.
- distance: point.ts:16 canonical. Copies: bot/micro/basic.ts:9, test/fake-client.ts:222, scripts/capture-fixtures.ts:121; Unit.distanceTo; combat-sim.ts:112 gapBetween (edge).
- distanceSquared: point.ts:7 (~35 callers); private copies create-unit.ts:78, units-collection.ts:12. distanceX/distanceY point.ts:20/24: 0 callers.
- Inline hypot/squared: combat-sim.ts:113, expansion-locations.ts:20, create-unit.ts:589, examples ramp-wall/cannon-rush; pathing.ts:27,109,148; bucket-index.ts:112; chokes.ts:336.
- Centroid (6 copies): point.ts:103 avgPoints (NaN on empty); helpers.ts:53 center (public); Units.center :109 (throws on empty); squads.ts:18 centroidOf; ramp.ts:9 centerOf; expansion-locations.ts:28 clusterCenter (:70-71 trunc+0.5 variant). Also cluster.ts:40 running mean; terran.ts:179 inline midpoint.
- cellCentre identical at pathing.ts:8 and map-analysis.ts:35.
- bot/ local copies exist because core's point.ts helpers aren't exported: anchor.ts (towards), micro/basic.ts:9 (distance), military/wall.ts:60-61 (hypot min).
