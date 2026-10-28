# parity-6a: chokes, regions, defensive positions, config file, chat debug, enemy race, workers per gas

Source: parity-roadmap.md phase 6 (ares-gap.md ranked #11, #13; the build runner #10 is phase 6b); user mandate 2026-10-26 "use best judgement to get ares parity" (decisions.md).
Design: .agent-work/parity-6a.design.md (technical-architect-3, incl. Addendum A1–A6), decisions 6a-D1–D19 logged in core-arch.decisions.md. Docs: docs-plan.md (§2 Phase 6a as amended by the design's Docs section). Scope: packages/core only.

Status: FINAL (best judgement under user mandate; assumptions listed at the end).

Ticket ids are `P6A-Tnn`, local to this file. "core-arch Tnn", "P2 Tnn", "P3 Tnn", "P4 Tnn" and "P5 Tnn" refer to core-arch.md, parity-2.md, parity-3.md, parity-4.md and parity-5.md.

## Problem Statement

Core knows ramps and a natural wall, but nothing else about the map's structure. There are no regions, no general chokes, no "where do I hold this base" and no defensive third, so defense positioning beyond the main ramp is hand-coded in the bot. Smaller gaps:
- A random opponent's race stays unknown all game (a TODO in the agent).
- There's no way to spawn or kill units from chat while testing.
- Configuration is env-only, and the step size is a module constant that can't vary per bot.
- `distributeWorkers` always fills gas to 3, so the bot can't run a mineral-heavy split.

## Solution

- **Map analysis:** a new core resource that, once per game, splits the start pathing grid into regions joined by chokes. It uses a clearance (distance-to-wall) watershed. From that it answers:
  - which region a point is in;
  - whether a point is in a choke;
  - a base's chokes, by ground distance;
  - a defensive position: on the base's choke along the shortest ground route toward a target (the enemy main by default), set back a few cells toward the base;
  - the defensive third: the third or fourth base farthest by path from the enemy;
  - a region's perimeter, ordered by angle (for the 6b worker scout);
  - the enemy main ramp.

  The analysis runs at game start by default, behind a feature toggle, otherwise lazily on first use.
- **Config file:** an optional JSON file (`sc-bot.config.json` in the cwd, or a path from `SC_BOT_CONFIG` or the engine options), merged with inline engine options. It sets the step size, feature toggles and per-resource settings. Other phases can add their own top-level sections (e.g. 6b's build orders); core keeps those unvalidated. Per-resource settings are fed to each resource's `configure` on creation and after every game reset. `STEP_COUNT` keeps overriding the step size.
- **Chat debug:** an opt-in system that turns the own player's chat into debug commands, with ares' command set: create/kill units, cooldown, food, god, resources, reveal map, tech tree, upgrades.
- **Enemy race:** a random opponent's race is filled in from the first enemy unit seen, and an `enemyRaceDetected` event fires once.
- **Workers per gas:** `distributeWorkers` takes a per-call `workersPerGas` (0–3).

## Non-goals

- Overlord/scout spots (6a-D10: deferred with #14, since the bot is Terran). The roadmap listed them under phase 6; they now go under readme Known limitations.
- Height-based region splitting (map_analyzer). Ramps link to chokes through `choke.ramp` instead (6a-D6).
- Chokes that react to buildings or pathing changes. The analysis uses the static start terrain, with minerals walkable (6a-D5).
- The per-map special cases in ares' defensive third (Oxide/Glittering).
- A persistent workers-per-gas setting (ares mediator). It's per call here (6a-D19). Phase-4 mining uses the same name and semantics.
- A YAML config, and config keys beyond gameStep, features and resources.
- Build-runner upgrades (phase 6b).
- bot/ changes (migration notes only).

## User Stories

1. As a bot author, I want the map split into regions joined by chokes at game start, so that I can reason about map structure without hand-written per-map positions.
2. As a bot author, I want each choke's centre, two ends, width, cells and the two regions it joins, so that I can place units or buildings on it.
3. As a bot author, I want a choke that is a ramp linked to that ramp, so that the existing ramp helpers and chokes line up.
4. As a bot author, I want to look up the region of any point, so that I can tell whether a unit is in my main, my natural or elsewhere.
5. As a bot author, I want to know if a point lies in a choke, so that I can avoid parking units or buildings in one.
6. As a bot author, I want a base's chokes ordered by ground distance from the base, so that I can pick which entrance to guard.
7. As a bot author, I want a defensive position for a base: on the choke facing a target (the enemy main by default), set back toward the base, so that my army holds the right entrance.
8. As a bot author, I want the defensive third (the third base farthest from the enemy), so that I take the safer third.
9. As a bot author, I want a region's perimeter ordered around its centre, so that a scout can circle a base.
10. As a bot author, I want the enemy main ramp, so that I can target or scout it.
11. As a bot author, I want to tune choke width, region merging and the defense offset, and keep those settings across games, so that I can fix a map that's analysed badly.
12. As a bot author, I want to draw chokes and regions in the debug overlay, so that I can see what the analysis found.
13. As a bot author who doesn't need map analysis at game start, I want to turn the eager analysis off, so that it only runs when I first ask.
14. As a bot author, I want a JSON config file with the step size, feature toggles and per-resource settings, so that different bots and runs need no code changes.
15. As a bot author, I want inline engine options to override the file and `STEP_COUNT` to override both, so that today's env usage keeps working.
16. As a bot author, I want a malformed or missing named config file to fail at engine creation, and unknown feature keys to warn, so that typos don't silently do nothing.
17. As a bot author, I want resource settings from the config re-applied after every game reset, with my own `configure` calls winning, so that config gives defaults and code gives overrides.
18. As a bot author testing a bot, I want to type "create 5 marines" or "kill 1 zergling 2" in chat to spawn or kill units, so that I can set up scenarios mid-game.
19. As a bot author, I want chat commands for cooldowns, food, god mode, resources, map reveal, tech tree and upgrades, so that I have ares' debug toolbox.
20. As a bot author, I want only my own chat parsed, and chat debug off unless enabled, so that an opponent's chat or a ladder game can't trigger it.
21. As a bot author, I want a bad chat command to reply with an error in chat, so that I see why nothing happened.
22. As a bot author facing a random opponent, I want `opponent.race` filled in when I first see an enemy unit, plus a one-time event, so that race-specific logic can kick in.
23. As a bot author, I want to cap workers per gas building in `distributeWorkers`, so that I can run mineral-heavy or gas-light splits.

## Implementation Decisions

From the Architect (full contract in parity-6a.design.md C1–C6; decisions 6a-D1–D19):

- **Map analysis resource** (6a-D1, D2):
  - A new core resource `mapAnalysis`, registered after phase 4's resources in the core resource list. Phase 5's behaviors register after it.
  - The map resource and the map system are not changed.
  - Analysis runs once per game. By default the first per-step hook triggers it (`features.eagerMapAnalysis`), so it is ready before the agent's game-start handler. The hook never throws.
  - Settings survive game resets. Changing settings recomputes the analysis on the next access.
- **Algorithm** (6a-D3, D4):
  - Euclidean clearance, then a watershed with union-find basins, merging basins unless the passage is narrow relative to both peaks. Then a small-region merge.
  - 4-connectivity, so diagonal cliff lines don't leak.
  - Each connected boundary component between two regions is one choke.
  - Deterministic.
  - Defaults: max choke width 14, peak ratio 2.2, min region area 150, defense offset 4.
- **Analysis grid** (6a-D5, D6):
  - The start pathing grid, with the own start townhall footprint cleared so both spawns are symmetric.
  - Minerals and geysers count as walkable. Structures are ignored.
  - Regions are not split by height; a choke that touches a ramp links to it.
- **Defensive position** (6a-D7, D8):
  - Ground distances come from 8-connected Dijkstra fields with no corner cutting, cached per start cell (32 at most).
  - The chosen choke is the base region's choke that minimises the distance from the base plus the distance to the target.
  - The position is up to `offset` cells back down the base's distance field.
- **Defensive third** (6a-D9): of the existing third/fourth candidates, the one with the longer path from the enemy.
- **Perimeter and enemy main ramp** (addendum A2, A3):
  - A region's perimeter is its cells next to an unwalkable or off-grid cell, sorted by angle around the region centre. It is cached per region.
  - The enemy main ramp is the ramp of the enemy main's defensive choke facing our start.
- **Config** (6a-D12–D16):
  - Engine options, file and env merge into one frozen config on the world.
  - Order: defaults, then the file, then inline options, then env `STEP_COUNT`.
  - The config is an extensible interface (addendum A1): other phases add top-level sections by declaration merging. Unknown top-level keys are kept as-is with no warning, and each such section is replaced whole by later sources. Only gameStep, features and resources are validated.
  - The registry passes each resource's config section to that resource's `configure` after creation and after every reset. A section for a resource without `configure` warns once.
  - The step size replaces the old module constant everywhere.
  - Features: `chatDebug` (off) and `eagerMapAnalysis` (on).
  - The test world skips the config file, so tests are hermetic.
- **Chat debug** (6a-D17):
  - An engine-held system that reads agent events, because chat is written as an agent event.
  - Only added when `features.chatDebug` is on.
  - Handles only the own player's chat, using ares' aliases. Unit names come from the core unit-type constants, with plurals accepted.
  - It sends debug commands and chat replies, never unit commands.
- **Enemy race** (6a-D18):
  - Detected in the agent's per-step code from the first live enemy's unit-type race, only while the race is unknown.
  - Sets `opponent.race` and writes `enemyRaceDetected` once per game.
  - Agent systems see the event the same step; the agent blueprint's own handler sees it the next step.
- **Workers per gas** (6a-D19):
  - A per-call option that caps the gas target at `min(ideal, workersPerGas)`.
  - Must be an integer 0–3, otherwise it's a range error.
  - Surplus gas workers go to minerals through the existing logic.
- **Root exports:** none new. The types flow through the existing type re-export.

## Testing Decisions

All seams are offline, using the core test harness: the fixture world builder, synthetic observations, and the fake client's sent requests.

- **Pure analysis** (choke analysis, distance field): synthetic grids with exact expectations, covering rooms/corridors/doors, wide openings, small pockets, diagonal walls, determinism, octile distances, no corner cutting and buffer reuse. No world.
- **Map analysis resource:** the world seam on the simple64, acropolis and blueshift fixtures. Checks:
  - main and natural in different regions;
  - the main's defensive choke is the main ramp;
  - the natural's defensive position is in the natural's region;
  - every expansion region has a choke;
  - the defensive third;
  - the eager and lazy toggle (spy);
  - settings survive a reset.

  If the defaults fail a fixture property, the developer reports it to the Architect rather than weakening the assertion.
- **Config:** a pure resolve function (including an extra top-level section kept unchanged with no warning) with an injected env, file path and cwd, plus registry tests (section applied on register and after reset) and one engine test, where the step size reaches the fake client's step request.
- **Chat debug:** a pure parser table, plus the world seam with chat in a synthetic observation, asserting the debug/action requests the fake client sent.
- **Enemy race:** the agent seam with a random opponent and an enemy unit in the next observation; the event fires once.
- **Workers per gas:** the existing macro-helper tests, extended.
- **Perf** (team-lead perf rule, 6a-D11 amended): no committed wall-clock test. The game-start budget is measured ad hoc and the median recorded in P6A-T03. The budget is full analysis ≤ 50 ms and cold defensive positions for every expansion ≤ 100 ms, on acropolis, as a median of 10 runs.
- **Prior art:** parity-2 resource tests, engine/create-world.test.ts, resources/map.test.ts, agent/macro.test.ts, agent/create-agent.test.ts, test/fake-client.ts.

## Out of Scope

See Non-goals.

## Further Notes

Migration notes for the user's bot/ (no tickets):
- Nothing breaks. `STEP_COUNT` keeps its meaning and still overrides everything.
- If the bot runs with a `sc-bot.config.json` in its cwd, that file is now read. A malformed one fails engine creation.
- Against random opponents, `agent.opponent.race` now changes mid-game, on the first enemy sighting. Code that cached it at game start should re-read it or handle `onEnemyRaceDetected`.
- New entry points:
  - the `mapAnalysis` resource (defensive position at nat/main, defensive third, region lookup);
  - `createEngine({ config, configFile })` and `world.config`;
  - the `distributeWorkers(ratio, { workersPerGas })` option;
  - chat debug via `features.chatDebug: true`.
- Candidate bot adoption (user's call): replace hand-coded natural defense spots with `getDefensivePosition(map.getNatural())`.

Assumptions (BA, best judgement):
- P6A-A1 Overlord/scout spots move out of the phase per 6a-D10. The phase-6 roadmap exit "every small item has a test" applies to the items built here.
- P6A-A2 The committed perf test file in design C2 (map-analysis.perf.test.ts) is dropped per the team-lead perf rule (6a-D11 amended). The budget is measured ad hoc and recorded in P6A-T03.
- P6A-A3 P6A-T01 sits in the scaffolding chain (P2 T01 → P3 T02 → P4 T04 → P6A-T01 → P5 T01). It is the only 6a ticket that edits types.ts, engine/create-world.ts, engine/create-resource-manager.ts, engine/create-engine.ts and test/create-test-world.ts. It adds all 6a types up front, including `onEnemyRaceDetected` and the `distributeWorkers` signature, so later tickets never touch types.ts.
- P6A-A4 `mapAnalysis` is registered after phase 4's resources (business-analyst / parity-3 PA4), not just after parity-2's as the design says.
- P6A-A5 P6A-T05 is blocked by P6A-T01 only for its `onEnemyRaceDetected` type. Otherwise it is free (decisions.md sequencing).
- P6A-A6 The docs chain puts 6a after phase 4 (docs-plan §3.6), so P6A-T07 is blocked by P4 T13.
- P6A-A8 Shared files (addendum A4): 6a edits types.ts, engine/create-world.ts (+ test), engine/create-resource-manager.ts, engine/create-engine.ts, test/create-test-world.ts, agent/create-agent.ts and agent/macro.ts. It doesn't edit index.ts, package.json, systems/builder-plugin.ts, resources/map.ts or systems/map.ts. Addendum A5 and A6 are already reflected (no perf file; the T06/P4 T11 rule applies in either order).
- P6A-A7 The design's Docs section amends docs-plan §2 Phase 6a: drop overlord/scout spots and add a Known limitations line, the config file subsection, `distributeWorkers` and the ares deviations. Business-analyst owns docs-plan.md and has been told.

---

# Tickets

## P6A-T01 Config file + phase-6a scaffolding (design C3, C2/C4 stubs)

- Source: design C3; C2–C6 types; 6a-D12–D16.
- What to build:
  - The config resolver: defaults, then the JSON file, then inline options, then env `STEP_COUNT`. Validated, with unknown keys warned, and frozen.
  - `world.config` set before the core resources register.
  - The registry applies `config.resources.<name>` through `configure` after creation and after every reset, and warns once for a resource without `configure`.
  - The engine:
    - resolves the config from the `config` and `configFile` options;
    - uses `config.gameStep` wherever the old step constant was;
    - adds the chat debug system when `features.chatDebug` is on.
  - The test world skips the config file and passes `config` through.
  - All phase-6a types.
  - Stubs for the map analysis resource (registered last, after phase 4's resources; methods throw "not implemented"; no-op per-step hook) and for the chat debug system (no handlers).
- API contract: design C3 in full with addendum A1; C2 `MapAnalysisResource` with A2/A3 and its types; C4 `ChatCommand` and `createChatDebugSystem`; C5 `onEnemyRaceDetected`; C6 `distributeWorkers` signature.
- Acceptance criteria:
  - [ ] With no file, the defaults are gameStep 4, chatDebug false, eagerMapAnalysis true, resources {}.
  - [ ] A file at the default path is merged. `SC_BOT_CONFIG` and the `configFile` option select another path. `configFile: false` skips the file.
  - [ ] Inline options override the file; `features` is shallow-merged and `resources` merged per resource name. `STEP_COUNT` overrides gameStep from both.
  - [ ] A missing default-path file is fine. A missing explicitly named file throws a core error, and so does malformed JSON (naming the path), at engine creation.
  - [ ] gameStep that isn't a positive integer, or a feature that isn't boolean, throws. Each unknown key inside `features` warns once.
  - [ ] An unknown top-level section (e.g. `builds` in the file) appears on `world.config` unchanged, with no warning; inline replaces the file's section whole (addendum A1).
  - [ ] The resolved config is frozen and available on the world.
  - [ ] The registry calls a resource's `configure` with its config section after creation and again after `resources.reset`. A section for a resource without `configure` warns once.
  - [ ] An engine created with `config: { gameStep: 2 }` and `configFile: false` sends step requests with count 2 (fake client).
  - [ ] `mapAnalysis` exists on the resources (no registration-order assertion) and its methods throw a core "not implemented" error. The chat debug system is in the engine's systems only when `chatDebug` is on.
  - [ ] Existing tests pass; lint, tsc and tests are green.
- Implementation plan:
  - Where:
    - types.ts: `ResourceSettings`, `CoreConfig` (an `interface`, A1), `CoreConfigInput` (mapped type per A1), `World.config`, `EngineOptions.config` / `configFile`; C2 `MapAnalysisSettings`, `Choke`, `Region`, `BaseChoke`, `DefensivePosition`, `MapAnalysisResource` (including `getPerimeter` and `getEnemyMainRamp`, A2/A3), and the container key `mapAnalysis`; C5 `EventConsumer.onEnemyRaceDetected`; C6 the `Agent.distributeWorkers` signature. `ChokeSettings` is imported from utils/map/chokes.ts if P6A-T02 has landed; otherwise it is declared here and P6A-T02 imports it from types.ts (the developer picks one, so there is no duplicate).
    - New engine/config.ts (`DEFAULT_CONFIG`, `resolveConfig`) and engine/config.test.ts.
    - engine/create-world.ts: the `config` parameter, `world.config` before registration, and the `mapAnalysis` definition appended last in CORE_RESOURCES.
    - engine/create-resource-manager.ts: apply config sections in `register` and `reset`.
    - engine/create-engine.ts: resolve the config; replace `STEP_COUNT` at its 4 uses (~:57, :505, :509, :519, :525) with `world.config.gameStep`; add the chat debug system after `engine.use([frame, unit, map])` when enabled.
    - test/create-test-world.ts: `configFile: false` and `TestWorldOptions.config`.
    - New stubs resources/map-analysis.ts and systems/chat-debug.ts.
    - engine/create-world.test.ts: registry config tests.
  - Interfaces: design C3 and the C2/C4–C6 signatures, as amended by addendum A1–A3.
  - Follow: the parity-2 T01 scaffolding pattern; `NodeSC2Error` (engine/errors.ts); the create-resource-manager.ts registry code.
  - Don't touch: resources/map.ts, systems/map.ts, systems/frame.ts, systems/unit.ts, resources/actions.ts and the command executor files, agent/*, index.ts (no change needed).
- Stack: core.
- Blocked by: P4 T04 (the scaffolding chain; it transitively covers P2 T01 and P3 T02, and core-arch T04 through P2 T01); core-arch T01 nits, if still open.
- Blocks: P5 T01 (scaffolding chain).
- Slice siblings: P6A-T02–T07.

## P6A-T02 Pure choke analysis + distance field (design C1)

- Source: design C1; 6a-D3, D4, D8.
- What to build:
  - `analyzeChokes`: an exact separable EDT for clearance, then a union-find watershed with the merge rule, a small-region merge, relabelling, and choke extraction per region pair and 8-connected component.
  - `createDistanceField`: 8-connected Dijkstra (1 / √2) with no corner cutting, Infinity when unreachable, and its own heap and buffers allocated once per instance.
- API contract: design C1 `ChokeSettings`, `ChokeAnalysis`, `analyzeChokes`, `createDistanceField`.
- Acceptance criteria:
  - [ ] One open room gives 1 region and 0 chokes.
  - [ ] Two 20x20 rooms joined by a 3-wide corridor give 2 regions and 1 choke, with its centre in the corridor and width in [2, 4].
  - [ ] Two rooms joined by two separate 3-wide doors give 2 chokes with the same `regions`.
  - [ ] An opening wider than maxChokeWidth gives 1 region.
  - [ ] A pocket smaller than minRegionArea behind a 2-wide gap is merged, with no choke.
  - [ ] A diagonal 1-cell wall between two rooms doesn't leak.
  - [ ] Two runs on the same input are deep-equal; regions are labelled 0..R-1 by smallest cell index; chokes are ordered by (regions, center).
  - [ ] The distance field gives octile values on an open grid, detours around a wall, Infinity when unreachable, and never cuts corners. 100 reused calls match a fresh instance.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new utils/map/chokes.ts + chokes.test.ts; new utils/map/distance-field.ts + distance-field.test.ts.
  - Interfaces: design C1.
  - Follow: the parity-2 typed-array conventions (index `y * width + x`, no per-call allocation in hot loops); utils/map/ramp.ts style; the no-corner-cutting rule in utils/pathing/astar.ts (read only).
  - Don't touch: utils/pathing/* (in flight; don't import its heap), types.ts, any resources/ file.
- Perf (measured ad hoc, senior-backend, 2026-10-26; startRaw pathing + own townhall 5x5 cleared, median of 21): analyzeChokes simple64 1.45 ms, acropolis 5.95 ms, blueshift 5.25 ms; distance field from own main 0.27 / 1.63 / 1.58 ms. Counts match the prototype (simple64 4 regions / 4 chokes, acropolis 13 / 20, blueshift 9 / 14); main region has exactly one choke on all three.
- Implementation note: equal-clearance cells are flooded breadth-first from already-labelled cells (standard watershed plateau handling) instead of strictly by index; with pure index order a flat corridor is claimed whole by one side and the choke lands at the far mouth (width √20 ≈ 4.47 instead of 4).
- Stack: core.
- Blocked by: None (pure, new files only; can run now).
- Slice siblings: P6A-T01, P6A-T03–T07.

## P6A-T03 mapAnalysis resource (design C2)

- Source: design C2; 6a-D1, D2, D5–D9, D11 (amended).
- What to build:
  - The map analysis resource:
    - the analysis grid from the start pathing grid with the own townhall footprint cleared;
    - the lazy once-per-game analysis plus the eager per-step trigger (guarded by try/catch);
    - region, choke and ramp linking, and the choke-cell mask;
    - base resolution;
    - cached distance fields (32 at most, FIFO eviction);
    - base chokes, defensive position and defensive third;
    - `getPerimeter` (lazy, cached per region) and `getEnemyMainRamp` (addendum A2, A3).
  - `configure` (recomputes on next access), `reset` (keeps settings), and `drawDebug`.
- API contract: design C2 `MapAnalysisResource` (with addendum A2/A3), `MapAnalysisSettings`, `Choke`, `Region`, `BaseChoke`, `DefensivePosition` (types already in types.ts from P6A-T01).
- Acceptance criteria (fixtures simple64, acropolis and blueshift, via the test world):
  - [ ] Main and natural townhalls are in different regions.
  - [ ] `getDefensivePosition(main)`: its choke's ramp is the main base ramp, and the position is walkable, in the main's region and within offset + 1.5 of the choke centre.
  - [ ] `getDefensivePosition(natural)` is defined, its choke is not the main-ramp choke, and the position is in the natural's region.
  - [ ] Every expansion's region has at least one choke.
  - [ ] `getDefensiveThird` is one of `getThirds()` and has the longest path from the enemy. It is undefined when there are no thirds.
  - [ ] `getRegion` returns undefined on an unwalkable cell or off the map. `isInChoke` is true on every choke point.
  - [ ] With the eager toggle on, the analysis exists right after test-world creation and runs once across two steps (spy). With it off, it doesn't run until the first access.
  - [ ] `configure({ peakRatio })` recomputes on the next access. Settings survive `resources.reset`, and a config-file section reaches `configure`.
  - [ ] Accessors throw `MapDecompositionError` when the start grids are missing. The per-step hook never throws.
  - [ ] `getPerimeter(region)`: every point is in the region and 4-adjacent to an unwalkable or off-grid cell; angles around the region centre are non-decreasing; the cache drops on reset/configure.
  - [ ] `getEnemyMainRamp()` is defined on all three fixtures and is not `map.getMainBaseRamp()`; it is undefined with no enemy main expansion.
  - [ ] `drawDebug` sends choke cells and region centres through the debug resource.
  - [ ] Perf (ad hoc, not committed): on acropolis, as a median of 10 runs, the full analysis is ≤ 50 ms and cold `getDefensivePosition` for every expansion is ≤ 100 ms in total. The measured medians are recorded in this ticket.
  - [ ] If the defaults fail a fixture property, the failing map and property are reported to the Architect; the assertions are not weakened.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/map-analysis.ts (replace the stub); new resources/map-analysis.test.ts. No perf test file (P6A-A2).
  - Interfaces: design C2.
  - Follow:
    - the parity-2 resource definitions (lazy per-game compute, reset keeps settings);
    - the resources/map.ts accessor style;
    - `map.inPathingGrid`, `map.getSize`, `map.getEnemyMain`, `map.getLocations`, `map.getRamps`, `map.getMainBaseRamp`, `map.getExpansions`, `map.getThirds`, `map.getCenter`;
    - `debug.setDrawCells`;
    - P6A-T02's `analyzeChokes` and `createDistanceField`;
    - ares terrain_manager.py:194 (defensive third).
  - Don't touch: resources/map.ts, systems/map.ts, utils/map/ramp.ts, utils/pathing/*, types.ts, utils/map/chokes.ts and distance-field.ts (owned by P6A-T02; open a follow-up if a bug turns up).
- Stack: core.
- Blocked by: P6A-T01, P6A-T02.
- Slice siblings: P6A-T01, P6A-T02, P6A-T04–T07.

## P6A-T04 Chat debug (design C4)

- Source: design C4; 6a-D17.
- What to build:
  - The chat command parser: ares aliases, case-insensitive; `create|kill <count> <UnitTypeName> [playerId]` with a plural fallback; errors for bad arguments; null for non-commands.
  - The chat debug system:
    - handles only the own player's chat;
    - create at the camera, falling back to the map centre;
    - kill the first `count` of a type, own units or a given player's;
    - the game-state debug commands;
    - a chat reply for errors and for "Can't find any of those".
- API contract: design C4 `ChatCommand`, `parseChatCommand`, `createChatDebugSystem`.
- Acceptance criteria:
  - [ ] Parser table: every alias, mixed case, "marines" resolves to MARINE, count 0 / negative / non-integer gives an error, an unknown unit gives an error, and a non-command gives null.
  - [ ] With `features.chatDebug` on and own chat "create 2 marine", a createUnit debug for 2 marines at the observation camera is sent.
  - [ ] Another player's chat is ignored.
  - [ ] "kill 1 <own type>" sends killUnit with exactly one tag. A type with no units sends the chat reply.
  - [ ] "god" sends the god game-state debug, and each other game-state command maps to its debug primitive.
  - [ ] An unknown unit sends the error as a chat reply.
  - [ ] No unit commands are sent.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: systems/chat-debug.ts (replace the stub); new systems/chat-debug.test.ts.
  - Interfaces: design C4.
  - Follow: ares chat_debug.py:40-215 and consts.py:150-158; the resources/debug.ts primitives (~:349-416); `actions.chatSend`; `frame.getObservation()`; constants/unit-type.ts; createSystem in systems/create-system.ts.
  - Don't touch: systems/frame.ts, resources/debug.ts, engine/create-engine.ts (wiring is from P6A-T01), types.ts.
- Stack: core.
- Blocked by: P6A-T01.
- Slice siblings: P6A-T01–T03, P6A-T05–T07.

## P6A-T05 Enemy race on first sight (design C5)

- Source: design C5; 6a-D18.
- What to build: in the agent's per-step code, before the blueprint's step:
  - While the opponent race is not Terran, Zerg or Protoss, read the race of the first live enemy unit's type.
  - If it is a playable race, set `opponent.race` and write `enemyRaceDetected` once.
  - Remove the TODO at game start.
- API contract: design C5 (`onEnemyRaceDetected` already in types.ts from P6A-T01).
- Acceptance criteria:
  - [ ] Random opponent (NORACE at start), with an enemy zergling in the next observation: `opponent.race` becomes ZERG and an agent system's `onEnemyRaceDetected` is called once with ZERG.
  - [ ] It is not called again on later steps.
  - [ ] An opponent whose race was known at game start never fires it.
  - [ ] No enemy units means no change and no event.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: agent/create-agent.ts (agent onStep; remove the @TODO ~:306); agent/create-agent.test.ts.
  - Interfaces: design C5.
  - Follow: `world.data.getUnitTypeData(...).race` (engine/data-storage.ts ~:31); `units.getAlive(Alliance.ENEMY)`; the `events.write` usage in agent/create-agent.ts.
  - Don't touch: systems/unit.ts (P2 T02), types.ts, agent/macro.ts.
- Stack: core.
- Blocked by: P6A-T01 (event type only; P6A-A5).
- Slice siblings: P6A-T01–T04, P6A-T06, P6A-T07.

## P6A-T06 Workers per gas (design C6)

- Source: design C6; 6a-D19.
- What to build: `distributeWorkers(resourceRatio = 2, { workersPerGas = 3 } = {})`. For gas buildings, surplus is assigned minus `min(ideal, workersPerGas)`. It must be an integer 0–3, otherwise it's a range error. Townhalls are unchanged.
- API contract: design C6 (signature already in types.ts from P6A-T01).
- Acceptance criteria:
  - [ ] A refinery with 3 assigned and workersPerGas 1 sends two of its workers to minerals.
  - [ ] With workersPerGas 0, an idle worker goes to minerals despite a gas deficit and a gas-favouring ratio.
  - [ ] 4, -1 and 1.5 throw a RangeError.
  - [ ] Existing distributeWorkers tests pass unchanged (default behaves as before).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: agent/macro.ts (`distributeWorkers` ~:434 only); agent/macro.test.ts.
  - Interfaces: design C6.
  - Follow: `surplusHarvesters()` in engine/create-unit.ts (~:313), the existing distributeWorkers pool logic, and ares manager_mediator.py:2661 (semantics).
  - Don't touch: `selectBuildWorker` and the rest of macro.ts (P4 T11), types.ts, resources/actions.ts.
- Stack: core.
- Blocked by: P6A-T01, core-arch T04 (macro.ts). Scheduling: never in parallel with P4 T11 (also edits macro.ts), in either order (addendum A6). Phase 4's mining manager uses `mining.configure({ workersPerGas })` with the same semantics.
- Slice siblings: P6A-T01–T05, P6A-T07.

## P6A-T07 Docs + changelog

- Source: docs-plan.md §2 (Phase 6a) as amended by the design's Docs section; design C2–C6.
- What to build:
  - readme.md:
    - a `### mapAnalysis` subsection;
    - a pointer to it from the map section;
    - a "Config file" subsection under Running games, plus env table rows;
    - an `onEnemyRaceDetected` row in the Events table;
    - `opponent.race` under Player data;
    - a chat debug commands table under debug;
    - the `workersPerGas` option under Macro helpers;
    - ares deviations;
    - Known limitations.
  - docs/api.md entries.
  - docs/internals.md updates.
  - The changelog `Unreleased › parity-6a` entry with `Migrating bot/`.
- Acceptance criteria:
  - [ ] readme.md:
    - `### mapAnalysis` under Resources: method table (including `getPerimeter` and `getEnemyMainRamp`), settings with defaults (14 / 2.2 / 150 / 4), `eagerMapAnalysis`, and one example (defensive position at the natural).
    - TOC and the `resources.get()` destructure line list `mapAnalysis`. The map section (~788) gets a one-line pointer to it.
  - [ ] readme.md Running games: a "Config file" subsection after Environment variables (~226) covering:
    - the file name and `SC_BOT_CONFIG`;
    - the JSON shape with defaults, and that extra top-level sections are allowed (A1);
    - precedence: `STEP_COUNT` > inline `createEngine({ config })` > file > defaults;
    - `resources.<name>` → `configure()`, and the feature toggles;
    - that a bot calls a resource's `configure()` from `setup` or `onGameStart`: the config file's section is re-applied after every game reset, so a `configure()` call made once after `createEngine` is overridden from game 2 on;
    - failure modes.

    The env table gains `SC_BOT_CONFIG`, and the `STEP_COUNT` row says it overrides config.
  - [ ] readme.md:
    - Events table: `onEnemyRaceDetected` (random opponents only, once; the blueprint handler sees it next step).
    - Agents › Player data: `opponent.race` filled on first sighting.
    - debug (~887): a chat commands table, own player only, enabled by `features.chatDebug`.
    - Macro helpers (~299): `distributeWorkers(resourceRatio, { workersPerGas })`.
  - [ ] readme.md:
    - "Where this library differs from ares-sc2" adds clearance-watershed chokes instead of map_analyzer (no height split; `choke.ramp`), JSON instead of YAML config, chat debug for the own player only, and workers per gas per call (not persistent).
    - Known limitations adds overlord/scout spots (not implemented).
    - No overlord/scout spot docs.
  - [ ] docs/api.md, in the §3.2 format with defaults:
    - createEngine options `config` and `configFile`;
    - World `config`;
    - `### mapAnalysis` with the Choke / Region / BaseChoke / DefensivePosition / MapAnalysisSettings types;
    - EventConsumer `onEnemyRaceDetected`;
    - Agent `distributeWorkers`;
    - debug chat commands.
  - [ ] docs/internals.md: the Resources list gains `mapAnalysis`; World gains `config`; and the registry applies `config.resources` on register and reset.
  - [ ] docs/changelog.md, under `Unreleased › parity-6a`:
    - Added: mapAnalysis, the config file, chat debug, enemyRaceDetected, workersPerGas.
    - Changed: the config file is read from the cwd if present; random opponents get `opponent.race` mid-game.
    - Migrating bot/: the steps in Further Notes.
  - [ ] Every new example type-checks (scratch file plus tsc, not committed). No mention of removed API remains.
- Implementation plan:
  - Where: packages/core/readme.md, docs/api.md, docs/internals.md, docs/changelog.md.
  - Don't touch: code.
- Stack: core (docs).
- Blocked by: P6A-T01, P6A-T03, P6A-T04, P6A-T05, P6A-T06, and P4 T13 (the previous docs ticket in the docs-plan §3.6 chain).
- Slice siblings: P6A-T01–T06.

## Dependency order

P6A-T02 can start now. P6A-T01 starts after P4 T04. After P6A-T01: P6A-T04, P6A-T05 and P6A-T06 (with core-arch T04 done, and not in parallel with P4 T11), plus P6A-T03 (with T02 done). P6A-T07 goes last, after P4 T13. P5 T01 waits on P6A-T01.
