# Docs audit: packages/core (readme.md, docs/*, examples/ references)

Read-only. Code wins. Paths relative to `packages/core` unless noted. Severity: high = wrong/misleading, med = duplicated/structural/gap, low = cosmetic.

## 0. Method and headline

- Read all of readme.md (2232), api.md (1546), internals/design/overview/tutorial, changelog Unreleased (lines 12-270), skimmed legacy changelog.
- Resource method names: every `resource.method` in readme/docs checked against the interfaces in `types.ts` (script). Result: zero documented names missing from code, except the intentionally listed removed ones (readme:2098-2102). `Unit` / `Units` method lists (readme + api.md) match `types.ts` and `units-collection.ts` exactly.
- All 38 readme `ts` blocks type-checked with tsc 7.0.2 against package sources (scratch tsconfig, paths mapped): 36 clean. The 2 non-clean are illustrative (DOC-51, DOC-52). api.md blocks are signature pseudo-code, not compiled.
- Links: all 139 readme `#anchor` links, every api/overview/tutorial/changelog link, relative links (`docs/*`, `examples/*`, `../readme.md#build-systems`) resolve (GitHub slug rules, including `-1` duplicate suffixes). All files in readme "Examples" exist. No broken links.
- Conclusion: the code-level content is accurate and current; the problems are (a) four legacy pages that are wrong or unusable, (b) the same facts written 3-6 times with one copy drifting, (c) readme size/audience mix.

### docs-plan.md / CN-D01: did it land?

| Plan item | Landed? |
|---|---|
| core-arch T05 (batchActions gone, `onCommandResults`, `commandPriority`, Custom resources, actions return types, `register`, internals, `## Unreleased`) | Yes. grep for `batchActions`, `distributeWorkers`, `canAffordUnit/N`, `getClosest`, `timeInSeconds`, `structurePending`: only in readme "Removed" list and changelog history. |
| Phases 2, 3, 4, 5, 6a, 6b readme + api + internals + changelog entries | Yes, all present, current against code. design.md paragraph on behaviors (design.md:21) present. tutorial.md:61 pointer to string format present. |
| Examples T08 (readme Examples, tutorial.ts link) | Yes (readme:2159-2223, tutorial.md:229). |
| CN-D01: Q1 map.path/pathing split, Q11 rally vs choke, root point helpers, `constants/time`, Removed list, changelog Consolidation with Fixed/Changed/Removed/Migrating | Yes (readme:1244, 1268, 1450, 1772, 1945-1952, 1972, 2096-2102; api.md:770, 793, 1251, 1345-1358; changelog:190-256). No `Deprecated` section (none needed: no `@deprecated` in code). |
| CN-D01 side effect: `map.path` text still says "unplaceable" | Stale after CN change, DOC-08. |
| docs-plan 3.2: convert api.md to `#### *\`res.method(...) => R\`*` format | Only `actions` (and new resources) converted; `map` (717-755) and `frame` (597-601) still old style, DOC-34. |
| docs-plan 3.1: "no implementation details in readme" | Violated: readme:1230 (AsyncLocalStorage/Bluebird), 2112 (test file paths). DOC-29. |
| docs-plan DA2: legacy pages not rewritten | Still legacy; this is now the main defect class (DOC-01..04, DOC-31). |

## 1. Findings

### 1.1 Stale / wrong against code

| id | file:line | sev | description | fix |
|---|---|---|---|---|
| DOC-01 | docs/design.md:32-40 | high | Describes "persistent" events (marked persistent, re-fired each loop until consumed, optional expiry) with a Scouting/StaticDefense example. `resources/event-channel.ts` has no persistence; docs/internals.md:37 itself says it is "yet to be implemented". | Delete the persistent-event example and metadata sentence (32-40); keep the pub/sub paragraph. |
| DOC-02 | docs/design.md:48-53; docs/tutorial.md:93-96; examples/tutorial.ts:78 | high | Says a `gasWorker` label "is actually used internal to node-sc2" and that it keeps probes out of build selection. grep: no `gasWorker` in core code. Since Consolidation the builder pick ignores user labels (`utils/workers/select-builder.ts:19-22`; changelog:224), only `command`/`stuck` matter. Tutorial comment is false. | design.md: use a neutral invented label example. tutorial: drop the label line and comment (mining/roles keep workers out of builds). |
| DOC-03 | docs/tutorial.md:5-18, 28-48, 66-77, 137 | high | CommonJS `require('@node-sc2/core')`, `npm init/install`, `main.js`; package is `@sc-bot/core`, ESM TypeScript, Bun, `"private": true` (package.json). Part 1 tells you to install `@node-sc2/system-protoss-supply`, which is not in the repo or its node_modules; examples/tutorial.ts has no supply handling (readme:2172 admits gateways can't be placed). The tutorial cannot be followed. | Rewrite in TS against `examples/tutorial.ts` (add a pylon/`autoSupply` step instead of the missing package). See section 3. |
| DOC-04 | docs/internals.md:15, 26, 55 | high | Names that no longer exist: `systems/builderPlugin.js`, `systems/createSystem.js` (now `systems/builder-plugin.ts`, `systems/create-system.ts`); `UnitEntity` (type is `Unit`, `types.ts:222`). | Rename; also title line 1-3 still `@node-sc2/core` / `node-sc2`. |
| DOC-05 | docs/api.md:139 | med | "the `map`, `events` and `debug` resources reset in place". Code resets every registered resource (`engine/create-world.ts:77`, `engine/create-resource-manager.ts` reset). readme:182 is right. | Replace by one link to the owner section (see DOC-13). |
| DOC-06 | docs/api.md:582-588 | med | Resources intro destructures 6 resources (`actions, events, frame, map, units, debug`) and says "all available built-in resources"; there are 19 (+`placer`). Also "Resources in `node-sc2`". readme:942 is right. | Single list in one place (resources.md). |
| DOC-07 | docs/api.md:1322-1323 | med | `### events` body is `TBD`. | Write (createReader/read/removeReader/write, `types.ts:715-720`) or delete; readme:1368 has the only text. |
| DOC-08 | readme:1268; docs/api.md:770 | med | `map.path` "also blocks the cells the map system marks unplaceable". Since Consolidation the path graph follows `setPathable` only; `setPlaceable` no longer touches it (`resources/map.ts:78-95`; changelog:225). Lowered depots and townhall/nydus corners are unplaceable but walkable. | Say "unpathable (structures, minerals, geysers, rocks, towers)"; mention lowered depots/townhall corners stay walkable. |
| DOC-09 | readme:389 | med | "the worker picked for a build is only taken from idle workers when it hasn't received one". `select-builder.ts:34-38`: idle or single-gather-order workers first, else any free `GATHERING`/role-less worker; `actions.build` takes a busy worker instead of rejecting (changelog:218). | Rewrite to match api.md:814 / select-builder. |
| DOC-10 | readme:2110 | med | Live tier lists `engine/create-engine`, `engine/behaviors`, `examples/examples`. Also exist: `resources/mining.live.test.ts`, `resources/placement.live.test.ts`, `resources/flying.live.test.ts`. | List all six or say "every `*.live.test.ts`". |
| DOC-38 | docs/overview.md:8-31 | low | Event list "currently as follows" omits `onCommandResults`, `onEnemyStrategyDetected`, `onEnemyRaceDetected`. | Delete the list, link the events table. |
| DOC-39 | docs/api.md:561-564 | low | `@FIXME: these currently do not update properly` on `cluster.mineralFields/vespeneGeysers`; no such FIXME in `types.ts` or `engine/create-expansion.ts`. Unverified claim in a doc. | Verify then delete. |
| DOC-40 | docs/api.md:276-279 | low | `createSystem(SystemBlueprint)` / `systemBlueprint = {...}`: no such type (`SystemObject`, `UnitSystemObject`, `BuildSystemObject`, `GeneralSystemObject`, `types.ts:61-93, 771-788`). | Use the real names. |
| DOC-41 | readme:1958-1976 | low | Constants table omits modules reachable via `./constants/*`: `build-target` (used at readme:660, 1933), `combat`, `influence`, `unit-ability-map`; `constants/index` also exports the `BuildTarget` namespace (`constants/index.ts:67`) and influence constants. | Add rows. |
| DOC-42 | index.ts:20-30; constants/index.ts | low | Root exports `DEFAULT_EFFECT_COSTS`, `EFFECT_INFLUENCE`, `INFLUENCE_DEFAULTS`, `STATIC_DEFENSE`, `UNIT_AVOIDANCE`, `WEIGHT_COSTS` and types `EffectInfluence`, `InfluenceSource`, `StaticDefenseSource`, `WeightCost`: documented nowhere (not readme, api.md, changelog). `influence.configure({ effects })` is the only related doc. | Document in the influence section, or stop exporting. |
| DOC-43 | docs/api.md:7-31 | low | Main-export import list omits `ConnectionClosedError` (`index.ts:55-58`; readme:1136 has it) and `Ramp`/`PixelMap` are only there. | Add; derive the list from index.ts. |
| DOC-44 | types.ts | low | Public but undocumented: `Unit.distanceTo` (305, used by tracker), `World.baseBuild` (1238), `engine.use` (1316), `DataStorage.register`/`mineralCost` (813-814; design.md:43 describes `register` only conceptually), `Debugger.useDebugWidget` (api.md only, not readme:1339-1348), `map.setPathable/setPlaceable` (named in changelog:225 only). | Document or mark internal. |
| DOC-45 | docs/internals.md:50-51 | low | "registers the built-ins in the order below": code order is frame, map, debug, units, events, actions, memory, ... (`engine/create-world.ts:30-57`); doc lists frame, units, map, events, debug, actions. Rest of the order matches. | Reorder list. |
| DOC-46 | docs/internals.md:21-37 | low | Dispatch description omits the optional `chat-debug` engine system (`create-engine.ts:618`) and the trailing `debugSystem` (`create-engine.ts:605`). | Add one line each. |
| DOC-47 | package.json:4, 7-11 | low | `description` "node.js framework ... in JavaScript"; `repository` node-sc2/core; author node-sc2's. Doc-adjacent metadata. | Update. |

### 1.2 Contradictions between files

| id | file:line | sev | description | fix |
|---|---|---|---|---|
| DOC-11 | readme:7 vs docs/api.md | med | readme: "for exhaustive signatures, see api.md". api.md has no section for: unit systems (`units`, `labels`, `idleFunctions`, `onNewUnit`, `onStep(world, {all, unlabeled, labeled})`), `world.data` (`getUnitTypeData`, `findUnitTypesWithAbility`, earmarks), `events` (TBD), custom events, constants, and ~14 `map` methods the readme lists (`isPathable`, `isPlaceable`, `isPlaceableAt`, `isVisible`, `hasCreep`, `getCreep`, `isRamp`, `getHeight`, `getSize`, `getCenter`, `closestPathable`, `freeGasGeysers`, `getEffects`, `isCustom`). Conversely readme lacks `debug.useDebugWidget`, `PixelMap`, `Expansion.areas.hull`. | Resolved by single-owner structure (section 3). |
| DOC-12 | docs/tutorial.md:66-77, 194-210, 228-229 vs examples/tutorial.ts vs readme:2172 | med | Tutorial says install a supply system and calls `examples/tutorial.ts` "the full code"; readme says the example builds no pylons and its gateways can't be placed. Also state key `buildCompleted` (tutorial) vs `buildComplete` (example:35, 56); `isCombatUnit()` (tutorial:152) vs `combatTypes.includes` (example:87). | One source: generate tutorial snippets from the example. |
| DOC-48 | readme:135 vs docs/api.md:145 vs types.ts:1268 | low | `GameResult` is the proto enum in readme (value `VICTORY`...) but a `[World, PlayerResult[]]` tuple type in api.md and `types.ts`. | Call the tuple `GameResultTuple` in docs or avoid the name. |
| DOC-49 | readme:1030 vs docs/api.md:543 | low | Empty-collection throw list differs (api adds `inClosestDistanceToGroup`, `inDistanceOfGroup` with empty `other`; matches code `units-collection.ts:277-290`). | One list. |
| DOC-50 | docs/overview.md:80-84 vs readme:1178 | low | "Agent systems run in the order they are mounted"; command winners are decided by priority then `use()` order. | Link to Command arbitration. |

### 1.3 Duplication (readme vs api.md and others)

| id | sections (line ranges) | overlap | sev |
|---|---|---|---|
| DOC-13 | Per-game reset semantics: readme:182, 1850, 2091; api.md:139 (stale), 417; internals.md:51; changelog:34 | same facts x6, one drifted | med |
| DOC-14 | Command arbitration: readme:1172-1201 (+306, 508, 1495, 2061); api.md:884-904, 369-381; internals.md:31-36; changelog:14-48 | ~70%, x5 | med |
| DOC-15 | Openings (choose/cycle/winrate/history/switch): readme:677-738, 1808-1821, 2198-2213; api.md:305-320, 1282-1320; changelog:163-189 | ~75%, x5 | med |
| DOC-16 | String steps/targets/`parseBuildOrder`: readme:604-675, 1931-1943; api.md:51-57, 1342-1343; changelog:165-175 | ~70%, x4 (grammar and error list restated) | med |
| DOC-17 | Behaviors and controllers: readme:759-935 vs api.md:1360-1546 | ~85%; api.md:1361 says "The readme ... has the same information as tables" | med |
| DOC-18 | memory/spatial/influence/pathing/roles/squads/intel/placement/buildings/mining/flying/mapAnalysis/openings: readme:1372-1842 vs api.md:936-1320 | ~80%, per-method prose rewritten in both | med |
| DOC-19 | Agent, cost/supply, macro helpers: readme:285-397 vs api.md:173-272 | ~75% (near line by line) | med |
| DOC-20 | Events: readme:399-460 vs api.md:332-394 vs overview.md:8-31 | ~80%, x3, overview stale | med |
| DOC-21 | Running games, SC2 discovery, whitespace maps: readme:56-78, 116-283 vs api.md:59-171 | ~70% | med |
| DOC-22 | readme "Changes compared to node-sc2" 2055-2102 vs changelog:12-270 (command return change, swapBuildings, memory expiry, Removed list 2096-2102 vs changelog:234-241) | ~50%; two changelogs | med |
| DOC-23 | units/Units/Unit: readme:947-1104 vs api.md:419-545, 616-712 | ~70% | med |
| DOC-24 | actions: readme:1106-1230 vs api.md:801-907 | ~75% | med |
| DOC-25 | map: readme:1232-1295 vs api.md:714-799 | ~65% (api subset) | med |
| DOC-26 | Chat debug commands: readme:1349-1364, 2190-2196, api.md:921-934. Config file: readme:258-283, api.md:75, 401, internals.md:44, changelog:116-131 | x3 / x4 | low |
| DOC-27 | readme "Where differs from ares" 2010-2053 vs Known limitations 2148-2157 vs Examples gaps 2178-2213 (Zerg placement 2043/2153, influence grids 2015/2150, YAML/JSON 2035/2044, tempest upgrade 2051/2212) | ~40%, x3 | low |
| DOC-36 | "Settings survive a new game on the same engine" repeated for 10 resources (readme:1382, 1434, 1493, 1578, 1612, 1658, 1703, 1744, 1776, 1814; api.md x10) | boilerplate | low |

Not duplication but related: macro/worker story told in four places (readme:347-397 helpers, 846-935 controllers, 591-600 + 744-748 build systems, 1643-1731 buildings/mining), DOC-19/DOC-28.

### 1.4 Structure

| id | file:line | sev | description | fix |
|---|---|---|---|---|
| DOC-28 | readme (whole) | med | 2232 lines / 194 KB, 17 H2; "Resources" alone is 942 lines (42%), "Systems" (incl. build systems/openings/targets) 272, "Behaviors" 178. Reads as a manual, not a landing page; every topic has a second copy in api.md. | Section 3. |
| DOC-29 | readme:1997-2157 | med | Mixes audiences: user guide, library-comparison tables (python-sc2 / ares), a second changelog (2055-2102), contributor docs (Testing, fixtures, scripts 2104-2146), limitations, examples catalog. Contributor-only/impl detail at 1230, 2112. | Move per section 3. |
| DOC-30 | docs/changelog.md:12-270 | med | Unreleased sub-headings use ticket vocabulary and mixed naming (`core-arch`, `parity-2`, `Phase 3`, `parity-4`, `parity-6a`, `Phase 5`, `Phase 6b`, `Consolidation`, `Examples`), not feature order (6a before 5); internal refs ("supersedes core-arch Q7", line 102); `Migrating bot/` blocks cite private bot file:line (243-256, e.g. `production.ts:27`) which will rot and don't belong in a library changelog. TOC (5-10) lists none of the sub-sections. Legacy entries (271+) use inconsistent heading levels (`## Highlights` same level as the version, `##  v0.8.0` double space, `[0.7.1]`). | One heading per release-note topic by feature name; move `Migrating bot/` into a per-topic "Upgrading" bullet without file:line; split legacy to `docs/changelog-node-sc2.md`. |
| DOC-31 | docs/overview.md, design.md, tutorial.md, internals.md, changelog.md:271-504 | med | Legacy node-sc2 pages. Verdicts below. | See 1.4a. |
| DOC-32 | docs (all) | med | No errors reference: classes (`BuildError.data`, `TrainError`, `GatherError`, ...), which methods reject with which, are scattered (readme:1108, 1136; api.md per method). | One "Errors" subsection in commands doc. |
| DOC-33 | readme:9-54 | low | Hand TOC is accurate but uneven: expands Resources and Examples, omits children of Running games, Agents, Systems (Build systems, Unit systems), Behaviors (8), Utilities (3), actions > Command arbitration, Config file. | Drop (GitHub renders one) or generate. |
| DOC-34 | docs/api.md (3 styles) | low | `### *\`x\`*` (Engine, Agent, Utilities), `#### *\`x\`*` (resources), plain `#### map.getLocations() => Locations;` with trailing `;` (map 717-755, frame 597-601). readme uses `### \`createEngine(options?)\`` for engine and plain lowercase for resources. | One format (docs-plan 3.2). |
| DOC-35 | docs/api.md, readme | low | Method headings are `###` under Engine/Agent and `####` under Resources; duplicate headings (`## Units`/`### units`, `## Behaviors`/`### behaviors`, readme `#### Openings`/`### openings`) produce `-1` anchors that depend on document order (api.md:33 `#behaviors-1`, readme:39/708/1810 `#openings-1`/`#openings`). Works today. | Rename one of each pair. |
| DOC-37 | docs/internals.md:46-49; docs/tutorial.md:1, 81, 162 | low | internals jumps H2 `## World` to `#### Data`; tutorial has three H1. | Fix levels. |
| DOC-58 | readme:246 | low | Core readme references the `bot/` package build command. | Move to repo root README. |

#### 1.4a Legacy page verdicts

| page | state | verdict |
|---|---|---|
| overview.md (121) | node-sc2 voice, `js` blocks, stale event list (DOC-38), names `node-sc2`; concepts (event consumers, world, systems, resources) are still correct and not covered elsewhere as a gentle intro | Merge into getting-started.md; retype blocks to TS. |
| tutorial.md (238) | JS-era, unrunnable (DOC-03), misleading label advice (DOC-02), 3 H1, anecdotes ("85% in my testing") | Rewrite in TS from `examples/tutorial.ts`. |
| design.md (63) | Philosophy still valid; persistent events false (DOC-01), `gasWorker` false (DOC-02), `[ADD LINK TO DOC]` placeholders (lines 10, 32), typos | Merge into architecture.md; fix. |
| internals.md (83) | Dispatch/registry/shared-module sections are current and good; stale names (DOC-04, 45, 46); `[ADD LINK]` (internals.md:46); "Race Agnosticy / Proxy" (82-83) is a plan, not behaviour | Merge into architecture.md; delete speculative section. |
| changelog.md 271-504 | historical, fine content, inconsistent headings (DOC-30) | Move to changelog-node-sc2.md, normalize headings. |

### 1.5 Broken examples

| id | file:line | sev | description | fix |
|---|---|---|---|---|
| DOC-51 | readme:763-773 | low | `Behavior`/`BehaviorContext` listing uses `World`, `Unit`, `Point2D` unimported; not compilable. | Add `import type`, or drop in favour of `types.ts` link. |
| DOC-52 | readme:2114-2135 | low | Imports `../test/create-test-world.ts` / `../constants/index.ts`: valid only inside packages/core (readme:2139 says so). | Fine; keep in contributor doc. |
| DOC-53 | docs/api.md:322-328 | low | `setState` example does `currentState.fooValue += 1` right after saying state "should not be mutated". | `fooValue: currentState.fooValue + 1`. |
| DOC-54 | readme, api.md, overview, tutorial | low | Map names inconsistent (`Melee/Simple64`, `Simple64`, `Blueshift LE`, `Cerulean Fall LE`, `Ladder2019Season3/AcropolisLE`); only the first and last are canonical per readme:74-78. | Use `Melee/Simple64` outside map-resolution docs. |

All other readme examples compile as written (note: `createEngine`, `runGame`, `runBotVsBot`, `runReplay` snippets are type-checked only, not run). JS blocks in overview/tutorial/design were reviewed by hand: API usage (`units.getById(type, filter)`, `actions.train(type, unit)`, `getMineralWorkers().closestNUnits`, `getCombatRally`, `buildComplete`, `defaultOptions.state`) is valid against current types; only the surrounding module system/package/label advice is wrong.

### 1.6 Missing topics

| id | sev | missing | where it should live |
|---|---|---|---|
| DOC-55 | low | Debug logging namespaces: code defines 30 (`sc2:debug:*`, `sc2:silly:*`, `sc2:DebugOnScreen`, `sc2:DrawDebug*`, `sc2:DebugPathable`, `sc2:DebugWeights`, `sc2:DebugWidget`, `sc2:DrawPlacementMap`); readme:255 names 2 patterns; on-screen debug gating only in changelog (288, 373, 387). | running-games.md "Debugging" |
| DOC-56 | low | `placer` resource (`resources.set({ placer })`, `Placer` `types.ts:1217`; `place` and `placements` hooks) is only inside an example (readme:547-554) and one sentence (1622); not in resource lists. | macro.md next to `placement` |
| DOC-57 | low | Engine extension points (`engine.use`, engine-type systems) | architecture.md |
| (see DOC-11) | med | Unit-system reference in api.md, `world.data`/earmarks reference, `events` resource reference | resources.md, agents.md |
| (see DOC-32) | med | Errors reference | commands.md |

Counts: high 4, med 26, low 28 (58 findings: DOC-01..DOC-58).

## 2. One-owner rules used below

1. One topic, one file. A fact (default, failure mode, setting) is written once; other files link by heading.
2. Each topic file has the same shape: 10-15 line concept intro, then members in a single format `#### \`res.method(arg: T, opt = d) => R\`` (signature, defaults, rejects/throws), one example per resource. No tables that restate headings.
3. "Settings survive a new game" and arbitration/reset rules are stated once (resources.md, commands.md); resources just link.
4. api.md is retired (no second copy). Types stay authoritative in `types.ts`.
5. Contributor material (architecture, testing) is not linked from the user path except from the docs map.

## 3. Target structure

| file | owns | est. lines |
|---|---|---|
| `readme.md` | what/why, requirements (3 lines), quick start, concept map (agent, system, resources, events: 1 paragraph each), docs map table, examples pointer, community | ~220 |
| `docs/getting-started.md` | first bot walk-through in TS (from tutorial.md + overview.md + `examples/tutorial.ts`) | ~220 |
| `docs/running-games.md` | `createEngine`, `runGame`, `runBotVsBot`, `runReplay`, lower-level, ladder, env vars, config file, finding SC2/maps, debug namespaces | ~260 |
| `docs/agents.md` | `createAgent`, settings, player data, cost/supply, events table + custom events, `createSystem`, agent/unit systems | ~420 |
| `docs/commands.md` | `actions`, command arbitration, `CommandResult`, errors | ~330 |
| `docs/units.md` | `units`, `Units`, `Unit`, `memory`, `spatial` | ~560 |
| `docs/map.md` | `map`, `Expansion`, `Ramp`, `PixelMap`, `mapAnalysis`, `influence`, `pathing`, point helpers | ~520 |
| `docs/combat.md` | `roles`, `squads`, `intel`, fights (`simulateFight`, `canWinFight`, engagement results) | ~330 |
| `docs/behaviors.md` | behavior executor, `plan`, helpers, individual/Terran/group behaviors, controllers | ~420 |
| `docs/macro.md` | agent macro helpers, `placement`, `placer`, `buildings`, `mining`, `flying` | ~560 |
| `docs/build-orders.md` | build systems, string steps, targets, openings (system option + `openings` resource), scouts/persistent builder, `parseBuildOrder` | ~420 |
| `docs/resources.md` | `world`, `world.data`/earmarks, `resources.get()` list, registry, per-game reset, custom resources, `frame`, `debug` + chat commands, `events` | ~330 |
| `docs/constants.md` | constants modules, dicts, groups, `GAME_LOOPS_PER_SECOND` | ~70 |
| `docs/compatibility.md` | differences from python-sc2 and ares, changes vs node-sc2, known limitations | ~170 |
| `docs/architecture.md` | design levels (from design.md), engine/dispatch/registry/shared modules (from internals.md), testing and scripts | ~260 |
| `docs/changelog.md` | fork release notes, by feature; `docs/changelog-node-sc2.md` legacy | ~270 + 235 |
| `examples/README.md` | examples catalog, env vars, ares ports table, openings configs, live smoke test | ~70 |

Deleted: docs/api.md, docs/overview.md, docs/design.md, docs/internals.md, docs/tutorial.md (merged as above).

## 4. Migration list (source -> target)

### readme.md

| source lines | target |
|---|---|
| 1-8 | readme.md intro (trim to ~5 lines; drop "walks through everything") |
| 9-54 | delete hand TOC; docs-map table in readme.md |
| 56-78 | running-games.md "Finding StarCraft II / maps"; readme keeps 3-line requirements |
| 80-114 | readme.md Quick start (keep) |
| 116-246 | running-games.md (createEngine, runGame, botVsBot, replay, lower-level, ladder) |
| 248-283 | running-games.md (env vars, config file) |
| 285-345 | agents.md (blueprint, settings, player data, cost/supply) |
| 347-397 | macro.md (macro helpers, builder handoff) |
| 399-485 | agents.md (events table, examples, custom events) |
| 487-508 | agents.md (systems) |
| 510-748 | build-orders.md |
| 750-757 | agents.md (unit systems) |
| 759-935 | behaviors.md |
| 937-945 | resources.md (resources.get list); concept map in readme.md |
| 947-1104 | units.md (units, Units, Unit) |
| 1106-1230 | commands.md (actions, arbitration) |
| 1232-1295 | map.md |
| 1297-1364 | resources.md (frame, debug, chat commands) |
| 1366-1370 | resources.md (events, data, earmarks) |
| 1372-1421 | units.md (memory, spatial) |
| 1423-1475 | map.md (influence, pathing) |
| 1477-1594 | combat.md (roles, squads, intel) |
| 1596-1758 | macro.md (placement, buildings, mining, flying) |
| 1760-1806 | map.md (mapAnalysis) |
| 1808-1842 | build-orders.md (openings resource) |
| 1844-1877 | resources.md (custom resources) |
| 1879-1929 | combat.md (fights) |
| 1931-1943 | build-orders.md (parseBuildOrder) |
| 1945-1952 | map.md (point helpers) |
| 1954-1995 | constants.md |
| 1997-2053 | compatibility.md (python-sc2, ares) |
| 2055-2102 | compatibility.md (node-sc2 changes; drop what changelog:12-270 already says) |
| 2104-2146 | architecture.md (testing, fixtures, scripts) |
| 2148-2157 | compatibility.md (known limitations; dedupe against ares list, DOC-27) |
| 2159-2223 | examples/README.md; readme.md keeps a 10-line list |
| 2225-2232 | readme.md docs map |

### docs/api.md

| source lines | target |
|---|---|
| 1-57 | readme.md (import line), agents.md (`createSystem`), build-orders.md (`taskFunctions`) |
| 59-171 | running-games.md (merge with readme text; keep `createGame`/`joinGame`) |
| 173-272 | agents.md (agent), macro.md (helpers) |
| 274-330 | agents.md (systems); build system fields -> build-orders.md |
| 332-394 | agents.md (events); `CommandResult` -> commands.md |
| 396-417 | resources.md |
| 419-545 | units.md |
| 547-579 | map.md |
| 581-614 | resources.md (frame) |
| 616-712 | units.md |
| 714-799 | map.md |
| 801-907 | commands.md |
| 909-934 | resources.md (debug) |
| 936-970 | units.md |
| 972-1008 | map.md |
| 1010-1083 | combat.md |
| 1085-1217 | macro.md |
| 1219-1274 | map.md |
| 1276-1280, 1360-1546 | behaviors.md |
| 1282-1320 | build-orders.md |
| 1322-1323 | delete |
| 1325-1358 | combat.md (fights), build-orders.md (parseBuildOrder), map.md (points), constants.md |

### Legacy pages

| source | target |
|---|---|
| overview.md | getting-started.md (concepts, TS) |
| tutorial.md | getting-started.md (TS rewrite from `examples/tutorial.ts`) |
| design.md | architecture.md "Design" (apply DOC-01, DOC-02) |
| internals.md | architecture.md "Internals" (apply DOC-04, 45, 46; drop Race Agnosticy) |
| changelog.md 12-270 | changelog.md (rename sub-headings by feature, drop ticket ids and bot/ file:line, DOC-30) |
| changelog.md 271-504 | changelog-node-sc2.md |

Order to apply: fix high findings (DOC-01..04) first, since they stay valid under either layout; then do the move per the tables, taking the longer of the two copies as the base, and delete the shorter.
