# packages/core comment audit (read-only)

Scope: all `.ts` under `packages/core` except node_modules, fixtures/, constants/{ability,unit-type,upgrade,buff,effect}.ts, constants/dicts/*. 204 files scanned (tests, scripts and examples included).
Method: every `//`, `/* */` and trailing comment extracted by script, then each classified by hand against the rule. Triple-slash references, `@ts-ignore`, eslint directives, TODO/FIXME/TODO(ts) and URLs are counted as "protected" and never touched.

## Headline

The package is already almost clean. 222 comment lines in 60 files (144 files have none). Only 41 lines are cuts and 7 are trims. 25 of the 41 cuts are one function.

| | lines |
|---|---|
| total comment lines | 222 |
| CUT (delete whole) | 41 |
| TRIM (cut to the why clause) | 7 |
| protected (directive / TODO / FIXME / URL / `///`) | 35 |
| KEEP (terse non-obvious why) | 139 |

Public-API JSDoc: there is none. `grep '/\*\*'` over the scoped files finds zero hits; `types.ts` has 4 comment lines and `index.ts` has 1 (a `/// <reference>`). So:
- Keep candidates (behavioural JSDoc on public types/exports): none exist.
- Restating JSDoc to cut: none.
- Behaviour docs duplicated on `types.ts` interfaces and also on the implementation: none. The three `types.ts` comments (43, 316, 725) are type-level whys (proto-optional workaround, key legend, bivariance) and are KEEP. Side note, not a finding: editor hovers for library users currently show nothing for the public API.
- The only block-style comment in scope is `resources/units.ts:56-57` (`@FIXME`, protected).

## Per-file table (comment-bearing files, sorted by CUT desc, then TRIM, then total)

Columns: comment lines / CUT / TRIM / protected / KEEP. Files >500 lines are marked BIG.

| file | lines in file | comments | CUT | TRIM | prot | KEEP | notable examples |
|---|---|---|---|---|---|---|---|
| utils/geometry/plane.ts | 87 | 25 | 25 | 0 | 0 | 0 | :38 `cells.push(centerPoint); // center`; :41 `// left`; :44 `// down left`; :60 `// 2 left 2 down` (all 25 are direction labels on `cells.push`) |
| utils/map/flood.ts | 58 | 5 | 5 | 0 | 0 | 0 | :29 `// console.log(\`in floodFill - x: ...` (dead code); :38 `// left`; :42 `// up`; :46 `// right`; :50 `// down` |
| resources/event-channel.ts | 89 | 8 | 4 | 0 | 3 | 1 | :16 `// by default, only subscribe to agent events`; :35 `// get all events holding this readerId`; :40 `// remove the reader id from the event, essentially 'consuming' it`; :70 `// if there are no more readers, remove it from the event channel queue` |
| engine/create-engine.ts BIG | 624 | 21 | 3 | 0 | 8 | 10 | :126 `// the ladder manager is launching this agent and it should override anything else` (restates `if (isManaged)`); :510 `// console.warn(\`WARNING! loop delay is ...` (dead code); :555 `// concurrency: 1` (trailing, restates `mapSeries`) |
| systems/builder-plugin.ts BIG | 928 | 14 | 3 | 0 | 1 | 10 | :239 `// ares build_order_parser.py _remove_completed_steps` (provenance only, says nothing about behaviour); :487 `// a BUILDING worker goes back via the tracker` (restates the guard); :500 `// a builder busy on a tracked build holds the BUILDING role` (restates `builderFor`) |
| constants/race-map.ts | 57 | 1 | 1 | 0 | 0 | 0 | :5 `// These constants are helpers to create race-agnostic routines` (header summary) |
| systems/map.ts BIG | 744 | 17 | 0 | 3 | 2 | 12 | :148 `// allow for misplaced townhalls, but not macro hatches` (keep only the 4.5-radius why); :256 `adding 3 to start at an x,y not occupied by the townhall` (trailing; fold into a named const); :551 `// this is necessary because some maps have random tiles...` (drop "this is necessary because") |
| agent/create-agent.ts | 245 | 7 | 0 | 1 | 0 | 6 | :26 `// Assigning used to create a plain property before these accessors existed` (history, not constraint; reword to the why of shadowing) |
| agent/macro.ts BIG | 519 | 5 | 0 | 1 | 0 | 4 | :111 `// python-sc2's hand-written equivalents plus the API's tech aliases, so e.g. a ...` (drop the what, keep nothing or the TECHLAB why) |
| resources/buildings.ts BIG | 558 | 5 | 0 | 1 | 0 | 4 | :479 `// opt-in (P4-D3): bots that never hand the tracker a build keep full control...` (drop the ticket ref) |
| utils/map/townhall.ts | 74 | 5 | 0 | 1 | 1 | 3 | :59 `// every cell for the placement must be 3 (min distance) + 1 (cell size) away from...` (explains magic `3 + 1`; name the const instead) |
| engine/create-unit.ts BIG | 623 | 9 | 0 | 0 | 0 | 9 | all domain whys (:54 `unit data speeds are per normal-speed second`, :464 `Assumes a bunker full of marines`) |
| resources/units.ts | 266 | 6 | 0 | 0 | 4 | 2 | protected: :47 `@TODO`, :56-57 `/* @FIXME: FIX THIS NONSENSE...`, :143 `@ts-ignore overloads are hard apparently` |
| scripts/generate-data.ts BIG | 550 | 6 | 0 | 0 | 0 | 6 | all provenance/why for hand-patched data (:76, :81, :89); :181 is a generated-output template, not a comment |
| systems/frame.ts | 125 | 6 | 0 | 0 | 2 | 4 | protected :61-62 TODOs |
| test/fake-client.ts BIG | 506 | 6 | 0 | 0 | 1 | 5 | protected :503 `TODO(ts)` |
| resources/debug.ts | 417 | 5 | 0 | 0 | 3 | 2 | protected: eslint-disable at :330, :337, :344 |
| resources/actions.ts BIG | 764 | 4 | 0 | 0 | 0 | 4 | whys (:235, :314, :351, :398) |
| systems/unit.ts | 302 | 4 | 0 | 0 | 2 | 2 | protected TODOs :19-20 |
| types.ts BIG | 1352 | 4 | 0 | 0 | 1 | 3 | see Public-API section |
| utils/geometry/units.ts | 175 | 4 | 0 | 0 | 0 | 4 | whys |
| examples/ares/custom-building-placements.ts | 303 | 3 | 0 | 0 | 0 | 3 | whys |
| resources/map.ts | 494 | 3 | 0 | 0 | 1 | 2 | protected :112 `@TODO: put this somewhere useful` |
| systems/create-system.ts | 193 | 3 | 0 | 0 | 1 | 2 | protected :53 TODO |
| utils/map/ramp.ts | 230 | 3 | 0 | 0 | 0 | 3 | whys |
| constants/groups.ts BIG | 512 | 2 | 0 | 0 | 0 | 2 | whys (:464, :469) |
| utils/map/grid.ts | 126 | 2 | 0 | 0 | 2 | 0 | bare `@ts-ignore` at :29, :34 (directive; leave) |
| engine/create-client.ts | 115 | 2 | 0 | 0 | 0 | 2 | whys |
| examples/ladder.ts | 29 | 2 | 0 | 0 | 0 | 2 | :5-6 behaviour note for example readers; keep |
| resources/influence.ts | 219 | 2 | 0 | 0 | 0 | 2 | whys |
| resources/mining.ts BIG | 548 | 2 | 0 | 0 | 0 | 2 | whys |
| test/live.ts | 44 | 2 | 0 | 0 | 0 | 2 | whys |
| utils/map/blockers.ts | 61 | 2 | 0 | 0 | 0 | 2 | whys |
| 27 single-comment files (below) | | 27 | 0 | 0 | 3 | 24 | protected: index.ts:1 `///`, systems/debug.ts:124 eslint, utils/geometry/angle.ts:24 URL |

Single-comment files, all KEEP unless noted: constants/combat.ts, constants/influence.ts, engine/create-engine.live.test.ts, engine/create-world.ts, engine/data-storage.ts, engine/launcher.test.ts, engine/launcher.ts, examples/ares/build-runner.ts, examples/ares/combat-maneuver.ts, examples/ares/influence-and-pathing.ts, examples/ares/managing-production.test.ts, examples/ares/managing-production.ts, examples/cannon-rush.ts, index.ts (protected), resources/command-context.ts, resources/command-executor.test.ts, resources/placement.ts (BIG), resources/spatial.test.ts, resources/units-collection.ts, scripts/capture-fixtures.ts (BIG), systems/builder-plugin.test.ts (BIG), systems/debug.ts (protected), test/fake-client.test.ts, test/spawn-units.ts, utils/geometry/angle.ts (protected), utils/map/chokes.ts, utils/spatial/bucket-index.ts.

The 144 remaining files have zero comments.

### Totals

| comment lines | CUT | TRIM | protected | KEEP |
|---|---|---|---|---|
| 222 | 41 | 7 | 35 | 139 |

Actionable edits: 48 lines in 11 files.

## Batches for juniors (no file appears in two batches; only files with CUT/TRIM work)

Total work is tiny, so four batches. BIG = over 500 lines. Each batch should re-read each target line in context before editing, and delete a trailing comment without touching the code on the line.

1. Batch A, utils/ (31 lines): utils/geometry/plane.ts (25 cut), utils/map/flood.ts (5 cut), utils/map/townhall.ts (1 trim: :59, consider naming the `3 + 1` const; leave the :27 TODO).
2. Batch B, systems/ (6 lines, two BIG files): systems/map.ts BIG (3 trim: :148, :256, :551), systems/builder-plugin.ts BIG (3 cut: :239, :487, :500).
3. Batch C, engine/ + constants/ + agent/ (7 lines, two BIG): engine/create-engine.ts BIG (3 cut: :126, :510, :555), constants/race-map.ts (1 cut: :5), agent/create-agent.ts (1 trim: :26), agent/macro.ts BIG (1 trim: :111).
4. Batch D, resources/ (5 lines, one BIG): resources/event-channel.ts (4 cut: :16, :35, :40, :70), resources/buildings.ts BIG (1 trim: :479, drop "(P4-D3)").

No batch for tests, examples, behaviors, test/ or constants beyond race-map: nothing to cut there.

## Judgement calls (the owner may disagree)

- builder-plugin.ts:239 and :544, macro.ts:97/111, generate-data.ts: provenance comments citing python-sc2/ares. Kept when they explain a data patch or deliberate deviation; :239 is cut because it is a bare file reference.
- builder-plugin.ts:605 and :760 (`in case something changed while waiting for placement position`) are borderline why; kept.
- types.ts:316 trailing `// 1 = Self, 3 = Neutral, 4 = Enemy` kept; an enum-keyed type would remove the need.
- examples/ladder.ts:5-6 kept as behavioural doc in an example, which is user-facing teaching material.
- No dead-code comment blocks besides flood.ts:29 and create-engine.ts:510.
