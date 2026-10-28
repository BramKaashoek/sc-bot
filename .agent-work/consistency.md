# consistency: packages/core internal + outward consistency and docs cleanup

Source: user, 2026-10-27 overnight (core-arch.decisions.md, last entry): "make the framework internally consistent, outwardly consistent, and clean up the docs". Overnight rule: no public API change without the user.
Raw audits (file:line detail, blast-radius counts, method): audits/cs-public.md (PUB-nn), audits/cs-internal.md (INT-nn), audits/cs-comments.md (comment sweep), audits/cs-docs.md (DOC-nn, target doc structure, migration tables). Audited at a8b1f38 + the dirty tree (R2-T01 scaffolding in flight). Code wins over docs; high-severity claims re-checked by the architect against the code.
Not redone: consolidation.md (CN-*).

Status: DRAFT. CS-I, CS-D and CS-PM tickets are runnable in the order below. PQ1–PQ10 answered (user, 2026-10-28; core-arch.decisions.md last entry): tickets in "Answered questions (CS-PQ tickets)"; folds into CS-PM05a/b/c, PM06, PM08, PM10 are marked "Changed per PQn". PQ8 superseded (no ticket). DQ1 settled (a) by the lead. Public split per user (via lead, 2026-10-27): minor public changes run overnight and migrate bot/ call sites; only removing/reshaping core concepts and semantic changes wait.

## Summary

| class | findings | high | med | low | tickets |
|---|---|---|---|---|---|
| public | 46 | 9 | 19 | 18 | CS-PM01–PM18 (PM05 split a/b/c, PM18 split a/b); CS-PQ01a, PQ01b, PQ02a, PQ04, PQ05, PQ06a, PQ06b, PQ07a, PQ07b, PQ07c, PQ09, PQ10d; 4 no-change |
| internal | 23 | 0 | 7 | 16 | CS-I01–I15 (runnable; I06, I13, I14, I15 wait for R2 tickets) |
| docs | 58 | 4 | 26 | 28 | CS-D01–D10 (runnable) |
| total | 127 | 13 | 52 | 62 | |

Headlines:
- Public: the surface has no single rule for failure (throw / false / null / undefined / 0), defaults (queue, alliance scope, hidden workers), time units (loops vs seconds, unsuffixed) or coordinates (townhall cell vs centre, tuples vs Point2D). Most fixes are minor (renames, option shapes, honest types, bug-shaped fixes: CS-PM); eight questions remain for the user (failure rule, defaults, semantics, concept removals, stub policy). bot/index.ts:14 enables only `sc2:debug:system`, so every BuildError/TrainError a bot system throws is invisible today (PUB-02).
- Internal: one resource-definition pattern for 14 resources and another for the core 6; hand-written resets that must mirror `create` field by field; per-game state in system-level WeakMaps outside the reset lifecycle; small helpers copied 5–10 times; test scaffolding copied in 27 files. Comments are already nearly clean (48 lines to cut/trim in 11 files).
- Docs: code-level content is accurate (every documented name exists; 36/38 readme snippets type-check; no broken links). The problems are four legacy node-sc2 pages that are wrong (persistent events, `gasWorker` label, CommonJS tutorial that can't be followed), the same facts written 3–6 times across readme/api.md/legacy pages, and a 2232-line readme.

## Findings

Class: P = public, I = internal, D = docs. Detail and both-sides citations are in the audit file named by the id prefix.

### Public

| id | sev | file:line | finding | ticket |
|---|---|---|---|---|
| PUB-01 | high | resources/actions.ts:393 (throws BuildError); agent/macro.ts:388 (returns 0); resources/buildings.ts:162 (undefined) | refusal signalled four ways (throw / 0 / false / undefined) for the same intent | PQ1 |
| PUB-02 | high | systems/create-system.ts:121-130, :136-146 | NodeSC2Error from handlers goes to `sc2:silly:system`, other errors to `sc2:debug:system`; bot enables only the latter (bot/index.ts:14) | CS-PM01 |
| PUB-03 | high | resources/actions.ts:256, :300 vs :174 | `queue` defaults true for gather/mine/toggle, false everywhere else | PQ2 |
| PUB-04 | high | resources/units.ts:138 vs :213-219 | getById defaults to SELF, getByType to all alliances; filter param types differ per getter | CS-PM05 (filter type), PQ2 (defaults, getByType) |
| PUB-05 | high | utils/map/townhall.ts:21; resources/map.ts:439; agent/macro.ts:385 | `Expansion.townhallPosition` is the floored cell, helpers return centre (+0.5); CN-B04's AC ("getExpansionLocations = townhallPosition") isn't what the code does | CS-PM07 (townhallCenter), PQ4 |
| PUB-06 | high | resources/placement.ts:551 (seconds) vs resources/buildings.ts:141, flying.ts:81, intel.ts:253 (loops) | stored timestamps mix loops and seconds, no unit in the name | CS-PM06 (names), PQ3 (reservedAt) |
| PUB-07 | high | resources/map.ts:74-107, :217 | isPathable/isPlaceable/isVisible/hasCreep/getHeight: y out of bounds throws, x out of bounds returns "pathable" | CS-PM02 |
| PUB-08 | high | resources/units.ts:166-176 | `getWorkers()` hides workers with the internal `command` label; bot/index.ts:47 under-reports | CS-PM05 (option shape), PQ2 (semantics) |
| PUB-09 | high | resources/units-collection.ts:97-107, :366 | `first`/`random`/`center` getters and closestTo/furthestTo throw plain Error on empty; findByTag/spatial.closest return undefined | PQ1 |
| PUB-10 | med | resources/units-collection.ts:274, :298 | furthestNUnits returns ascending order; nFurthestToDistance(.., 0) returns every unit (sibling of the CN-B05 fix) | CS-PM02 (guard), PQ7 (order) |
| PUB-11 | med | actions.ts:386 (false); placement.ts:506 (undefined); macro.ts:358, map.ts:460 (null); utils/map/ramp.ts:66-111 (null); map.ts:164 (throws) | "not found" shape differs per call | PQ1 |
| PUB-12 | med | types.ts:440-443 vs map.ts:123-134; engine/data-storage.ts:41-59; utils/geometry/point.ts:98-103; systems/frame.ts:17-31 | non-optional return types that return undefined or throw | CS-PM03 |
| PUB-13 | med | engine/data-storage.ts:44-49 vs engine/create-unit.ts:259 | getUnitTypeData subtracts 50 minerals for Zerg structures, raw `data.get('units')` doesn't | PQ6 |
| PUB-14 | med | agent/create-agent.ts:170-182 | `canAfford`/`canAffordUpgrade` settle the earmark (predicate with a side effect) | PQ7 |
| PUB-15 | med | agent/macro.ts:341, :360 vs resources/map.ts:148, :154 | expansions exposed on agent (OwnedExpansion, Promise<Point2D \| null>) and map (Expansion) | PQ6 |
| PUB-16 | med | systems/unit.ts:86, :91, :108, :173, :182, :229 | one occurrence fires two events (structure*/building*, unitDamaged/unitTookDamage, created/spawned) | PQ6 |
| PUB-17 | med | agent/macro.ts:387, :481 vs resources/actions.ts:495, :550 | agent.train vs actions.train differ in semantics; research vs upgrade verbs | CS-PM08 (research → upgrade) |
| PUB-18 | med | engine/create-unit.ts:178-210 vs :269-287; units-collection.ts:159-169 | is<Activity> predicates use any-order vs first-order rules; Units getters a third rule | PQ7 |
| PUB-19 | med | engine/create-unit.ts:178, :284 | `isConstructing()` means "worker has a build order", not "structure under construction" | CS-PM08 |
| PUB-20 | med | resources/actions.ts:135-247; agent/macro.ts:369-517 | command-queueing calls are async with sync bodies; sibling resources are sync | PQ5 |
| PUB-21 | med | resources/actions.ts:388; agent/create-agent.ts:170; agent/macro.ts:387 | positional vs option-object params for the same concepts (queue, worker, earmark) | CS-PM04, CS-PM05 |
| PUB-22 | med | resources/actions.ts:135; resources/behaviors.ts:26; engine/create-unit.ts:584 | three argument orders for "issue ability" | CS-PM04 |
| PUB-23 | med | resources/map.ts:462; types.ts:362 | map.path / pathFrom* are `[x,y]` tuples, everything else Point2D | CS-PM07 |
| PUB-24 | med | resources/map.ts:74-96, :441-452 | pathing grid 0 = good, placement grid 1 = good; isPathable (live) vs inPathingGrid (start) | CS-PM07 |
| PUB-25 | med | resources/buildings.ts:124; memory.ts:5; placement.ts:54; engine/create-unit.ts:150 | settings in seconds without suffix; getLife 0..100 vs fractions elsewhere | CS-PM06 |
| PUB-26 | med | resources/units.ts:135; systems/frame.ts:108 | getAlive = "seen this loop"; getAll/getByTag return dead own units forever | CS-PM08 (rename), PQ7 (getAll) |
| PUB-27 | med | types.ts:412-475, :661-688 | `_fields` and engine-only `set*` mutators on public MapResource/FrameResource | CS-PM09 |
| PUB-28 | med | dirty tree: resources/{influence,intel,pathing,buildings}.ts, behaviors/combat/{aoe,spells}.ts | R2-T01 stubs typed callable, throw "not implemented" (invisible per PUB-02) | PQ8 |
| PUB-29 | low | BuildTaskOptions.near, BuildOptions.at, agent.train closestTo, WarpInOptions.nearPosition | position-param naming | CS-PM05 |
| PUB-30 | low | resources/units-collection.ts:254, :258 | closerThan(distance, pos) vs position-first everywhere else | CS-PM05 |
| PUB-31 | low | behaviors/combat/helpers.ts:41; group.ts:98 | two spellings of squared-distance params | CS-PM10 |
| PUB-32 | low | units.getStructures vs buildings; getGasGeysers/getGasMines/freeGasGeysers/buildGas | vocabulary drift (structure/building, gas, base/townhall, pending) | CS-D10 |
| PUB-33 | low | agent/create-agent.ts:89-118 | food* proto fields and supply* accessors both on Agent; differ for Zerg | CS-D09 (docs only) |
| PUB-34 | low | behaviors/macro/spawn.ts:37 et al. | behavior options: toCount/maximum, maxPending/maxOnRoute, extraRange/bonusDistance | CS-PM10 |
| PUB-35 | low | index.ts:19; behaviors/index.ts:4 | root exports a slice of point helpers; three centroid helpers; different empty-input behaviour | CS-PM08 |
| PUB-36 | low | types.ts:503-519 vs actions.ts:156, :300 | Unit vs tag params; tag collections as string[] / Set / ReadonlySet | CS-PM04 |
| PUB-37 | low | resources/mining.ts:142-149 | configure(): no getter, only mining validates, defaults exported only for influence | CS-PM09 |
| PUB-38 | low | types.ts:54 vs constants/index.ts:15 | `UnitTypeId` is a type and a const; *Race maps vs *Types sets; three build-status vocabularies | no change |
| PUB-39 | low | types.ts:434 vs resources/map.ts:118 | typed Unit[] where runtime returns Units | CS-PM07 |
| PUB-40 | low | resources/units-collection.ts:207, :216 | take/randomGroupOf return `this`; in-place sort/reverse | CS-PM02 |
| PUB-41 | low | resources/map.ts:141-147, :135, :417; map-analysis.ts:310 | getExpansions(alliance) only knows ENEMY; getThirds returns two; two main-ramp algorithms | CS-PM07 (alliance param); rest no change |
| PUB-42 | low | engine/create-unit.ts:150, :575, :591-595 | getLife/getLabel vs age()/data(); isEnemy without isOwn; isFacing Unit-only, no angle wrap | CS-PM08 (isOwn); rest no change |
| PUB-43 | low | types.ts:1326; index.ts:11 | createGame takes realtime positionally, runGame in options | CS-PM05 |
| INT-03 | low | types.ts:1223 | `debug?` optional though always registered; 7x `debug!` | CS-PM09 |
| INT-16 | low | engine/errors.ts:8, :32; units-collection.ts:201, :366; map.ts:43, :164 | plain Error vs NodeSC2Error in reachable paths (changes triage log level); `err.name` is 'NodeSc2Error' | CS-PM01 (err.name), CS-PM02 |
| INT-17 | low | systems/map.ts:36-39; systems/debug.ts:7; resources/map.ts:14-15 | debug namespaces: 3 shapes, mixed case, Draw*/Debug*; renaming changes documented DEBUG names | CS-PM11 |

### Internal

| id | sev | file:line | finding | ticket |
|---|---|---|---|---|
| INT-01 | med | engine/create-world.ts:28-59; resources/{frame,map,debug,units,event-channel,actions}.ts default exports | core 6 resources defined inline in create-world (resets there too), other 14 export a definition | CS-I03 |
| INT-02 | med | engine/create-resource-manager.ts:47-49; resources/memory.ts:59 | default reset (recreate + Object.assign) splits state for WeakMap resources; every one hand-clears fields in reset | CS-I09, CS-I13 |
| INT-04 | low | influence.ts:46; map-analysis.ts:61; squads.ts:16; memory.ts:7; buildings.ts:56 | 7 WeakMap names, arrow vs method, buildings keeps `step` in state | CS-I09, CS-I13 |
| INT-05 | med | placement.ts:127-128, :165-166; influence.ts:71; utils/map/blockers.ts:8; systems/map.ts:543-549, :590 | `map._grids/_mapSize/_ramps` read directly though getters exist | CS-I04, CS-I13 |
| INT-06 | low | memory.ts:33, :60-66; systems/frame.ts:110; systems/unit.ts:278, :293-295; roles.ts:51 | units store `_units` has 5 writers; abilities cache written in 2 places + a redundant set | CS-I05 |
| INT-07 | low | resources/debug.ts:39 | `actions._client!` on a non-optional field | CS-I05 |
| INT-08 | med | systems/unit.ts:7-9, :64-67; systems/map.ts:47, :157; utils/map/blockers.ts:18 | per-game state in system WeakMaps outside the reset lifecycle, 3 init styles | CS-I10 |
| INT-09 | med | resources/actions.ts:12; buildings.ts:9; systems/builder-plugin.ts:14; behaviors/macro/{tech,structures,spawn}.ts:1 | resources/systems/behaviors import economy helpers from agent/macro.ts | CS-I06 |
| INT-10 | low | resources/units-collection.ts:11; behaviors/combat/helpers.ts:7 | toPoint/isFlying util lives in resources/; positionOf = toPoint | CS-I08, CS-I13 |
| INT-11 | low | roles.ts:21; mining.ts:41; actions.ts:53, :157-753; debug.ts:40; flying.ts:113 | tag / array normalisation re-implemented ~10 times | CS-I07, CS-I13 |
| INT-12 | low | agent/macro.ts:131; actions.ts:33-45; units-collection.ts:104, :218 | getRandom bypassed 3 times; 2 shuffle copies (CN-A01 residue) | CS-I07 |
| INT-13 | low | agent/macro.ts:164; actions.ts:123; create-unit.ts:266; data-storage.ts:29; behaviors/combat/helpers.ts:31; builder-plugin.ts:99 | `remapsToAbilityId \|\| id` inlined 6 times | CS-I08, CS-I13 |
| INT-14 | low | NOOP x5; resources/map.ts:22; point keys (systems/map.ts:64, mining.ts:347, macro.ts:329); CHANGELINGS (terran.ts:17, influence.ts:28); create-unit.ts:415, :589 | small leftovers | CS-I07, CS-I08, CS-I13 |
| INT-15 | med | systems/create-system.ts:120-145; create-resource-manager.ts:66-76; create-engine.ts:574-581, :600; blockers.ts:28 | one error-triage block hand-copied 5 times with different sinks | CS-I02 (helper), PQ1 (sink) |
| INT-18 | low | utils/map/grid.ts:4-60, :125; package.json (chalk); flood.ts:29; create-engine.ts:509-510 | dead debugGrid + its only dependency; commented-out code | CS-I01 |
| INT-19 | med | 27 test files (structuredClone(fixture.observations[896])) | observation-edit helper copied per file | CS-I11, CS-I12, CS-I14 |
| INT-20 | low | units-collection.test.ts:10; create-unit.test.ts:29; create-agent.test.ts:125 | 3 worldWith builders; unitTypeData assignment x25 | CS-I12 |
| INT-21 | low | engine/behaviors.live.test.ts:17-40; create-engine.live.test.ts:36-78; 22.4 literals x6 | live suites re-implement test/live.ts; constant redefined | CS-I11, CS-I12 |
| INT-22 | low | behaviors/combat/*.test.ts; behaviors/macro/*.test.ts | place/fixture/run/setup/execute re-declared per file | CS-I14 |
| INT-23 | low | resources/command-executor.test.ts | test named for a module that doesn't exist | CS-I11 |
| INT-24 | low | engine/index.ts, agent/index.ts, systems/index.ts; constants import styles | one-line barrels used only by root index; 3 constants import styles | CS-I01 (barrels); backlog (import style) |
| INT-25 | low | utils/map/{blockers,townhall,region}.ts, utils/workers, utils/build-order/targets.ts | utils/ mixes pure algorithms and World-taking helpers | backlog (rule in architecture.md, CS-D06) |
| CMT-01 | low | 11 files, 48 lines (audits/cs-comments.md) | WHAT comments against the comment rule; 25 are direction labels in utils/geometry/plane.ts | CS-I01, CS-I13 |

### Docs

File:line and fix per row are in audits/cs-docs.md §1.

| id | sev | where | finding | ticket |
|---|---|---|---|---|
| DOC-01 | high | docs/design.md:32-40 | "persistent events" don't exist | CS-D06 |
| DOC-02 | high | docs/design.md:48-53; tutorial.md:93-96; examples/tutorial.ts:78 | `gasWorker` label claimed to steer the builder; no such code | CS-D06 |
| DOC-03 | high | docs/tutorial.md:5-137 | CommonJS `@node-sc2/core`, missing supply package; can't be followed | CS-D06 |
| DOC-04 | high | docs/internals.md:15, :26, :55 | builderPlugin.js / createSystem.js / UnitEntity | CS-D06 |
| DOC-05 | med | docs/api.md:139 | says only map/events/debug reset | CS-D01 |
| DOC-06 | med | docs/api.md:582-588 | lists 6 resources as "all" (there are 19 + placer) | CS-D01 |
| DOC-07 | med | docs/api.md:1322 | `events` section is TBD | CS-D01 |
| DOC-08 | med | readme:1268; api.md:770 | map.path "blocks unplaceable cells" (stale since BG-T05) | CS-D03 |
| DOC-09 | med | readme:389 | builder pick rule stale vs select-builder.ts:34-38 | CS-D05 |
| DOC-10 | med | readme:2110 | live tier lists 3 of 6 live suites | CS-D06 |
| DOC-11 | med | readme:7 vs api.md | api.md "exhaustive" but misses unit systems, world.data, events, constants, ~14 map methods | CS-D01–D05 |
| DOC-12 | med | tutorial.md vs examples/tutorial.ts vs readme:2172 | buildCompleted vs buildComplete, missing supply | CS-D06 |
| DOC-13 | med | readme:182, 1850, 2091; api.md:139, 417; internals.md:51; changelog:34 | per-game reset stated 6 times, one drifted | CS-D01 |
| DOC-14 | med | readme:1172-1201 +4; api.md:884-904, 369-381; internals:31-36; changelog:14-48 | command arbitration x5 | CS-D02 |
| DOC-15 | med | readme:677-738, 1808-1821, 2198-2213; api.md:305-320, 1282-1320 | openings x5 | CS-D05 |
| DOC-16 | med | readme:604-675, 1931-1943; api.md:51-57, 1342 | string steps / parseBuildOrder x4 | CS-D05 |
| DOC-17 | med | readme:759-935 vs api.md:1360-1546 | behaviors ~85% duplicate | CS-D04 |
| DOC-18 | med | readme:1372-1842 vs api.md:936-1320 | 13 resources documented twice | CS-D03–D05 |
| DOC-19 | med | readme:285-397 vs api.md:173-272 | agent / cost / macro helpers | CS-D02, CS-D05 |
| DOC-20 | med | readme:399-460; api.md:332-394; overview.md:8-31 | events x3 | CS-D02 |
| DOC-21 | med | readme:56-78, 116-283 vs api.md:59-171 | running games | CS-D01 |
| DOC-22 | med | readme:2055-2102 vs changelog:12-270 | two changelogs | CS-D06, CS-D07 |
| DOC-23 | med | readme:947-1104 vs api.md:419-545, 616-712 | units/Units/Unit | CS-D03 |
| DOC-24 | med | readme:1106-1230 vs api.md:801-907 | actions | CS-D02 |
| DOC-25 | med | readme:1232-1295 vs api.md:714-799 | map | CS-D03 |
| DOC-26 | low | readme:1349-1364, 258-283; api.md:921-934, 75, 401 | chat commands x3, config file x4 | CS-D01 |
| DOC-27 | low | readme:2010-2053 vs 2148-2157 vs 2178-2213 | ares differences / limitations / example gaps x3 | CS-D06 |
| DOC-28 | med | readme (whole) | 2232 lines, Resources alone 942 | CS-D08 |
| DOC-29 | med | readme:1997-2157, :1230, :2112 | audiences mixed; impl detail in user doc | CS-D06 |
| DOC-30 | med | docs/changelog.md:12-270 | ticket-vocabulary headings, bot/ file:line migration notes, legacy heading levels | CS-D07 |
| DOC-31 | med | overview/design/tutorial/internals, changelog:271-504 | legacy node-sc2 pages | CS-D06, CS-D07, CS-D08 |
| DOC-32 | med | readme:1108, 1136; api.md per method | no errors reference | CS-D02 |
| DOC-33 | low | readme:9-54 | hand TOC uneven | CS-D08 |
| DOC-34 | low | docs/api.md:597-601, 717-755 | three heading styles | CS-D01–D05 (one format) |
| DOC-35 | low | api.md:33; readme:39, 708, 1810 | duplicate headings → order-dependent `-1` anchors | CS-D08 |
| DOC-36 | low | readme x10, api.md x10 | "settings survive a new game" boilerplate | CS-D01 (stated once) |
| DOC-37 | low | internals.md:46-49; tutorial.md:1, 81, 162 | heading levels | CS-D06 |
| DOC-38 | low | overview.md:8-31 | stale event list | CS-D02 |
| DOC-39 | low | api.md:561-564 | unverified @FIXME on cluster fields | CS-D03 |
| DOC-40 | low | api.md:276-279 | `SystemBlueprint` doesn't exist | CS-D02 |
| DOC-41 | low | readme:1958-1976 | constants table misses build-target, combat, influence, unit-ability-map | CS-D01 |
| DOC-42 | low | index.ts:20-30 | influence constants exported, documented nowhere | CS-D03 |
| DOC-43 | low | api.md:7-31 | import list misses ConnectionClosedError | CS-D01 |
| DOC-44 | low | types.ts:305, 1238, 1316, 813-814 | Unit.distanceTo, engine.use, DataStorage.register/mineralCost, useDebugWidget undocumented | CS-D01, CS-D03 (document); map.set*/World.baseBuild go with CS-PM09 |
| DOC-45 | low | internals.md:50-51 | registration order wrong | CS-D06 |
| DOC-46 | low | internals.md:21-37 | dispatch omits chat-debug and debugSystem | CS-D06 |
| DOC-47 | low | package.json:4, 7-11 | node-sc2 description/repository/author | CS-D08 |
| DOC-48 | low | readme:135 vs api.md:145 | `GameResult` names two things | CS-D01 |
| DOC-49 | low | readme:1030 vs api.md:543 | empty-collection throw lists differ | CS-D03 |
| DOC-50 | low | overview.md:80-84 | "systems run in mount order" vs arbitration | CS-D02 |
| DOC-51 | low | readme:763-773 | Behavior listing not compilable | CS-D04 |
| DOC-52 | low | readme:2114-2135 | internal-path imports (contributor doc only) | CS-D06 |
| DOC-53 | low | api.md:322-328 | setState example mutates state | CS-D02 |
| DOC-54 | low | readme, api.md, overview, tutorial | map names inconsistent | CS-D01–D06 (use `Melee/Simple64`) |
| DOC-55 | low | — | debug namespaces undocumented | CS-D01 |
| DOC-56 | low | readme:547-554, 1622 | `placer` resource undocumented | CS-D05 |
| DOC-57 | low | — | engine extension points undocumented | CS-D06 |
| DOC-58 | low | readme:246 | bot/ build command in core readme | CS-D01 (move to repo root README) |

## In-flight overlap and order

Hot files tonight (R2 tickets READY or running, parity-r2.md): types.ts and resources/{influence,pathing,intel,buildings}.ts (R2-T01, dirty now), behaviors/combat/{helpers,individual,group,terran,aoe,spells}.ts (T03/T06/T07), resources/buildings.ts + systems/builder-plugin.ts + behaviors/macro/structures.ts (T04), resources/intel.ts (T05), resources/pathing.ts (T02). After the morning RQ answers: agent/macro.ts:341-386 (T13), resources/placement.ts (T15), systems/builder-plugin.ts (T12, T15), resources/openings.ts (T12), engine/config.ts (T16). R2-T18 (docs) edits readme.md/api.md/internals.md/changelog.md.
Live-hardening (junior-backend-live2) has no tickets yet; before starting any CS-I ticket, the lead checks that no live-hardening fix is in flight on its files.

Rules for every CS-I and CS-D ticket (CS-PM rules are in "Public changes"): no change to anything exported from index.ts, types.ts, behaviors/index.ts or constants/* (exports map in package.json); no behaviour change a bot can observe, including log output; comment rule applies to every line touched; gate = `bun run check-types`, `bun test`, `biome format` in packages/core.

Serial order (an arrow means "blocks"; lanes run in parallel):
- Lane A: CS-I01 → CS-I02 → CS-I04
- Lane B: CS-I03 → CS-I05 → CS-I07 → CS-I08 → CS-I10. CS-I03 waits for CS-I01; CS-I07 also for CS-I01, CS-I02, CS-I09; CS-I08 for CS-I04; CS-I10 for CS-I04.
- Lane C: CS-I09 (SENIOR), start now; CS-I04 waits for it (placement.ts).
- Lane D (tests): CS-I11 → CS-I12 (CS-I12 also waits for CS-I09: engine/create-world.test.ts).
- After R2 lands: CS-I06 (after R2-T04, CS-I08), CS-I13 (after R2-T03, T04, T05, CS-I07, CS-I08, CS-I09), CS-I14 (after R2-T03, T04, T06, T07, CS-I12), CS-I15 (after CS-I13, R2-T02–T05, CS-PM16).
- Docs: CS-D01–D07 in parallel now (each creates new files only); CS-D08 after all of them and CS-I01 (package.json).
- R2-T18 must write into the new doc layout: blocked by CS-D08 (architect-4 retargets its Where list). Same for any other docs ticket still open.
- Land the cold-file CS-I tickets that touch agent/macro.ts, resources/placement.ts, resources/openings.ts (CS-I01, I04, I07, I08, I09) before R2-T12/T13/T15 start, or those R2 tickets wait for them.
- Public minor (CS-PM): PM01 after CS-I02; PM13 and PM15 landed early (in review, 2026-10-28), so the order is reversed: PM02 after PM01, PM13, CS-I07, CS-I08; CS-I03 after PM15; PM16 after R2-T04 is approved; PM17 now (before CS-I04, I08, I10, PM07 on systems/map.ts); the types.ts chain PM12 → PM14 → PM03 → PM04 → PM05 → PM06 → PM07 → PM08 → PM09 → PM10 starts after R2-T01 lands, with per-ticket blockers on hot files (most of the chain past PM03 waits for R2-T03–T07 and CS-I13); PM11 last. Commit the BOT-3 bot/ edits before the first PM ticket that touches bot/.
- Docs after the PM work: CS-D09 (apply PM docs deltas) after CS-D08; CS-D10 (glossary) after CS-D08.
- CS-PQ items: after their answer; each gets a ticket and blockers then.

Start now: CS-I01, CS-I09 (senior), CS-I11, CS-D01–CS-D07. Next as blockers clear: CS-I02 → CS-PM01; CS-PM03 once R2-T01 lands.

## Interleaving with parity round 2 (2026-10-28, after the RQ answers)

The authoritative cross-queue order is parity-r2.md "Runnable order (snapshot 7)": the remaining order for every remaining R2, CS-I, CS-PM and CS-PQ ticket and R2-T37/T38. Edges it adds to tickets in this file:
- types.ts chain: CS-PM14 → R2-T08 → R2-T19 → CS-PM03 → … (the R2 scaffolding goes first).
- CS-I04 also waits for R2-T08 (placement.ts stubs).
- CS-I07 also waits for R2-T13 (agent/macro.ts), R2-T19 (stub lines in actions/mining) and CS-PM01 (create-engine.ts, create-system.ts).
- CS-I06 also waits for R2-T31 (builder-plugin.ts), R2-T25 and CS-PQ02a (actions.ts).
- R2-T35 also waits for CS-PQ01a (mining.ts; added 2026-10-28 with the PQ tickets).
- CS-PM18b sits between R2-T10 and R2-T11 on influence.ts.
- CS-I10 also waits for R2-T24 and R2-T34 (systems/unit.ts).
- CS-I14 also waits for R2-T20, T22, T23, T27, T33 (behaviors files and tests).
- CS-I15 also waits for R2-T20, T29, T33, T34 (pathing/influence/spatial/units tests).
- CS-PM04 also waits for R2-T25 (actions.ts). Superseded 2026-10-28: the types.ts chain is now PM18a → PQ06b → R2-T39 → PQ07b → PM05a → PM05b → PM05c → PQ01b → PQ06a → PQ05 → PQ07a → PM06 → PM07 → PQ04 → PM08 → PQ10d → PM09 → R2-T37 → R2-T38 → PM10 → PM11. PM05a starts after PQ07b, CS-I06 and R2-T15 (lead 2026-10-28: no T18 gate). CS-PQ07c is off the chain and runs after PQ07b and T15.
- CS-D09 runs before R2-T18 (both edit docs/).

## Runnable now

Current snapshot: parity-r2.md "Runnable order (snapshot 7, restart point)". It covers every remaining ticket: CS-PQ07c, CS-I15 (influence.test.ts) and R2-T17 finishing; then R2-T18, and the serial chain CS-PM05b → … → PM11, including R2-T37/T38. Older snapshots (including the one below) are history.

### Snapshot 1 (superseded, kept for history)

Done: CS-I01, I03, I09, I11, PM02, PM12, PM13, PM15; R2-T01, T02, T03, T05, T06. In flight: R2-T04 rework (resources/buildings.ts, systems/builder-plugin.ts, behaviors/macro/structures.ts, types.ts, their tests), R2-T07 review (behaviors/combat/spells.ts + test), CS-DFIX (docs/*.md, examples/README.md), then CS-D08. R2-T08–T18 wait on RQs.

The four tickets below can run in parallel; their file sets don't overlap with each other or with anything in flight. Test files are listed because they're where overlaps usually hide.

| ticket | blockers (all resolved) | files |
|---|---|---|
| CS-I02 error-triage helper | CS-I01 ✓ | engine/errors.ts, engine/errors.test.ts (new), systems/create-system.ts, engine/create-resource-manager.ts, engine/create-engine.ts, utils/map/blockers.ts |
| CS-I05 units store / abilities cache | CS-I03 ✓, CS-I09 ✓ | resources/{units,memory,roles,debug}.ts, systems/frame.ts, systems/unit.ts, engine/create-unit.ts; tests in resources/{units,memory,roles}.test.ts and systems/frame.test.ts only. Not engine/create-unit.test.ts (CS-I12). |
| CS-I12 test helpers (engine/agent/systems/examples) | CS-I11 ✓, CS-I09 ✓ | test/factories.ts, resources/units-collection.test.ts, engine/create-unit.test.ts, agent/create-agent.test.ts, agent/macro.test.ts, systems/map.test.ts, engine/{behaviors,create-engine}.live.test.ts, examples/ares/{assigning-unit-roles,combat-maneuver,custom-behaviors,managing-production,unit-squads}.test.ts, examples/examples.live.test.ts |
| CS-PM14 types + additive fixes | CS-PM12 ✓, R2-T01 ✓; condition: R2-T04's rework must not be editing types.ts (ask its owner; otherwise PM14 waits for R2-T04) | types.ts, resources/frame.ts, utils/pixel-map.ts, utils/pixel-map.test.ts, engine/create-expansion.ts, engine/create-expansion.test.ts (new). Not systems/unit.ts: its `frame.getPrevious()?._gameLoop` (:23) already handles the narrowed type. Not systems/map.test.ts (CS-I12). |
| CS-PM16 next expansion skips pending townhall spots (added; starting) | R2-T04 ✓ | resources/buildings.ts, resources/buildings.test.ts |
| CS-PM17 effects keep owner (added 2026-10-28) | none | systems/map.ts (`sameEffect` only), systems/map-effects.test.ts (new) |

Next as blockers clear:
- CS-I02 done → CS-PM01 (now also engine/create-client.ts) and CS-I04 (after I02; touches resources/placement.ts, utils/map/blockers.ts, systems/map.ts).
- CS-I05 + CS-I02 done → CS-I07 → CS-I08 → CS-I10.
- CS-PM14 done → CS-PM03.
- R2-T04 approved → CS-PM16, then CS-I06 (also after I08), CS-I13.
- CS-DFIX done → CS-D08 → CS-D09, CS-D10.

## Internal tickets (runnable)

### CS-I01 Comment and dead-code sweep (cold files), one-line barrels
- Source: CMT-01, INT-18, INT-24 (barrels), INT-17 (variable name only).
- What to build: apply the comment rule to the cut/trim lines in audits/cs-comments.md (Batches A, C, D, and systems/map.ts from B); delete commented-out code; delete the unused `debugGrid` and the `chalk` dependency; delete the three one-line barrels; rename the `debugDebug` variable.
- API contract: none (no public change; debug namespace strings unchanged).
- Acceptance criteria:
  - [ ] Every CUT line in cs-comments.md for the files below is gone; every TRIM line keeps only its why clause (or is deleted if the remnant is a fragment). Protected lines untouched.
  - [ ] utils/map/flood.ts:29 and engine/create-engine.ts:509-510 (commented line and the empty `if` around it) are gone.
  - [ ] `debugGrid` is gone from utils/map/grid.ts; `chalk` is gone from packages/core/package.json and bun.lock; grep finds no `chalk` import.
  - [ ] engine/index.ts, agent/index.ts, systems/index.ts are deleted; root index.ts imports the `create-*.ts` modules directly; exported names unchanged.
  - [ ] No `debugDebug` identifier; namespace strings byte-identical.
  - [ ] Gate passes.
- Implementation plan:
  - Where: utils/geometry/plane.ts (25 direction labels), utils/map/flood.ts, utils/map/townhall.ts:59 (name the `3 + 1` as a const instead of the comment), utils/map/grid.ts:4-60, :125, systems/map.ts:148, :256, :551 + `debugDebug` (:39), engine/create-engine.ts:126, :509-510, :555, constants/race-map.ts:5, agent/create-agent.ts:26, agent/macro.ts:111, resources/event-channel.ts:16, :35, :40, :70, engine/index.ts, agent/index.ts, systems/index.ts, index.ts:4-6, packages/core/package.json, bun.lock (`bun remove chalk` in packages/core).
  - Follow: the rule in /home/bram/.claude/CLAUDE.md "Comments"; cs-comments.md "Judgement calls" for the borderline ones.
  - Don't touch: resources/buildings.ts, systems/builder-plugin.ts (hot; CS-I13), types.ts.
- Stack: backend. Junior. Blocked by: None. Slice siblings: CS-I13.

### CS-I02 One error-triage helper (sinks unchanged)
- Source: INT-15.
- What to build: one helper for "rethrow fatal, log NodeSC2Error one way, log the rest another" used by the five copies, each passing its current sinks, so PQ1(c) later becomes a one-place change.
- API contract: none. Log namespaces, messages and levels per site stay as today.
- Acceptance criteria:
  - [ ] No hand-written `instanceof GameEndedError || instanceof ConnectionClosedError` triage outside engine/errors.ts.
  - [ ] Each site logs to the same namespace/level as before for GameEndedError (rethrown), NodeSC2Error and plain Error; a new engine/errors.test.ts covers the helper's three branches.
  - [ ] Gate passes.
- Implementation plan:
  - Where: engine/errors.ts (add helper), systems/create-system.ts:120-145 (both branches), engine/create-resource-manager.ts:55-58, :66-76, engine/create-engine.ts:574-581, :600, utils/map/blockers.ts:28.
  - Interfaces: `isFatalGameError(err: unknown): boolean`; `triageError(err: unknown, label: string, sinks: { expected: (msg: string, err: Error) => void; unexpected: (msg: string, err: Error) => void }): void` (rethrows fatal).
  - Follow: systems/create-system.ts:120-145 for the current behaviour.
  - Don't touch: which sink a site uses (PQ1).
- Stack: backend. Junior. Blocked by: CS-I01 (engine/create-engine.ts). Slice siblings: CS-PM01.

### CS-I03 Core resources export their definitions
- Source: INT-01, INT-04 (core six).
- What to build: frame, map, debug, units, events, actions each export a `xResource: ResourceDefinition` from their own file (create and reset next to the state they reset); engine/create-world.ts `coreResources` becomes a plain list. One create shape: `create(world)` calling the file's private factory.
- API contract: none (the six default exports are not reachable from index.ts or the exports map; checked).
- Acceptance criteria:
  - [ ] create-world.ts has no inline `create`/`reset` bodies; registration order unchanged.
  - [ ] Reset behaviour per resource unchanged: existing engine tests pass untouched; if not already covered, a test asserts units/actions/frame are emptied by `resetGameState` as before.
  - [ ] create-world.ts imports use one naming scheme (`frameResource`, `mapResource`, ...).
  - [ ] Gate passes.
- Implementation plan:
  - Where: engine/create-world.ts:3-9, :28-59; resources/{frame,map,debug,units,event-channel,actions}.ts.
  - Follow: resources/spatial.ts:11 (`spatialResource`), memory.ts:29.
  - Builds on CS-PM15 (landed): resources/event-channel.ts already has a module-level `normaliseEventType` that both `createReader` and `write` use. Keep it module-level next to the new `eventsResource` definition and leave both call sites on it; resources/event-channel.test.ts (added by PM15) must pass unchanged.
  - Don't touch: create-resource-manager.ts default-reset logic, types.ts, engine/create-world.test.ts while CS-I09 is open (put any new test in a new file), the event-type mapping inside event-channel.ts (PM15's behaviour).
- Stack: backend. Junior. Blocked by: CS-I01 (event-channel.ts), CS-PM15 review approved (event-channel.ts). Slice siblings: CS-I09.

### CS-I04 Read map state through getters (cold files)
- Source: INT-05.
- What to build: replace `map._grids` / `map._mapSize` / `map._ramps` reads with `getGrids()` / `getSize()` / the value just computed, in placement, blockers and the map system. `_mapState.creep` stays (a getter would be a public addition).
- API contract: none.
- Acceptance criteria:
  - [ ] grep `\._grids\|\._mapSize\|\._ramps` outside resources/map.ts finds only resources/influence.ts (CS-I13).
  - [ ] systems/map.ts:543-549 no longer reads back the `_ramps` it just set.
  - [ ] Gate passes; placement/map fixture tests unchanged.
- Implementation plan:
  - Where: resources/placement.ts:127, :165; utils/map/blockers.ts:8; systems/map.ts:543-549, :590-591.
  - Follow: systems/map.ts:255 (`map.getGrids()`).
  - Don't touch: resources/influence.ts (hot), types.ts.
- Stack: backend. Junior. Blocked by: CS-I01, CS-I02 (blockers.ts), CS-I09 (placement.ts), CS-PM17 (systems/map.ts). Slice siblings: CS-I13.

### CS-I05 One owner for the units store and the abilities cache
- Source: INT-06, INT-07.
- What to build: module functions in resources/units.ts (not on the public UnitResource type) for "forget a unit" and "set available abilities", used by memory, systems/frame and systems/unit; roles reads through `units.getByTag`; drop the redundant `_units[SELF].set` at systems/unit.ts:295 and the `!` on `actions._client`.
- API contract: none.
- Acceptance criteria:
  - [ ] No `_units[...]` writes outside resources/units.ts.
  - [ ] `_availableAbilities` written by one function, called from engine/create-unit.ts:165 and systems/unit.ts:278/:293.
  - [ ] Memory expiry, dead-enemy deletion and roles cleanup tests pass unchanged.
  - [ ] Gate passes.
- Implementation plan:
  - Where: resources/units.ts, resources/memory.ts:33, :60-66, resources/roles.ts:51, :107, systems/frame.ts:110, systems/unit.ts:278, :293-295, engine/create-unit.ts:165-166, resources/debug.ts:39.
  - Interfaces: `forgetUnit(units: UnitResource, alliance: Alliance, tag: string): void`; `setAvailableAbilities(unit: Unit, abilityIds: number[], loop: number): void`.
  - Don't touch: types.ts.
- Stack: backend. Junior. Blocked by: CS-I03 (units.ts, debug.ts), CS-I09 (memory.ts, roles.ts). Slice siblings: none.

### CS-I06 Economy helpers out of agent/macro.ts
- Source: INT-09.
- What to build: move `spend`, `affordable`, `researchAbilityOf`, `techEquivalents`, `REQUIRES_TECHLAB` to utils/economy.ts, all taking `World`; agent/macro.ts keeps only the Agent mixin and calls them.
- API contract: none (agent/macro.ts is not exported).
- Acceptance criteria:
  - [ ] No import of agent/macro.ts from resources/, systems/ or behaviors/.
  - [ ] All moved helpers take `World` (one signature style).
  - [ ] Gate passes; tests unchanged apart from import paths.
- Implementation plan:
  - Where: new utils/economy.ts (+ economy.test.ts taking over the helpers' tests from agent/macro.test.ts); agent/macro.ts:111-245; agent/create-agent.ts; resources/actions.ts:12; resources/buildings.ts:9; systems/builder-plugin.ts:14; behaviors/macro/{tech,structures,spawn}.ts:1.
  - Interfaces: `spend(world: World, cost: Cost, earmarkName?: string): void`; `affordable(world: World, cost: Cost, earmarkName?: string): boolean`; `researchAbilityOf(world: World, upgradeId: number)` with today's return semantics.
  - Don't touch: agent/macro.ts:341-386 while R2-T13 is open.
- Stack: backend. Junior. Blocked by: R2-T04 (buildings.ts, builder-plugin.ts, structures.ts), CS-I08 (macro.ts, actions.ts), CS-I12 (macro.test.ts). Slice siblings: none.

### CS-I07 Shared tag/array/random/NOOP helpers (cold files)
- Source: INT-11, INT-12, INT-14 (NOOP).
- What to build: one `toTag`/`toTags`/`asArray`, one `shuffle` next to `getRandom`, one `NOOP`; replace the copies in cold files.
- API contract: none.
- Acceptance criteria:
  - [ ] Copies listed in cs-internal.md INT-11/12/14 (NOOP) are replaced in the files below; agent/macro.ts `randomOf` and actions.ts `shuffled`/inline pick use the shared helpers; units-collection.ts `random`/`randomGroupOf` keep their exact public behaviour (empty-throw, `this` return).
  - [ ] Unit tests for the new helpers.
  - [ ] Gate passes.
- Implementation plan:
  - Where: utils/get-random.ts (add `shuffle`), new utils/collections.ts (`toTag`, `toTags`, `asArray`, `NOOP`); resources/{actions,roles,mining,behaviors,flying,debug,squads,units-collection}.ts; agent/{macro,create-agent}.ts; engine/create-engine.ts:62; systems/{create-system,unit-plugin}.ts.
  - Interfaces: `toTag(u: Unit | string): string`; `toTags(u: Unit | string | Array<Unit | string>): string[]`; `asArray<T>(x: T | T[]): T[]`; `shuffle<T>(xs: readonly T[]): T[]`.
  - Don't touch: resources/influence.ts, systems/builder-plugin.ts, behaviors/combat/* (CS-I13).
- Stack: backend. Junior. Blocked by: CS-I01, CS-I02, CS-I05, CS-I09. Slice siblings: CS-I08, CS-I13.

### CS-I08 Shared point and ability helpers (cold files)
- Source: INT-10, INT-13, INT-14 (createPoint2D, point keys, hypot).
- What to build: move `toPoint`/`isFlying` out of resources/units-collection.ts into utils/geometry (units-collection re-imports them); one `pointKey`; resources/map.ts uses the shared `createPoint2D`; create-unit/combat-sim use `distance`; one `generalAbility(data, id)`.
- API contract: none (`Units` stays exported from index.ts).
- Acceptance criteria:
  - [ ] utils/ and engine/ no longer import `toPoint`/`isFlying` from resources/units-collection.ts.
  - [ ] `remapsToAbilityId || id` appears only in the helper, plus behaviors/combat/helpers.ts and builder-plugin.ts (CS-I13).
  - [ ] `${x},${y}` keys built by one function.
  - [ ] Gate passes.
- Implementation plan:
  - Where: utils/geometry/point.ts (or utils/geometry/units.ts for `isFlying`), resources/units-collection.ts:11, utils/combat/combat-sim.ts:17, :113, engine/create-unit.ts:45, :266, :415, :589, resources/map.ts:22, resources/mining.ts:347, systems/map.ts:64, agent/macro.ts:164-166, :329, :336, resources/actions.ts:123, engine/data-storage.ts:29.
  - Interfaces: `pointKey(p: Point2D): string`; `generalAbility(data: DataStorage, abilityId: number): number`.
  - Don't touch: behaviors/combat/*, resources/influence.ts, systems/builder-plugin.ts.
- Stack: backend. Junior. Blocked by: CS-I07, CS-I04. Slice siblings: CS-I07, CS-I13.

### CS-I09 Resource reset from fresh state (SENIOR)
- Source: INT-02, INT-04 (WeakMap resources).
- Senior because: per-game reset semantics. Each resource decides which fields survive a new game on the same engine (settings everywhere; openings' loaded definitions vs per-game history; buildings `optedIn`); a wrong call leaks state across games or drops configuration silently, and no test catches it today.
- What to build: every cold WeakMap resource gets a `freshState(kept)` and its `reset` re-seats `stateByX.set(resource, freshState(kept))`, replacing field-by-field clearing; WeakMaps named `stateBy<Resource>`; `reset`/`onStep` in method shorthand; one test resets every registered resource and checks state equals a fresh one apart from the named survivors.
- API contract: none (ResourceDefinition keeps `reset?`; default reset unchanged).
- Acceptance criteria:
  - [ ] roles, openings, mining, map-analysis, placement, flying, squads, memory reset through `freshState`; survivors named per resource in the test.
  - [ ] memory's empty `reset() {}` becomes a real fresh-state reset, or keeps a one-line why.
  - [ ] Test in engine/create-world.test.ts: step a fixture game, reset, compare each resource's state with a newly created one minus survivors.
  - [ ] Two-games-on-one-engine tests still pass.
  - [ ] Gate passes.
- Implementation plan:
  - Where: resources/{roles,openings,mining,map-analysis,placement,flying,squads,memory}.ts; engine/create-world.test.ts.
  - Follow: resources/placement.ts:64 (`freshState`) and :616-619.
  - Don't touch: resources/{intel,influence,buildings}.ts (hot; CS-I13 applies the pattern after R2), engine/create-resource-manager.ts, resources/*.test.ts (CS-I11 is migrating them; the new test lives in engine/create-world.test.ts).
- Stack: backend. SENIOR. Blocked by: None. Slice siblings: CS-I13.

### CS-I10 Per-world state in systems (SENIOR)
- Source: INT-08.
- Senior because: lifetime of map-system blocker state across games on one engine (BG-T05/BG-CR tracking); clearing on the wrong dispatch drops blocked-structure records mid-game or keeps the previous game's.
- What to build: one `perWorld(create)` helper (WeakMap get-or-create keyed by World, with `clear(world)`); systems/unit.ts seen-tag sets, systems/map.ts `blockedStructures`/`blockerCells`, utils/map/blockers.ts `liveGrids` use it; each cleared in exactly one place, no lazy re-creation elsewhere.
- API contract: none.
- Acceptance criteria:
  - [ ] The four sites use the helper; no other module-level per-World WeakMap in systems/ or utils/.
  - [ ] A two-games-on-one-engine test shows blocker state and seen tags start empty in game 2.
  - [ ] Gate passes.
- Implementation plan:
  - Where: new engine/per-world.ts; systems/unit.ts:7-9, :15-16, :64-67; systems/map.ts:46-56, :157-163, :521-522; utils/map/blockers.ts:18.
  - Interfaces: `perWorld<T>(create: (world: World) => T): { get(world: World): T; clear(world: World): void }`.
  - Don't touch: resources/*.
- Stack: backend. SENIOR. Blocked by: CS-I04, CS-I05, CS-I08 (systems/map.ts, systems/unit.ts). Slice siblings: none.

### CS-I11 Shared test helpers + resources/ tests
- Source: INT-19, INT-21 (resources part), INT-23.
- What to build: `observationAt` / `stepWith` in test/create-test-world.ts and `describeLive` in test/live.ts; migrate the cold resources/*.test.ts and resources/*.live.test.ts; tests use `GAME_LOOPS_PER_SECOND`; rename resources/command-executor.test.ts to command-arbiter.integration.test.ts.
- API contract: none (test code only).
- Acceptance criteria:
  - [ ] No `structuredClone(...observations[` and no local `stepWith`/`observation` helpers in the migrated files.
  - [ ] No local 22.4 / LOOPS_PER_SECOND constant in the migrated files.
  - [ ] Same test count before/after, all green; live suites still skip without SC2PATH.
- Implementation plan:
  - Where: test/create-test-world.ts, test/live.ts; the cold resources/*.test.ts that use the pattern (actions, flying, memory, mining, roles, squads, placement and any other grep hit), resources/{mining,placement,flying}.live.test.ts, resources/command-executor.test.ts (rename).
  - Interfaces: `observationAt(world: World, loop: number, edit?: { add?: RawUnit[]; hide?: string[] }): Observation`; `stepWith(world: World, loop: number, units?: RawUnit[]): Promise<void>`; `describeLive(name: string, fn: () => void): void`.
  - Follow: resources/squads.test.ts:10 (`stepWith`), resources/memory.test.ts:14 (`observation`).
  - Don't touch: resources/{pathing,intel,buildings,influence}.test.ts (CS-I14); test files of a CS-I ticket in flight.
- Stack: backend. Junior. Blocked by: None. Slice siblings: CS-I12, CS-I14.

### CS-I12 Test helpers: engine, agent, systems, examples
- Source: INT-19, INT-20, INT-21.
- What to build: `toyWorld(...)` in test/factories.ts replacing the three `worldWith` builders and the `unitTypeData` assignments; migrate the examples/ares/*.test.ts `stepWith` copies; engine live suites reuse test/live.ts.
- API contract: none.
- Acceptance criteria:
  - [ ] No local `worldWith`; no `sc2Pids`/`clientOf` copies in engine/*.live.test.ts.
  - [ ] Same test count, all green.
- Implementation plan:
  - Where: test/factories.ts; resources/units-collection.test.ts, engine/create-unit.test.ts, agent/create-agent.test.ts, agent/macro.test.ts, systems/map.test.ts, engine/{behaviors,create-engine}.live.test.ts, examples/ares/{assigning-unit-roles,combat-maneuver,custom-behaviors,managing-production,unit-squads}.test.ts, examples/examples.live.test.ts.
  - Interfaces: `toyWorld(opts: { units?: RawUnit[]; unitTypes?: Record<number, Partial<UnitTypeData>>; race?: Race }): World` (extend as the three builders need).
  - Follow: resources/units-collection.test.ts:10.
  - Don't touch: engine/create-world.test.ts.
- Stack: backend. Junior. Blocked by: CS-I11, CS-I09. Slice siblings: CS-I11, CS-I14.

### CS-I13 Hot-file remnants (after R2)
- Source: CMT-01, INT-02/04, INT-05, INT-10, INT-11, INT-13, INT-14 in the files R2 edits tonight.
- What to build: resources/buildings.ts:479 comment trim; systems/builder-plugin.ts:239, :487, :500 comments, NOOP, `generalAbility`; resources/influence.ts:71 `_grids` → `getGrids()`, tag/array helper, WeakMap naming + freshState reset; resources/intel.ts and resources/buildings.ts freshState reset; behaviors/combat/helpers.ts `positionOf` → `toPoint`, `generalAbility`; CHANGELINGS shared by behaviors/combat/terran.ts and resources/influence.ts from one internal module (not constants/*, which is public).
- API contract: none.
- Acceptance criteria:
  - [ ] Each item above done; CS-I09's reset test extended to intel, influence, buildings.
  - [ ] Gate passes.
- Implementation plan: as in the source tickets; Follow: CS-I07/I08/I09 as landed. Line numbers re-checked after R2.
- Split 2026-10-28 so the influence lane doesn't wait on the builder-plugin lane (parity-r2.md "Runnable order"):
  - **CS-I13a:** everything above except resources/influence.ts. Files: resources/{buildings,intel}.ts, systems/builder-plugin.ts, behaviors/combat/{helpers,terran}.ts, the CS-I09 reset test (intel, buildings). Blocked by: CS-PM16, CS-I06, CS-I07, CS-I08, CS-I09, R2-T31 (builder-plugin.ts), R2-T33 (terran.ts).
  - Added 2026-10-28 (lead, after CS-I08 and CS-PM17), all in CS-I13 as it is now running:
    - resources/units-collection.ts:9 re-exports `isFlying`/`toPoint` (the seam CS-I08 left). Repoint behaviors/combat/{individual,spells,terran,helpers,group}.ts to utils/geometry/*, then delete the re-export. behaviors/combat/terran.test.ts:5's import goes to CS-I14, which holds that file.
    - behaviors/combat/helpers.ts:32 and systems/builder-plugin.ts:99 use `generalAbility` (CS-I08's helper) instead of the inline `remapsToAbilityId || id`.
    - resources/buildings.test.ts drops the x−3 offset on the enemy sweep: CS-PM17 keeps own and enemy scans apart, so the offset that kept them from masking each other is no longer needed. The test must still assert the own scan clears the spot with an enemy scan on the same cell.
    - Acceptance criteria: grep finds no import of `isFlying`/`toPoint` from units-collection and no re-export there; `remapsToAbilityId ||` appears only in `generalAbility`; buildings.test.ts sweep at the same cell passes.
    - Extra files: resources/units-collection.ts, behaviors/combat/{individual,spells,group}.ts, resources/buildings.test.ts. behaviors/combat/*.ts may also be on CS-PM04's caller list: whichever lands first, the other rebases.
  - **CS-I13b:** the resources/influence.ts items (`_grids` → `getGrids()`, tag/array helper, WeakMap naming + freshState reset, CHANGELINGS shared with terran.ts; whichever of I13a/I13b runs first creates the shared internal module) and the CS-I09 reset test for influence. Blocked by: R2-T29 (last R2 ticket on influence.ts), CS-I07, CS-I09.
- Stack: backend. Junior (the reset pattern and survivor list are fixed by CS-I09). Blocked by: see the split above. Slice siblings: CS-I01, CS-I04, CS-I07, CS-I08, CS-I09.

### CS-I14 Test helpers: hot test files (after R2)
- Source: INT-19, INT-22.
- What to build: migrate behaviors/{combat,macro}/*.test.ts to the CS-I11 helpers; add `placeUnit`, `runBehavior(world, behavior)`, `macroWorld(units, opts)` in a new test/behavior-helpers.ts. The hot resources/ tests moved to CS-I15.
- API contract: none.
- Acceptance criteria:
  - [ ] No per-file `place`/`run`/`setup`/`execute` copies in behaviors tests; same test count, all green.
- Implementation plan: Where: behaviors/{combat,macro}/*.test.ts, new test/behavior-helpers.ts. Follow: behaviors/combat/group.test.ts:32-37. Don't touch: test/create-test-world.ts (CS-I15).
- Stack: backend. Junior. Blocked by: R2-T03, R2-T04, R2-T06, R2-T07 (behaviors files), CS-I12. Slice siblings: CS-I11, CS-I12, CS-I15.

### CS-I15 CS-I11 leftovers: hot resources tests, fog and observation copies
- Source: CS-I11 review (lead, 2026-10-28); INT-19, INT-21.
- What to build:
  - resources/{intel,buildings,influence,pathing}.test.ts: replace `structuredClone(...observations[...])` with `observationAt`/`stepWith`, and the 22.4 literals and local loops-per-second constants with `GAME_LOOPS_PER_SECOND`.
  - Local fog code goes: `hideFogged` (resources/spatial.test.ts:16-23) and `fogAround` (resources/units.test.ts:22-27). Both fog a 5x5 block around a fixed spot (ZERGLINGS_SPOT / zerglingsSpot), while `observationAt`'s `fog: true` fogs around each hidden unit's own position. If those blocks cover the same cells for these fixtures, use `hide: [...]` + `fog: true`. Otherwise add `fogAt?: Point2D[]` to `ObservationEdit` and use that. units.test.ts's `editedObservation` (:15) filter-based hide becomes `hide`.
  - resources/flying.test.ts's local `observation` (:17-35) goes. Add `patch?: Record<string, Partial<SC2APIProtocol.Unit>>` to `ObservationEdit` (merged over the raw unit by tag). flying.test keeps only its data (the FLYING type map and per-tag edits) and calls `observationAt` directly.
- API contract: none (test code only).
- Acceptance criteria:
  - [ ] grep in resources/*.test.ts: no `structuredClone(`, no `22.4`, no local visibility-grid writes, no local `observation`/`hideFogged`/`fogAround`/`editedObservation`.
  - [ ] Same test count before/after, all green. The fog tests still assert memory/visibility behaviour: each fog assertion fails if `fog` is removed (checked once by hand, noted in the PR).
  - [ ] Gate passes.
- Implementation plan:
  - Where: test/create-test-world.ts (`ObservationEdit`: `fogAt?` if needed, `patch?`), resources/{intel,buildings,influence,pathing,spatial,units,flying}.test.ts.
  - Interfaces: `ObservationEdit` gains `patch?: Record<string, Partial<SC2APIProtocol.Unit>>` and, only if needed, `fogAt?: Point2D[]`.
  - Follow: resources/memory.test.ts (migrated by CS-I11).
  - Don't touch: product code; behaviors tests (CS-I14).
- Stack: backend. Junior. Blocked by: CS-I13 (follow-up per lead; I13 extends tests in the same area), R2-T02, R2-T03, R2-T04, R2-T05 (pathing/influence/buildings/intel tests), CS-PM16 (buildings.test.ts). Slice siblings: CS-I11, CS-I14.
- Commit note: CS-I11 renamed resources/command-executor.test.ts with a plain `mv`, so resources/command-arbiter.integration.test.ts is untracked. Whoever commits the CS-I11 batch stages both sides (`git add resources/command-arbiter.integration.test.ts resources/command-executor.test.ts`). This doesn't wait for CS-I15.

Backlog, not ticketed: constants import-style normalisation (INT-24, ~80-file churn for zero behaviour); utils/ pure-vs-World split (INT-25; CS-D06 writes the rule into architecture.md instead); direct tests for resources/frame.ts and event-channel.ts (INT-23, covered indirectly).

## Docs tickets (runnable)

Target layout (DQ1; full rationale and line-range migration tables in audits/cs-docs.md §2–§4): readme.md becomes a ~220-line landing page; topic pages under docs/ each own one topic; docs/api.md and the four legacy node-sc2 pages are retired by merging. Built expand → contract: CS-D01–D07 only create new files (they read readme/api.md/legacy pages, never edit them), so they run in parallel; CS-D08 swaps the readme, deletes the old pages and fixes every link.

Doc contract for CS-D01–D07:
- One topic, one file. A fact (default, failure mode, reset rule, setting) is written once; other pages link to its heading. "Settings survive a new game" and the per-game reset rule live only in resources.md; arbitration only in commands.md.
- Each page: a 10–15 line concept intro, then members in one heading format, `#### \`res.method(arg: T, opt = d) => R\``, with defaults and what it rejects/throws; one example per resource. No table that restates the headings below it.
- Source text: for each topic take the longer of the readme / api.md copies as the base, merge in what only the other has, then verify every signature, default and failure mode against types.ts and the implementation (code wins). Legacy-page content is rewritten in TypeScript.
- Use `Melee/Simple64` as the map name except where map resolution is the topic (DOC-54).
- Link to sibling pages by file + heading as planned in cs-docs.md §3; CS-D08 resolves and checks every link.
- Document current behaviour, including the inconsistencies the PQs list; don't pre-empt a PQ answer.
- Gate: every TS block either type-checks (scratch tsconfig with package paths, as in cs-docs.md §0) or is marked as a signature sketch; `biome format` is not run on markdown.

### CS-D01 running-games.md, resources.md, constants.md
- Source: readme 56-78, 116-283, 937-945, 1297-1370, 1844-1877, 1954-1995; api.md 1-171, 396-417, 581-614, 909-934, 1322-1323, constants part of 1325-1358. Fixes DOC-05, -06, -07, -13, -21, -26, -36, -41, -43, -44 (engine.use, DataStorage.register/mineralCost, useDebugWidget), -48, -55, -58.
- What to build: docs/running-games.md (createEngine, runGame, runBotVsBot, runReplay, createGame/joinGame, ladder, env vars, config file, finding SC2/maps, debug namespaces as they are today); docs/resources.md (world, `resources.get()` list of all 19 + `placer`, registry, per-game reset stated once, custom resources, frame, debug + chat commands, events resource written from types.ts, world.data + earmarks); docs/constants.md (every `./constants/*` module incl. build-target, combat, influence, unit-ability-map, dicts, groups, `GAME_LOOPS_PER_SECOND`). Move the bot/ build command (readme:246) to the repo root README.md.
- Acceptance criteria:
  - [ ] Each fix listed in Source is reflected; no section says "TBD".
  - [ ] Resource list equals `ResourceContainer` in types.ts.
  - [ ] Debug namespaces table matches every `createDebug(` string in the code.
  - [ ] Doc contract met.
- Implementation plan: Where: new docs/running-games.md, docs/resources.md, docs/constants.md; README.md (repo root, one line). Don't touch: readme.md, docs/api.md, legacy pages, code.
- Stack: docs. Junior. Blocked by: None. Slice siblings: CS-D02–D08.

### CS-D02 agents.md, commands.md
- Source: readme 285-345, 399-508, 750-757, 1106-1230; api.md 173-200 (agent), 274-394, 801-907; overview.md events/systems text. Fixes DOC-14, -20, -24, -32, -38, -40, -50, -53, DOC-11 (unit systems).
- What to build: docs/agents.md (createAgent, settings, player data, cost/supply, events table incl. onCommandResults / onEnemyStrategyDetected / onEnemyRaceDetected, custom events, createSystem with real type names, agent and unit systems, state); docs/commands.md (actions, command arbitration once, CommandResult, an errors section: each error class, its `data`, and which calls throw it, from engine/errors.ts and the call sites).
- Acceptance criteria:
  - [ ] Events table equals the event names written in systems/unit.ts, systems/frame.ts and the engine.
  - [ ] Errors table covers every class exported from index.ts.
  - [ ] Doc contract met.
- Implementation plan: Where: new docs/agents.md, docs/commands.md. Don't touch: readme.md, api.md, code.
- Stack: docs. Junior. Blocked by: None. Slice siblings: CS-D01, D03–D08.

### CS-D03 units.md, map.md
- Source: readme 947-1104, 1232-1295, 1372-1475, 1760-1806, 1945-1952; api.md 419-579, 616-799, 936-1008, 1219-1274, points part of 1325-1358. Fixes DOC-08, -23, -25, -39, -42, -44 (Unit.distanceTo), -49, DOC-11 (map methods), DOC-18 (memory, spatial, influence, pathing, mapAnalysis).
- What to build: docs/units.md (units, Units, Unit, memory, spatial; one empty-collection throw list); docs/map.md (map, Expansion, Ramp, PixelMap, mapAnalysis, influence incl. the exported influence constants, pathing, point helpers; map.path says it blocks unpathable cells only).
- Acceptance criteria:
  - [ ] Every MapResource member in types.ts that isn't `_`-prefixed or an engine-only `set*` is documented (CS-PM09 removes those from the public type).
  - [ ] DOC-39's @FIXME claim verified against engine/create-expansion.ts and either backed or dropped.
  - [ ] Doc contract met.
- Implementation plan: Where: new docs/units.md, docs/map.md. Don't touch: readme.md, api.md, code.
- Stack: docs. Junior. Blocked by: None. Slice siblings: CS-D01, D02, D04–D08.

### CS-D04 combat.md, behaviors.md
- Source: readme 759-935, 1477-1594, 1879-1929; api.md 1010-1083, 1276-1280, 1360-1546, fights part of 1325-1358. Fixes DOC-17, -51, DOC-18 (roles, squads, intel).
- What to build: docs/combat.md (roles, squads, intel, simulateFight/canWinFight, engagement results); docs/behaviors.md (executor, plan, helpers, individual/Terran/group behaviors, macro controllers; the Behavior/BehaviorContext listing compiles or links types.ts).
- Acceptance criteria:
  - [ ] Every export of behaviors/index.ts at HEAD is documented once; R2 stubs not yet implemented are not documented (R2-T18 adds them).
  - [ ] Doc contract met.
- Implementation plan: Where: new docs/combat.md, docs/behaviors.md. Don't touch: readme.md, api.md, code.
- Stack: docs. Junior. Blocked by: None. Slice siblings: CS-D01–D03, D05–D08.

### CS-D05 macro.md, build-orders.md
- Source: readme 347-397, 510-748, 1596-1758, 1808-1842, 1931-1943; api.md 200-272 (macro helpers), build-system fields of 274-330, 1085-1217, 1282-1320, parseBuildOrder part of 1325-1358. Fixes DOC-09, -15, -16, -56, DOC-18 (placement, buildings, mining, flying, openings), DOC-19 (macro part).
- What to build: docs/macro.md (agent macro helpers, placement, `placer`, buildings, mining, flying; builder pick rule from utils/workers/select-builder.ts); docs/build-orders.md (build systems, string steps and targets grammar once, openings system option + openings resource once, scouts/persistent builder, parseBuildOrder, taskFunctions).
- Acceptance criteria:
  - [ ] Builder-pick text matches select-builder.ts:34-38 and actions.build's busy-worker fallback.
  - [ ] String-step grammar and its error list appear once.
  - [ ] Doc contract met.
- Implementation plan: Where: new docs/macro.md, docs/build-orders.md. Don't touch: readme.md, api.md, code.
- Stack: docs. Junior. Blocked by: None. Slice siblings: CS-D01–D04, D06–D08.

### CS-D06 getting-started.md, architecture.md, compatibility.md
- Source: overview.md, tutorial.md, examples/tutorial.ts; design.md, internals.md, readme 2104-2146; readme 1997-2102, 2148-2157. Fixes DOC-01, -02, -03, -04, -10, -12, -22 (readme side), -27, -29, -37, -45, -46, -52, -57; INT-25 rule.
- What to build:
  - docs/getting-started.md: first bot in TypeScript built on examples/tutorial.ts as it is (Bun, `@sc-bot/core`, ESM; state key `buildComplete`); concepts from overview.md (event consumers, world, systems, resources). States plainly that the example builds no pylons, so its gateways don't get placed. No `gasWorker` label advice.
  - docs/architecture.md: design levels (design.md minus persistent events and `gasWorker`), engine dispatch incl. chat-debug and debugSystem, registry and registration order from engine/create-world.ts, shared modules, engine extension points (`engine.use`), the utils/ rule (pure algorithms in utils/, World-taking helpers named as such), testing tiers listing every `*.live.test.ts`, fixtures, scripts. No "Race Agnosticy" plan section.
  - docs/compatibility.md: differences from python-sc2 and ares, changes vs node-sc2 (only what changelog doesn't already say), known limitations, deduped (Zerg placement, influence grids, YAML/JSON, tempest upgrade appear once).
  - examples/tutorial.ts:78: drop the `gasWorker` label line (it has no effect; DOC-02).
- Acceptance criteria:
  - [ ] Every code block in getting-started.md type-checks against the package.
  - [ ] No `node-sc2` package name, `require(`, `.js` path or `UnitEntity` in the three pages, except when naming node-sc2 history in compatibility.md.
  - [ ] Doc contract met; examples/tutorial.ts still type-checks.
- Implementation plan: Where: new docs/getting-started.md, docs/architecture.md, docs/compatibility.md; examples/tutorial.ts:78. Don't touch: legacy pages (CS-D08 deletes them), readme.md, other code.
- Stack: docs. Junior. Blocked by: None. Slice siblings: CS-D01–D05, D07, D08.
- Out of scope: making the tutorial example build supply (behaviour change to an example; needs a live run). Listed under Further notes.

### CS-D07 changelog and examples catalog
- Source: docs/changelog.md, readme 2159-2223 (examples), readme 2055-2102 (node-sc2 changes, changelog side). Fixes DOC-30, DOC-22 (changelog side).
- What to build: docs/changelog.md Unreleased regrouped by feature name (no ticket ids such as core-arch / parity-4 / Phase 5, no "supersedes Qn"); `Migrating bot/` blocks become per-topic "Upgrading" bullets without bot/ file:line; legacy node-sc2 entries (271-504) moved to docs/changelog-node-sc2.md with normalised heading levels; new examples/README.md with the examples catalog, env vars, ares ports table, openings configs, live smoke test.
- Acceptance criteria:
  - [ ] No ticket id or bot/ file:line in docs/changelog.md; every Unreleased fact from before is still present.
  - [ ] Every file in examples/ (non-test) appears in examples/README.md.
- Implementation plan: Where: docs/changelog.md, new docs/changelog-node-sc2.md, new examples/README.md. Don't touch: readme.md, code.
- Stack: docs. Junior. Blocked by: None (R2-T18, if it starts first, owns changelog.md until done). Slice siblings: CS-D01–D06, D08.

### CS-D08 Contract: new readme, retire old pages, links
- Source: readme 1-114, 2225-2232; DOC-28, -31, -33, -34, -35, -47.
- What to build: readme.md rewritten as the landing page (what/why, 3-line requirements, quick start, one paragraph each for agent / systems / resources / events, docs-map table, 10-line examples list linking examples/README.md); delete docs/api.md, overview.md, design.md, internals.md, tutorial.md; resolve every cross-link in the new pages and in the repo root README.md; package.json description/repository/author updated; one Unreleased changelog line ("docs reorganised; api.md retired"). Also apply the doc deltas of CS-PM13 and CS-PM15, which landed before CS-D09:
  - docs/running-games.md failure notes: `runGame` rejects with NodeSC2Error when no player has an agent; `createGame` rejects with NodeSC2Error ("Could not create a game on ...") when SC2 doesn't move to the game, so low-level `createGame` + `joinGame` callers no longer need their own check. runGame/runBotVsBot failure text unchanged apart from the error class.
  - docs/resources.md events section: an event written with `type: 'build'` or `'unit'` reaches readers created with 'build', 'unit' or 'agent' (all three are the agent reader group); the delivered event keeps the type it was written with.
  - CS-PM02 (approved 2026-10-28): changelog lines only, plus the matching sentences in docs/map.md and docs/units.md if they still state the old behaviour.
    - `map.isPathable/isPlaceable/isVisible/hasCreep` return false and `map.getHeight` returns 0 for points off the grid. Previously an off-grid x returned true ("pathable") and an off-grid y threw a TypeError.
    - `Units.take(n)` with a negative `n` returns an empty collection; previously it returned `slice(0, n)`, everything but the last |n|.
    - `nFurthestToDistance` with count ≤ 0 returns empty.
    - `take`/`randomGroupOf` always return a new collection.
    - Internal precondition failures now throw NodeSC2Error instead of a plain Error (still `instanceof Error`).
  - docs/changelog.md: one Unreleased line each (PM13, PM15, the PM02 lines above) under "Consistency" (or under "Fixed" if CS-D07's layout has no Consistency heading yet).
- Acceptance criteria:
  - [ ] readme.md ≤ 300 lines; no hand TOC; no duplicate headings that need `-1` anchors anywhere in docs/.
  - [ ] Every relative link and anchor in readme.md, docs/*.md, examples/README.md and repo README.md resolves (script check, GitHub slug rules).
  - [ ] Every readme/api.md section is accounted for by a row in cs-docs.md §4 that points to a page that now has it (spot-check each row).
  - [ ] grep: no reference to docs/api.md, overview.md, design.md, internals.md or tutorial.md left in the repo (including .md under packages/core and the root).
  - [ ] running-games.md and resources.md state the PM13/PM15 behaviour above, checked against engine/create-engine.ts and resources/event-channel.ts as landed.
- Implementation plan: Where: readme.md, docs/{api,overview,design,internals,tutorial}.md (delete), all new docs pages (link fixes only, plus the PM13/PM15 text in running-games.md and resources.md), README.md (repo root), packages/core/package.json, docs/changelog.md (three lines). Don't touch: code.
- Stack: docs. Junior. Blocked by: CS-D01–D07, CS-I01 (package.json). Slice siblings: CS-D01–D07.

### CS-D09 Apply public-change docs deltas
- Source: the "Docs delta" notes of every CS-PM ticket done before this starts; PUB-33 (document `supply*` on Agent as the API, `food*` as raw proto fields).
- What to build: update the new pages to the renamed/reshaped APIs; one Unreleased changelog entry per PM ticket (old → new names, behaviour line) under a "Consistency" feature heading.
- Acceptance criteria:
  - [ ] grep over docs/ and readme.md finds none of the old names listed in the deltas.
  - [ ] Every TS block touched still type-checks; links still resolve.
- Implementation plan: Where: docs/*.md, readme.md, examples/README.md, docs/changelog.md. Don't touch: code.
- Stack: docs. Junior. Blocked by: CS-D08. Later PM tickets update docs themselves.

### CS-D10 GLOSSARY.md
- Source: PUB-32.
- What to build: packages/core/GLOSSARY.md defining, without implementation detail: structure vs building (structure = unit category; `buildings` = the build tracker), gas geyser vs gas mine (neutral geyser vs own extractor/refinery/assimilator), townhall vs base vs expansion, unfinished vs pending vs in progress, near vs at, earmark, role, label, opening, task, target. Each entry names the public members that use it; where existing names disagree, list them under "Known deviations" (no renames). Linked from the readme docs map.
- Acceptance criteria:
  - [ ] Every term above defined in one or two sentences; every "known deviation" cites the member name.
  - [ ] Linked from readme.md.
- Implementation plan: Where: new packages/core/GLOSSARY.md, readme.md (one link). Don't touch: code.
- Stack: docs. Junior. Blocked by: CS-D08.

Fallback if DQ1 is "no restructure": one ticket applies the content fixes (DOC-01–10, -12, -38–-46, -48–-54) in place in the current files; duplication stays.

## Public changes

Classification (user, 2026-10-27 via lead): CS-PM = minor (naming alignment, option-shape tweaks, additive aliases or members, type-only or low-impact signature tidy-ups, bug fixes where no correct caller depends on today's result); runnable overnight, each ticket migrates the bot/ and examples/ call sites it touches (user's explicit exception to the bot/ hints-only rule, scoped to those call sites). CS-PQ = removing or reshaping a core concept, or a semantic change to a working call; stays a question for the user. bot/ reliance is not a factor.

Rules for every CS-PM ticket:
- The compiler finds every call site: a rename or reshape changes the type so stale callers fail `check-types`; no silent behaviour change on a renamed path. No deprecated aliases unless the ticket says so.
- Gate: `bun run check-types` and `bun test` in packages/core, `bun run check-types` in bot/ (repo-root turbo), `biome format`.
- bot/ has uncommitted BOT-3 edits (bot/systems/build.ts, combat/offense.ts, combat/utils.ts): the lead commits them before a PM ticket touches bot/. Two PM tickets editing the same bot/ file are serial (Blocked by covers the known ones; the lead re-checks at start).
- Docs: each ticket ends with a "Docs delta" note in its task (old → new names, behaviour line for the changelog). CS-D09 applies every delta recorded before it starts; a PM ticket finishing after CS-D09 edits docs/ and docs/changelog.md itself.
- types.ts is one shared file: the PM and PQ tickets that touch it form one serial chain. Done: PM12 → PM14 → PM03 → PM04. Remaining (2026-10-28): PM18a → PQ06b → R2-T39 → PQ07b → PM05a → PM05b → PM05c → PQ01b → PQ06a → PQ05 → PQ07a → PM06 → PM07 → PQ04 → PM08 → PQ10d → PM09 → R2-T37 → R2-T38 → PM10 → PM11.
- types.ts after R2-T04 (lead decision 2026-10-28, design C6 / ares): `BuildOptions` has no `checkSafe`; tracker retargets use `getNextExpansion`'s default. `BuildingTracker.getNextExpansion(opts?: { checkSafe?: boolean }): Point2D | undefined` (default true) and `isExpansionBlocked(pos)` exist, and `expansionController` passes its flag through to getNextExpansion. Every chain ticket keeps these members as they are (no PM ticket renames or re-defaults them). The types.ts line numbers cited in PM tickets predate R2: re-grep at start. Specific touch points: CS-PM03 leaves `getNextExpansion`'s `Point2D | undefined` as is (already honest); CS-PM05's `near` rename doesn't apply to BuildOptions (`at` is an exact target); CS-PM10 renames the behavior's pass-through option to getNextExpansion's name (`checkLocationIsSafe` → `checkSafe`).

### CS-PM01 Handler errors visible; error name casing
- Source: PUB-02, INT-15 (sink), INT-16 (`err.name`).
- Why minor: log output and `err.name` only; no signature, no return value changes. Today's split hides operational refusals (BuildError/TrainError) from bots that enable `sc2:debug:system` only (bot/index.ts:14); nobody can depend on not seeing them.
- What to build: NodeSC2Error thrown from system and resource handlers is logged at the same namespace/level as other handler errors; unexpected errors from systems/resources also go to console.warn, as agent-handler errors already do (create-engine.ts:577); NodeSC2Error's `name` becomes 'NodeSC2Error' (errors.ts:8, :32).
  - Folded in from the PM02 review (2026-10-28): engine/create-client.ts still throws plain Errors. A protocol response error (:76) keeps its `err` property and becomes a NodeSC2Error. "SC2 connection not open for <name> request" (:101) also becomes a NodeSC2Error, not ConnectionClosedError, which would change it from logged to fatal. They belong here, not in a separate ticket: before this ticket's sink change, a NodeSC2Error from a handler is logged at `sc2:silly:system`, so converting them earlier would hide errors that are visible today.
- Acceptance criteria:
  - [ ] A NodeSC2Error and a TypeError thrown from a system onStep are both visible with `DEBUG=sc2:debug:system`; a TypeError from a resource onStep is printed without DEBUG (test with a stubbed console/debug sink).
  - [ ] `new NodeSC2Error().name === 'NodeSC2Error'`; no 'NodeSc2Error' string left.
  - [ ] create-client: a response with `error` rejects with a NodeSC2Error carrying `err` and the same message; a send on a non-open socket rejects with a NodeSC2Error naming the request (engine/create-client.test.ts).
  - [ ] Gate passes.
- Implementation plan: Where: engine/errors.ts (sink choice inside the CS-I02 helper, name fix), systems/create-system.ts, engine/create-resource-manager.ts, engine/create-engine.ts, engine/create-client.ts:76, :101, engine/create-client.test.ts. bot/: none. Docs delta: commands.md errors table (protocol and not-open errors are NodeSC2Error; class name casing).
- Stack: backend. Junior. Blocked by: CS-I02.

### CS-PM02 Off-map predicates, nFurthestToDistance guard, typed errors, copy semantics
- Source: PUB-07, PUB-10 (guard), PUB-40, INT-16.
- Why minor: each fixes a result no correct caller relies on: off-map lookups throw a TypeError (y) or claim "pathable" (x); `nFurthestToDistance(.., 0)` returns every unit (CN-B05 fixed the sibling); `take`/`randomGroupOf` return values are unchanged, only mutating through the result stops reaching the source; plain Error → NodeSC2Error keeps `instanceof Error`.
- What to build: `map.isPathable/isPlaceable/isVisible/hasCreep` return false and `getHeight` returns 0 for points off the grid; `nFurthestToDistance` returns empty for count ≤ 0; `Units.take`/`randomGroupOf` always return a new Units; internal precondition failures reachable from public calls throw NodeSC2Error (units-collection.ts:201, :279, :287, :366; resources/map.ts:43, :164; engine/create-unit.ts:617; agent/macro.ts:484; engine/launcher.ts:23, :53, :155; engine/create-engine.ts: the remaining plain `new Error`s, at landing time the replay start (:295), the raw-interface check in joinGame (:375) and :430; re-grep at start). CS-PM13 already made the createGame failure (:365) and runGame's no-agent check (:202) NodeSC2Error and removed `assertGameCreated`; leave those as they are. Pure-util argument checks (pixel-map.ts, ramp.ts:17) keep Range/TypeError.
- Acceptance criteria:
  - [ ] Tests: each predicate at (-1, 5), (5, -1), (width, 5), (5, height) returns false / 0, no throw.
  - [ ] `nFurthestToDistance(p, d, 0)` and negative count → empty; `take(n ≥ length)` result is not the source (`!==`).
  - [ ] Error-class test: an empty `Units.first` throws an instance of NodeSC2Error with today's message.
  - [ ] Gate passes.
- Implementation plan: Where: resources/map.ts, resources/units-collection.ts, engine/create-unit.ts, agent/macro.ts:484, engine/launcher.ts, engine/create-engine.ts. Interfaces: none changed. bot/: none (bot/systems/combat/utils.ts isGroundReachable benefits, no edit).
- Stack: backend. Junior. Blocked by: CS-PM01 (errors.ts, create-engine.ts), CS-PM13 (landed; create-engine.ts), CS-I07, CS-I08 (units-collection.ts, map.ts, create-unit.ts, macro.ts).

### CS-PM12 `buildOptions.earmarks` optional
- Source: found while writing CS-D05 (lead, 2026-10-28). types.ts:79 declares `earmarks: null | number` as required, so `buildOptions: { fillWorkers: false }` on a build system doesn't compile, although systems/builder-plugin.ts:116-120 already defaults it (`earmarks: 1000` spread under the user's options).
- Why minor: type-only; the runtime default already exists, so every object that compiles today behaves the same; other members of `buildOptions` are already optional.
- What to build: `earmarks?: null | number` in the System `buildOptions` type; the default stays 1000 at builder-plugin.ts:118.
- Acceptance criteria:
  - [ ] A type-level test (or a builder-plugin test system) with `buildOptions: { fillWorkers: false }` compiles and runs with `earmarks === 1000` after setup.
  - [ ] `buildOptions: { earmarks: null }` still disables earmark timeouts (existing behaviour, builder-plugin.ts:397).
  - [ ] Gate passes.
- Implementation plan: Where: types.ts:77-81 only (plus the test in systems/builder-plugin.test.ts, or a new test file if builder-plugin.test.ts is held by R2-T04). Internal reads at builder-plugin.ts:131, :397-398 need no change (they run after the default spread). Docs delta: CS-D05 documents `earmarks` as optional, default 1000.
- Stack: backend. Junior. Blocked by: R2-T01 (types.ts). First in the types.ts chain (ahead of CS-PM14).

### CS-PM13 Engine entry-point failures
- Source: doc writers, 2026-10-28.
  - engine/create-engine.ts:209-210: `runGame` does `players.find((p) => !!p.agent)!` then `player.agent!.settings`, so a player list without an agent (e.g. two computers) throws a TypeError.
  - engine/create-engine.ts:327-371: `createGame` returns SC2's ResponseCreateGame without checking `error`. Only runGame/runBotVsBot check it (`assertGameCreated`, :160-165), so a low-level `createGame` + `joinGame` caller gets a confusing failure at join time.
- Why minor: both are failure paths no working call goes through. A game that SC2 refused to create can't be joined, and a TypeError is not a usable result. Success returns are unchanged.
- What to build:
  - `runGame` throws a NodeSC2Error naming the problem when no player has an agent.
  - `assertGameCreated` moves into `createGame`, which throws on an error response with today's message. runGame/runBotVsBot keep their behaviour through it.
- Acceptance criteria:
  - [ ] `runGame(map, [computer, computer])` rejects with NodeSC2Error "runGame needs a player with an agent" (wording free).
  - [ ] `createGame` against a fake client returning `{ error: ... }` rejects with the existing "Could not create a game on ..." message; a success response is returned as before.
  - [ ] Gate passes.
- Implementation plan: Where: engine/create-engine.ts:160-165, :208-214, :327-371; engine/create-engine.test.ts (fake client from test/fake-client.ts). Docs delta: running-games.md failure notes.
- Stack: backend. Junior. Blocked by: CS-PM02 (create-engine.ts). CS-PM05 (createGame options) waits for this.

### CS-PM14 Type and additive fixes from the docs pass
- Source: doc writers, 2026-10-28.
- Why minor: type-only corrections to match what the implementation already accepts or returns, plus additive members. No existing result changes.
- What to build:
  - MapResource types: `closestPathable(point, radius?: number)` and `isPlaceable(point, opts?: MapPathOptions)` / `isPlaceableAt(type, pos, opts?: MapPathOptions)`, matching resources/map.ts:25-29 (types.ts:428-429, :453 omit them).
  - `frame.getPrevious()`: typed as what it holds, `{ _gameLoop: number } | undefined`. systems/frame.ts:46-48 stores only the loop, and it's null before the first step (resources/frame.ts:12, :42 uses `!`). The `GameFrame` type stops implying `_observation`/`_gameInfo` there. Keeping the previous observation would be a new feature, not in scope.
  - `PixelMap` accepts an `SC2APIProtocol.ImageData` directly (`new PixelMap(startRaw.pathingGrid)`, the form the old api.md:799 used). Fields are checked at runtime and a missing one throws a TypeError, like the existing size check.
  - Expansion gets live `getMineralFields(): Units` and `getVespeneGeysers(): Units` (own-base resources still alive now, like `getBase()`). `cluster.mineralFields/vespeneGeysers` stay the start-of-game snapshot that area computation uses (systems/map.ts:247-280). Docs call the snapshot a snapshot.
- Acceptance criteria:
  - [ ] Types match the implementations above; `bun run check-types` shows no new `!` needed at callers.
  - [ ] Tests: PixelMap from a fixture's `startRaw.pathingGrid` equals the explicit-form construction. `getMineralFields()` drops a field after it dies in a fixture step while `cluster.mineralFields` keeps it.
  - [ ] Gate passes.
- Implementation plan: Where: types.ts (MapResource, FrameResource.getPrevious, Expansion), resources/frame.ts, utils/pixel-map.ts, engine/create-expansion.ts. Follow: `Expansion.getBase()` in create-expansion.ts. Docs delta: map.md (PixelMap, Expansion getters, snapshot note), resources.md (getPrevious).
- Stack: backend. Junior. Blocked by: CS-PM12 (types.ts). CS-PM03 waits for this; CS-PM07 (create-expansion.ts) comes later in the chain.

### CS-PM15 Events written as 'build' or 'unit' reach their readers
- Source: doc writers, 2026-10-28. resources/event-channel.ts:16 stores readers created with type 'build' or 'unit' as 'agent', but `write` (:44-51) matches on the event's raw type. An event written with `type: 'build'` or `'unit'` gets zero readers and is never delivered. `EventType` (types.ts:699) offers both values for writes.
- Why minor: today such an event silently goes nowhere, so no working caller depends on it. The fix makes `write` map the type the same way `createReader` does.
- What to build: one `normaliseEventType` used by both `createReader` and `write` ('build'/'unit' → 'agent'). The event's stored `type` stays as written, so readers still see 'build'/'unit'.
- Acceptance criteria:
  - [ ] Test: a build-system reader and an agent reader both receive an event written with `type: 'build'`, and the same for 'unit'. 'engine' and 'all' are unchanged.
  - [ ] Gate passes.
- Implementation plan: Where: resources/event-channel.ts; a new resources/event-channel.test.ts (none exists, INT-23). types.ts untouched. Docs delta: resources.md events section.
- Stack: backend. Junior. Blocked by: CS-I03 (event-channel.ts).

### CS-PM16 Next expansion skips spots a tracked townhall build already targets
- Source: R2-T04 (lead, 2026-10-28). `nextExpansion` (resources/buildings.ts:371-377) filters available expansions by `isBlocked(pos, true)`, which sees own townhalls only once they exist as units (spatial check :361-363). An active tracked townhall build whose worker is still moving (status 'moving'/'ordered', no structure yet) doesn't count, so `getNextExpansion()`, an untargeted runner CC and `retargetTownhall` (:398-406) can all pick the spot a pending build is heading to.
- Why minor: a bug fix. Two townhalls sent to one spot is never a correct result, and calls whose spot is free return the same as today.
- What to build: `nextExpansion` also skips any position targeted by another active tracked townhall build (`isActive` at :81, `townhallTypes` includes `unitType`, target within the existing expansion-match distance of the candidate). `retargetTownhall` excludes the build being retargeted from that check (it's moving off its own spot).
- Acceptance criteria:
  - [ ] Test: with one tracked CC 'moving' to expansion A, `getNextExpansion()` returns B; once that build fails or is cancelled, A is returned again.
  - [ ] Test: two untargeted townhall builds requested in the same step get different spots.
  - [ ] Test: `retargetTownhall` on a blocked build doesn't choose another pending build's spot, and can still choose a spot no other build targets.
  - [ ] `checkSafe` behaviour unchanged: getNextExpansion defaults to true and retargets use that default (R2-T04 lead decision; BuildOptions has no checkSafe).
  - [ ] Gate passes.
- Implementation plan:
  - Where: resources/buildings.ts (`nextExpansion`, `retargetTownhall`), resources/buildings.test.ts.
  - Interfaces: internal only, `nextExpansion(checkSafe: boolean, accept?: (pos: Point2D) => boolean, exclude?: Build)`. No types.ts change.
  - Follow: `isBlocked` (:355-368) for the distance constant; `isActive` (:81).
  - Don't touch: types.ts, systems/builder-plugin.ts:742 and behaviors/macro/structures.ts:173 (callers benefit unchanged).
  - Docs delta: macro.md, "getNextExpansion skips spots of pending tracked townhall builds".
- Stack: backend. Junior. Blocked by: R2-T04 approved (buildings.ts). CS-I13, CS-PM05 and CS-PM06 (buildings.ts) wait for this.

### CS-PM17 Effects with the same id and position but different owners stay separate
- Source: R2-T04 (lead, 2026-10-28). The map system's `sameEffect` (systems/map.ts:625-629) compares `effectId`, the first position and the position count, but not `alliance` or `owner`. An own scan and an enemy scan on the same spot collapse into one entry in `map.getEffects()`: whichever arrived first is kept, and the second never fires `newEffect`. Concrete impact: the R2-T04 blocked-spot clearing (resources/buildings.ts `clearBlocked`) filters `map.getEffects()` for own scans, so an own scan masked by an earlier enemy scan doesn't clear the spot.
- Why minor: a bug fix. Results change only when two effects of different owners coincide, which today is wrong (one disappears); every other case returns the same list and events.
- What to build: `sameEffect` also compares `alliance` and `owner` (undefined equals undefined, so fixtures without these fields behave as today). Expiry uses the same predicate, so each side expires on its own.
- Acceptance criteria:
  - [ ] Test: own and enemy scan at the same position in one frame → `map.getEffects()` has two entries, and two `newEffect` events are written.
  - [ ] Test: when the enemy scan ends and the own scan stays, one `expiredEffect` (enemy) is written and the own entry remains.
  - [ ] Test: the same effect (same id, pos, alliance, owner) on consecutive frames still yields one entry and no repeat `newEffect`.
  - [ ] Gate passes.
- Implementation plan:
  - Where: systems/map.ts:625-629 (`sameEffect`); new systems/map-effects.test.ts (systems/map.test.ts is CS-I12's).
  - Interfaces: none changed.
  - Follow: the existing newEffect/expiredEffect flow at systems/map.ts:631-683.
  - Don't touch: resources/map.ts, resources/buildings.ts (CS-PM16 running), systems/map.test.ts.
  - Docs delta: map.md `getEffects` / events: effects are distinguished by owner; one changelog line.
- Stack: backend. Junior. Blocked by: None (R2-T04 approved; no queued ticket in flight on systems/map.ts). CS-I04, CS-I08, CS-I10 and CS-PM07 (systems/map.ts) wait for it.
- Not folded into an existing ticket: the queued tickets that touch systems/map.ts are internal-only (CS-I04, I08, I10, which may not change behaviour) or far down the types.ts chain (CS-PM07). A standalone ticket lands the fix now.

### CS-PM18 One owned-effect type (split 2026-10-28: PM18a now, PM18b on influence.ts)
- Split (architect, sequencing only, lead to confirm): resources/influence.ts is held by R2-T10 and then T11/T29, while every other PM18 file is free now. **CS-PM18a** = everything below except resources/influence.ts; runnable now. **CS-PM18b** = replace influence.ts's local alias with types.ts `OwnedEffect`; one-file junior ticket, after R2-T10 and PM18a, before R2-T11 in the influence.ts chain. AC for both: the grep AC below, scoped to their files.
- Source: lead, 2026-10-28, after CS-PM17. Four local aliases of `SC2APIProtocol.Effect & { alliance?; owner? }`: resources/buildings.ts:~374, resources/intel.ts:32, resources/influence.ts:41, systems/map.ts (`OwnedEffect`). The bundled proto typings lack those fields; the raw data carries them.
- Why minor: type-only and additive. `map.getEffects()` returns the same objects with two optional fields now typed; nothing breaks for callers.
- What to build: `export type OwnedEffect = SC2APIProtocol.Effect & { alliance?: SC2APIProtocol.Alliance; owner?: number }` in types.ts; `MapResource.getEffects(): OwnedEffect[]` (and `setActiveEffects`); the four local aliases replaced by it.
- Acceptance criteria:
  - [ ] grep: no local `Effect & {` alias left; `getEffects()` typed `OwnedEffect[]`; callers drop their casts.
  - [ ] Gate passes; no runtime change.
- Implementation plan: Where: types.ts, resources/map.ts (`getEffects`, `setActiveEffects`), systems/map.ts, resources/{buildings,intel,influence}.ts. Docs delta: map.md getEffects return type. Don't touch: frame.ts (`frame.getEffects` stays raw proto).
- Stack: backend. Junior. Blocked by: PM18a: none (CS-PM04 ✓, R2-T08 ✓, CS-I13 ✓; types.ts, map.ts, systems/map.ts, buildings.ts, intel.ts all free at snapshot 3). PM18b: R2-T10 (influence.ts), CS-PM18a. Blocks: CS-PQ06b (next types.ts slot), R2-T11 (PM18b, influence.ts).

### CS-PM03 Honest return types
- Source: PUB-12.
- Why minor: type-only; runtime results unchanged. The compiler then points at call sites that can receive undefined today.
- What to build: `| undefined` on map.getMain/getNatural/getEnemyMain/getEnemyNatural (undefined on custom maps), `getLocations().self` (before game start), data.getAbilityData/getUpgradeData/getEffectData, `closestPoint`. `getUnitTypeData` keeps its type (it throws, it doesn't return undefined) and frame getters keep theirs (changing to a throw would be semantic).
- Acceptance criteria:
  - [ ] Types changed as listed; every core, examples and bot/ call site compiles with an explicit guard or a `!` only where the value is guaranteed (with a one-line why if not obvious).
  - [ ] Gate passes.
- Implementation plan: Where: types.ts (MapResource, DataStorage), utils/geometry/point.ts, core callers (map.ts:237 et al., ~9 + data getters ~9), bot/systems/anchor.ts:5, bot/systems/combat/offense.ts:54-55 and other grep hits.
- Stack: backend. Junior. Blocked by: CS-PM14 (types.ts), R2-T01, CS-I08 (point.ts, data-storage.ts).

### CS-PM04 Command shapes
- Source: PUB-21 (actions part), PUB-22, PUB-36.
- Why minor: option-shape and argument-order tweaks; each command still issues the same order with the same defaults. Every change alters the parameter types, so the compiler catches stale callers.
- What to build: `actions.mine`'s `gasBuilding` parameter is renamed `gasMine` (parameter name only, GLOSSARY "Known deviations"); `queue` moves into an options object on every actions.* command that takes it positionally (`move/attack/attackMove/patrol/smart/gather/mine/stop/holdPosition/repair/returnResource`), defaults unchanged (gather/mine stay `true` until PQ2); `actions.build(type, target, { worker })`; `actions.do(units, abilityId, { target, queue })`, units first, accepting `Unit | Unit[] | Units`; typed signatures accept what the runtime already accepts (single Unit on attack/smart/mine; Unit or tag where the runtime takes both).
- Acceptance criteria:
  - [ ] No positional boolean `queue` left on actions.*; actions.do argument order as above.
  - [ ] Existing command tests pass with call sites updated; a test per changed signature asserts the same proto action as before.
  - [ ] Gate passes.
- Implementation plan: Where: types.ts (ActionManager), resources/actions.ts, core callers (grep `actions\.(do|move|attack|...)\(` incl. behaviors/ and systems/builder-plugin.ts), examples/, bot/systems/military/production.ts:122 and other bot/ grep hits. Follow: `Unit.useAbility(abilityId, { target, queue })` (create-unit.ts:584).
- Stack: backend. Junior. Blocked by: CS-PM03 (types.ts), CS-PM02 (create-unit.ts), CS-I07, CS-I08 (actions.ts), R2-T04 (builder-plugin.ts caller), BOT-3 commit.

### CS-PM05 Agent, units and engine call shapes; `near` (split into PM05a/b/c, 2026-10-28)
- Source: PUB-04 (filter type), PUB-08, PUB-21, PUB-29, PUB-30, PUB-43.
- Split (architect, granularity only, lead to confirm): the original ticket touched ~60 call sites across agent, units, placement and engine and wouldn't fit one context. PQ2(b) and PQ2(c) are folded into PM05b because they change the same getters PM05 reshapes. The three run serially in the types.ts chain.
- Rules for all three: shape-only unless an item says "Changed per PQ"; gate as in "Public changes"; each edits its docs page and docs/changelog.md itself (they finish after R2-T18).

#### CS-PM05a Agent and engine call shapes
- Why minor: option-shape and parameter-name tweaks; results and defaults unchanged.
- What to build:
  - `agent.train(type, { count, near, idleOnly })` (today `train(type, amount, closestTo, trainOnlyIdleBuildings)`).
  - `agent.canAfford(type, { earmark, count, supply })` and `canAffordUpgrade(upgradeId, { earmark })`. Settling is untouched here; CS-PQ07a removes it.
  - `engine.createGame(map, players, { realtime, ... })` matching runGame. Builds on CS-PM13 (landed): `createGame` itself throws NodeSC2Error on a failed create (status check after `_client.createGame`, with its why comment), and runGame/runBotVsBot call it without `assertGameCreated`. The reshape changes only the parameter list: keep the status-based check and its message, update the internal calls in runGame/runBotVsBot, and keep runGame's no-agent NodeSC2Error ahead of the call. PM13's tests in engine/create-engine.test.ts move to the new call shape with the same assertions.
- Acceptance criteria:
  - [ ] Each item done; no positional `earmarkName`, `amount`, `closestTo`, `trainOnlyIdleBuildings` or `realtime` left on Agent/Engine types.
  - [ ] Existing agent, builder-plugin and engine tests pass with call sites updated; one test per reshaped call asserts the same result as the old call.
  - [ ] Gate passes.
- Implementation plan: Where: types.ts (Agent, Engine), agent/macro.ts (train), agent/create-agent.ts (canAfford*), engine/create-engine.ts (createGame), core canAfford callers (~23: grep `canAfford(`, incl. resources/buildings.ts, systems/builder-plugin.ts, behaviors/), agent.train callers (systems/builder-plugin.ts train task), examples/, bot/ (canAfford 8: economy.ts, training.ts, production.ts, wall.ts; agent.train 1: training.ts). Don't touch: data-storage.ts (CS-PQ09).
- Stack: backend. Junior. Blocked by: CS-PQ07b (types.ts chain), CS-I06 (agent/macro.ts, create-agent.ts, builder-plugin.ts), R2-T15 (builder-plugin.ts), and no in-flight ticket on a canAfford caller file (grep at start). Changed per lead decision 2026-10-28: no longer waits for R2-T18 or for every other R2 ticket.

#### CS-PM05b Units and map shapes; getWorkers and getter defaults (Changed per PQ2(b), PQ2(c))
- Why: shape items are minor; the two PQ items are user-approved semantic changes (decisions 2026-10-28).
- What to build:
  - `map.getCenter({ pathable })`, `Units.sorted(key, { reverse })`, `sortedByDistanceTo(pos, { reverse })`.
  - `Units.closerThan/furtherThan(position, distance)` position-first like every other Units helper.
  - Every UnitResource typed getter accepts `number | UnitFilter` (today only some do; the runtime path is identical).
  - Changed per PQ2(c): `units.getWorkers()` returns every own worker (no flag). New `units.getAvailableWorkers()` returns the ones without the internal `command` label (today's `getWorkers()`). `getIdleWorkers`/`getMineralWorkers` keep their results by building on `getAvailableWorkers`; `getConstructingWorkers` builds on `getWorkers()`. Core callers that want today's filtered view move to `getAvailableWorkers()`, callers of `getWorkers(true)` to `getWorkers()`. This replaces the old PM05 item `getWorkers({ includeBusy })`.
  - Changed per PQ2(b): typed getters of player units default to `Alliance.SELF`. At audit only `getUnfinished` (today all alliances) changes; getById, getStructures, getBases, getCombatUnits, getGasMines and inProgress already default to SELF. `getByType` is removed in favour of `getById(ids, { alliance })`. Its core callers: systems/map.ts (vespene geysers, mineral fields: pass `Alliance.NEUTRAL`), resources/map.ts gas mines (needs SELF and ENEMY: two calls or a getAlive filter, internal choice), systems/builder-plugin.ts ability-task casters (SELF; today all alliances, which could pick an enemy caster: changelog line). Not changed (OQ-B, see Further notes): `getMineralFields`/`getGasGeysers` (neutral units; a SELF default would return nothing), `getAll`/`getAlive`/`withLabel` (not typed getters).
- Acceptance criteria:
  - [ ] Each item done; no boolean positional on getCenter/sorted/sortedByDistanceTo; closerThan/furtherThan take position first; no `getByType` on UnitResource.
  - [ ] Tests: a worker with the `command` label is in `getWorkers()` and not in `getAvailableWorkers()`; getIdleWorkers/getMineralWorkers return the same as before on the existing fixtures; `getUnfinished()` excludes an enemy structure under construction; `getById(type, { alliance: ENEMY })` returns what `getByType` returned for enemy units.
  - [ ] bot/ migrated: bot/index.ts:47 keeps `getWorkers()` (now counts every worker, the PQ2(c) fix); bot/systems/economy.ts `getWorkers(true)` → `getWorkers()`; closerThan/furtherThan call sites (bot ~18, core ~9) swapped.
  - [ ] Gate passes.
- Implementation plan: Where: types.ts (UnitResource, MapResource.getCenter), resources/units.ts, resources/units-collection.ts, resources/map.ts, systems/map.ts, systems/builder-plugin.ts (getByType caller), core callers (grep `closerThan|furtherThan|getCenter\(|sorted\(|sortedByDistanceTo|getWorkers|getByType|getUnfinished`), examples/, bot/systems/** and bot/index.ts.
- Stack: backend. Junior. Blocked by: CS-PM05a (types.ts chain), CS-PQ01a and CS-PQ07b (units-collection.ts), R2-T34 (units.ts), CS-PQ02a (bot/systems/economy.ts).

#### CS-PM05c Proximity parameters are named `near`
- Why minor: option renames; values and behaviour unchanged.
- What to build: `PlacementRequest.closestTo` → `near`, `WarpInOptions.nearPosition` → `near`, `autoSupply`'s `closestTo` → `near`.
- Acceptance criteria:
  - [ ] No `closestTo`/`nearPosition` option names left on public types.
  - [ ] Existing placement, warpIn and autoSupply tests pass with call sites updated.
  - [ ] Gate passes.
- Implementation plan: Where: types.ts (PlacementRequest, WarpInOptions, autoSupply options), resources/placement.ts, resources/actions.ts (warpIn), behaviors/macro/structures.ts (autoSupply), callers (grep `closestTo:|nearPosition`), examples/, bot/ grep hits.
- Stack: backend. Junior. Blocked by: CS-PM05b (types.ts chain), R2-T35 (placement.ts), CS-PQ07b (actions.ts chain).

### CS-PM06 Time units in names
- Source: PUB-06 (names), PUB-25.
- Why minor: renames that put the unit in the name; values and units unchanged.
- What to build: settings that take seconds get a `Seconds` suffix (`BuildingSettings.timeout` → `timeoutSeconds`, `MemorySettings.expireGround/expireAir` → `expireGroundSeconds/expireAirSeconds`, `PlacementSettings.reservationTimeout` → `reservationTimeoutSeconds`, `IntelSettings.greedyTwoBaseBefore/greedyThreeHatchBefore` → `...BeforeSeconds`, `RunGameOptions.gameTimeLimit` → `gameTimeLimitSeconds`); loop timestamps get a `Loop` suffix (`TrackedBuild.requestedAt` → `requestedAtLoop`, `FlightPlan.startedAt` → `startedAtLoop`, intel `detectedAt` → `detectedAtLoop`); `Unit.getLife()` (0..100, 0 callers) → `healthPercent()`.
  - Changed per PQ3 (user, 2026-10-28): `Placement.reservedAt` becomes `reservedAtLoop` and stores the game loop (`frame.getGameLoop()`, today `frame.time()` seconds). The reservation-timeout check converts once (loops vs `reservationTimeoutSeconds`). `OpeningRecord.duration` stays seconds (persisted ares-format field). Replaces the old item `reservedAt` → `reservedAtSeconds`.
  - Changed per PQ10(e) (user, 2026-10-28): System `buildOptions.earmarks` (a delay in loops) → `buildOptions.earmarkDelayLoops`; the `earmarkDelay()` method keeps its name; default 1000 and `null` (disabled) unchanged (CS-PM12).
- Acceptance criteria:
  - [ ] Each rename done across core, examples and bot/; no old name left on a public type.
  - [ ] Test: a reservation made at loop L expires at the same game time as before (timeout seconds × 22.4 loops later), and `reservedAtLoop === L`.
  - [ ] Test: `buildOptions: { earmarkDelayLoops: null }` disables earmark timeouts; omitted → 1000.
  - [ ] Gate passes; docs (macro.md, build-orders.md, resources.md settings tables) and changelog edited by this ticket.
- Implementation plan: Where: types.ts, resources/{buildings,memory,placement,intel,flying}.ts, engine/create-engine.ts (gameTimeLimit), engine/create-unit.ts (getLife), systems/builder-plugin.ts (earmarks reads/default/earmarkDelay setter), examples/ (gameTimeLimit sites, buildOptions), bot/ grep hits.
- Stack: backend. Junior. Blocked by: CS-PQ07a (types.ts chain; builder-plugin.ts), CS-PM05c (placement.ts), CS-PQ05 (create-unit.ts), CS-PQ06a (buildings.ts).

### CS-PM07 Coordinates and grids
- Source: PUB-05 (additive part), PUB-23, PUB-24, PUB-39, PUB-41 (param).
- Why minor: an added field, a return-shape tidy-up with no caller outside core (map.path/pathFrom*: bot 0 / examples 0), renames, and type narrowing to what the runtime handles.
- What to build: `Expansion.townhallCenter: Point2D` (the +0.5 centre the helpers already compute through utils/map/townhall.ts:21; townhallPosition unchanged, PQ4); `map.path` and `Expansion.pathFromMain/pathFromEnemy` return `Point2D[]` (`Path` type becomes `Point2D[]`; getCombatRally's conversion goes); `inPathingGrid/inPlacementGrid` → `startPathable/startPlaceable`; `map.getGrids()` typed `{ pathing: PathingGrid; placement: PlacementGrid; ... }` where the alias names state polarity (0 = walkable / 1 = placeable); `map.freeGasGeysers(): Units`; `getExpansions(alliance?: Alliance.SELF | Alliance.ENEMY)`.
- Acceptance criteria:
  - [ ] Each item done; map.path tests assert Point2D output with the same cells.
  - [ ] Gate passes.
- Implementation plan: Where: types.ts, resources/map.ts, engine/create-expansion.ts, utils/map/townhall.ts, systems/map.ts (pathFrom*), utils/map/region.ts or other path consumers (grep), bot/ grep hits (getExpansions 9 compile unchanged).
- Stack: backend. Junior. Blocked by: CS-PM06 (types.ts), CS-I10 ✓, CS-PQ01b (resources/map.ts). CS-PQ04 (PQ4 (a): townhall builds take `townhallCenter`) follows.

### CS-PM08 One name per concept (renames and additions)
- Source: PUB-17 (verb), PUB-19, PUB-26 (rename), PUB-35, PUB-42 (isOwn).
- Why minor: renames to the names the rest of the surface already uses, plus additive members; behaviour of every call unchanged.
- What to build: `agent.research` → `agent.upgrade` (six names already say upgrade); `units.getAlive()` → `getVisible()` (same filter; CS-PQ07c then drops dead own units from getAll); root index.ts exports the full point-helper set (`nClosestPoint`, `add`, `subtract`, `multiply`, `normalize`, `areEqual`, `distanceX/Y`), `center` dropped from behaviors/index.ts (Units#center and avgPoints cover it); new `Unit.isOwn()`.
  - Moved to CS-PQ07b (Changed per PQ7(b)): `Unit.isConstructing()` → `hasBuildOrder()` and `Unit.isUnderConstruction()`; they belong with the one predicate rule.
  - Changed per PQ10(a) (user, 2026-10-28): `buildings.buildGas` → `buildings.buildGasMine`, matching `actions.buildGasMine` and the glossary term. Callers: behaviors/macro/structures.ts (gas controller), systems/builder-plugin.ts (gas step), behaviors/macro/structures.test.ts spies. bot 0 / examples 0.
- Acceptance criteria:
  - [ ] Each item done across core, examples, bot/ (getAlive bot 4, core ~32); no `buildGas` member left on BuildingTracker.
  - [ ] Gate passes; docs and changelog edited by this ticket.
- Implementation plan: Where: types.ts, agent/macro.ts, engine/create-unit.ts (isOwn), resources/units.ts, resources/buildings.ts (buildGas), behaviors/macro/structures.ts, systems/builder-plugin.ts, index.ts, behaviors/index.ts, all getAlive callers, examples/, bot/.
- Stack: backend. Junior. Blocked by: CS-PQ04 (types.ts chain; agent/macro.ts, buildings.ts, structures.ts, builder-plugin.ts), CS-PM05b (units.ts).

### CS-PM09 Public surface hygiene
- Source: PUB-27, PUB-37, INT-03.
- Why minor: removes engine-only members no bot or example uses (0 hits) from the public types, narrows an always-present resource to required, and adds getters/defaults; behaviour unchanged except configure rejecting invalid values, which today are accepted and break later.
- What to build: MapResource and FrameResource split into the public read interface and an engine-only writer interface (`_fields`, `set*`, `newGraph`, `recordStepTime`, `resetStepTimes`); `ResourceContainer.debug` required (drop the 7 `debug!`, 1 `debug?.`); each configurable resource gets `getSettings(): Readonly<XSettings>`, exports its `X_DEFAULTS` from index.ts like INFLUENCE_DEFAULTS, and validates in `configure` like mining.ts:142-149 (NodeSC2Error).
- Acceptance criteria:
  - [ ] No `_`-prefixed member or engine mutator on MapResource/FrameResource; engine/system writers use the writer type; `getGraph`/`newGraph` either move to the writer type or get a real type instead of `any` (doc writers, 2026-10-28).
  - [ ] getSettings/defaults/validation on every resource with configure; one test per resource for an invalid value.
  - [ ] Gate passes.
- Implementation plan: Where: types.ts, resources/{map,frame}.ts, systems/{map,frame}.ts, every resource with configure, index.ts. Follow: mining.ts:142-149, constants/influence.ts INFLUENCE_DEFAULTS.
- Stack: backend. Junior. Blocked by: CS-PQ10d (types.ts chain), CS-PM08 (index.ts), CS-PQ07c (systems/frame.ts), CS-I13 ✓, CS-I04 ✓. R2-T37 (RQ11'(b) prerequisite, parity-r2.md) follows and builds on the writer types: it reroutes engine writers to the registered instance, so PM09 only has to split the types.

### CS-PM10 Behaviors vocabulary
- Source: PUB-31, PUB-34; GLOSSARY.md "Known deviations" (CS-D10, 2026-10-28).
- Why minor: option renames on behaviors, which are unreleased (consolidation Q6); behaviour unchanged except squared-distance params taking plain distances, which the rename makes compile-visible.
- What to build: one count word (`toCount`; spawnController `maximum` → `toCount`), `buildStructure` keeps `maxOnRoute` (changed 2026-10-28: it counts workers on the way to an unstarted structure, not pending builds, so renaming it `maxPending` would add a third meaning; the two existing `maxPending` options are PQ10(c)); `buildStructure`'s `structureType` → `unitType` (as `buildings.build`); `gasBuildingController` → `gasMineController` (glossary term "gas mine"), `bonusDistance` everywhere (`inAttackRange` `extraRange`), plain distances (`distanceSquaredCheck` / `distanceCheckSquared` → `distance`, squared inside), group behaviors accept `Iterable<Unit>`; R2's AoE/spell option names follow (`closeEnemy` vs `targets`: pick `targets`); `expansionController`'s `checkLocationIsSafe` → `checkSafe` (behaviors/macro/structures.ts:152, :158, :173), the name of the `buildings.getNextExpansion` option it passes through to (default stays true).
  - Changed per PQ10(c) (user, 2026-10-28): `gasMineController`'s `maxPending` counts `agent.alreadyPending(gasMineType)` (orders, unfinished, tracked), like `expansionController`'s, instead of `buildings.pending` (tracked only). The `max` it passes to `buildings.buildGasMine` stays (tracker-level cap).
- Acceptance criteria:
  - [ ] No option names from the left-hand list on behaviors' public types; tests updated, same behaviour except the PQ10(c) count.
  - [ ] Test: a gas mine ordered outside the tracker (worker with the build order, no tracked build) counts toward `maxPending`; with `maxPending: 1` the controller builds nothing more.
  - [ ] Gate passes; docs and changelog edited by this ticket.
- Implementation plan: Where: behaviors/** and their tests, types.ts (behavior option types), examples/, bot/ grep hits (`closeEnemy|group:` 3).
- Stack: backend. Junior. Blocked by: R2-T38 (types.ts chain), R2-T20 and CS-PQ01a (individual.ts, group.ts), CS-I14 ✓.

### CS-PM11 Debug namespace scheme
- Source: INT-17.
- Why minor: names of DEBUG channels only.
- What to build: logs use `sc2:<level>:<camelCaseModule>`, overlays `sc2:draw:<name>`; modules without a namespace (mining, buildings, openings, flying, intel) get none added unless they log; old → new table in the docs delta.
- Acceptance criteria:
  - [ ] Every `createDebug(` string follows the scheme; bot/index.ts DEBUG strings migrated.
  - [ ] Gate passes.
- Implementation plan: Where: every `createDebug(` site (agent/, engine/, systems/, resources/, utils/build-order/parse.ts), bot/index.ts.
- Stack: backend. Junior. Blocked by: CS-PM10 (last of the serial wave; it touches every module that logs).

## Answered questions (CS-PQ tickets, 2026-10-28)

Answers: core-arch.decisions.md, 2026-10-28 (user): PQ1 (a), PQ2 a+b+c, PQ3 yes, PQ4 (a), PQ5 yes, PQ6 a+b+c, PQ7 a+b+c+d, PQ8 superseded, PQ9 latest wins, PQ10 a, c, d, e yes and b no.
These are user-approved semantic changes, so the CS-PM "no behaviour change" rule doesn't apply to the item each ticket names; everything else in the ticket stays behaviour-preserving. Each ticket migrates the core, examples and bot/ call sites it changes (user's exception to the bot/ hints-only rule, as for CS-PM), and edits its docs page and docs/changelog.md itself; the changelog line says what an unchanged call now does differently. Gate as in "Public changes". docs/ is one serial resource: the lead hands it to one ticket at a time.

Where each answer went:

| answer | ticket |
|---|---|
| PQ1 (a), Units part | CS-PQ01a (with PQ7 (d)) |
| PQ1 (a), absence and agent returns | CS-PQ01b |
| PQ2 (a) | CS-PQ02a |
| PQ2 (b), (c) | folded into CS-PM05b |
| PQ3 | folded into CS-PM06 |
| PQ4 (a) | CS-PM07 adds `townhallCenter`; CS-PQ04 moves townhall builds to it |
| PQ5 | CS-PQ05 |
| PQ6 (a) | CS-PQ06a |
| PQ6 (b) | CS-PQ06b |
| PQ6 (c) | CS-PQ09 (same file as PQ9) |
| PQ7 (a) | CS-PQ07a |
| PQ7 (b) | CS-PQ07b (takes `hasBuildOrder`/`isUnderConstruction` from CS-PM08) |
| PQ7 (c) | CS-PQ07c |
| PQ7 (d) | CS-PQ01a |
| PQ8 | superseded (user pushed with stubs); no ticket |
| PQ9 | CS-PQ09 |
| PQ10 (a) | folded into CS-PM08 |
| PQ10 (b) | no change |
| PQ10 (c) | folded into CS-PM10 |
| PQ10 (d) | CS-PQ10d |
| PQ10 (e) | folded into CS-PM06 |

Conflicts with the PM05–PM11 chain, and how they're settled:
- PQ5 (sync) vs PM05 call shapes: different aspects of the same members. PM05a reshapes the parameters first, CS-PQ05 changes the return type after it, so each call site is edited once per ticket and never by two tickets at once.
- PQ2 (c) vs PM05's `getWorkers({ includeBusy })`: the option item is dropped; PM05b implements `getWorkers()` + `getAvailableWorkers()` instead.
- PQ2 (b) vs PM05's "every typed getter accepts number | UnitFilter": same getters, so both are in PM05b.
- PQ7 (a) vs PM05's canAfford options: PM05a reshapes, CS-PQ07a then removes the settle; no caller is edited by both at once.
- PQ7 (b) vs PM08's `isConstructing` rename: moved into CS-PQ07b, so the `is*` = first order / `has*` = any order rule lands in one ticket.
- PQ3 vs PM06's `reservedAtSeconds`: PM06 now renames straight to `reservedAtLoop`; there is no intermediate name.
- PQ4 vs PM07: PM07 adds the field (unchanged); CS-PQ04 moves the builds after PM07 and CS-PQ06a.
- PQ6 (a) vs CS-PQ04: PQ06a changes the return shape with coordinates unchanged; PQ04 then changes coordinates. Splitting them keeps the senior part (tracker matching) apart from the mechanical shape change.
- PQ10 (a), (c), (e): small renames and one count on code PM06/PM08/PM10 already edit, so they're folded in instead of getting slots of their own.

### CS-PQ01a Units lookups return undefined; furthestNUnits furthest first
- Decision: PQ1 (a), Units part, and PQ7 (d). Source: PUB-09, PUB-10.
- What to build:
  - On an empty collection, `Units.first`, `random`, `closestTo`, `furthestTo` and `inClosestDistanceToGroup` return `undefined` (typed `Unit | undefined`) and `center` returns `undefined` (`Point2D | undefined`), instead of throwing.
  - `closestDistanceTo` / `furthestDistanceTo` on empty return `Infinity` / `-Infinity` (Math.min/max of nothing). OQ-A: values recommended, not user-confirmed.
  - `inDistanceOfGroup(other, d)` with an empty `other` returns an empty Units.
  - `byTag` (the throwing twin of `findByTag`, 0 callers outside tests) is removed; `findByTag` stays. OQ-A.
  - `furthestNUnits(pos, n)` returns furthest first (today ascending). `closestNUnits` unchanged.
  - `assertNotEmpty` goes if nothing uses it. CS-PM02's "empty Units.first throws NodeSC2Error" test is replaced by the undefined test.
- Acceptance criteria:
  - [ ] Test per member on an empty Units: the value above, no throw.
  - [ ] Test: `furthestNUnits(p, 3)[0]` is `furthestTo(p)`, and the order is non-increasing in distance.
  - [ ] Every core, examples and bot/ caller compiles with an explicit guard; `!` only where the line before checks the collection is non-empty.
  - [ ] Gate passes; docs/units.md empty-collection table; changelog.
- Implementation plan:
  - Where: resources/units-collection.ts, resources/units-collection.test.ts; callers the compiler finds (at audit: behaviors/combat/{terran,individual}.ts, resources/{mining,flying}.ts, utils/workers/select-builder.ts, examples/cannon-rush.ts, bot/systems/combat/micro/basic.ts:51 `closestTo(...).pos`, bot/systems/combat/offense.ts:118 `alive.center`); docs/units.md, docs/changelog.md.
  - Interfaces: `get first(): Unit | undefined`, `get random(): Unit | undefined`, `get center(): Point2D | undefined`, `closestTo(p): Unit | undefined`, `furthestTo(p): Unit | undefined`, `inClosestDistanceToGroup(o): Unit | undefined`.
  - Follow: `findByTag`, `randomOr` (units-collection.ts).
  - Don't touch: types.ts (Units is the class), sorted/closerThan shapes (CS-PM05b).
- Stack: backend. Junior. Blocked by: R2-T20 (individual.ts), R2-T33 (mining.ts, terran.ts). Blocks: CS-PQ07b, CS-PM05b (units-collection.ts), R2-T35 (mining.ts), CS-PM10 (individual.ts).

### CS-PQ01b Absence is undefined; agent refusals return values
- Decision: PQ1 (a). Source: PUB-01, PUB-11.
- What to build:
  - `actions.findPlacement` → `Promise<Point2D | undefined>` (false → undefined).
  - `map.queryPathing` → `Promise<number | undefined>` (null → undefined).
  - Ramp getters (`barracksInMiddle`, `depotInMiddle`, `barracksCorrectPlacement`, `protossWallPylon`, `protossWallWarpin`) return `undefined` instead of `null`.
  - `map.closestPathable(point, radius)` returns `Point2D | undefined` instead of throwing when nothing is pathable in range. OQ-A: the PQ1 text lists "not found" shapes; this one throws today, so it's included by the rule, not by name.
  - `agent.research` (CS-PM08 renames it `upgrade`) returns false for an upgrade missing from the researched-from table instead of throwing NodeSC2Error.
  - `agent.expandNow` returns the `TrackedBuild` it requested, or `undefined` when it requested nothing (no spot, unaffordable, already pending).
  - actions.* already throw ActionManagerError subclasses (BuildError/TrainError/GatherError; no plain Error in actions.ts at audit). One test pins it: every refusal path in actions.ts throws an `ActionManagerError`.
  - Not here: `agent.getNextExpansion` null → undefined (CS-PQ06a). `data.getUnitTypeData` keeps throwing on an unknown id (CS-PM03's call; OQ-A). Boolean predicates (`canPlace`, `isPlaceableAt`) stay boolean; list returns stay `[]`.
- Acceptance criteria:
  - [ ] Types as above; grep types.ts: no `| null` or `| false` used as "not found" on a public return.
  - [ ] Tests: findPlacement with no spot → undefined; queryPathing unreachable → undefined; a Ramp of the wrong size → undefined getters; closestPathable on a fully blocked area → undefined; research(unknown) → false; expandNow returns the TrackedBuild, and undefined on the repeat call in the same step.
  - [ ] Callers compile and behave the same: bot economy.ts/production.ts `if (position)` unchanged; bot wall.ts/log.ts ramp `?.` unchanged.
  - [ ] Gate passes; docs (commands.md failure table, map.md, agents.md); changelog.
- Implementation plan:
  - Where: types.ts (ActionManager.findPlacement, MapResource.queryPathing/closestPathable, Agent.research/expandNow), resources/actions.ts, resources/map.ts, utils/map/ramp.ts, agent/macro.ts; callers: resources/placement.ts, systems/builder-plugin.ts, examples/cannon-rush.ts, scripts/capture-fixtures.ts, bot/ (compile check); tests next to each.
  - Follow: `buildings.build` (returns `TrackedBuild | undefined`).
  - Don't touch: Units lookups (CS-PQ01a), agent.getNextExpansion (CS-PQ06a).
- Stack: backend. Junior. Blocked by: CS-PM05c (types.ts chain; actions.ts), CS-PM05a (agent/macro.ts), CS-PM05b (resources/map.ts), R2-T31 and CS-I06 (builder-plugin.ts).

### CS-PQ02a `queue` defaults to false everywhere
- Decision: PQ2 (a). Source: PUB-03.
- What to build:
  - `actions.gather` and `actions.mine` default to `queue: false`; `Unit.toggle` defaults to `queue: false`.
  - Internal callers that relied on the old default pass `queue: true`: actions.build's gather after a gas-mine build (actions.ts:527 at audit). Grep the rest at start (audit: no other core gather/mine/toggle caller).
  - `actions.gather` keeps forcing `queue: true` for a worker with the internal `command` label (it protects a pending build order). Its console.warn fires only when the caller passed `queue: false` explicitly, not on the default, or every default call on a building worker would warn. OQ-C.
  - bot/: bot/systems/economy.ts passes `{ queue: true }` on its two `gather` calls (onUnitCreated, onUnitIdle) and its `mine` call (onUnitFinished): lines 10, 17, 22 now; re-grep after the bot canAfford fix lands. examples/tutorial.ts:78, :85 the same.
- Acceptance criteria:
  - [ ] Tests: gather/mine/toggle without options send `queueCommand: false`, with `{ queue: true }` true; a `command`-labelled worker is still forced to queue and warns only on an explicit `queue: false`.
  - [ ] actions.build on a gas mine still queues the gather behind the build (existing test).
  - [ ] bot/ and examples call sites send the same proto as before (queue true).
  - [ ] Gate passes; docs/commands.md defaults line; changelog (unchanged calls to gather/mine/toggle now replace the current order).
- Implementation plan:
  - Where: resources/actions.ts, engine/create-unit.ts (toggle), resources/actions.test.ts, engine/create-unit.test.ts, examples/tutorial.ts, bot/systems/economy.ts, docs/commands.md, docs/changelog.md.
  - Don't touch: resources/command-arbiter.ts.
- Stack: backend. Junior. Blocked by: R2-T25 (actions.ts, actions.test.ts), the bot/systems/economy.ts canAfford fix (in flight). Blocks: CS-I06 (actions.ts), CS-PQ07b (create-unit.ts), CS-PM05b (bot economy.ts).

### CS-PQ04 Townhall builds target `townhallCenter` (SENIOR)
- Decision: PQ4 (a). Source: PUB-05. Supersedes CN-B04's acceptance criterion (the code already returns centres from getExpansionLocations).
- Senior because: the tracker matches build targets against cell-keyed state by distance (error-44 blocked set keyed by `townhallPosition`, CS-PM16's pending-spot skip, retargetTownhall, `isExpansionBlocked`). Moving targets to the centre shifts every comparison by ~0.71, and a threshold that stops matching silently re-picks a blocked spot or sends a second townhall to a pending one. It also changes the point SC2 receives for every townhall build.
- What to build:
  - Every townhall build core issues targets `expansion.townhallCenter` (CS-PM07): `agent.expandNow` when it picks the spot (a caller's `location` is used as given), `expansionController`, builder-plugin's townhall branch, and the tracker's retarget. The townhall `placement.canPlace(type, at)` checks use the same point.
  - `townhallPosition` stays the floored cell and is documented as "grid cell". State keyed by it (placement bases, intel, the blocked set) stays cell-keyed; every comparison between a build target and a cell key goes through one helper in utils/map/townhall.ts.
  - `map.getExpansionLocations()` already returns centres (unchanged).
- Acceptance criteria:
  - [ ] Tests: expandNow, expansionController and a build-order townhall step each send BUILD at (x + 0.5, y + 0.5) of the chosen expansion.
  - [ ] The blocked set (error 44), the pending-spot skip and retarget still match a centre-targeted build to its expansion: existing buildings.test.ts cases pass, plus one case per path with a centre target.
  - [ ] grep: no core townhall build issued with `townhallPosition`.
  - [ ] Live: one game where the bot expands at least twice, townhalls placed (EX-T07-style smoke), if SC2 is available; otherwise say so in the task.
  - [ ] Gate passes; docs (map.md: townhallPosition is the grid cell, builds use townhallCenter; macro.md); changelog.
- Implementation plan:
  - Where: agent/macro.ts (expandNow), behaviors/macro/structures.ts (expansionController), systems/builder-plugin.ts (townhall branch), resources/buildings.ts (retarget, nextExpansion, blocked-set matching), utils/map/townhall.ts (match helper), tests next to each. bot/: none (it uses townhallPosition for distances and keys only).
  - Follow: `isBlocked` and the expansion-match distance in resources/buildings.ts.
  - Don't touch: placement/intel keys.
- Stack: backend. SENIOR. Blocked by: CS-PM07 (townhallCenter; types.ts chain), CS-PQ06a (getNextExpansion returns Expansion). Blocks: CS-PM08.

### CS-PQ05 Command calls are synchronous
- Decision: PQ5. Source: PUB-20.
- What to build:
  - Members that only queue commands become synchronous and return `void`: actions.do/smart/move/patrol/attack/attackMove/swapBuildings/gather/mine/build/buildGasMine/train/upgrade/warpIn/stop/holdPosition/repair/returnResource; Unit.useAbility/inject/blink/burrow/toggle. Check each body: anything that awaits a client request stays async (findPlacement, canPlace, sendQuery, sendAction, chatSend, toggleAutocast, surrender, flushQueuedActions, unloadByTag, Unit.fetchAvailableAbilities, map.queryPathing).
  - `agent.train` (number), `agent.research`/`upgrade` (boolean) and `agent.expandNow` (`TrackedBuild | undefined`, CS-PQ01b) become synchronous with the same values.
  - Refusals throw synchronously.
  - `agent.getNextExpansion` stays async as the answer lists it. OQ-D: since R2-T13 it no longer queries the server.
  - Migration: drop `await` on these calls in core, examples and bot/. `Promise.all(xs.map((x) => actions.train(...)))` becomes a loop (bot/systems/economy.ts svc, bot/systems/military/training.ts:16). Today every element is attempted even when one rejects; a sync throw would stop the map at the first refusal. So the bot loops keep attempting the remaining units (pre-check or per-call try/catch, matching today's behaviour).
- Acceptance criteria:
  - [ ] Types: no Promise return on the listed members; check-types green across core, examples and bot/.
  - [ ] Tests: a refusal throws synchronously (`expect(() => actions.build(...)).toThrow(BuildError)`); a queued command is flushed in the same step as before.
  - [ ] grep: no `await` on a listed call in core, examples or bot/.
  - [ ] bot/ loops over several producers still issue to every producer when one refuses (test or reasoning in the task, pointing at the line).
  - [ ] Gate passes; docs/commands.md (sync vs async table); changelog (breaking: `.catch` on the result no longer works).
- Implementation plan:
  - Where: types.ts (ActionManager, Unit, Agent), resources/actions.ts, engine/create-unit.ts, agent/macro.ts; callers: grep `await .*\b(actions|agent)\.(…)` and Unit command calls in behaviors/, systems/builder-plugin.ts, resources/, examples/, bot/systems/** (~17 sites).
  - Follow: `buildings.build`, `ctx.order` (already sync).
- Stack: backend. Junior. Blocked by: CS-PQ06a (types.ts chain), CS-PQ01b (actions.ts, agent/macro.ts), CS-PQ02a and CS-PQ07b (create-unit.ts). Blocks: CS-PQ07a, CS-PM06.

### CS-PQ06a One expansion shape
- Decision: PQ6 (a). Source: PUB-15.
- What to build:
  - `agent.ownedExpansions()` and the `OwnedExpansion` type are removed; `map.getOccupiedExpansions()` covers them.
  - `agent.getNextExpansion(): Promise<Expansion | undefined>` (still async, see OQ-D) and `buildings.getNextExpansion(opts?): Expansion | undefined` return the Expansion.
  - Coordinates don't change in this ticket: callers that used the returned cell use `expansion.townhallPosition`. CS-PQ04 then moves townhall builds to the centre.
  - `isExpansionBlocked(pos)` keeps taking a point.
- Acceptance criteria:
  - [ ] Types as above; grep: no `OwnedExpansion` or `ownedExpansions`.
  - [ ] Tests (agent/expansion.test.ts, resources/buildings.test.ts) assert the returned Expansion is the same spot as before; expandNow, expansionController and the builder-plugin townhall branch build at the same point as before (tests unchanged).
  - [ ] Gate passes; docs (agents.md, macro.md); changelog.
- Implementation plan:
  - Where: types.ts (Agent, BuildingTracker, OwnedExpansion), agent/macro.ts, resources/buildings.ts, behaviors/macro/structures.ts (expansionController), systems/builder-plugin.ts (townhall branch), index.ts if it exports OwnedExpansion, tests (agent/macro.test.ts, agent/expansion.test.ts, resources/buildings.test.ts, behaviors/macro/structures.test.ts). bot/ 0, examples 0.
- Stack: backend. Junior. Blocked by: CS-PQ01b (types.ts chain; agent/macro.ts), CS-PM05a (buildings.ts canAfford callers). Blocks: CS-PQ04, CS-PQ05.

### CS-PQ06b One event per occurrence
- Decision: PQ6 (b). Source: PUB-16.
- What to build:
  - Drop `unitDamaged` (keep `unitTookDamage`, which carries the amount; both fire under the same condition today).
  - Drop `buildingConstructionStarted`/`buildingConstructionComplete`, keep `structureConstructionStarted`/`structureConstructionComplete`.
  - `unitCreated` and `unitSpawned` both stay; docs state their filters.
  - Before deleting, compare the two branches in systems/unit.ts: the new-unit branch writes building* for new own structures, and the existing-unit branch writes buildingConstructionComplete on finish (check its alliance filter: it may also fire for enemy structures, which structure* never does). Every own-structure case building* covered must fire structure*. A case only building* covered (for example enemy completions) either moves to structure* or is named in the changelog as dropped.
  - bot/: bot/systems/log.ts:41, :44 → `onStructureConstructionStarted` / `onStructureConstructionComplete`. examples/: grep `onBuildingConstruction|onUnitDamaged`.
- Acceptance criteria:
  - [ ] Tests (systems/unit.test.ts): one structureConstructionStarted and one structureConstructionComplete per own structure lifecycle (placed → finished, and appearing finished); none of the dropped names is written; own damage writes unitTookDamage once.
  - [ ] SystemObject has no onUnitDamaged / onBuildingConstruction*; bot/ and examples compile.
  - [ ] Gate passes; docs (events table); changelog (which handler to move to, and any dropped case).
- Implementation plan:
  - Where: types.ts (SystemObject handlers), systems/unit.ts, systems/unit.test.ts, bot/systems/log.ts, examples/ grep hits, docs.
  - Don't touch: resources/event-channel.ts.
- Stack: backend. Junior. Blocked by: R2-T34 (systems/unit.ts, systems/unit.test.ts; dirty now), CS-PM18a (types.ts chain). Blocks: CS-PQ07b (types.ts chain), R2-T37 (systems/unit.ts).

### CS-PQ07a `canAfford` doesn't settle; `agent.settleEarmark`
- Decision: PQ7 (a). Source: PUB-14.
- What to build:
  - `agent.canAfford(type, { earmark, count, supply })` and `canAffordUpgrade(id, { earmark })` (shapes from CS-PM05a) are pure. `earmark` still names the earmark left out of the reserved totals (today's arithmetic); nothing is settled.
  - New `agent.settleEarmark(name: string): void` settles (delegates to `data.settleEarmark`).
  - Callers that relied on the settle call it where canAfford returned true: systems/builder-plugin.ts `settle` helper (`agent.canAfford(task.id, earmarkOf(task))`, :734 at audit); bot/systems/military/production.ts:53-55 (when `canAfford(unitType, { earmark: 'production' })` is true, `agent.settleEarmark('production')` before building, today's behaviour). Grep the rest at start (audit: no other caller passes a name).
- Acceptance criteria:
  - [ ] Test: canAfford with an earmark name returns the same boolean as before and leaves `data.get('earmarks')` unchanged; settleEarmark removes it.
  - [ ] builder-plugin earmark tests (BG-T01, BG-AM, CN-B02 cases) pass unchanged.
  - [ ] grep: no core or bot/ caller relies on canAfford to settle.
  - [ ] Gate passes; docs/macro.md earmarks; changelog.
- Implementation plan:
  - Where: types.ts (Agent), agent/create-agent.ts, systems/builder-plugin.ts, bot/systems/military/production.ts, agent/create-agent.test.ts, systems/builder-plugin.test.ts, docs.
  - Follow: macro.ts `affordable` (the existing non-settling internal check).
- Stack: backend. Junior. Blocked by: CS-PQ05 (types.ts chain; builder-plugin.ts), CS-PM05a (canAfford shape), CS-PQ09 (earmark semantics first).

### CS-PQ07b One rule for Unit activity predicates
- Decision: PQ7 (b). Source: PUB-18, PUB-19 (moved from CS-PM08).
- What to build:
  - Every `Unit.is<Activity>()` checks the first order through `isUsingAbility` (remap-aware): `isHolding`, `isReturning` and `isGathering` move to it; the first-order ones are unchanged.
  - New `Unit.hasOrder(abilityIds: number | number[]): boolean`: any order, remap-aware like isUsingAbility.
  - `Unit.isConstructing()` → `hasBuildOrder()` (any order: the `has` prefix means any order) and new `Unit.isUnderConstruction()` (`buildProgress < 1`), moved from CS-PM08.
  - Units `gathering`/`returning`/`collecting` give the same answer as `isGathering`/`isReturning`/`isCollecting` per unit; MULE gather counts as gathering everywhere.
  - Core callers that need any order today move to `hasOrder`/`hasBuildOrder`, so their behaviour doesn't change (audit: resources/actions.ts 1, resources/mining.ts 3, utils/workers/select-builder.ts 2; check each).
  - bot/: bot/systems/combat/micro/basic.ts:16, :63 (isAttacking, isMoving) are already first-order; compile only.
- Acceptance criteria:
  - [ ] Tests: a worker with [move, gather] orders: `isGathering()` false, `hasOrder(gather)` true; with [gather] both true; a MULE gathering is `isGathering()` and in `Units#gathering`; on a fixture the Units getters equal the per-unit methods.
  - [ ] Existing mining, speed-mining and builder tests pass unchanged.
  - [ ] Gate passes; docs/units.md (predicate rule); changelog.
- Implementation plan:
  - Where: types.ts (Unit), engine/create-unit.ts, resources/units-collection.ts, constants/groups.ts (if the MULE id joins a shared list), callers above, engine/create-unit.test.ts, resources/units-collection.test.ts.
  - Follow: `isUsingAbility` (create-unit.ts).
- Stack: backend. Junior. Blocked by: CS-PQ06b (types.ts chain), CS-PQ01a (units-collection.ts; it follows R2-T33 on mining.ts), CS-I06 (actions.ts), CS-PQ02a (create-unit.ts). Blocks: CS-PM05a (types.ts chain), CS-PM05b, CS-PM05c, CS-PQ05.

### CS-PQ07c `getAll` and `getByTag` drop dead own units
- Decision: PQ7 (c). Source: PUB-26.
- What to build:
  - Own units that die leave the units store in the loop they're labelled dead (systems/frame.ts:109-110, as enemy units already do), so `units.getAll()` and `getByTag()` no longer return them.
  - The `dead` label stays on the Unit object for holders of a reference (unitDestroyed handlers, roles/mining/buildings/flying state).
  - Readers that look a unit up and check `labels.has('dead')` already handle `undefined`. Remove a dead check only where it becomes unreachable. Any core handler that looks a destroyed unit up by tag uses the event's unit instead.
- Acceptance criteria:
  - [ ] Test: an own unit killed in a fixture: unitDestroyed fires with the unit, `getByTag(tag)` is undefined, `getAll()` excludes it, and the Unit object has 'dead'.
  - [ ] Each reader releases the unit as before (existing tests plus one per reader where none exists): resources/{roles,mining,buildings,flying,placement}.ts, resources/map.ts occupied/available expansions, engine/create-expansion.ts alliance.
  - [ ] Gate passes; docs/units.md; changelog.
- Implementation plan:
  - Where: systems/frame.ts, resources/units.ts (store helper if needed), the readers above, tests.
  - Follow: the enemy branch at systems/frame.ts:110.
- Stack: backend. Junior. Blocked by: CS-PQ07b (mining.ts, docs/units.md), R2-T15 (placement.ts), R2-T34 ✓ (units.ts); not alongside R2-T35 (mining.ts, placement.ts, map.ts). Changed per lead decision 2026-10-28: off the types.ts chain (no types.ts change); runs before CS-PM05b and PM08 on units.ts. Blocks: CS-PM05b (units.ts), CS-PM09 (systems/frame.ts).

### CS-PQ09 Re-added earmarks take the new amount; `getUnitTypeData` is raw
- Decisions: PQ9 (a) latest wins; PQ6 (c). Source: PUB-13; data-storage.ts.
- What to build:
  - `data.addEarmark` with an existing name replaces that earmark's amounts (debug line on change). Core per-step re-adds of the same cost behave the same (systems/builder-plugin.ts, resources/buildings.ts).
  - `data.getUnitTypeData(id)` returns the raw API data (no Zerg-structure −50); `data.mineralCost(id)` follows. The net cost lives only in `agent.calculateCost` (agent/create-agent.ts `unitCost` already subtracts the drone itself). `Unit.data()` becomes raw too.
- Acceptance criteria:
  - [ ] Tests: addEarmark('x', 100 minerals) then ('x', 150) → totals 150; the same amount twice → one earmark; `getUnitTypeData(HATCHERY).mineralCost` equals the raw value; `agent.calculateCost(HATCHERY)` unchanged.
  - [ ] grep the cost readers of getUnitTypeData / mineralCost / `.data()`, and list in the task every number that changes. At audit only behaviors/combat/spells.ts:177 (an enemy Zerg structure's value, +50); changelog line, no edit there.
  - [ ] Gate passes; docs (macro.md earmarks, units.md data readers); changelog.
- Implementation plan:
  - Where: engine/data-storage.ts, engine/data-storage.test.ts, docs/macro.md, docs/units.md, docs/changelog.md.
  - Don't touch: agent/create-agent.ts, behaviors/combat/spells.ts (R2-T33).
- Stack: backend. Junior. Blocked by: None. The docs edits wait for whoever holds docs/ now (dirty at snapshot 3); the lead hands docs over. Blocks: CS-PQ07a.

### CS-PQ10d Build-task options that take a unit type: `nearType`, `targetType`
- Decision: PQ10 (d).
- What to build: build-task `opts.near` → `nearType` and the ability task's `opts.target` → `targetType` (BuildTaskI opts). The builder-plugin readers, the task functions and the string-step parser (which fills the field) follow. The string-step grammar is unchanged.
- Acceptance criteria:
  - [ ] grep: no `opts.near`/`opts.target` on build tasks; parse tests produce `nearType`/`targetType`; builder-plugin behaviour unchanged (existing tests).
  - [ ] Gate passes; docs/build-orders.md; changelog.
- Implementation plan: Where: types.ts (BuildTaskI), systems/builder-plugin.ts (near/target readers), utils/build-order/parse.ts (+ test), utils/build-order task functions, examples/ (build-runner openings if they set either). Don't touch: `opts.at` (a BuildTarget, unchanged).
- Stack: backend. Junior. Blocked by: CS-PM08 (types.ts chain), CS-PQ07c, R2-T28 (parse.ts, targets.ts), CS-PQ04 (builder-plugin.ts). Blocks: CS-PM09 (types.ts chain).

## Questions for the user (CS-PQ, answered 2026-10-28; texts kept for reference)

"yes" accepts the recommendation. Blast counts: bot / examples / core non-test lines (approximate; audits/cs-public.md).

### PQ1 One rule for failure and absence
- Why major: changes what failing calls do (throw vs return) and the absence value across the surface; working error handling changes.
- Today: refusals throw (actions.*), return 0 (agent.train), false (agent.research, findPlacement), null (getNextExpansion, queryPathing, Ramp getters) or undefined (buildings.build, placement.request); Units `first/random/center/closestTo/furthestTo` throw on empty.
- Options: (a) layered rule: actions.* throw typed NodeSC2Error subclasses; agent/buildings/placement/behaviors return values; absence is `undefined` everywhere (false/null → undefined); Units lookups return undefined instead of throwing. (b) as (a), but Units lookups keep throwing, plus `firstOr`/`closestToOr`. (c) document the current table only.
- Recommend: (a). Blast: findPlacement bot 2 / ex 1; Units closestTo bot 1 / ex 1.

### PQ2 Defaults
- Why major: a default change alters what an unchanged call does.
- (a) `queue` defaults to false everywhere (python-sc2); gather/mine/toggle callers pass `queue: true`. bot/systems/economy.ts:10, :13, :17 would replace the current order instead of queueing.
- (b) Every UnitResource typed getter defaults to SELF; `getByType` (all alliances; 0 callers outside core; map.ts:114 needs all) is removed in favour of `getById(ids, { alliance })`.
- (c) `getWorkers()` returns all own workers; new `getAvailableWorkers()` excludes those with the internal `command` label (today `getWorkers()` hides them; bot/index.ts:47 under-reports).
- Recommend: yes to (a), (b), (c).


### PQ3 Stored timestamps in game loops
- Why major: changes the value of an existing field.
- `Placement.reservedAt` (seconds) becomes game loops like every other stored timestamp; OpeningRecord.duration stays seconds (persisted ares-format field). CS-PM06 has already renamed it `reservedAtSeconds`; a yes renames it `reservedAtLoop`.
- Recommend: yes. Blast: 0 outside core.

### PQ4 What `townhallPosition` means
- Why major: reshapes a core Expansion field used for placement and intel keys.
- Today the floored cell, while every helper returns the centre (+0.5); expansionController builds at the cell, expandNow at the centre. After CS-PM07 both are on Expansion (`townhallPosition`, `townhallCenter`).
- Options: (a) keep the cell; townhall builds and all helpers take `townhallCenter`; the docs call townhallPosition "grid cell". (b) townhallPosition becomes the centre everywhere and townhallCenter goes (placement/intel keys move). (c) rename townhallPosition → `townhallCell`.
- Recommend: (a). Also supersedes CN-B04's AC (code already uses the centre). Blast: townhallPosition bot 13 / ex 7 / core 49.

### PQ5 Synchronous command calls
- Why major: changes the calling convention of every command (refusals throw synchronously instead of rejecting a promise; `.catch` on the result stops working).
- Command-queueing calls (actions.*, Unit.useAbility/inject/blink/burrow/toggle, agent.train/upgrade/expandNow) become synchronous; async stays for server queries (findPlacement, canPlace, queryPathing, fetchAvailableAbilities, getNextExpansion).
- Recommend: yes. Blast: actions.* bot ~17 / ex ~11 awaited sites (still compile).

### PQ6 Duplicated concepts
- Why major: removes or reshapes core concepts.
- (a) `agent.ownedExpansions()` and `OwnedExpansion` removed in favour of `map.getOccupiedExpansions()`; `agent.getNextExpansion()` returns `Expansion | undefined` (still async). R2's `buildings.getNextExpansion` follows the shape. Blast: 0 external.
- (b) Events: drop `unitDamaged` (keep `unitTookDamage`, which carries the amount); keep one of `buildingConstruction*` / `structureConstruction*` (recommend `structure*`, python-sc2/ares naming; bot/systems/log.ts:41, :44 migrate); `unitCreated` and `unitSpawned` both stay (different filters), documented.
- (c) `world.data.getUnitTypeData` returns raw API data; the Zerg drone-cost adjustment lives only in `agent.calculateCost` (today two readers differ by 50 minerals). Blast: bot 2 (Terran, unaffected).
- Recommend: yes to (a), (b), (c).

### PQ7 Predicate semantics
- Why major: same call, different answer.
- (a) `agent.canAfford`/`canAffordUpgrade` stop settling earmarks; a new `agent.settleEarmark(name)` settles. bot/systems/military/production.ts:53-55 relies on the settle and migrates.
- (b) Every `Unit.is<Activity>()` uses one rule (first order, remap-aware); any-order checks become `unit.hasOrder(abilityId)`; Units `gathering/returning/collecting` match the Unit methods (MULE included everywhere). Blast: bot isMoving/isAttacking 2.
- (c) `units.getAll()` (and `getByTag`) stop returning dead own units.
- (d) `Units.furthestNUnits` returns furthest first (today ascending). Blast: 0 external.
- Recommend: yes to all.

### PQ8 Stubs on public types (urgent: R2-T01 is landing them now)
- Why major: a release-policy call; members that throw "not implemented" (or behaviors that no-op) are on the public types.
- Options: (a) no batch is pushed to main while a public member is a stub (R2 batches push when their stubs are implemented); (b) stubs ship, marked experimental in docs and changelog; (c) stubs stay off the public types until implemented (conflicts with R2's scaffold-first plan).
- Recommend: (a).

### PQ9 Re-adding an earmark under an existing name
- Why major: changes what an existing call does with its input (money accounting).
- Today: `data.addEarmark` returns without change when the name already exists (engine/data-storage.ts:65-75), so a new amount under the same name is ignored. Core callers re-add the same cost each step (systems/builder-plugin.ts:424, :788; resources/buildings.ts:344), so they're unaffected. bot/systems/military/production.ts:53-55 and :114 reuse the names 'production' and 'addons' for different unit types, so the earmark keeps the first type's cost.
- Options: (a) latest wins: an existing name's amount is replaced; (b) amounts add up (breaks the per-step re-add callers, which would need a guard); (c) keep first wins and document it; the bot uses per-type names.
- Recommend: (a). Core callers behave the same, and the bot's earmark tracks what it currently wants.

### PQ10 Glossary deviations: renames and one count rule
- Why a question: (a), (b), (d) and (e) rename released public API; the lead routes those to the user, even though the user's earlier rule would class them as minor naming alignment ("yes" lets them run as PM tickets). (c) is a semantic change.
- (a) `buildings.buildGas` → `buildings.buildGasMine`, matching `actions.buildGasMine` and the glossary term "gas mine". Blast: bot 0 / ex 0 / core ~3. Recommend yes.
- (b) `actions.swapBuildings` → `swapStructures`. Recommend no: one call, and the glossary records the deviation.
- (c) The two `maxPending` options count different things: `expansionController` counts `agent.alreadyPending` (orders, unfinished, tracked) and `gasBuildingController` counts `buildings.pending` (tracked only, so gas mines ordered outside the tracker aren't counted). Make both count `agent.alreadyPending`. Recommend yes.
- (d) Build-task options that take a unit type, not a position or unit: `opts.near` → `nearType` and the ability task's `opts.target` → `targetType`. The string-step grammar is unaffected (the parser fills the field). Blast: core builder-plugin.ts:598, :634 and the task functions, examples/build-runner openings if they set them. Recommend yes.
- (e) System `buildOptions.earmarks` (a delay in loops; `earmarkDelay()` is the setter method) → `buildOptions.earmarkDelayLoops`. The method keeps its name. Recommend yes.
- No change recommended (the glossary records them): `units.getBases` / `expansion.getBase` returning townhalls; the vespene-named `Cluster.vespeneGeysers` field and `vespeneGeyserTypes` constant (SC2 data naming); `upgradeCCs` (Terran-only, accurate); the `BUILDING` role (worker activity); `MiningAssignment.kind: 'gas'` and `townhallTag`; the task state flag `earmarked`; `getPendingAt(point, maxDistance)` (a threshold, not an anchor); the other meanings of `target` and `pending`.

#### Glossary deviation mapping (GLOSSARY.md "Known deviations", 2026-10-28)

| deviation | covered by | action |
|---|---|---|
| `actions.swapBuildings` acts on structures | PQ10(b) | recommend no change |
| `BUILDING` role is a worker that is building | none | no change (role names an activity) |
| `buildStructure` takes `structureType`, `buildings.build` takes `unitType` | CS-PM10 (extended) | `structureType` → `unitType` (behaviors unreleased) |
| `buildGas` / `buildGasMine` / `gasBuildingController` | PQ10(a); CS-PM10 (extended) | `buildings.buildGas` → `buildGasMine` (user); `gasBuildingController` → `gasMineController` (PM10, unreleased) |
| "Gas" methods vs `vespeneGeysers` field / `vespeneGeyserTypes` | PQ10 no-change list | no change |
| `actions.mine` parameter `gasBuilding` | CS-PM04 (extended) | parameter → `gasMine` (name only) |
| `MiningAssignment.kind: 'gas'` | none | no change |
| `units.getBases` / `expansion.getBase` return townhalls | PQ10 no-change list | no change |
| `townhallPosition` is the expansion's location | PQ4 | user decides cell vs centre; CS-PM07 adds `townhallCenter` |
| `upgradeCCs`, `MiningAssignment.townhallTag` | none | no change |
| five meanings of "pending" | PQ10 no-change list; PQ10(c) | names stay; glossary defines each |
| two `maxPending` options count different things | PQ10(c) | both count `agent.alreadyPending` (user) |
| `buildStructure` `maxOnRoute` | CS-PM10 (corrected) | rename dropped: it isn't a pending count |
| `near` is a position in findPlacement/selectWorker, a unit type in task `opts.near` | PQ10(d) | `opts.near` → `nearType` (user) |
| `WarpInOptions.nearPosition`, `closestTo` proximity names | CS-PM05 | → `near` |
| `getPendingAt` takes `maxDistance` | none | no change (threshold) |
| ability task `opts.target` is a unit type | PQ10(d) | → `targetType` (user) |
| other `target` meanings (Unit/Point2D, BuildTarget, TrackedBuild.target) | none | no change |
| `canAfford(unitType, earmarkName)` positional name | CS-PM05 | → `canAfford(type, { earmark, ... })`, same key as `BuildOptions.earmark` |
| `buildOptions.earmarks` is a delay in loops | PQ10(e) | → `earmarkDelayLoops` (user) |
| task field `earmarked` is a boolean | none | no change (task state flag) |

### DQ1 Doc layout (not an API change; the lead may settle it)
- (a) Restructure per CS-D01–D08 (topic pages, ~220-line readme, api.md and legacy pages merged and retired). (b) Fix content in place, keep readme + api.md duplication.
- Recommend (a): the duplication is the main defect class (DOC-13–27) and one copy already drifted (DOC-05).

## Further notes

Open points from ticketing the PQ answers (2026-10-28). Each ticket carries the recommendation, marked with its OQ id; the user confirms or overrides through the lead before that ticket starts:
- OQ-A (PQ1 edges, CS-PQ01a/b): empty `closestDistanceTo`/`furthestDistanceTo` return `Infinity`/`-Infinity`; `Units.byTag` removed (`findByTag` stays); `map.closestPathable` returns undefined instead of throwing; `data.getUnitTypeData` keeps throwing on an unknown id (CS-PM03's call stands).
- OQ-B (PQ2 (b), CS-PM05b): "every typed getter defaults to SELF" is applied to getters of player units only. `getMineralFields`/`getGasGeysers` keep their all-alliance default: the units are neutral, so SELF would return nothing. `getAll`/`getAlive`/`withLabel` aren't typed getters and are unchanged.
- OQ-C (PQ2 (a), CS-PQ02a): gather still forces `queue: true` for a worker with the `command` label, and warns only on an explicit `queue: false`.
- OQ-D (PQ5/PQ6 (a)): `agent.getNextExpansion` stays async as answered, but since R2-T13 it no longer queries the server. Recommend making it sync in CS-PQ05; that needs a yes.

- R2-T04 lead decisions (2026-10-28): `BuildOptions.checkSafe` was removed, and retargets use getNextExpansion's default `checkSafe: true` (design C6 / ares). This dropped the former PQ2(d). RQ10 DEV-1 (blocked-spot clearing) stays implemented while it waits for the user. No CS ticket depends on the RQ10 answer: CS-PM16 changes only which spots count as taken by pending builds, not how blocked spots clear (resources/buildings.ts `clearBlocked`).

- PUB-05 shows CN-B04's acceptance criterion ("getExpansionLocations equals getExpansions().map(townhallPosition)") isn't what shipped (the code adds 0.5). Not re-decided here; PQ5(a) settles it.
- examples/tutorial.ts builds gateways without pylons, so they never get placed. Making it build supply is an example behaviour change that needs a live run; candidate follow-up after CS-D06.
- Doc-writer findings (2026-10-28): the old readme/api.md `new PixelMap(startRaw.pathingGrid)` didn't type-check. docs/map.md already uses the explicit form, CS-D08 retires api.md, and CS-PM14 makes the short form valid. `getGraph`/`newGraph` typed `any` is folded into CS-PM09.
- R2-T18 (docs for round 2) should be retargeted to the new pages by architect-4 once DQ1 is settled.
