# parity-3: combat sim, roles, squads, intel

Source: parity-roadmap.md phase 3 (ares-gap.md ranked #2, #3, #7); user mandate 2026-10-26 "use best judgement to get ares parity" (decisions.md).
Design: .agent-work/parity-3.design.md (technical-architect), decisions P3-D1–P3-D14. Scope: packages/core only.

Status: FINAL (best judgement under user mandate; assumptions listed at the end).

Ticket numbers here are local to this file. "core-arch Tnn" and "parity-2 Tnn" refer to .agent-work/core-arch.md and .agent-work/parity-2.md.

## Problem Statement

Core can't tell the bot whether a fight is winnable, has no way to group the army into roles or squads, and knows nothing about what the enemy is doing near our bases or which opening it chose. ares bots get all three from managers (combat sim, unit roles, squads, enemy-to-base and intel), and every ares combat or macro decision reads them.

## Solution

- **Combat sim:** two pure functions. One simulates a fight between two unit lists and returns HP left on both sides; the other buckets that into ares' 0–10 engagement result scale. Built on the existing per-pair DPS, so upgrades, armor and shields carry over.
- **Roles:** a resource that maps own units to ares unit roles, separate from labels. New units get a configurable default role once (workers gather). A role can issue commands under its own commander, and opt-in exclusive roles make the executor drop other owners' commands for their units.
- **Squads:** a lazy resource that clusters a role's units into squads each loop, with stable ids, a main squad and its position.
- **Intel:** a resource that tracks enemies near each own base (with ares' enter/leave hysteresis) and sticky strategy flags (rushes, proxies, expansions, greedy, rushed), each firing an event the first time it's detected.

## Non-goals

- Splash, healing, spells, terrain/chokes, bunker passengers and micro in the combat sim; no `goodPositioning` (P3-D3).
- Roles as labels (P3-D5).
- Filtering the raw immediate command path by role ownership (Q5).
- Enemy race detection (phase 6a); rules gate on unit types (P3-D11).
- Behaviors using squads/roles (phase 5).
- bot/ changes (additive only; adoption is up to the user).

## User Stories

1. As a bot author, I want to know whether my units can win a fight against a set of enemies, so that I engage only good fights.
2. As a bot author, I want the result on ares' engagement scale, so that ares thresholds and logic port directly.
3. As a bot author, I want the sim to account for upgrades, armor, shields and air/ground targeting, so that the prediction matches real fights.
4. As a bot author, I want an option where units only start shooting once they could reach a target, so that range and approach time count.
5. As a bot author, I want an option where workers deal no damage, so that worker pulls don't inflate my strength.
6. As a bot author, I want the raw simulation result (HP left, duration), so that I can build my own thresholds.
7. As a bot author, I want the sim cheap enough to call several times per step, so that I can evaluate several fights.
8. As a bot author, I want to assign, clear and switch roles for one unit or a batch, so that I can organise my army.
9. As a bot author, I want to query units by role, optionally filtered by unit type, so that each system gets its own units.
10. As a bot author, I want new workers to start gathering by default and a configurable default for other units, so that new units are never unowned by accident.
11. As a bot author, I want a role I clear to stay cleared, so that the default doesn't override my choice.
12. As a bot author, I want dead units dropped from roles and loaded units kept, so that roles stay correct without cleanup code.
13. As a bot author, I want to issue commands on behalf of a role, so that the executor knows which role owns them.
14. As a bot author, I want to make some roles exclusive, so that no other system can command their units by accident.
15. As a bot author, I want to see in command results when a command was dropped because another role owns the unit, so that I can debug ownership.
16. As a bot author, I want a role's units grouped into squads with stable ids, so that I can give per-squad orders across steps.
17. As a bot author, I want the main squad and its position, so that I can rally or retreat to the army.
18. As a bot author, I want to know which enemies threaten each of my bases, split ground and air, with their supply, so that I can defend the right base.
19. As a bot author, I want the base with the biggest threat, so that defense goes where it matters most.
20. As a bot author, I want sticky flags for worker, ling, roach, ravager, marine, marauder rushes, 4-gate, proxy zealots, proxies, reapers, expansions and greedy openings, so that my build can react.
21. As a bot author, I want an event when a flag is first detected, so that I react once instead of polling.
22. As a bot author, I want a "rushed" flag computed like ares, so that I can switch to a defensive plan.
23. As a bot author, I want role and intel settings to survive between games, so that configuration is done once.
24. As a bot author who doesn't use squads, I want no per-step cost from them, so that my step time is unaffected.

## Implementation Decisions

From the Architect (full contract in parity-3.design.md, decisions P3-D1–P3-D14):

- The combat sim is a pair of pure exported functions, not a resource (P3-D1). It is a deterministic time-stepped focus-fire model on per-type cached DPS, with lowest-HP targeting without overkill and simultaneous damage (P3-D2). HP includes shields on both sides (P3-D14). Results use ares' 0–10 engagement scale and ares' exact buckets (P3-D4).
- Roles, squads and intel are core resources registered after pathing, in that order, so memory forgets first, roles update next and intel reads spatial after.
- Roles live in their own resource and never in labels, so unit-system label handling is unchanged (P3-D5). The default resolver runs once per unit; by default workers except MULEs gather (P3-D6).
- Role commands go through the core-arch commander override with owner `role:<ROLE>`. Exclusive roles are opt-in: the arbiter drops other owners' proposals for their units, with a new "not-owner" reason. The raw immediate path isn't filtered (P3-D7).
- Squads are clustered lazily once per loop per role and type filter. A merge goes smaller into larger, ids are deterministic counters, and the main squad is the largest, oldest on ties (P3-D8, P3-D9).
- Intel updates each step: base threats with ares' hysteresis, and sticky flags ported from ares with plain distances. Rules gate on unit types (P3-D10, P3-D11). Greedy uses our own start-time thresholds (P3-D12). A strategy-detected event fires once per flag in the same step (P3-D13).
- Settings for roles and intel survive game resets; per-game state is cleared (parity-2 D10).

## Testing Decisions

All seams are offline, using the core test harness (fixture world builder, stepping to synthetic observations, fake client).

- **Combat sim:** pure seam with units from the fixture world builder and raw unit factories (real weapon data). Scripted engagement fixtures with expected outcomes. Perf is measured ad hoc, not as a committed test.
- **Roles, squads:** resource seam on a fixture world, stepping to synthetic observations for new/dead/loaded units.
- **Exclusive arbitration:** arbiter seam (pure) plus the executor seam through command results.
- **Intel:** dispatch seam with synthetic observations: one positive and one negative fixture per flag, threat enter/leave, event once. Perf is measured ad hoc.
- **Prior art:** resources/command-arbiter.test.ts, resources/command-executor.test.ts, parity-2's memory tests, engine/create-world.test.ts.

## Out of Scope

See Non-goals.

## Further Notes

Migration notes for the user's bot/ (no tickets):
- Additive except one fix: `unit.distanceToWeaponReady()` now returns 1.4× the old value (T08); no bot/ caller. `CommandResult.reason` gains `'not-owner'`; exhaustive switches over it need a new case.
- Optional adoption: `roles.configure({ defaultRole })` to put army units into ATTACKING; wrap a system's commands in `roles.as(role, ...)`; make roles exclusive once all owners use `roles.as`; replace hand-rolled engage checks with `canWinFight`; read intel flags or handle `onEnemyStrategyDetected`.

Assumptions (BA, best judgement):
- PA1 Where types live. T01 (combat sim, design Q2) is new files only and can't wait for scaffolding, so it defines `FightOptions`, `FightSimulation` and the `EngagementResult` type in its own files. T02 (scaffolding, design Q1) re-exports them from types.ts and index.ts instead of redefining them, so there is one definition. Design Q1 lists them under types.ts; this keeps that public surface without a duplicate.
- PA2 T02 (scaffolding) also adds the `mayCommand` member and `RoleSettings.exclusive` to the types, so T05 (exclusive arbitration) touches no types.ts.
- PA3 T05 runs after T03 (roles) and must not run in parallel with any phase-4 ticket that edits actions.ts. The PM sequences that across files.
- PA4 Phase-4 and 6a scaffolding tickets (which edit types.ts, create-world.ts, constants/index.ts, index.ts) are chained after T02 here (design "Order / file ownership"). That edge lives in their files.

---

# Tickets

## T01 Combat sim (design Q2)

- Source: design Q2; P3-D1–D4, D14.
- What to build: the engagement result constants (0–10 scale) and the pure combat sim: `simulateFight` and `canWinFight` with timing-adjust, workers-do-no-damage and max-seconds options.
- API contract: design Q2 `FightOptions`, `FightSimulation`, `simulateFight`, `canWinFight`; constants/engagement-result.ts.
- Acceptance criteria:
  - [ ] 10 marines vs 4 zerglings ≥ VICTORY_DECISIVE.
  - [ ] 4 marines vs 8 zerglings at range 0 is a loss.
  - [ ] 1 marine vs 1 marine and identical 8v8 mixed armies are TIE.
  - [ ] 5 fighter-mode vikings vs 5 marines is LOSS_EMPHATIC.
  - [ ] 1 sieged tank vs 1 zealot at distance 12 wins with timingAdjust and does worse without it (4 zealots can't be held without splash, P3-D3; decisions.md "P3-T01 combat sim").
  - [ ] 20 SCVs vs 1 mutalisk with workersDoNoDamage is a loss.
  - [ ] +1 attack flips a mirror 8v8 marine fight to a win.
  - [ ] Empty enemy → VICTORY_EMPHATIC; empty own → LOSS_EMPHATIC; both empty → TIE.
  - [ ] HP counts health + shields on both sides; buckets match design Q2 step 6 exactly (boundary tests at .9/.75/.6/.4/.2 on both sides, including the ≥ vs > differences).
  - [ ] Timeout/stalemate: higher remaining-HP fraction wins; equal is TIE.
  - [ ] No allocation per tick (arrays sized once per call).
  - [x] Perf: 60 marines vs 60 zerglings, median of 20 runs ≤ 3 ms. Measured ad hoc (no committed wall-clock test; decisions.md "P3-T01 combat sim"): median 0.42 ms.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where:
    - New constants/engagement-result.ts: `VICTORY_EMPHATIC = 10` … `LOSS_EMPHATIC = 0` (ares consts.py:265), plus the `EngagementResult` value-union type.
    - New utils/combat/combat-sim.ts: `FightOptions`, `FightSimulation`, `simulateFight`, `canWinFight`.
    - New utils/combat/combat-sim.test.ts using `createTestWorld` + `rawUnit`.
  - Interfaces: design Q2.
  - Follow: ares managers/combat_sim_manager.py:100-170 (buckets only); `calculateDpsVsTarget` / `calculateDamageVsTarget` in engine/create-unit.ts:415-566; `realSpeed()`.
  - Don't touch: create-unit.ts, types.ts, index.ts, constants/index.ts (T02 re-exports).
- Stack: core.
- Blocked by: None.
- Slice siblings: T02–T07.

## T02 Phase-3 scaffolding (design Q1)

- Source: design Q1.
- What to build:
  - The unit role constants (all 56 ares names) and the `UnitRole` type.
  - The roles, squads and intel resource types in the container, and every phase-3 interface (RolesResource, RoleSettings incl. `exclusive`, Squad, SquadsResource, IntelResource, IntelSettings, IntelFlag, BaseThreat).
  - `'not-owner'` added to `CommandResult.reason`.
  - Re-exports of T01's types and functions (PA1).
  - Roles, squads and intel registered as core resources after pathing, as stubs that throw "not implemented".
- API contract: design Q1, plus the Q3, Q4, Q6 interfaces (types only).
- Acceptance criteria:
  - [ ] `roles`, `squads` and `intel` resolve from `resources.get()` after world creation (no registration-order assertion; decisions.md "scaffolding tickets: no registration-order tests"); their methods throw a core "not implemented" error.
  - [ ] `UnitRole` and `EngagementResult` are importable from the constants entry; `canWinFight`, `simulateFight`, `FightOptions`, `FightSimulation` from the package root; no duplicate definitions of T01's types.
  - [ ] `CommandResult.reason` accepts `'not-owner'`.
  - [ ] Existing tests pass; lint, tsc and tests green.
- Implementation plan:
  - Where:
    - types.ts: `UnitRole`, `EngagementResult` (re-exported from constants/engagement-result.ts), container keys, the Q3/Q4/Q6 interfaces, `CommandResult.reason`, re-export of `FightOptions`/`FightSimulation` from utils/combat/combat-sim.ts.
    - New constants/unit-role.ts: one `export const X = 'X'` per ares UnitRole (consts.py:492-561).
    - constants/index.ts: re-export `UnitRole` and `EngagementResult`.
    - engine/create-world.ts: `roles`, `squads`, `intel` in CORE_RESOURCES after `pathing`.
    - New stub files resources/roles.ts, resources/squads.ts, resources/intel.ts.
    - index.ts: export `canWinFight`, `simulateFight` and their types.
    - engine/create-world.test.ts: the three names resolve.
  - Interfaces: design Q1, Q3, Q4, Q6.
  - Follow: parity-2 T01 (P0 stub pattern); constants/unit-type.ts (constant module pattern); `NodeSC2Error` in engine/errors.ts.
  - Don't touch: actions.ts, command-arbiter.ts, memory.ts, spatial.ts, influence.ts, pathing.ts, utils/combat/*.
- Stack: core.
- Blocked by: T01 (re-export), parity-2 T01 (same files).
- Slice siblings: T01, T03–T07.

## T03 Roles (design Q3)

- Source: design Q3; P3-D5, D6, D7.
- What to build: the roles resource: assign/clear/switch/get/roleOf/getTags, `as(role, fn)` through the commander override, `mayCommand` (used by T05), configure; the step hook that drops dead/missing tags and applies the default role once per new finished unit; reset keeping settings.
- API contract: design Q3 `RolesResource`, `RoleSettings`.
- Acceptance criteria:
  - [ ] assign replaces a previous role; assign/clear accept a unit, units, a tag or tags; switchRole moves every unit of a role.
  - [ ] `get` honours `types` and `excludeTypes`, and returns only current, non-dead own units.
  - [ ] A new SCV gets GATHERING; a MULE and a marine get no role.
  - [ ] A cleared SCV stays roleless on the next step.
  - [ ] A dead unit's tag is removed from its role.
  - [ ] Cargo (not current) keeps its role and is absent from `get`; it reappears on unload.
  - [ ] Commands issued inside `roles.as(ATTACKING, ...)` carry owner `role:ATTACKING` (asserted via the `commandResults` owner); priority defaults to the current commander's.
  - [ ] `mayCommand(owner, tag)` is false only when the tag's role is exclusive and the owner isn't `role:<ROLE>`.
  - [ ] Roles never add labels to units.
  - [ ] `configure` settings survive a game reset; per-game state doesn't.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/roles.ts (replace the stub); new resources/roles.test.ts.
  - Interfaces: design Q3.
  - Follow: ares managers/unit_role_manager.py:149-392; core-arch `actions.as()` (resources/actions.ts ~624); parity-2 memory resource (onStep + configure + reset pattern).
  - Don't touch: types.ts, actions.ts, command-arbiter.ts, systems/unit-plugin.ts, create-unit.ts.
- Stack: core.
- Blocked by: T02.
- Slice siblings: T01, T02, T04–T07.

## T04 Squads (design Q4)

- Source: design Q4; P3-D8, D9.
- What to build: the lazy squads resource: per (role, sorted types) clustering once per game loop (prune, strays, at most one merge smaller-into-larger, join-or-create, recompute, main squad), `getSquads`, `getMainSquad`, `getMainSquadPosition`; reset clears state.
- API contract: design Q4 `Squad`, `SquadsResource`.
- Acceptance criteria:
  - [ ] Two separated groups give two squads with ids `${role}-${n}`.
  - [ ] A unit drifting out of radius leaves its squad; the squad keeps its id.
  - [ ] A unit joining keeps the squad's id.
  - [ ] Two converging squads merge, keeping the bigger squad's id (older on equal size); at most one merge per loop.
  - [ ] Main squad = most units, ties to the oldest; `getMainSquadPosition` returns its centroid, the last main position when there are no squads, or the main base's townhall position when there never was one.
  - [ ] Two calls in one loop return identical results (no re-cluster).
  - [ ] A unit whose role changes leaves the squad.
  - [ ] Default radius 6; the `types` filter partitions state per key.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/squads.ts (replace the stub); new resources/squads.test.ts.
  - Interfaces: design Q4.
  - Follow: ares managers/squad_manager.py:187-516; parity-2 spatial (lazy once-per-loop build).
  - Don't touch: roles.ts, types.ts.
- Stack: core.
- Blocked by: T03.
- Slice siblings: T01–T03, T05–T07.

## T05 Role-exclusive arbitration (design Q5)

- Source: design Q5; P3-D7.
- What to build: an optional `mayCommand` filter in the arbiter that drops not-owner proposals before winner selection, and the flush passing `roles.mayCommand`.
- API contract: design Q5; `CommandResult.reason: 'not-owner'`, `by: 'role:<ROLE>'`.
- Acceptance criteria:
  - [ ] Arbiter: a not-owner proposal is dropped for that tag with reason `not-owner` and `by` = the owning role, while the owner's own proposal survives.
  - [ ] Arbiter without `mayCommand`: results identical to before (existing tests unchanged).
  - [ ] Executor: with ATTACKING exclusive, a system commanding an ATTACKING unit outside `roles.as` gets `dropped`/`not-owner` in `commandResults`; inside `roles.as(ATTACKING, ...)` it wins.
  - [ ] With no exclusive roles (default) every existing executor test passes unchanged.
  - [ ] Raw `sendAction`/`swapBuildings` are not filtered.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/command-arbiter.ts (`arbitrate(..., mayCommand?)`) + command-arbiter.test.ts; resources/actions.ts (`flushQueuedActions` only: pass `roles.mayCommand`); resources/command-executor.test.ts.
  - Interfaces: design Q5.
  - Follow: core-arch design "Roles/behaviors later"; existing drop/reason handling in command-arbiter.ts.
  - Don't touch: roles.ts, types.ts, the rest of actions.ts.
- Stack: core.
- Blocked by: T03, core-arch T03, core-arch T04. Not in parallel with any phase-4 ticket that edits actions.ts (PA3).
- Slice siblings: T01–T04, T06, T07.

## T06 Intel (design Q6)

- Source: design Q6; P3-D10–D13.
- What to build: the intel resource: per-townhall ground/air threat sets with ares' hysteresis, sticky strategy flags with detection loop, the proxy rule, the `enemyStrategyDetected` event (once per flag, same step), configure, reset keeping settings.
- API contract: design Q6 `IntelResource`, `IntelSettings`, `IntelFlag`, `BaseThreat`; event `enemyStrategyDetected` / handler `onEnemyStrategyDetected(world, { flag, gameLoop })`.
- Acceptance criteria:
  - [ ] A zergling within 15 of a CC is tracked as ground; it's cleared when it walks beyond 24 or becomes a ghost.
  - [ ] An overlord at 18 counts as air, not ground.
  - [ ] `getMainThreat(kind)` returns the base with the most supply of that kind.
  - [ ] Every flag in design Q6 (workerRush, lingRush, roachRush, ravagerRush, marineRush, marauderRush, fourGate, proxyZealot, proxy, reaper, expanded, baseOutsideNatural, greedy, rushed) has one positive and one negative fixture (time window passed or under threshold).
  - [ ] Flags are sticky; `detectedAt` returns the first detection loop.
  - [ ] The event fires once per flag, and an agent handler sees it in the same step.
  - [ ] `getProxies` excludes creep tumors and gas buildings and includes ghosted structures.
  - [ ] Settings survive a game reset; flags and threat sets don't.
  - [ ] Perf: intel + roles onStep on the blueshift fixture with ~40 enemies, median over 50 steps ≤ 1 ms. Measured ad hoc (no committed wall-clock test; decisions.md "P3-T01 combat sim"); the measured median is recorded in the ticket.
    - Measured (senior-backend, 2026-10-26): 40 enemies (6 fixture + 34 added near the own main), roles + intel onStep timed inside the real dispatch (includes the per-loop spatial rebuild intel triggers), 50 steps after 10 warm-up: median 0.106 ms, p90 0.158 ms.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/intel.ts (replace the stub); new resources/intel.test.ts.
  - Interfaces: design Q6.
  - Follow: ares managers/enemy_to_base_manager.py:170-330, managers/intel_manager.py:145-409; parity-2 memory tests (synthetic observations with `stepTo`); custom event writing in readme "Custom events".
  - Don't touch: memory.ts, spatial.ts, types.ts.
- Stack: core.
- Blocked by: T02, parity-2 T02 (memory), parity-2 T03 (spatial).
- Slice siblings: T01–T05, T07.

## T08 distanceToWeaponReady speed units (bug fix)

- Source: technical-architect verification, 2026-10-26 (asked by team lead): a real bug, ported faithfully from python-sc2, which has it too. Evidence: python-sc2 sc2/unit.py:310-327 (movement speed is normal-speed, no ×1.4), :376-378 (`real_speed / 22.4 * weapon_cooldown`); `weapon_cooldown` is in game loops (python-sc2 examples/arcade_bot.py:50); normal speed is 16 loops per game second, so dividing by 22.4 underestimates by 1.4×.
- What to build: `unit.distanceToWeaponReady()` uses 16 loops per normal-speed second instead of 22.4. Nothing else changes: `realSpeed` stays normal-speed, and the combat sim is already consistent.
- Acceptance criteria:
  - [ ] Formula fixed: real speed / 16 × weapon cooldown.
  - [ ] The existing expectation is updated to (3 / 16) × 4.48.
  - [ ] A test asserts a 2.25-speed marine with cooldown 16 returns 2.25.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: engine/create-unit.ts (~385-388: `(this.realSpeed() / LOOPS_PER_NORMAL_SECOND) * cooldown`, with `LOOPS_PER_NORMAL_SECOND = 16` and a one-line why comment: unit data speeds are normal-speed, 16 loops per normal second); engine/create-unit.test.ts (~601).
  - Follow: existing `realSpeed()` in create-unit.ts.
  - Don't touch: anything else (no bot/ caller; no other core caller; readme ~678 and api.md ~455 are updated by T07).
- Stack: core.
- Blocked by: core-arch T03, core-arch T04 (create-unit.ts return types).
- Breaking: the value is 1.4× larger. No bot/ caller.
- Slice siblings: T07 (docs).

## T07 Docs + changelog (design Q7)

- Source: design Q7; .agent-work/docs-plan.md §2 "Phase 3" and §3.
- What to build: readme and API docs for roles, squads, intel and the combat sim; the `## Utilities` section; events, constants and command-result reason updates; ares deviations and known limitations; the `Unreleased › Phase 3` changelog entry.
- Acceptance criteria:
  - [ ] readme TOC and `resources.get()` destructure line list `roles`, `squads`, `intel`.
  - [ ] readme `### roles`, `### squads`, `### intel` under Resources after pathing, each with a method table, defaults and one example; roles covers the default role, exclusive ownership via `roles.as`, and that roles aren't labels. Next to exclusive ownership: raw `sendAction`/`swapBuildings` are not filtered by role (T05), and a raw send from a non-owner commits the tag, so the exclusive role's owner must strictly outrank that sender to retake the unit in the same step.
  - [ ] The squads section states: one radius per (role, types) key; the first `getSquads` call in a loop decides it, and switching radius between loops makes squads flap.
  - [ ] readme `## Utilities` (after Resources, before Constants) with `canWinFight`/`simulateFight`, the EngagementResult scale and a "Fights" example (engage at `>= VICTORY_CLOSE`).
  - [ ] readme Events table has `onEnemyStrategyDetected`; `commandResults` reasons include `'not-owner'`; Constants lists `UnitRole` and `EngagementResult`.
  - [ ] "Where this library differs from ares-sc2" lists: own focus-fire sim instead of sc2_helper, HP including shields, no good_positioning; squads merge smaller into larger with deterministic ids; rush rules gate on unit types; greedy defined here; roles aren't labels. Known limitations lists what the sim doesn't model, including that minimum range is judged on starting positions (a unit that walks inside a sieged tank's minimum range still gets shelled).
  - [ ] docs/api.md: `### roles`, `### squads`, `### intel` under Resources; `## Utilities` (created here unless an earlier phase created it) with both functions and FightOptions; EventConsumer `onEnemyStrategyDetected`; CommandResult reason — in the docs-plan §3.2 format.
  - [ ] readme "Where this library differs from python-sc2" has a bullet: `distanceToWeaponReady` uses 16 loops per normal-speed second; python-sc2 divides by 22.4 and underestimates by 1.4× (T08). The readme (~678) and api.md (~455) entries for it match.
  - [ ] docs/internals.md Resources list has roles, squads, intel.
  - [ ] docs/changelog.md `Unreleased › Phase 3: combat sim, roles, squads, intel` with Added, Changed (`'not-owner'`; `distanceToWeaponReady` 1.4× larger, T08) and `Migrating bot/` (see Further Notes).
  - [ ] Every new example type-checks.
- Implementation plan:
  - Where: packages/core/readme.md, docs/api.md, docs/changelog.md, docs/internals.md.
  - Follow: docs-plan.md §3; parity-2 T09's sections.
  - Don't touch: code.
- Stack: core (docs).
- Blocked by: T01, T03, T04, T05, T06, T08, parity-2 T09 (docs chain).
- Slice siblings: T01–T06, T08.
