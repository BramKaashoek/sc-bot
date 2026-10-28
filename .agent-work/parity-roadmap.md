# ares parity roadmap (packages/core)

Source: user, 2026-10-26: "go. and keep going, no need to ask for every step. use best judgement to get ares parity"; "no PRs btw, straight to main" (decisions.md). Gap baseline: ares-gap.md (item numbers below = its "Ranked" table).
Phase 1 = core-arch (resource registry + step-end command executor, .agent-work/core-arch.md).

Order follows ares-gap's dependency graph (4 → 7; 1 → 6, 8; 3 → 8, 10; 5 → 6, 9, 10, 12) and the bot being Terran bio.

## Phase 1: core-arch (in flight)
- Goal: an open resource registry, and one per-step command arbitration point.
- Exit: core-arch.md T01–T05 done; lint/tsc/test green.

## Phase 2: enemy memory, spatial queries, influence grids, pathing (#4, #1)
- Goal: a per-step picture of where the enemy is (including remembered units that expire), fast range queries, and ground/air cost grids built from enemy units, static defense and effects. Cost-aware pathing and safety queries on top: safe spot, is-position-safe, next path point.
- Why first: the foundation for combat sim inputs, intel, mining safety and every combat behavior.
- Exit:
  - Enemy memory expires after a configurable age. Remembered snapshot structures are kept apart from moved units, and there is a memory accessor.
  - Units-in-range / any-enemy-in-range queries are faster than O(n) scans, and their results match the brute-force scans on fixtures.
  - Army value (own, enemy, ready) is available.
  - Grids are rebuilt each step from a registered resource, without reallocating the buffers.
  - A weighted pathfinder that does not clone the graph per call is used; path, next point, safe spot and is-safe are all exposed.
  - Fixture tests cover tank/static-D/effect avoidance.
  - Pathing for ~50 units per step stays within a stated step-time budget, measured with the frame step timer.

## Phase 3: combat sim, roles and squads, intel (#2, #3, #7)
- Goal: decide fights (can-win prediction from own vs enemy units, built on per-pair DPS). Group the army: a role API over labels with a default role for new units, plus squads clustered from role units, a main squad and squad centres. Detect threats near own bases, and rushes/strategies.
- Depends on: phase 2 (memory, army value, spatial). Roles also use phase 1's commander override, so a role can own its units' commands.
- Exit:
  - The combat sim's predicted winner matches on a set of scripted engagement fixtures.
  - Role assign/clear/switch/query works in batches, and new units get a default role.
  - Squads are re-clustered each step, and squad identity stays stable when membership changes slightly.
  - Threat-near-base and rush flags (worker, ling, marine/marauder, roach/ravager, 4gate, proxy, greedy expand) are exposed as resource state with fixture tests.

## Phase 4: placement solver and building tracker, mining manager, flying structures (#5, #6, #12)
- Goal: precomputed per-base building formations (2x2/3x3 with addon space, pylon power), reserve/release, and a per-map user placement hook on the existing placer. Construction tracking reissues orders, times out, and cancels low-HP buildings. Mining: patch assignment bookkeeping, speed mining, builder handoff, worker safety (using phase 2 grids), workers per gas. Terran flying structures and addon swaps run as a state machine with no fixed delays.
- Depends on: phase 2 (worker safety), phase 1 (executor arbitration between the mining owner and the builder).
- Exit:
  - Placements are found without placement queries in the common case.
  - Reserved spots are never double-used.
  - A rejected or stuck build is reissued or released.
  - Speed mining gives measurable income over SC2 auto-mining in a live smoke run.
  - Builders return to mining after the build.
  - Addon swaps complete without timing sleeps.

## Phase 5: behavior library and macro controllers (#8, #9)
- Goal: a behavior executor (register per-step behaviors, one per unit per step) on top of phase 1 arbitration. Composite plans (ordered behaviors, first success wins). Individual and group micro for Terran bio first: stutter forward/back, keep safe, path to target, shoot in range, medivac heal/pickup/drop, siege tank. Macro controllers: spawn (composition + priority), production, auto supply, tech-up resolver, worker/expansion/gas/upgrade controllers.
- Depends on: phases 2–4.
- Exit:
  - Each behavior has a fixture or live test.
  - A sample bot built only from controllers and behaviors macros and fights without hand-coded per-unit logic.

## Phase 6: build runner upgrades, chokes, small items (#10, #11, #13, rest)
- Goal: a string build-order format with named targets (ramp, nat, nat wall, third, enemy nat proxy, map centre), special steps (worker scout, chrono, gas steal, orbital, cancel gas) and opening switch. A general choke/region finder and a defensive third. Smaller items: enemy race on first sighting, chat debug commands, a config file (step size per bot, feature toggles), and overlord/scout spots.
- Depends on: phases 3–4.
- Exit:
  - Openings are written as strings and run on fixtures/live.
  - Chokes are found on all fixture maps.
  - Every small item has a test.

## Documentation (all phases)
Source: user, 2026-10-26: "dont forget to plan the updating of the documentation". Plan: docs-plan.md.
- Every phase's ticket file ends with one "Docs + changelog" ticket from the docs-plan §4 template, covering that phase's rows in docs-plan §2.
- It is blocked by the phase's public-API tickets and by the previous docs ticket in the docs-plan §3.6 chain (core-arch T05 → parity-2 T09 → parity-3 → parity-4 → parity-6a → parity-5 → parity-6b).
- Added exit criterion for phases 3, 4, 5, 6a, 6b: readme.md, docs/api.md and the `Unreleased` changelog entry (with `Migrating bot/`) document every public API the phase adds or changes.

## Excluded
- #14 zerg creep spread, nydus, adept shade tracking: the user's bot is Terran, and they're large. Revisit after phase 6. Creep reading already exists.

## Assumptions (BA, best judgement)
- A1 Each phase runs the same BA → Architect design → tickets loop, and ships straight to main per the user.
- A2 Bot-side adoption is a migration note per phase. The user writes bot/.
- A3 Within a phase, perf exit criteria use the frame step-time recorder; exact budgets are set in each phase design.
- A4 Executor/roles coupling: roles in phase 3 use the phase 1 `as()` commander override rather than a new ownership mechanism. The role-ownership filter in arbitration is a phase 3 option, not phase 1.
