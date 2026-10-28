# parity-5: behaviors and macro controllers

Source: parity-roadmap.md phase 5 (ares-gap.md ranked #8, #9); user mandate 2026-10-26 "use best judgement to get ares parity" (decisions.md).
Design: .agent-work/parity-5.design.md (technical-architect), decisions P5-D1–P5-D13. Phase-4 contract: .agent-work/parity-4.design.md. Scope: packages/core only.

Status: FINAL (best judgement under user mandate; assumptions listed at the end).

Ticket numbers here are local to this file. "core-arch Tnn", "parity-2 Tnn", "parity-3 Tnn" and "parity-4 Tnn" refer to the matching .agent-work files. Design section → parity-4 ticket: P0 scaffolding = parity-4 T04, P1 placement = T05, P3 buildings = T09, P4 mining = T07/T08, P5 flying = T10.

## Problem Statement

With phases 1–4 the bot has arbitration, threat grids, pathing, a combat sim, roles, squads, intel, placement, a building tracker and mining, but every unit's micro and every macro decision is still hand-coded per bot. ares bots compose ready-made behaviors (stutter, keep safe, path, shoot in range, medivac heal, siege decisions, group moves) and macro controllers (spawn, production, supply, tech, upgrades, expansions, gas) into plans, and run them every step.

## Solution

- **Behavior contract and executor:** a behavior is a named object whose `execute` returns whether it acted. A `behaviors` resource runs one immediately in the caller's commander context, optionally as a role or at a priority. Behaviors order units through a context that allows one action per unit per step per owner; the executor's arbitration then picks one owner per unit.
- **`plan`:** runs behaviors in order, first success wins. It replaces ares' CombatManeuver and MacroPlan.
- **Combat library:** helpers (attack readiness, target pick, duplicate-order check, group cooldown), individual behaviors (attack-move, attack, shoot in range, use ability, stutter forward/back, keep safe, path to target, move to safe target, shoot and move, worker kite back), Terran behaviors (medivac heal, cargo pickup/drop, siege tank decision) and all six ares group behaviors.
- **Macro controllers:** spawn and build workers, build structure, auto supply, expansion, gas, CC upgrades, tech up, upgrade controller and production controller, built on the agent's macro helpers and the phase-4 tracker and placement.
- **Sample bot:** a Terran bio bot built only from controllers and behaviors, with a live smoke against the built-in AI and a perf budget.

Factories are imported from a `@sc-bot/core/behaviors` subpath, not the package root.

## Non-goals

- Behaviors not in P5-D8: ghost snipe, reaper grenade, raven auto-turret, AoE spells, transfuse, queen creep/inject, creep tumors, nydus, restore power, protoss static defence, zerg/protoss morphs.
- ares options without a core counterpart: `smoothing`, `ignored_build_from_tags`, `to_count_per_base`, `good_positioning` (P5-D12).
- Zerg structure placement (phase 4 doesn't support it); Zerg production controller.
- Deferred/after-step behavior execution (P5-D1).
- bot/ changes (additive only; adoption is up to the user).

## User Stories

1. As a bot author, I want to write a behavior as a small object with `execute`, so that micro and macro logic is reusable across systems.
2. As a bot author, I want to run a behavior as a role or at a priority, so that the executor attributes and arbitrates its commands correctly.
3. As a bot author, I want a unit ordered only once per step by the same owner, so that two behaviors in one plan don't fight over a unit.
4. As a bot author, I want queued orders to be allowed alongside, so that I can chain orders deliberately.
5. As a bot author, I want to compose behaviors in a plan where the first that acts wins, so that I can express ares maneuvers and macro plans.
6. As a bot author, I want plans to mix sync combat behaviors and async macro controllers, so that one mechanism covers both.
7. As a bot author, I want to know whether a unit's weapon will be ready by the time it reaches a target, so that stutter-step timing is right.
8. As a bot author, I want to skip an order that duplicates the unit's current one, so that I don't spam SC2 with repeats.
9. As a bot author, I want individual behaviors for attack-move, attack, shoot the weakest target in range, use an ability, stutter forward and back, so that basic micro needs no custom code.
10. As a bot author, I want units to keep themselves safe and path to targets around danger, so that they use the influence grids without me calling pathing directly.
11. As a bot author, I want workers to kite back when attacked, so that worker harass doesn't kill my economy.
12. As a bot author, I want medivacs to heal the closest hurt bio unit while staying safe, so that bio sustains in fights.
13. As a bot author, I want dropships to pick up, carry, unload and keep safe, with cargo switched to a role, so that drops are one behavior.
14. As a bot author, I want siege tanks to siege and unsiege by ares' rules, so that tanks are useful without per-step logic.
15. As a bot author, I want group versions of attack-move, keep safe, path to target, stutter back/forward and use ability, so that a squad acts as one with one command.
16. As a bot author, I want a spawn controller that trains toward a target army composition by priority, so that production follows my plan.
17. As a bot author, I want an invalid composition rejected when I create the controller, so that I find the mistake immediately.
18. As a bot author, I want worker production up to a target count, so that saturation is automatic.
19. As a bot author, I want to build a structure with on-route and count limits through the building tracker, so that I don't double-build.
20. As a bot author, I want supply built automatically by ares' thresholds, so that I'm never supply blocked.
21. As a bot author, I want expansions taken at the next safe, free location, so that expanding is one controller.
22. As a bot author, I want gas buildings up to a count, so that gas timing is declarative.
23. As a bot author, I want command centres upgraded to orbitals or planetaries, so that the morph doesn't need custom code.
24. As a bot author, I want to tech up to a unit or upgrade, building the missing structures and addons, so that tech paths are resolved for me.
25. As a bot author, I want an upgrade controller that researches a list in order and techs up as needed, so that upgrades never stall.
26. As a bot author, I want a production controller that adds production by income, bank and composition, so that I scale production without tuning.
27. As a bot author, I want a sample bot that macros and fights with only controllers and behaviors, so that I have a working reference.
28. As a bot author, I want behaviors cheap enough to run per unit per step for a 50-unit army, so that step time stays within budget.

## Implementation Decisions

From the Architect (full contract in parity-5.design.md, decisions P5-D1–P5-D13):

- `behaviors.run` executes immediately in the caller's commander context; a role wraps it in the role's commander, a priority in an explicit override (P5-D1).
- The behavior context's order allows one non-queued action per unit per game loop per owner; other owners are left to the arbiter (P5-D2). It's state on the resource, reset lazily per game loop.
- One `plan` with first-success semantics replaces CombatManeuver and MacroPlan (P5-D3).
- Behaviors are factory functions returning plain objects, with ares option names in camelCase (P5-D4). `execute` may be sync or async (P5-D5).
- Behavior factories live under a `./behaviors` package subpath, not the root (P5-D6). The `behaviors` resource is registered as a core resource.
- Macro controllers reuse the agent's macro helpers (spend deducted at proposal) and the phase-4 building tracker, placement and flying plans (P5-D7). Structure counting includes tracked builds and untracked in-progress structures, as agreed with technical-architect-2.
- The ported set is Terran-first (P5-D8). Attack readiness uses the unit's fixed `distanceToWeaponReady` (P5-D9 as amended: the speed-units fix is parity-3 T08). The siege-tank decision filters flyers by the enemy's own flying state, fixing ares (P5-D10). The spawn controller validates the composition at creation (P5-D11).
- Exit evidence: a sample bot, a live smoke against the built-in AI (skipped without SC2), a fixture test per behavior, and a perf budget of ≤ 10 ms median for 50 marines' plans plus the influence build (P5-D13).

## Testing Decisions

- **Executor and plan:** resource seam on a fixture world; assert proposals through the flush and the fake client's sent actions, and ownership through command results.
- **Behaviors and controllers:** each behavior's true and false branches on fixture worlds, asserting the commands sent. Danger is made with influence's per-step cost. Phase-4 resources are stubbed where the placement solver isn't needed.
- **Sample bot:** live seam only (real SC2 vs Easy AI), skipped without SC2, like the existing live tests.
- **Perf:** measured ad hoc on the blueshift fixture and recorded in the ticket; no committed wall-clock test.
- **Prior art:** resources/command-executor.test.ts, agent/macro.test.ts, engine/create-engine.live.test.ts, parity-2 pathing tests, parity-4 tracker tests.

## Out of Scope

See Non-goals.

## Further Notes

Migration notes for the user's bot/ (no tickets):
- Additive only; nothing breaks.
- Optional adoption: replace per-unit micro in the bot's combat systems with behaviors run under `role: 'ATTACKING'`; replace hand-rolled supply/production with a macro plan; enable mining (`mining.configure({ enabled: true })`) so controllers get builders through the tracker.
- Import factories from `@sc-bot/core/behaviors`.

Assumptions (BA, best judgement):
- PA1 Scaffolding chain. T01 edits types.ts and create-world.ts like every phase's scaffolding, so it joins the chain after the parity-6a scaffolding ticket: parity-2 T01 → parity-3 T02 → parity-4 T04 → parity-6a scaffolding → parity-5 T01. The design only names parity-4 T04; without the 6a edge, T01 and 6a scaffolding could run in parallel on the same files. `behaviors` is registered last in CORE_RESOURCES (after `flying` and any 6a resources). It has no step hook, so its position doesn't matter at runtime.
- PA2 behaviors/index.ts: each ticket appends its own export lines (the design's default), rather than T01 pre-writing stubs. Conflicts are one-line and trivial.
- PA3 The live smoke's "every unit command came from a behavior or controller owner" also accepts core resource owners that issue their own commands (mining, buildings, flying). Those are core-owned by design in phase 4, and the bot doesn't hand-code them. Confirmed by technical-architect: accepted owners are `role:*`, behavior/controller callers, and `flying` (mining and buildings run as `role:GATHERING` / `role:BUILDING`). PA1 also confirmed.
- PA4 T02 (helpers + individual behaviors) is one ticket, as designed. If it's too big for one context, the PM can split helpers from behaviors along the file boundary with no API change.
- PA5 The PF morph ability is `MORPH_PLANETARYFORTRESS` (1450), checked in constants/ability.ts.

---

# Tickets

## T01 Behavior contract, executor and plan (design B0)

- Source: design B0; P5-D1–D6.
- What to build: the behavior types; the `behaviors` resource with `run` (role/priority wrappers) and the ordering context with per-owner, per-loop dedupe; `plan`; the `./behaviors` package subpath and its index.
- API contract: design B0 `BehaviorContext`, `Behavior`, `BehaviorsResource`, `ArmyComposition`, `plan`.
- Acceptance criteria:
  - [ ] `plan` returns true at the first behavior that returns true and doesn't run the rest; it handles sync, async and mixed behaviors.
  - [ ] `ctx.order` drops the same owner's second non-queued order for a tag within one loop (returns false when no tags remain), allows `queue: true`, and allows the order again the next loop.
  - [ ] A Unit target produces a target-unit command, a point produces a world-position command.
  - [ ] Two systems at different priorities ordering one unit: one `won`, one `dropped` in `commandResults`.
  - [ ] `run(b, { role: ATTACKING })` produces owner `role:ATTACKING`; `run(b, { priority })` overrides priority only; `run` returns the behavior's result.
  - [ ] `behaviors` resolves from `resources.get()`; reset clears the dedupe state.
  - [ ] `import { plan } from '@sc-bot/core/behaviors'` resolves (package.json exports).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where:
    - types.ts: `BehaviorContext`, `Behavior`, `BehaviorsResource`, `ArmyComposition`, container key `behaviors`.
    - engine/create-world.ts: register `behaviors` last in CORE_RESOURCES (PA1).
    - package.json: `"./behaviors": "./behaviors/index.ts"` in exports.
    - New resources/behaviors.ts (+ resources/behaviors.test.ts).
    - New behaviors/plan.ts, behaviors/index.ts.
  - Interfaces: design B0.
  - Follow: resources/command-context.ts (`currentCommander`), `actions.as` (actions.ts ~624), `roles.as` (parity-3 T03), `actions.queueAction`; parity-2/3 resource definition pattern.
  - Don't touch: actions.ts, command-arbiter.ts, agent/macro.ts, phase-2/3/4 resource files.
- Stack: core.
- Blocked by: parity-4 T04, parity-6a scaffolding ticket (PA1), parity-3 T03 (roles.as).
- Slice siblings: T02–T10.

## T02 Combat helpers + individual behaviors (design B1)

- Source: design B1; P5-D8, D9, D12.
- What to build: helpers (`attackReady`, `inAttackRange`, `pickEnemyTarget`, `duplicateOrSimilarOrder`, `groupWeaponsOnCooldown`, `center`, `towards`) and individual behaviors (`aMove`, `attackTarget`, `shootTargetInRange`, `useAbility`, `stutterUnitForward`, `stutterUnitBack`, `keepUnitSafe`, `pathUnitToTarget`, `moveToSafeTarget`, `shootAndMoveToTarget`, `workerKiteBack`), exported from the behaviors index.
- API contract: design B1 (options and defaults as listed).
- Acceptance criteria:
  - [ ] Every behavior has a fixture test for its true branch and its false branch, asserting the sent commands.
  - [ ] `attackReady` compares `unit.distanceToWeaponReady()` against the gap to range (≥ gap → ready), with no speed math of its own: true when ready; true when cooling but far enough that walking into range takes at least the cooldown; false when cooling and close; false when the unit can't hit the target.
  - [ ] `duplicateOrSimilarOrder` matches a specific ability against its general id, and a same-tag or same-rounded-point target.
  - [ ] `shootTargetInRange` ignores cloaked undetected targets, returns true without an order when already shooting an in-range target with weapon ready, and attacks the lowest health+shield target otherwise.
  - [ ] Path/safety behaviors default the layer by the unit's flying state and avoid danger added with influence's per-step cost; `keepUnitSafe` returns false when already safe.
  - [ ] `workerKiteBack` ignores larva, eggs, creep tumors and changelings.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new behaviors/combat/helpers.ts, behaviors/combat/individual.ts (+ tests); behaviors/index.ts (append exports).
  - Interfaces: design B1.
  - Follow: ares behaviors/combat/individual/*.py, combat_group_behavior.py; unit helpers `targetInRange`, `abilityAvailable`, `realSpeed` in engine/create-unit.ts; parity-2 pathing/spatial/influence APIs.
  - Don't touch: create-unit.ts, types.ts, resources/*.
- Stack: core.
- Blocked by: T01, parity-2 T03 (spatial), parity-2 T08 (pathing), parity-3 T08 (distanceToWeaponReady fix).
- Slice siblings: T01, T03–T10.

## T03 Terran individual behaviors (design B2)

- Source: design B2; P5-D10.
- What to build: `medivacHeal`, `pickUpCargo`, `dropCargo`, `pickUpAndDropCargo`, `siegeTankDecision`, exported from the behaviors index.
- API contract: design B2.
- Acceptance criteria:
  - [ ] `medivacHeal` returns false for a non-medivac, keeps safe first, returns true when already healing, heals the closest hurt biological ally and ignores a hurt SCV.
  - [ ] `pickUpCargo` uses pickup range 5; SMARTs the closest target in range, moves via pathing otherwise; with no targets assigns `switchCargoToRole` to passengers and returns false.
  - [ ] `dropCargo` returns false when empty or on an unpathable cell; otherwise unloads at its own position.
  - [ ] `pickUpAndDropCargo` follows the design's plan order.
  - [ ] `siegeTankDecision`: one test per siege and unsiege rule in design B2; flying enemies are ignored by their own flying state; returns true while sieged.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new behaviors/combat/terran.ts (+ test); behaviors/index.ts (append exports).
  - Interfaces: design B2.
  - Follow: ares medivac_heal.py, pick_up_cargo.py, drop_cargo.py, siege_tank_decision.py, dicts/pickup_range.py; T02 helpers and behaviors.
  - Don't touch: individual.ts, helpers.ts, resources/*.
- Stack: core.
- Blocked by: T02, parity-3 T03 (roles).
- Slice siblings: T01, T02, T04–T10.

## T04 Group behaviors (design B3)

- Source: design B3.
- What to build: `aMoveGroup`, `keepGroupSafe`, `pathGroupToTarget`, `stutterGroupBack`, `stutterGroupForward`, `groupUseAbility`, exported from the behaviors index.
- API contract: design B3.
- Acceptance criteria:
  - [ ] Each group behavior issues one multi-tag command for the group, and suppresses a duplicate/similar order.
  - [ ] `stutterGroupBack` retreats away from the target (best of 8 directions, clamped to the map and finite on the grid), does nothing while cooling and all safe, and attacks the target position otherwise.
  - [ ] `stutterGroupForward` attacks the enemy centre when all are in range, moves to it while cooling, attacks it otherwise.
  - [ ] `groupUseAbility` honours `syncCommand` (all vs any unit has the ability).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new behaviors/combat/group.ts (+ test); behaviors/index.ts (append exports).
  - Interfaces: design B3.
  - Follow: ares behaviors/combat/group/*.py; T02 helpers.
  - Don't touch: individual.ts, helpers.ts, resources/*.
- Stack: core.
- Blocked by: T02.
- Slice siblings: T01–T03, T05–T10.

## T05 Macro helpers + spawn controller (design B4)

- Source: design B4; P5-D7, D11.
- What to build: `ownUnitCount`, `structurePending`, `spawnController`, `buildWorkers`, exported from the behaviors index.
- API contract: design B4.
- Acceptance criteria:
  - [ ] `structurePending` counts tracked builds plus untracked in-progress structures of the type, never double-counting a tracked build's structure.
  - [ ] With two types, spawn steers toward the target proportions and follows priority order.
  - [ ] Unaffordable top priority stops lower priorities when not freeflow, and doesn't in freeflow.
  - [ ] A reactor barracks trains 2.
  - [ ] Creating the controller with proportions not summing to 1 (±1e-6) or a priority outside integer 0–10 throws `NodeSC2Error` (unless freeflow).
  - [ ] Over-produce on low tech tops up to `maximum` when only one type is tech-ready.
  - [ ] `buildWorkers` stops at `toCount`.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new behaviors/macro/helpers.ts, behaviors/macro/spawn.ts (+ tests); behaviors/index.ts (append exports).
  - Interfaces: design B4.
  - Follow: ares spawn_controller.py, build_workers.py; agent/macro.ts (`train`, `alreadyPending`, `canAffordN`, `techRequirementProgress`); constants/dicts/trained-from.ts; parity-4 `buildings.pending`/`getTracked`.
  - Don't touch: agent/macro.ts, resources/*.
- Stack: core.
- Blocked by: T01, parity-4 T09 (buildings).
- Slice siblings: T01–T04, T06–T10.

## T06 Structure controllers (design B5)

- Source: design B5; P5-D7, D12.
- What to build: `buildStructure`, `autoSupply`, `expansionController`, `gasBuildingController`, `upgradeCCs`, exported from the behaviors index.
- API contract: design B5; parity-4 `BuildingTracker`, `PlacementResource`, `PlacementFlag`.
- Acceptance criteria:
  - [ ] `buildStructure` returns false at `maxOnRoute` moving/ordered builds, at `toCount` (ready + pending), and below `techProgressCheck`; otherwise requests through the building tracker with the placement options.
  - [ ] `autoSupply` follows ares' required-supply table for 0 / 1 / 3 production structures and with pending supply; Terran uses the `supplyDepot` flag.
  - [ ] `expansionController` skips an occupied or unsafe expansion and respects `toCount`, `maxPending` and affordability.
  - [ ] `gasBuildingController` counts pending gas builds and stops at `toCount` / `maxPending` / under 35 minerals.
  - [ ] `upgradeCCs` proposes the orbital (or planetary) morph on the first ready idle CC; with `prioritize` and unaffordable it returns true without a command.
  - [ ] Zerg structure requests return false (no Zerg placement).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new behaviors/macro/structures.ts (+ test); behaviors/index.ts (append exports).
  - Interfaces: design B5.
  - Follow: ares build_structure.py, auto_supply.py, expansion_controller.py, gas_building_controller.py, upgrade_ccs.py; T05 helpers; `MORPH_ORBITALCOMMAND` (1516) and `MORPH_PLANETARYFORTRESS` (1450) in constants/ability.ts.
  - Don't touch: phase-4 resource files, resources/*.
- Stack: core.
- Blocked by: T05, parity-4 T05 (placement), parity-4 T09 (buildings).
- Slice siblings: T01–T05, T07–T10.

## T07 Tech controllers (design B6)

- Source: design B6.
- What to build: `techUp` and `upgradeController`, exported from the behaviors index.
- API contract: design B6.
- Acceptance criteria:
  - [ ] `techUp` for MARAUDER builds a barracks techlab on an idle addon-less barracks (via `agent.train`, or `ctx.order` with the build-techlab ability if the creation ability doesn't map; the test decides).
  - [ ] `techUp` for an upgrade whose research structure is missing builds it through `buildStructure`.
  - [ ] `upgradeController` researches stim when it can, techs to an armory for +2 weapons, and with `prioritize` bank-holds (returns true) when it can't afford.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new behaviors/macro/tech.ts (+ test); behaviors/index.ts (append exports).
  - Interfaces: design B6.
  - Follow: ares tech_up.py, upgrade_controller.py; constants/dicts researched-from.ts, research-requirements.ts, tech-requirement.ts, trained-from.ts; `agent.research`, `alreadyPendingUpgrade`.
  - Don't touch: agent/macro.ts, structures.ts.
- Stack: core.
- Blocked by: T06.
- Slice siblings: T01–T06, T08–T10.

## T08 Production controller (design B7)

- Source: design B7.
- What to build: `productionController` (Terran; Protoss without restore power; Zerg returns false), exported from the behaviors index.
- API contract: design B7.
- Acceptance criteria:
  - [ ] Adds a barracks when income supports it and none is idle; doesn't when an idle barracks exists.
  - [ ] The bank rule adds production at `addProductionAtBank`.
  - [ ] A flying production structure within 19 of the base blocks adding one.
  - [ ] The income cap, max-structures cap and tech-progress skip each have a test.
  - [ ] Zerg returns false.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new behaviors/macro/production.ts (+ test); behaviors/index.ts (append exports).
  - Interfaces: design B7.
  - Follow: ares production_controller.py; T06 `buildStructure`, T07 `techUp`; `frame.getScore().scoreDetails`; parity-4 `flying.getPlans()`.
  - Don't touch: structures.ts, tech.ts.
- Stack: core.
- Blocked by: T07, parity-4 T10 (flying).
- Slice siblings: T01–T07, T09, T10.

## T09 Sample bot, live smoke and perf (design B8)

- Source: design B8; P5-D13; roadmap phase 5 exit.
- What to build: a Terran bio sample bot built only from controllers and behaviors (macro plan + army system as in design B8), a live smoke against Easy AI, and an ad hoc perf measurement.
- Acceptance criteria:
  - [ ] The sample bot runs from `examples/` with the same env conventions as the other examples, and contains no hand-coded per-unit logic.
  - [ ] Live smoke (skipped without `SC2PATH`): after 8 game minutes vs Easy AI, supply ≥ 60, ≥ 2 townhalls, ≥ 1 upgrade done, and every unit command in `commandResults` came from an accepted owner (PA3): a `role:*` owner, a behavior/controller caller, or a core resource owner (`flying`; mining and buildings run as `role:GATHERING` / `role:BUILDING`).
  - [ ] Perf: on blueshift with 50 marines and 20 enemies, influence build + `plan(shootTargetInRange, stutterUnitBack, pathUnitToTarget)` per marine has a median ≤ 10 ms over 20 runs. Measured ad hoc (no committed wall-clock test; decisions.md "P3-T01 combat sim"); the measured median is recorded in the ticket.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new examples/behaviors-bot.ts, engine/behaviors.live.test.ts (no committed perf test).
  - Follow: examples/ramp-wall.ts (example conventions), engine/create-engine.live.test.ts (skip without SC2).
  - Don't touch: library code; a missing API is reported to the PM, not patched here.
- Stack: core.
- Blocked by: T03, T04, T08, parity-3 T01 (sim), parity-3 T04 (squads), parity-3 T06 (intel), parity-4 T07, parity-4 T08 (mining).
- Slice siblings: T01–T08, T10.

## T10 Docs + changelog (design B9)

- Source: design B9; .agent-work/docs-plan.md §2 "Phase 5" and §3.
- What to build: the readme "Behaviors and controllers" section, API docs, design/internals notes, ares deviations, known limitations, and the `Unreleased › Phase 5` changelog entry.
- Acceptance criteria:
  - [ ] readme top-level "Behaviors and controllers" after Systems (with TOC line): the `behaviors` resource and `run`, `plan`, one action per unit per step per owner plus arbitration, roles via `run({ role })`, a table of every behavior and controller with options and defaults, one combat and one macro example; imports from `@sc-bot/core/behaviors`.
  - [ ] readme Macro helpers points to the controllers; Examples lists behaviors-bot.ts; TOC and `resources.get()` destructure line list `behaviors`.
  - [ ] "Where this library differs from ares-sc2" lists every deviation in design B9; Known limitations lists the not-ported behaviors.
  - [ ] docs/api.md: `## Behaviors` (contract, executor, every combat factory), `## Controllers` (every macro factory, ArmyComposition), `### behaviors` under Resources, in the docs-plan §3.2 format.
  - [ ] docs/design.md: one paragraph on behaviors vs systems vs the executor. docs/internals.md Resources list has `behaviors`.
  - [ ] docs/changelog.md `Unreleased › Phase 5: behaviors and macro controllers` with Added and `Migrating bot/` (see Further Notes).
  - [ ] Every new example type-checks.
- Implementation plan:
  - Where: packages/core/readme.md, docs/api.md, docs/design.md, docs/internals.md, docs/changelog.md.
  - Follow: docs-plan.md §3; earlier phases' docs sections.
  - Don't touch: code.
- Stack: core (docs).
- Blocked by: T01–T09, parity-6a docs ticket (docs chain, docs-plan §3.6).
- Slice siblings: T01–T09.
