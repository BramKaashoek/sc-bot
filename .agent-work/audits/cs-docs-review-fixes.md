# CS-D01–D07 review fixes (CS-DFIX)

All paths are under packages/core/docs unless noted. Line numbers are approximate; re-locate each one by its text. Verify every fix against the code: the code wins.

## Lead decisions
- Round-2 content (pathing findLowPriorityPath/findLowestCostPoints/findFurthestSafeSpot/sensitivity, influence getCleanGrid/InfluenceGrid targets/layer, constants/aoe, constants/detection, AoE + Terran spell behaviors) ships in the same batch. KEEP it documented, and make sure it describes the working tree.
- REMOVE the `influence.getForcefieldPositions` stub from map.md (it is a stub, still waiting on a user question).
- map.md:92-96/:136: the `closestPathable(point, radius)` / `isPlaceable(point, opts)` / `isPlaceableAt(t, p, opts)` params don't type-check on MapResource. CS-PM14 widens the types, so KEEP the docs as written.
- behaviors.md: update to the working tree. expansionController uses `buildings.getNextExpansion({ checkSafe })` (structures.ts ~173), not `pathing.isPositionSafe`; `layer` accepts `InfluenceLayer | InfluenceGrid`. Also document the new AoE/spell exports (autoUseAOEAbility, useAOEAbility, ghostSnipe, placePredictiveAoE, ravenAutoTurret, reaperGrenade) in behaviors.md or combat.md, wherever the layout puts them.
- Pseudo-type blocks that don't parse: switch them to ```text (units.md/map.md already use this convention), or make them real type declarations.

## Must fix (wrong claims)
- commands.md "How errors surface" table, row 1, "Agent handlers" column: it says "Rethrown, ending the loop". That is wrong. The agent-handler `.catch` in create-engine.ts dispatch swallows everything: NodeSC2Error → debugSilly, anything else → console.warn, and nothing is rethrown. Only system handlers, resource hooks and the flush rethrow.
- commands.md ~166, commander table: drop the "a promise a handler didn't await" → 'unknown' example. AsyncLocalStorage keeps the handler's commander (command-context.test.ts:25-39). Only code outside any runAsCommander gets 'unknown'.
- macro.md:40: expandNow does NOT deduct money right away. The cost is spent when the tracker sends BUILD (buildings.ts orderBuild ~335, macro.ts ~376). Only train/research deduct on proposal.
- build-orders.md:214: "townhalls go through actions.canPlace/actions.build (not a tracked build)". Qualify this as "an untargeted townhall". A targeted townhall (`expand @nat`) goes through trackBuild (builder-plugin.ts ~718-733). Re-check this against the R2-T04 working tree, which routes townhalls through the tracker.
- map.md:52: getClosestExpansion paths to `add(townhallPosition, 3)` (resources/map.ts:177), not to the townhall position.
- map.md:212-213: pathFromMain is computed from the expansion (+3) to your start (+3) (systems/map.ts:493-497), not main→expansion. The 999 placeholder also applies when no enemy start exists.
- map.md:150: the mechanism is wrong. Lowered depots and townhall/nydus corners are walkable because utils/geometry/units.ts:140-163 `pathingCells` are never passed to setPathable(false), not because of setPlaceable. burrowedCreepTumor is also exempt.
- behaviors.md:224: techUp in productionController passes `ignoreExistingTechlabs: current <= target` (production.ts:72). Existing tech labs are IGNORED, so another one can be added. The doc currently says the reverse.
- behaviors.md:188: the code carries on for `ignoreProportions` (freeflow OR total below ignoreProportionsBelowUnitCount) (spawn.ts:94), not just freeflow.
- architecture.md:33: selectBuilder checks only `stuck` and "received a command this observation" (select-builder.ts:20, :29-32). The `command` label is read only by mining (mining.ts:64) and units.getMineralWorkers. Fix the same wrong text at changelog.md ~219.
- architecture.md:21: there is no "command executor" module; arbitration happens in actions.flushQueuedActions.
- compatibility.md:61: with the default speedMining, mineral workers get MOVE + queued SMART (mining.ts:425-456), not HARVEST_GATHER/RETURN.

## Duplication: one owner, others link
- Per-game reset / settings-survive: owned by resources.md. architecture.md:101-110, constants.md:3 and combat.md:59/:190 ("Settings survive a new game") should link to resources.md#per-game-reset instead of restating it. A short restatement plus a link (map.md:343, units.md:384, macro.md:7) is OK.
- Commander / AsyncLocalStorage / flush / arbitration: owned by commands.md (agents.md links). architecture.md:21, :63-65 should link.
- Builder pick: owned by macro.md:278-288. architecture.md:116 should link.
- Influence constants: owned by map.md:431-455. constants.md:105-107 should become a one-line pointer.
- compatibility.md restates build-order and macro behaviours: gas target / ENEMY_NAT_HG_SPOT (:69 vs build-orders.md:140/:155), proxy (:68 vs :207), scout waypoints (:70 vs :209), NAT_WALL (:71 vs :199), and the placement/buildings/mining bullets :53-61 vs macro.md. Keep compatibility.md to the *difference from ares/python-sc2/node-sc2*, one line each, and link to the owner page for the details.
- Inside compatibility.md: influence layers at :25 and :116, combat-sim limits at :35 and :117, Zerg placement at :120 (also in macro.md:88 and build-orders.md:218). Merge these.
- The Tempest sentence has 5 copies (build-orders.md:134, compatibility.md:72, examples/README.md:65, changelog.md:183/:257). Keep one in build-orders.md and the changelog entry that introduced it. Others link or drop.

## Nits (fix all)
- resources.md: world.config is frozen at top level only (shallow Object.freeze, engine/config.ts:78). Say "top level frozen".
- resources.md:157: the onStep second arg equals frame.getGameLoop() only outside realtime (create-engine.ts ~479).
- resources.md events.write: `data` uses `event.data || null`, so any falsy value becomes null. Match agents.md.
- resources.md: give the earmark paragraph its own heading. As written it reads like part of data.register.
- running-games.md debug table: sc2:debug:engine also covers "Queued actions failed".
- commands.md:226: drop "with a handful of systems" (unsupported).
- commands.md actions.build: the selectBuilder fallback also applies when mining.selectWorker returns nothing.
- commands.md actions.do: it also accepts Unit[].
- agents.md: chat-debug and engine systems run outside runAsCommander, so their commander is 'unknown'. One line.
- units.md:337: inject/blink/burrow/toggle silently do nothing when not applicable (create-unit.ts:70-110). toggle defaults to queue: true. inject() with no target picks one of the 3 closest idle hatcheries. units.md:290: distanceToWeaponReady goes negative for units that can't attack.
- behaviors.md:204: document canAffordCheck = false (structures.ts:171). behaviors.md:229: productionController skips a type while notStarted(producer) > 0 (production.ts:76).
- behaviors.md:7-17: BehaviorContext is a `type` in types.ts:1156, not an interface. behaviors.md:179 ArmyComposition is missing the `type` keyword.
- macro.md:115/:164/:231 (PlacementRequest, Placer, BuildOptions): mark them as signature sketches (```text) or make them type-check.
- macro.md:284-285: builder-pick order. reuseConstructing (Protoss) is checked first (select-builder.ts:23). The HARVEST_RETURN queueing applies only to selectBuilder-picked workers (actions.ts:441-452).
- macro.md:54: structureTypeBuildProgress also counts units in production by creation ability (macro.ts:299-306).
- macro.md:90: the Protoss wall pylon carries both `wall` and `productionPylon` (placement.ts:296).
- macro.md:332: assignGas releases one worker per overfull building, not "per step" (mining.ts:262-268).
- macro.md:334: mining.selectWorker also skips command-labelled and constructing workers (mining.ts:64, :219).
- build-orders.md:216: placer-position builds are tracked only for Terran and Protoss. Zerg falls back to an untracked buildAt (builder-plugin.ts ~621-630, ~762-765).
- build-orders.md:110: buildComplete fires again after switchOpening (builder-plugin.ts:312 resets completeSym).
- build-orders.md:106: `earmarks: null` also disables earmarking (builder-plugin.ts:397).
- build-orders.md:341: the history file name uses the lowercased race (openings.ts:40). `undecided` is written as Result 1 (openings.ts:44).
- architecture.md:70: add the gameTimeLimit path to onGameEnd (create-engine.ts:537-541). architecture.md:147: createTestWorld options also include `config`.
- getting-started.md:120-190: mark the method-fragment blocks as fragments. The onStep block should match tutorial.ts exactly, including the `debug` destructure, or stop claiming it is the file "as it stands".

## Out of scope (CS-D08 owns)
- Cross-page anchors/links, replacing the readme, deleting old pages (api.md etc.), the PM13/PM15 doc deltas.
