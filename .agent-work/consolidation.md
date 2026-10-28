# consolidation: one way to do each thing in packages/core

Source: user, 2026-10-27: "we also need to determine where we now have multiple ways of doing the same thing, and only keep the best one" (decisions.md "consolidation work package").
Inputs: .agent-work/audits/*.md plus the auditors' full reports. Claims marked (verified) were re-checked against the code by the architect.
Scope: packages/core only. bot/ was read and grepped, never edited; the user migrates bot/ call sites.

Status: FINAL. (a) and (b) are ready under the parity mandate; (c) is answered (decisions.md "consolidation answers" and the lines after it). Nothing starts before the batch 3 push. bot/ call sites are migrated by the CN-C tickets themselves (Q0).

Paths are relative to packages/core; `bot/` means /bot. Ticket ids: CN-Axx (dedupe), CN-Bxx (bug), CN-Cxx (public, gated), CN-D01 (docs).

## Rules used

- The keeper is the one with the richest semantics that core itself builds on. A wrapper layered on the keeper (e.g. swapBuildings → flying.swap) isn't a duplicate.
- Internal means not reachable from bot/: utils/** (outside the package.json exports map: `.`, `./constants/*`, `./behaviors`, `./types`), private functions and module constants.
- Public means exported from index.ts, behaviors/index.ts or constants/*, or on a types.ts interface reachable from World.
- A bug fix keeps the public signature and fixes behavior. Removing or reshaping a public API is always a question (c).

## (a) Internal-only dedupes

| # | Capability | Ways (file:line) | Keeper, why | Action |
|---|---|---|---|---|
| A-1 | `towards` | utils/geometry/point.ts:135 (canonical; behaviors re-export helpers.ts:57); utils/mining/targets.ts:6, resources/placement.ts:76 | point.ts: shared util; the copies are identical except they return `from` by reference | delete copies |
| A-2 | centroid | point.ts:103 avgPoints; squads.ts:18 centroidOf; utils/map/ramp.ts:9 centerOf; utils/map/expansion-locations.ts:28 clusterCenter. Public `center` (helpers.ts:53) and `Units#center` (units-collection.ts:109) stay as typed wrappers | avgPoints | delete the 3 private copies; keep expansion-locations' trunc+0.5 step at its call site |
| A-3 | squared distance | point.ts:7; engine/create-unit.ts:78; resources/units-collection.ts:12 | point.ts | delete copies |
| A-4 | per-file helpers | cellCentre pathing.ts:8 = map-analysis.ts:62; positionOf/layerFor behaviors/combat/group.ts:21-22 = individual.ts:19-20; randomOf agent/macro.ts:168 = utils/get-random.ts | one copy each | merge |
| A-5 | dead clustering | utils/map/cluster.ts:46 clusterByNeighbor (test-only) | none | delete it and its test |
| A-6 | footprint / grid bookkeeping | footprint→cells loop ×5 systems/map.ts:363-368, 373-377, 474-480, 505-511, 521-526 (@FIXME :133); footprintData ×3 systems/map.ts:29, placement.ts:104, map.ts:401; base assignment systems/map.ts:489-498 = :532-540 | one helper each | merge |
| A-7 | race → unit tables | constants/race-map.ts:5-35 (public); behaviors/macro/structures.ts:30-49; spawn.ts:22; agent/macro.ts:18-33; utils/build-order/parse.ts:15-35; intel.ts:28 | race-map.ts: already public and used by actions/units/mining/builder-plugin | copies import it; add a flying-townhall map there |
| A-8 | unit-type sets | GAS_TYPES buildings.ts:27, placement.ts:59, targets.ts:42; GAS_BUILDING_TYPES macro.ts:38; MINERAL_TYPES macro.ts:47; RESOURCE_TYPES expansion-locations.ts:10; WORKER_TYPES macro.ts:36; CREEP_TUMORS intel.ts:27 = buildings.ts:27; units.getStructures units.ts:112 re-implements isStructure | constants/groups.ts (completed by CN-B01) | copies use groups |
| A-9 | build-worker pick | actions.ts:400-445 inline (GATHERING role, Protoss reuses a constructing probe, sets `command`); macro.ts:240 selectBuildWorker; buildings.ts:63-72 fallback (skips workers on active builds); mining.selectWorker mining.ts:109 is tried first in all | mining.selectWorker, then ONE internal fallback picker (options: role / exclude / Protoss reuse) | merge the 3 fallbacks |

Non-settling afford copies, the six spend sites and the duplicated research lookup are folded into CN-B02, because merging them is how the cost-model bug gets fixed.

### CN-A01 Geometry and small private copies (A-1–A-5)
- What to build: delete the private towards, centroid and squared-distance copies, the duplicated cellCentre / positionOf / layerFor, and the dead clusterByNeighbor (plus its test).
- Acceptance criteria:
  - [ ] No function body equal to point.ts towards/avgPoints/distanceSquared remains outside point.ts (grep: `const towards`, `function towards`, `centroidOf`, `centerOf`, `squaredDistance(`).
  - [ ] Fixture expansion positions, mining targets and placement spots unchanged (existing tests pass).
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: utils/mining/targets.ts, resources/placement.ts (:76 only), resources/squads.ts, utils/map/ramp.ts, utils/map/expansion-locations.ts, engine/create-unit.ts (:78 only), resources/units-collection.ts (:12 only), resources/pathing.ts, resources/map-analysis.ts, behaviors/combat/{group,individual}.ts, utils/map/cluster.ts (+test), new utils/grid/cell.ts. randomOf moves in CN-A03 (macro.ts is P4-T11's). Follow: utils/geometry/point.ts. Don't touch: public exports, agent/macro.ts, mining.ts.
- Stack: core. Staffing: junior.
- Blocked by: none. The PM may hold it until batch 3 is committed.

### CN-A02 Map system bookkeeping (A-6)
- What to build: one footprint→grid helper replacing the five loops; one footprintData; one expansion-base assignment used by onUnitCreated and onEnemyFirstSeen.
- Acceptance criteria:
  - [ ] systems/map.ts has one footprint loop; the @FIXME at :133 is resolved and removed.
  - [ ] Grids after lift/land, structure death and placement are identical on fixtures (existing systems/map and P4-T03 tests pass).
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: systems/map.ts, resources/map.ts (:401 only), resources/placement.ts (:104 only). Follow: utils/geometry/units.ts getFootprint. Don't touch: map public methods.
- Stack: core. Staffing: junior.
- Blocked by: CN-A01 (placement.ts).

### CN-A03 Constants consolidation (A-7, A-8)
- What to build: every race→type table and type-set copy imports constants/race-map.ts / constants/groups.ts; units.getStructures uses isStructure; randomOf from utils/get-random.
- Acceptance criteria:
  - [ ] grep finds none of `GAS_TYPES`, `GAS_BUILDING_TYPES`, `MINERAL_TYPES`, `WORKER_TYPES`, `CREEP_TUMORS`, `WORKER_BY_RACE`, `RACE_UNITS`, `RACE_TOWNHALLS`, `HATCHERIES` outside constants/.
  - [ ] Each replaced set's members are covered by its group (one test per merged set, or the existing tests of its users pass unchanged).
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: constants/race-map.ts, constants/groups.ts, agent/macro.ts (constants + randomOf only), behaviors/macro/structures.ts (:30-49), behaviors/macro/spawn.ts (:22), utils/build-order/parse.ts, resources/intel.ts, resources/buildings.ts (:27), resources/placement.ts (:59), utils/build-order/targets.ts (:42), resources/units.ts (getStructures), utils/map/expansion-locations.ts (:10). Don't touch: logic in those files.
- Stack: core. Staffing: junior.
- Blocked by: CN-B01 (groups.ts completed first), P4-T11 (agent/macro.ts), CN-A02 (placement.ts).

### CN-A04 One build-worker picker (A-9)
- What to build: one internal fallback picker used by actions.build, agent buildNear and the tracker, after mining.selectWorker.
- Acceptance criteria:
  - [ ] The three fallback bodies are gone; mining.selectWorker is still tried first when mining is enabled.
  - [ ] Each caller keeps its behavior: actions.build gives role GATHERING and sets `command`; the tracker skips workers on other active builds and assigns BUILDING once; the Protoss reuse holds. Existing tests are extended per variant, not restated.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: new utils/workers/select-builder.ts (internal), resources/actions.ts (:400-445), agent/macro.ts (:240), resources/buildings.ts (:63-72). Follow: P4-T11's picker changes; decisions.md "batch 2 shipped; P4-T09 review fixes" fix 6. Don't touch: mining.ts.
- Stack: core. Staffing: SENIOR. Reason: cross-cutting worker ownership (roles, `command` label, mining, tracker) with judgment calls where the three pickers disagree.
- Blocked by: CN-B02 (same files), P4-T08 (mining behavior settled).

## (b) Bugs

| # | Bug | Where (file:line) | Fix (signature kept) | Ticket |
|---|---|---|---|---|
| B-1 | Rich gas isn't a gas mine: groups.gasMineTypes has no RICH types (verified), so Unit.isGasMine and units.getGasMines miss rich refineries. mineralFieldTypes lacks MINERALFIELD450 / OPAQUE variants (verified; macro.ts:47 adds them locally) | constants/groups.ts:116, :131; engine/create-unit.ts:205; resources/units.ts:89 | complete both groups | CN-B01 |
| B-2 | Two cost models: canAfford / actions.train / actions.build / tracker check and deduct raw cost (getUnitTypeData), while agent.train / behaviors use net cost (calculateCost). Morphs (orbital, baneling, ravager…) are over-charged on the raw path. Six deduct sites, two non-settling afford copies | create-agent.ts:147,178,198; actions.ts:366,445,485,503; buildings.ts:78,290; builder-plugin.ts:337; macro.ts:277; tech.ts:58; structures.ts:247 | one net-cost model: one spend, one non-settling afford check; research-ability lookup shared (macro.ts:208 = tech.ts:43); tech.ts aliases via techEquivalents | CN-B02 |
| B-3 | Pending counts disagree: alreadyPending misses tracked builds whose worker is still walking (no BUILD order yet); ownUnitCount double-counts unfinished non-Terran units/structures (getById length + alreadyPending); structurePending counts adopted builds in neither term; tech.ts:53 present() and the on-route filters structures.ts:206-210 / production.ts:77-81 are further variants | agent/macro.ts:324; behaviors/macro/helpers.ts:3,7; tech.ts:53 | alreadyPending is the one count (incl. walking tracked builds, no double count); ownUnitCount, structurePending and present() derive from it | CN-B03 |
| B-4 | Two base computations: map.getExpansions (clusters + townhall placement; used by all of core) and map.getExpansionLocations (independent python-sc2 algorithm) can return different coordinates; agent.getNextExpansion / ownedExpansions use the latter | resources/map.ts:145, :423, :453; agent/macro.ts:398, :418 | getExpansionLocations derived from getExpansions; ownedExpansions / getNextExpansion use Expansion objects | CN-B04 |
| B-5 | drawDebug output is invisible unless env `sc2:debug:DebugSystem` is on: the flush runs only under `state.debug` | systems/debug.ts:138-143 (verified) | flush whenever `debug.touched` | CN-B05 |
| B-6 | Stuck-worker handling wipes ALL labels, incl. user labels | systems/frame.ts:79-81 (verified) | remove only 'command', add 'stuck' | CN-B05 |
| B-7 | Units#furthestNUnits(pos, 0) returns every unit (`slice(-0)`) | resources/units-collection.ts:275 (verified) | return none for 0 | CN-B05 |
| B-8 | frame.timeInSeconds (old node-sc2 formula round(loop × 44 / 1000)) disagrees with frame.time() (loop / 22.4); no callers (verified) | resources/frame.ts:44 | removed (Q10) | CN-C02 |
| B-9 | Stale swapBuildings docs (immediate send, ResponseAction[]) | readme.md:754, docs/api.md:823 | already an AC of P4-T13 | P4-T13 |
| B-10 | 'addonSwap' build task is parsed but no runner branch executes it | types.ts:95, utils/build-order/parse.ts:138-150, systems/builder-plugin.ts | already an AC of P6B-T05 ("An addon-swap task calls the flying resource") | P6B-T05 |

bot/ impact of the bug fixes (no bot code change needed; listed for the changelog):
- B-1: bot/systems/economy.ts:14 `isGasMine()` becomes true on rich geysers, so its gas-worker logic runs there too.
- B-3: bot/systems/military/production.ts:27 and training.ts:25 `alreadyPending` count a build while its worker walks. The bot's build system routes Terran builds through the tracker since P4-T11, so today these counts miss walking builds (double-build risk).
- B-2: the bot's canAfford calls (economy.ts:39,53; training.ts:29; production.ts:53,112; wall.ts:34,39,45) are on non-morph types, so results are unchanged.

### CN-B01 Complete resource type groups (B-1)
- What to build: gasMineTypes gains EXTRACTORRICH / ASSIMILATORRICH / REFINERYRICH; mineralFieldTypes gains the variants macro.ts:47 adds (MINERALFIELD450, MINERALFIELDOPAQUE, MINERALFIELDOPAQUE900, …; read the list there).
- Acceptance criteria:
  - [ ] Unit.isGasMine is true for each rich gas type; units.getGasMines includes them (test).
  - [ ] Mineral-field consumers (isMineralField, mining, expansion clustering) handle the added types; fixture expansions unchanged (existing tests).
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: constants/groups.ts (+ test). Don't touch: the copies (CN-A03).
- Stack: core. Staffing: junior.
- Blocked by: none.

### CN-B02 One cost model (B-2)
- What to build: one internal `spend(world, cost)` on net cost (calculateCost / calculateUpgradeCost), used by all six deduct sites. One non-settling affordability check used by the tracker and builder-plugin. canAfford and actions.train/build/upgrade check net cost. One research-ability lookup; tech.ts uses techEquivalents.
- Acceptance criteria:
  - [ ] Exactly one deduction implementation (grep `minerals -=` / `vespene -=` elsewhere: none).
  - [ ] Orbital morph via actions / ctx.order checks and deducts 150 minerals, not 550 (test). A depot costs 100 on every path (test at tracker + actions.build).
  - [ ] canAfford(BANELING) and agent.canAffordUnit(BANELING) agree (test).
  - [ ] Earmark waits unchanged; the earmark isn't settled until send (P4-T09 fix 2 stays green).
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: agent/create-agent.ts (afford internals; public signatures unchanged), agent/macro.ts (spend, researchAbilityOf), resources/actions.ts (:366, :445, :485, :503 only), resources/buildings.ts (:78, :290 only), systems/builder-plugin.ts (:337 only), behaviors/macro/{tech,structures}.ts. Don't touch: public signatures (Q7).
- Stack: core. Staffing: SENIOR. Reason: cross-cutting money accounting across agent, actions, tracker, builder-plugin and behaviors; an off-by-morph error stalls every macro path.
- Blocked by: P6B-T06 (builder-plugin.ts, after P6B-T05), CN-A03 (macro.ts, structures.ts, buildings.ts).

### CN-B03 One pending count (B-3)
- What to build: alreadyPending counts tracked builds in status `moving` without double counting ordered / constructing ones. ownUnitCount = ready+unfinished units + alreadyPending without counting unfinished twice. structurePending counts adopted builds once (it stays public until Q6). present() and the on-route filters derive from alreadyPending / buildings.getTracked.
- Acceptance criteria:
  - [ ] Tracked depot: alreadyPending = 1 while walking, ordered and constructing; 0 when done (test across states).
  - [ ] Adopted (resumed) unfinished structure counted once by structurePending (test).
  - [ ] ownUnitCount for an unfinished gateway = 1, not 2 (test).
  - [ ] Eggs, reactor double queue and archon halving unchanged (existing macro tests).
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: agent/macro.ts (alreadyPending), behaviors/macro/{helpers,tech,structures,production}.ts. Follow: resources/buildings.ts getTracked/pending. Don't touch: buildings.ts, behaviors/index.ts.
- Stack: core. Staffing: SENIOR. Reason: judgment calls on double counting across orders, eggs, tracker states and adopted builds.
- Blocked by: CN-A04 (agent/macro.ts), P5-T08 (production.ts).

### CN-B04 One base computation (B-4)
- What to build: map.getExpansionLocations returns the getExpansions townhall positions; agent.ownedExpansions and getNextExpansion use Expansion objects (getOccupiedExpansions / getAvailableExpansions / pathing order).
- Acceptance criteria:
  - [ ] getExpansionLocations equals getExpansions().map(townhallPosition) on every fixture (test). Each coordinate that moves vs today is listed in the ticket.
  - [ ] getNextExpansion returns an expansion from getAvailableExpansions (test).
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: resources/map.ts (:423, :453), agent/macro.ts (:398-430 only), utils/map/expansion-locations.ts (delete if unused; scripts/capture-fixtures.ts:305 keeps working via the map method). Don't touch: systems/map.ts expansion building.
- Stack: core. Staffing: junior.
- Blocked by: CN-B03 (agent/macro.ts).

### CN-B05 Small public fixes (B-5–B-7)
- What to build: the debug flush runs whenever something was drawn; the stuck-worker branch keeps user labels; furthestNUnits(pos, 0) returns none.
- Acceptance criteria:
  - [ ] placement.drawDebug() reaches the client's debug request with no env flag (test via the fake client).
  - [ ] A stuck worker keeps its user label and gains 'stuck' (test).
  - [ ] furthestNUnits(pos, 0) is empty (test).
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: systems/debug.ts (:138-143), systems/frame.ts (:79-81), resources/units-collection.ts (:275). Don't touch: debug env gating of on-screen text (sc2:DebugOnScreen).
- Stack: core. Staffing: junior.
- Blocked by: CN-A01 (units-collection.ts).

## (c) Bot-facing / public API: questions and answers

Answers (user, 2026-10-27; decisions.md "consolidation answers" and the lines after it):
- Q0: bot/ call sites are migrated by the tickets themselves (the CLAUDE.md bot/ rule is lifted for the call sites listed in CN-C01/C02 only).
- Q1: keep both. map.path = static map structure (placement, expansion ordering, regions); pathing.* = unit movement. CN-D01 documents the split; no code change.
- Q2: remove units.getClosest; migrate bot/systems/economy.ts:16.
- Q3, Q5, Q6, Q7, Q8, Q10: as recommended (a).
- Q4 (a): remove distributeWorkers.
- Q9: game ability data is the single source (data.findUnitTypesWithAbility, units.getProductionUnits, units.getUpgradeFacilities). trainedFrom/researchedFrom callers move onto it; the ticket's first step is a disagreement diff so regressions (Lair/Hive, WarpGate equivalents) surface.
- Q11: keep both getCombatRally and getDefensivePosition; CN-D01 states rally point vs choke hold point.

The questions as asked, for the record (each option list ends with the recommendation):

- Q0 Removal policy. (a) Remove bot-unused public APIs now; mark bot-used ones `@deprecated` (changelog migration line) and remove them in a follow-up after the user migrates bot/. (b) Deprecate everything first. (c) Remove everything now (breaks bot/ until the user fixes it). **Rec (a).**
- Q1 map.path vs pathing (ground paths). Ways: map.path map.ts:477 (PathFinding.js, static setup analysis, wall weights, used by expansion ordering / region / getClosestExpansion); pathing.findPath / nextPoint pathing.ts:68,73 (own A*, influence-aware, runtime); map.queryPathing map.ts:468 (engine, async); distance fields (internal). (a) Keep map.path for setup and pathing for runtime, documented (parity-2 D6). (b) Reimplement map.path on the internal A* and drop PathFinding.js; this changes expansion ordering and every fixture. (c) Deprecate map.path. **Rec (a).** bot/: none.
- Q2 units.getClosest units.ts:18 is a strict duplicate of `Units.from(arr).closestNUnits(pos, n)`. (a) Deprecate, then remove. (b) Keep. **Rec (a).** bot/: economy.ts:16 → `Units.from(workers).closestNUnits(pos, 3)`.
- Q3 Point helpers are internal, so bot/ keeps copies. (a) Export `distance`, `distanceSquared`, `towards`, `avgPoints`, `closestPoint` from the root; behaviors stops re-exporting towards. (b) No. **Rec (a).** bot/ can drop anchor.ts:6-12, combat/micro/basic.ts:9, military/wall.ts:60-61.
- Q4 agent.distributeWorkers macro.ts:434 vs the mining resource. (a) Remove; mining is the only worker manager, and `workersPerGas` covers gas (ares has no mineral/gas ratio). (b) Keep both with "pick one" docs (P4-D12 status quo). (c) Remove and port `resourceRatio` into mining. **Rec (a).** bot/: none (examples T03 already moves ramp-wall to mining).
- Q5 agent.expandNow macro.ts:425 (untracked, private buildNear) vs buildings.build / expansionController. (a) Reimplement on `buildings.build(townhall, { at })` (tracked; python-sc2 name kept). (b) Remove; use expansionController. (c) Keep. **Rec (a).** actions.build stays as the single-command primitive in every option; bot/ uses it (economy.ts:41, production.ts:64, wall.ts:35,40,49). bot/ doesn't use expandNow.
- Q6 behaviors' structurePending (after CN-B03 it equals alreadyPending for structures). (a) Remove it from behaviors/index.ts; callers use agent.alreadyPending. (b) Keep both. **Rec (a).** behaviors is unreleased; bot/: none.
- Q7 Afford API: canAfford create-agent.ts:178, canAffordUnit :147, canAffordN :198, canAffordUpgrade :214, canFeed :143. (a) `canAfford(type, earmark?, opts?: { count?, supply? })`; remove canAffordUnit / canAffordN; keep canAffordUpgrade (upgrade ids collide with unit ids) and canFeed (supply only). (b) Keep all. **Rec (a).** bot/ calls only canAfford and canFeed; both signatures are kept.
- Q8 hasTechFor create-agent.ts:234 (boolean; UnitTypeData + own alias scan) vs techRequirementProgress macro.ts:366 (0..1; dict + techEquivalents). (a) hasTechFor = techRequirementProgress ≥ 1 (one requirement and alias source), with a test pinning the bot's call types. (b) Keep both implementations. **Rec (a).** bot/: production.ts:49,109, wall.ts:46.
- Q9 Producer / researcher lookup: trainedFrom / researchedFrom dicts (agent.train/research, behaviors) vs units.getProductionUnits units.ts:236 / getUpgradeFacilities :247 via ability data (actions.train/upgrade, builder-plugin). (a) Diff both over every trainable type and upgrade first, report disagreements (WarpGate, Lair are suspects), then pick. (b) Dicts now. (c) Ability data now. **Rec (a).** I can't recommend a keeper without the diff. bot/: indirectly through agent.train (training.ts:30) and actions.train (economy.ts:53, training.ts:16).
- Q10 Game time. (a) Remove frame.timeInSeconds and export `GAME_LOOPS_PER_SECOND` from constants (22.4 is declared six times in core: frame.ts:3, create-unit.ts:52, create-engine.ts:59, buildings.ts:21, intel.ts:26, influence.ts:26). (b) Keep timeInSeconds (aligned by CN-B05) and export the constant. **Rec (a).** bot/: index.ts:22 and log.ts:6 declare 22.4; log.ts:8 reimplements frame.timeFormatted.
- Q11 map.getCombatRally map.ts:225 vs mapAnalysis.getDefensivePosition map-analysis.ts:231 (rally point vs choke hold point; they return different points). (a) Keep both, documented. (b) Reimplement getCombatRally on getDefensivePosition of the outermost owned base, which moves where the bot's army waits. **Rec (a).** bot/: combat/index.ts:38, offense.ts:93,157,216, utils.ts:34.

### CN-C01 Public API removals and reshapes (Q2, Q4–Q8)
- Source: decisions.md "consolidation answers".
- What to build:
  - Q2: remove units.getClosest (types.ts UnitResource, resources/units.ts:18-37 and :82). Every internal caller (grep `getClosest(` after CN-A04, which moves the buildings/actions pickers) uses `Units.from(...).closestNUnits` or, where the pool is known non-empty, `closestTo` (it throws on empty).
  - Q4: remove agent.distributeWorkers (types.ts:192, agent/macro.ts:434) and its tests.
  - Q5: agent.expandNow builds through `buildings.build(townhall, { at })` at CN-B04's next expansion; remove the private buildNear.
  - Q6: remove structurePending from behaviors/macro/helpers.ts and behaviors/index.ts; callers use agent.alreadyPending (correct after CN-B03).
  - Q7: `canAfford(unitTypeId, earmarkName?, opts?: { count?: number; supply?: boolean })` on net cost; remove canAffordUnit and canAffordN and move their callers (agent/macro.ts:284,542,585,613; behaviors/macro/spawn.ts amountFor). canAffordUpgrade and canFeed stay.
  - Q8: hasTechFor returns `techRequirementProgress(unitTypeId) >= 1`; its own alias scan goes.
  - bot/ migration (Q0): bot/systems/economy.ts:16 `units.getClosest(building.pos, units.getMineralWorkers(), 3)` → `Units.from(units.getMineralWorkers()).closestNUnits(building.pos, 3)` (import `Units` from `@sc-bot/core`). No other bot/ file uses a removed API (verified grep: distributeWorkers, expandNow, structurePending, canAffordUnit, canAffordN absent). bot/'s canAfford, canFeed and hasTechFor calls keep their signatures.
- Acceptance criteria:
  - [ ] getClosest, distributeWorkers, buildNear, structurePending, canAffordUnit and canAffordN are gone from types.ts, behaviors/index.ts and the code (grep across packages/core and bot/: none).
  - [ ] expandNow issues a tracked townhall build at the next free expansion (`buildings.getTracked()` has it; test).
  - [ ] canAfford honours `{ count: 2 }` and `{ supply: true }` (test). Net cost is covered by CN-B02's orbital test, not restated.
  - [ ] hasTechFor is unchanged for the bot's call types (bot/systems/military/production.ts:49,109, military/wall.ts:46; read the types there) and true via a tech-equivalent structure (e.g. a lowered depot for barracks) (test).
  - [ ] Root `bun run check-types` (core + bot), `bun test` in packages/core and lint green.
- Implementation plan:
  - Where: types.ts (UnitResource.getClosest; Agent.distributeWorkers / canAffordUnit / canAffordN / canAfford lines only), resources/units.ts, agent/create-agent.ts, agent/macro.ts, getClosest callers in packages/core, behaviors/index.ts, behaviors/macro/{helpers,spawn,structures,tech,production}.ts (structurePending / canAffordN callers only), bot/systems/economy.ts (:16 only).
  - Follow: resources/units-collection.ts Units.from / closestNUnits; resources/buildings.ts build.
  - Don't touch: builder-plugin.ts, any other bot/ file.
- Stack: core (+ one bot/ call site). Staffing: junior.
- Blocked by: batch 3 push, CN-B04 (agent/macro.ts), CN-A04 (actions.ts, buildings.ts), CN-B03 (behaviors/macro), P6B-T05 (types.ts).

### CN-C02 Root point helpers and game-time constant (Q3, Q10)
- Source: decisions.md "consolidation answers".
- What to build:
  - Q3: export `distance`, `distanceSquared`, `towards`, `avgPoints` and `closestPoint` from index.ts. behaviors/index.ts and behaviors/combat/helpers.ts stop re-exporting towards; behaviors keeps `center`.
  - Q10: remove frame.timeInSeconds (types.ts FrameResource, resources/frame.ts:44, its test). Add constants/time.ts exporting `GAME_LOOPS_PER_SECOND = 22.4` (importable as `@sc-bot/core/constants/time`), used by the six core copies (resources/frame.ts:3, engine/create-unit.ts:52, engine/create-engine.ts:59, resources/buildings.ts:21, resources/intel.ts:26, resources/influence.ts:26).
  - bot/ migration (Q0):
    - bot/systems/anchor.ts:6-12 inline towards → `towards` from `@sc-bot/core`.
    - bot/systems/combat/micro/basic.ts:9 local distance → `distance`.
    - bot/systems/military/wall.ts:60-61 inline hypot → `distance`.
    - bot/index.ts:22 and bot/systems/log.ts:6 `LOOPS_PER_GAME_SECOND = 22.4` → `GAME_LOOPS_PER_SECOND`.
    - formatGameTime (log.ts:8) stays: it formats an arbitrary loop (index.ts:43,83), which frame.timeFormatted can't.
- Acceptance criteria:
  - [ ] `import { towards, distance, distanceSquared, avgPoints, closestPoint } from '@sc-bot/core'` type-checks (bot/ uses it).
  - [ ] No `22.4` literal in packages/core outside constants/time.ts, and none in bot/ (grep).
  - [ ] grep code for `timeInSeconds`: none (readme is CN-D01's).
  - [ ] bot/ behavior unchanged: each replaced bot helper is the same formula (reviewer checks the diff; no new bot tests).
  - [ ] Root `bun run check-types`, `bun test` in packages/core and lint green.
- Implementation plan:
  - Where: index.ts, behaviors/index.ts, behaviors/combat/helpers.ts (re-export line), new constants/time.ts, types.ts (FrameResource), resources/frame.ts (+ test), the six constant sites above, bot/systems/anchor.ts, bot/systems/combat/micro/basic.ts, bot/systems/military/wall.ts, bot/index.ts, bot/systems/log.ts (:6 only).
  - Follow: utils/geometry/point.ts (exported as is; no signature changes).
  - Don't touch: other bot/ code.
- Stack: core (+ bot/ call sites). Staffing: junior.
- Blocked by: CN-C01 (types.ts), CN-B05, CN-A01 (create-unit.ts).

### CN-C03 Producer and researcher lookup on game ability data (Q9)
- Source: decisions.md "consolidation answers" Q9.
- What to build:
  - Step 1, before any code change: a disagreement diff. For every unit type with a creation ability and every upgrade in the fixture data (fixtures/data.json), compare producer types from trainedFrom / researchedFrom (constants/dicts) with types from game ability data (data.findUnitTypesWithAbility). Record every disagreement in the ticket, grouped into equivalents (Lair/Hive for Hatchery research; WarpGate for Gateway units; flying, lowered and burrowed variants; Orbital/PF for CC) and other. Send it to the PM and wait for acknowledgement.
  - Step 2: move every core trainedFrom / researchedFrom reader onto ability data: agent.train / research (agent/macro.ts:546, :630), morphCost / calculateCost (agent/create-agent.ts:36, :136), behaviors/macro/spawn.ts:69,92, production.ts:67, tech.ts:126,132,136,190. Type-level questions use data.findUnitTypesWithAbility; unit-level ones use units.getProductionUnits / getUpgradeFacilities. Each equivalence the dicts covered and ability data doesn't is mapped explicitly (via techEquivalents / alias data), so step 1's regressions don't ship.
  - The dicts stay exported from constants/dicts (public; not part of Q9); core just stops reading them for producers.
- Acceptance criteria:
  - [ ] The step-1 diff is in the ticket before any code change, and the PM has acknowledged it.
  - [ ] grep: no `trainedFrom` / `researchedFrom` import in packages/core outside constants/ and tests.
  - [ ] Each step-1 disagreement has a test pinning the post-change producer (e.g. a Lair researches overlord speed, a warpgate is a zealot producer for agent.train and spawnController, a Hive researches burrow).
  - [ ] Existing agent/macro, spawn, production and tech tests pass unchanged.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: agent/macro.ts, agent/create-agent.ts, behaviors/macro/{spawn,production,tech}.ts, resources/units.ts (getProductionUnits / getUpgradeFacilities only if an equivalence must live there), engine/data-storage.ts (only if a type-level helper is needed).
  - Follow: resources/units.ts:236-255; agent/macro.ts techEquivalents (:149).
  - Don't touch: constants/dicts, builder-plugin.ts.
- Stack: core. Staffing: SENIOR. Reason: a data-source swap under agent.train, research and the controllers, with known equivalence regressions to judge; a wrong producer silently stops production.
- Blocked by: CN-C01 (agent/macro.ts, create-agent.ts, behaviors/macro), CN-B02 (create-agent.ts cost lookup).

## Docs

### CN-D01 Docs + changelog
- What to build: readme and docs/api.md for every fixed, changed or removed API (Q2–Q10 as answered); the Q1 split (map.path = static map structure, pathing = unit movement) in the map and pathing sections; the Q11 split (getCombatRally = rally point, mapAnalysis.getDefensivePosition = choke hold point); the root point helpers and `@sc-bot/core/constants/time`; "Changes compared to node-sc2" entries (timeInSeconds, distributeWorkers, getClosest removed); docs/changelog.md `Unreleased › Consolidation` with Fixed (B-1–B-8), Changed, Deprecated, Removed and `Migrating bot/` (the bot/ call sites in (b) and (c) with replacements).
- Acceptance criteria: per docs-plan §4 template; grep readme.md and docs/ for each removed name: none; every deprecated API's doc names its replacement.
- Implementation plan: Where: packages/core/readme.md, docs/api.md, docs/changelog.md, docs/internals.md if a resource note changes. Don't touch: code.
- Stack: core (docs). Staffing: junior.
- Blocked by: all CN tickets, examples T08 (docs chain: … → P6B-T07 → examples T08 → CN-D01).

## Checked, no action

- actions.gather vs actions.mine: pick-a-field vs explicit target; bot uses both.
- Enemy queries: units.* = current units; memory.getEnemies = with ghosts (`includeGhosts: false` is just a flag). bot/systems/combat/offense.ts:21-24 hand-rolls ghosts with a 60 s window while memory expires them at 30 s: the user's call.
- Army value (cost) vs supplyArmy (food): different measures.
- Command paths: sendAction / chatSend / toggleAutocast are deliberate bypasses; swapBuildings → flying.swap is layered (P4-T10).
- placement.request vs actions.findPlacement: precomputed own-base spots vs SC2-authoritative search (Zerg and proxies need the latter). Ramp getters vs the placement wall solver: the solver is built on the getters.
- Labels vs roles: user tags vs command ownership. Moving core's internal 'command' / 'dead' / 'stuck' off labels touches ~25 sites for no user-visible gain; only the wipe bug (B-6) is fixed.
- Config precedence (6a D13), the four command-priority settings, getThirds vs getDefensiveThird, alreadyPendingUpgrade vs tech.ts pendingOrComplete (python-sc2 semantics vs boolean "ordered"): layered or distinct by design.

## Dependency order

- Everything waits for the batch 3 push; then CN-B01 and CN-A01 go first.
- CN-A01 → CN-A02 → CN-A03 (after CN-B01, P4-T11) → CN-B02 (after P6B-T06) → CN-A04 (after P4-T08) → CN-B03 (after P5-T08) → CN-B04 → CN-C01 (after P6B-T05) → CN-C02 → CN-C03 → CN-D01.
- CN-B05 can go any time after CN-A01.
- The chain is serial because of overlapping edits in agent/macro.ts, placement.ts, buildings.ts and types.ts.

## CN-B04 behaviour notes (for CN-D01 changelog)
getNextExpansion/ownedExpansions now use Expansion objects: enemy-held expansions are excluded from getNextExpansion; a macro hatch (not assigned as base) no longer counts as owning a location; tie order between equal pathing distances may differ; getExpansionLocations order is now getExpansions order (same coordinates).
