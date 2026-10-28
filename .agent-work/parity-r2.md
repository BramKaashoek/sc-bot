# parity-r2: ares parity round 2

Source: user 2026-10-27 "(1) ares parity round 2: architect compiles the remaining gaps into a plan + tickets" (core-arch.decisions.md "next work"). Inputs: ares-gap.md, ares-inventory.md, examples.md (EX-T01/T02/T05/T06 gaps), core-arch.decisions.md, ares source, current packages/core (code-checked 2026-10-27).
Design: .agent-work/parity-r2.design.md (contracts C1–C11). Scope: packages/core only.

Status: RQ1–RQ10 answered (user, 2026-10-28; core-arch.decisions.md): RQ1 c, RQ2 a, RQ3 a, RQ4 a, RQ5 a, RQ6 c, RQ7 a, RQ8 b, RQ9 "port if possible", RQ10 yes. RQ11 was answered "do it nicer?"; the redesign is RQ11' below, waiting on the user, and nothing is ticketed for it. Done: T01–T07. T08–T35 run in the order under "Runnable order with the consistency queue". T09 started (lead). New tickets T19–T35 (2026-10-28) cover Zerg (RQ1 c), path smoothing (RQ8 b) and the RQ9 items; contracts C12–C17 in parity-r2.design.md.

Ticket numbers are local to this file (R2-Tnn). "P2-D8" etc. refer to core-arch.decisions.md.

## Candidate verification

Every candidate re-checked against the code, not the docs.

| # | candidate | verdict | evidence | ticket |
|---|---|---|---|---|
| 1 | climber, airVsGround, groundToAir grids (+ ares priorityGroundAvoidance, tacticalGround) | missing (deferred P2-D8) | types.ts:845 has 4 layers; ares grid_manager.py:164-196, 714-860 | T09, T10 |
| 2 | find_low_priority_path | missing | resources/pathing.ts; ares path_manager.py:210 | T02 |
| 2b | `findPath` ignores `sensitivity` | bug | types.ts:869 declares it; resources/pathing.ts findPath never reads it | T02 |
| 2c | find_furthest_safe_spot, find_lowest_cost_points | missing | ares path_manager.py:184, manager_mediator.py:1227 | T02 |
| 3 | clean/blank grid API | missing | no unstamped grid accessor; every combat behavior takes `layer?: InfluenceLayer` only (behaviors/combat/helpers.ts:8), so a custom grid can't reach a behavior | T03 |
| 4 | PathGroupToTarget / KeepGroupSafe parity | at parity except `smoothing` (P5-D12) and custom grids (#3) | behaviors/combat/group.ts:65-136 vs ares keep_group_safe.py, path_group_to_target.py | T03, RQ8 |
| 5 | GateKeeper, FirstPylon placements | missing | types.ts:957 PlacementFlag has neither; ares placement_manager.py:197, 574-710, placement_strategy.py:188, build_order_runner.py:653, 834 | T15 |
| 6 | YAML loader | missing (rejected before: P4-D9, P6b-D2) | engine/config.ts:19 JSON only. Bun 1.4.3 ships `Bun.YAML.parse` (checked), so no dependency | T16 |
| 7 | RestorePower | missing (P5-D8) | ares behaviors/macro/restore_power.py; core has the placement + tracker it needs | T14 |
| 8 | gas-steal handling | **ares has it**, on by default | build_order_runner.py:83, 112, 253, 844-945 (`ShouldHandleGasSteal`, role GAS_STEAL_PREVENTER). The earlier wrong assumption was a gas-steal *step*, which ares indeed lacks. Core excluded handling (P6b-D10) | T12 |
| 9 | blocked expansions (burrowed unit, enemy, own townhall, rocks) | missing | ares custom_bot_ai.py:451-516, building_manager.py:285-310; core agent/macro.ts:341 and behaviors/macro/structures.ts:174 skip nothing, resources/buildings.ts:325 only checks canPlace, frame.getActionErrors() has no reader | T04 |
| 10 | KD8 charge, parasitic bomb, forcefield positions, bile/nuke timing | missing (P2-D9) | constants/influence.ts:89-107; ares grid_manager.py:440-570, 940-1025 | T11 |
| 11 | detection (enemy detectors, is-detected, own units in detector range) | missing | no match in core; ares unit_memory_manager.py:108, 536-600, dicts/enemy_detector_ranges.py | T05 |
| 12 | useAOEAbility, autoUseAOEAbility | missing (P5-D8) | behaviors/index.ts | T06 |
| 13 | reaperGrenade (+ placePredictiveAoE, its default path), ghostSnipe, ravenAutoTurret | missing (P5-D8) | behaviors/index.ts | T07 |
| 14 | ProtossStaticDefence | missing (P5-D8) | ares protoss_static_defence.py | T14 |
| 15 | Zerg: creep manager, queen/tumor creep spread, transfuse, nydus manager + nydus pathing, overlord spots | missing (roadmap "Excluded", 6a-D10) | ares creep_manager.py (787 lines), nydus_manager.py (472) | T21–T28 (RQ1 c; research audits/r2-zerg.md) |
| 16 | adept shade tracking, ability tracker, ENEMY_NAT_HG_SPOT, Protoss supply −1 start, ares' shipped protoss_building_placements.yml data | missing, low value | core queries available abilities every step instead of tracking cooldowns | T28–T35 (RQ9 "port if possible"; research audits/r2-rq9.md; verdicts below) |
| 17 | AddonSwap as a behavior | covered | `flying.addonSwap` (types.ts:1090) is callable from any behavior | none |
| 18 | Replacing a built-in manager (ares Hub per-slot replacement + `additional_managers`, hub.py:38, 216) | missing for built-ins | engine/create-resource-manager.ts:34 throws on a duplicate name; adding new resources works | RQ11' (redesign, waiting on the user) |

### Section 1 (architecture) and the section 2–16 sweep

Built on audits/r2-gap-sections-2-16.md (grep-based); its MISSING rows are already candidates above. Spot-checks of its PARTIAL/UNVERIFIED rows and section 1:

- `give_same_action` (one command, many tags): covered. Group commands send one raw command with every tag (resources/actions.ts:143-306).
- Realtime game step: covered. The engine doesn't step in realtime (engine/create-engine.ts:522), which matches ares forcing game_step 1 and skipping frames itself.
- Archon morph queue: covered by train/pending handling (agent/macro.ts:192, 270). Unload queue: covered by dropCargo.
- Pickup range dict: covered locally (behaviors/combat/terran.ts:9). Turn-rate dict: ares uses it in no behavior.
- Whole-map point KDTree/array (manager_mediator.py:1587, 1605): not needed. Core grids are indexed by cell.
- `is_free_expansion`: closed by T04.
- Low value, folded into RQ9: arcade mode; the Ley Lines expansion fix (`_fix_broken_exp_locations`, one map); selectWorker's min-shield and persistent-builder flags (core's runner handles the persistent builder); a single-worker speedMining behavior (mining does it internally, resources/mining.ts:442); batch anyInRange; previous-frame own army and removed-units caches; does_not_use_larva; get_total_supply/unload_by_tag; set_build_completed/set_step_complete/started (the `buildComplete` hook covers completion); look_ahead (rejected, P6b-D4).
- UNVERIFIED debug draws (terrain, nydus, enemy-to-base): terrain draws exist through map-analysis/placement drawDebug. Nydus is out with Zerg (RQ1). Enemy-to-base is a debug print only. No ticket.

## Problem Statement

After phases 2–6, core covers most of ares, but a Terran bio bot still hits gaps that ares handles. Units path around ravager biles only while the bile is visible and ignore enemy reaper grenades and parasitic bombs. Medivacs and vikings can't prefer flying over unpathable ground. A reaper can't path over cliffs, and influence layers stop at four. A bot author can't start from a clean grid, or hand a custom grid to a behavior. Expansions blocked by a burrowed zergling, an enemy unit or rocks are retried forever. An enemy worker can take the main geysers during the opening. There are no spell behaviors (grenade, snipe, auto-turret, generic AoE) and no detection checks. For other races there's no RestorePower, Protoss static defence, gatekeeper or first-pylon placement, and nothing reads ares' YAML builds or placements.

## Solution

- **Pathing:** the full-path query honours sensitivity, plus ares' low-priority path, furthest safe spot and lowest-cost points.
- **Grids:** ares' extra layers (climber, air-vs-ground, ground-to-air, priority ground avoidance, opt-in tactical ground), each fed by the same sources ares routes to it. A clean copy of any layer can be taken, costed with the existing add-cost and passed to any pathing query or combat behavior.
- **Effects:** reaper grenades, parasitic bombs, forcefield positions, and ares' bile and nuke timing, which keeps them on the grid after they leave the observation.
- **Expansions:** one next-expansion pick that skips blocked, unsafe or occupied spots, and remembers spots where a build failed because of something invisible until a detector clears them. The building tracker moves a blocked townhall build to the next spot.
- **Openings:** ares' gas-steal guard, on by default for openings.
- **Intel:** enemy detectors, an is-detected check and own units in detector range.
- **Behaviors:** generic AoE use (pick the best spot, avoid own units, don't stack), automatic AoE per caster, reaper grenade with predictive placement, ghost snipe, raven auto-turret. For Protoss: restore power, static defence per base, and gatekeeper and first-pylon placements.
- **YAML:** config files may be YAML, and ares' builds and building-placement files load as they are.

## Non-goals

- Replacing a built-in resource, until RQ11' is answered.
- The RQ9 items that can't or shouldn't be ported (reasons under "RQ9 verdicts"): look_ahead, the build-step setters, the Ley Lines expansion fix, the persistent-builder selectWorker flags.
- A queens manager (inject, queen roles): ares has none; the bot picks which queens run the creep and transfuse behaviors (audits/r2-zerg.md §0).
- A gas-steal *step* (ares has none).
- bot/ changes; adoption is a migration note.

## User Stories

1. As a bot author, I want my units to keep avoiding a bile until it lands, so that bio doesn't walk back into it after it leaves the observation.
2. As a bot author, I want enemy reaper grenades and parasitic bombs on the grids, so that micro avoids them.
3. As a bot author, I want the positions of forcefields, so that I can path or wait around them.
4. As a bot author, I want an air grid that prefers unpathable ground, so that medivacs and vikings stay over cliffs and water.
5. As a bot author, I want a climber grid, so that reapers path over cliffs.
6. As a bot author, I want a ground-to-air grid with only enemy ground anti-air, so that air units can ignore enemy air.
7. As a bot author, I want a priority avoidance grid with only the must-dodge threats, so that units can dodge storms and disruptor shots and ignore everything else.
8. As a bot author, I want an opt-in tactical ground grid, so that I can weigh own versus enemy ground strength by area.
9. As a bot author, I want a clean copy of any grid that I can cost myself, so that I can build custom influence.
10. As a bot author, I want to pass my own grid to any pathing query or combat behavior, so that custom influence drives micro.
11. As a bot author, I want a full path thinned by sensitivity, and ares' low-priority path, so that I can queue a few waypoints for long trips.
12. As a bot author, I want the furthest safe spot and all lowest-cost points near a unit, so that I can retreat deep or pick among safe spots.
13. As a bot author, I want expansions with enemies, rocks, own townhalls or invisible blockers skipped, so that my bot doesn't send workers to a spot it can't build on.
14. As a bot author, I want a spot blocked by a burrowed unit retried once my detection shows it's clear, so that the base isn't lost for the whole game.
15. As a bot author, I want a worker to guard my main geysers when an enemy worker shows up during the opening, so that my gas isn't stolen.
16. As a bot author, I want to know which enemy detectors are up and whether a unit or point is detected, so that cloaked units don't walk into detection.
17. As a bot author, I want an AoE behavior that finds the spot hitting the most targets, avoids my units and doesn't stack the same spell, so that spells are used well.
18. As a bot author, I want reaper grenade, ghost snipe and raven auto-turret behaviors, so that Terran casters work out of the box.
19. As a Protoss bot author, I want unpowered structures re-powered and static defence kept up per base, so that macro holds after a pylon dies.
20. As a Protoss bot author, I want gatekeeper and first-pylon spots, so that natural walls from ares placement files work.
21. As a bot author, I want to keep my config, openings and placements in YAML, and load ares' files unchanged, so that ares builds and placements port directly.

## Implementation Decisions

Full contracts: parity-r2.design.md C1–C11.

- Influence gains five layers (C1). Grid writes are routed the way ares routes them: every ground write also feeds climber, every air write also feeds air-vs-ground, and ground-to-air and priority avoidance get explicit source lists. The climber base is the ground base plus a climbable-cliff mask that core computes from the start pathing and terrain height (our rule; ares gets it from a C extension that isn't in its source). Tactical ground is built only when enabled.
- Clean grids are fresh copies of a layer's base for the current loop. Add-cost accepts a grid. Pathing already accepts grids, and every combat behavior now does too (C2).
- The pathing additions follow ares' semantics and defaults (C3).
- Effects: KD8 charges and unattached parasitic bombs come from unit types (python-sc2's "fake effects"), and own units carrying a bomb count too. Bile and nuke are tracked by position from first sight and stamped only inside ares' reaction window, including after they leave the observation (C4, RQ4).
- Detection lives on intel, uses live enemies only, and is cached once per loop (C5).
- The building tracker owns the next-expansion pick and the blocked set. Action errors from the observation feed the blocked set (C6). DEV-1: a blocked spot clears once an own detector is near and no enemy is (ares' burrow rule; ares never clears its own set).
- The gas-steal guard runs inside the build runner's opening options, with ares' conditions, using the mining resource's worker pick and the existing GAS_STEAL_PREVENTER role (C7).
- New behaviors are factory functions like phase 5's. The AoE spot finder is our own deterministic algorithm (ares uses a Cython helper) (C8, C9).
- YAML goes through Bun's built-in parser. The ares importers are pure functions from YAML text to core settings and placement tables. The placement table type and its placer move from the example into core (C10).
- Protoss: a first-pylon placement flag and request option, gatekeeper positions from user placements, and the build runner asking for first-pylon spots early, as ares does (C11).
- Two scaffolding tickets add types and stubs up front, so feature tickets touching different implementation files can run in parallel: T01 for the decision-free APIs now, and T08 for the RQ-gated ones once answered.

## Testing Decisions

- **Pure seams:** the climber mask on fixture grids (simple64, acropolis, blueshift); the AoE spot finder; the YAML importers on ares' own example files (examples/build_runner_examples/*.yml and protoss_building_placements.yml, copied into fixtures as test data).
- **Resource seams (createTestWorld + fixtures):** pathing additions; each new layer's base plus one routed source per layer; effect stamping and the bile/nuke window across loops; clean grids; detection; the blocked-expansion pick and tracker retarget (action error injected through the fake client's observation); gas-steal guard via the build runner on a fixture world with a spawned enemy worker.
- **Behavior seams:** existing behavior tests extended with one custom-grid case each, not per behavior; new behaviors get the usual fixture tests.
- **Perf:** measured ad hoc and recorded in the ticket (decisions "P3-T01 combat sim"): influence build time before/after T10 and T11, climber mask time per map.
- **Prior art:** resources/influence.test.ts, pathing.test.ts, intel.test.ts, buildings.test.ts, systems/builder-plugin.test.ts, behaviors/combat/*.test.ts, engine config tests, examples/ares/custom-building-placements.test.ts.
- No new live smoke tests. The examples live smoke (EX-T07) re-runs after T17.

## Out of Scope

See Non-goals.

## Further Notes

Migration notes for bot/ (no tickets):
- Additive, except: `findPath` honours `sensitivity` (default 1, unchanged unless passed); `agent.getNextExpansion`/`expandNow` skip blocked/unsafe spots (RQ5); bile/nuke stamping timing changes (RQ4). bot/ calls none of these today (grep: no getNextExpansion/expandNow/findPath in bot/).
- Optional: use `airVsGround` for medivacs, `climber` for the reaper scout, `reaperGrenade` in the reaper's plan, `getNextExpansion` for expansions.

## Questions for the user (RQ)

Each has a recommendation; "yes" accepts it.

- **RQ1 Scope.** (a) Terran/general items only: T01–T13, T17, T18. (b) (a) plus Protoss items and YAML: T14–T16. (c) (b) plus Zerg: creep manager, queen/tumor creep spread, transfuse, nydus manager and nydus pathing, overlord spots (tickets in a follow-up file). **Recommend (b).** Zerg is the biggest chunk (~1,500 lines of ares) and is worth nothing to a Terran bot. The Protoss items are small and close the remaining parity gaps.
- **RQ2 Extra layers (reverses P2-D8), T09/T10.** (a) climber, airVsGround, groundToAir and priorityGroundAvoidance, plus tacticalGround opt-in (off by default, as in ares). (b) (a) without tacticalGround. (c) None. **Recommend (a).** Off by default costs nothing per step, and it's ares' tool against disruptor balls.
- **RQ3 Climber definition, T09.** ares takes the climber grid from map_analyzer's C extension, so there's no source to port. (a) Our cliff-gap rule (design C1), tuned on fixtures, as a senior ticket. (b) Drop climber. **Recommend (a).** The bot scouts with a reaper.
- **RQ4 Effects (reverses P2-D9), T11.** Add KD8 charge, parasitic bomb and forcefield positions. For bile and nuke: (a) ares' exact window (bile costed 16–50 loops after first seen, nuke 250–320, also after it leaves the observation; configurable); (b) today's "while visible" plus a tail to 50/320 loops; (c) keep today's bile/nuke handling. **Recommend (a).** ares tuned the window so bio keeps shooting until the bile is about to land.
- **RQ5 One expansion picker, T13.** `agent.getNextExpansion` and `expandNow` delegate to the tracker's `getNextExpansion`: synchronous rules, no per-call pathing query, async signature kept. (a) Yes. (b) Leave the agent methods alone. **Recommend (a).** After T04 the agent's pair is the last separate picker; bot/ calls neither.
- **RQ6 YAML (reverses P4-D9, P6b-D2), T16.** (a) None. (b) YAML config files only. (c) (b) plus ares-format importers for builds and placements, with `createPlacer` moved from the example into core. **Recommend (c).** `Bun.YAML` makes it dependency-free, and ares files load unchanged.
- **RQ7 Gas-steal guard (reverses P6b-D10's exclusion), T12.** (a) On for every opening (ares' default `ShouldHandleGasSteal: True`), off per opening with `shouldHandleGasSteal: false`; tuple build orders unaffected. (b) Opt-in. (c) Don't port. **Recommend (a).**
- **RQ8 Path smoothing** (dropped in P5-D12; ares' default is off). (a) Keep it dropped. (b) Port it. **Recommend (a).**
- **RQ9 Confirm these stay unported:** adept shade tracking, the ability tracker, ENEMY_NAT_HG_SPOT, the Protoss supply −1 start, and ares' shipped Protoss placement data (2025 map pool; T16 can load it instead), plus the low-value items under "Section 1 and the section 2–16 sweep". **Recommend yes.**
- **RQ11 Replace a built-in resource** (ares lets a bot swap any manager). (a) `resources.register(def, { replace: true })`: keeps the built-in's slot (order, onStep, reset, onGameEnd) and must happen before the first game starts; one junior ticket (engine/create-resource-manager.ts + test + docs line), added on "yes". (b) Skip it; bots wrap or add resources instead. **Recommend (b).** No bot needs it today, and replacing a resource that others read (influence, mining) breaks their contracts silently. **Answered 2026-10-28: "do it nicer?"**, so it's re-asked as RQ11' below.

### RQ11' Replacing a built-in resource, designed properly (for the user)

What has to hold for any design. Other core code reaches every resource through `world.resources.get().<name>`. So a replacement is seen everywhere, as long as nobody kept a reference from before the swap and nobody reads the built-in's private state. Two things break that today:
- Built-in resources keep their state in module WeakMaps keyed by the resource object. The built-in's `onStep`/`reset` look that state up through the instance they are handed (resources/*.ts `stateByX`), so handing them a different object fails.
- Several resources read another's private fields (`map._grids`/`_mapState`, `units._units`, `actions._client`; CS-I04, CS-I05 and CS-PM09 are removing these).

Every option below needs a prerequisite ticket. It makes the public interface the only way resources talk to each other, finishing what CS-I04/I05/PM09 start, and adds a test that fails when a resource reads another's `_` field.

- **(a) Typed full replacement.** `resources.replace('influence', definition)`, where `definition: ResourceDefinition<'influence'>` must produce the whole public `InfluenceResource` interface. The replacement owns state, `onStep`, `reset` and `onGameEnd`, and takes the built-in's slot in step order. Allowed only before the first game starts (after that it throws). The built-in's definition is dropped.
  - Pro: closest to ares' per-slot Hub replacement, and the compiler checks the whole surface.
  - Con: the bot reimplements everything, including the per-step work other resources depend on (e.g. pathing reads influence grids built in influence's onStep). The type can't catch behaviour the others rely on, like when grids are rebuilt.
- **(b) Wrap the built-in (decorator).** `resources.override('influence', (builtIn, world) => ({ ...builtIn, getGrid(layer) { … } }))`. The factory gets the live built-in and returns an object typed as the full interface. Usually it spreads the built-in and replaces a few methods. The built-in keeps its own state and lifecycle: core keeps calling its `onStep`/`reset` with the built-in instance, so the WeakMap state still resolves. Everyone else sees the wrapper. An optional `onStep(wrapper, world)` in the override runs after the built-in's.
  - Pro: overrides one behaviour (custom grid costs, worker selection) without reimplementing the rest; the built-in's step contract stays intact; still fully typed. Returning an object that doesn't spread the built-in gives you (a) anyway.
  - Con: a wrapper method that the built-in calls internally isn't seen by the built-in (its closures call its own functions, not the wrapper's). The docs must say "overrides affect callers, not the built-in's own internals".
- **(c) Declared readers plus contract tests.** Each definition declares `reads: Array<keyof ResourceContainer>`. Core then knows who depends on whom (step order checked, missing dependency reported) and can warn when a replacement drops a member someone reads. Core also ships `resourceContract('influence')`, a behavioural test suite a replacement can run in the bot's own tests (grids rebuilt each loop, clamp ≥ 1, reset per game, …). Works with (a) or (b).
  - Pro: catches behavioural breakage, not just type shape; makes resource dependencies explicit (also useful for docs/architecture).
  - Con: the most work: every built-in declares `reads`, and a contract suite is written per replaceable resource, which is roughly a second test suite.

**Recommend (b), with full replacement available through it, plus the prerequisite.** It covers what bots actually want (change one behaviour of influence/mining/placement) without having to reimplement the step work other resources depend on, and the compiler checks the whole surface. Add (c)'s contract suites later, per resource, only if bots start replacing whole resources. Sizing if (b): one prerequisite ticket (public-interface-only access + guard test; junior, after CS-I04/I05/PM09) and one override ticket (engine/create-resource-manager.ts, types.ts `ResourceManager.override`, tests for wrap + full replace + "only before first game"; senior: step-order and reset semantics across the built-in and the wrapper).

### RQ9 verdicts ("port if possible")

Ported: path smoothing (T20, RQ8 b), adept shades (T29), the ability tracker (T30), ENEMY_NAT_HG_SPOT with overlord spots (T28), Protoss supply −1 (T31), ares' Protoss placement data as an opt-in data file (T32), and from the low-value list: min-shield worker selection, batch anyInRange, the single-worker speed-mining behavior, total supply, the does-not-use-larva dict (T33), the previous-loop own army and morphed-enemy caches (T34), arcade mode (T35), unload by tag (T25), and a read-only build-completed getter (T31).
Not ported, and why:
- **look_ahead:** dead code in ares. Its loop `continue`s before incrementing the index, so the body never runs and the temporary step is never set (build_order_runner.py:262-273). There's nothing to port, and P6b-D4 (strict order) stands. A real look-ahead would be a new design that contradicts strict ordering; ask separately if wanted.
- **set_build_completed / set_step_complete / set_step_started:** ares needs these setters because its runner learns progress from bot events. Core's runner derives task state itself, so a public setter would let a bot desync it. The read-only half (`buildCompleted`) is ported in T31.
- **The persistent-builder flags of selectWorker:** already covered. Core's build runner owns the persistent builder (systems/builder-plugin.ts `pickWorker`), and a second path through `mining.selectWorker` would compete with it.
- **Ley Lines expansion fix:** can't be verified here. ares patches two python-sc2 expansion coordinates on Ley Lines AIE. Core computes townhall positions itself and doesn't use python-sc2's finder, so the bug may not exist in core. Ley Lines isn't in the local SC2 Maps folder (2017–2019 ladder maps only), so it can't be checked. Copying ares' coordinates blind could move a correct position. It gets a junior check once the map is installed: run core's expansion calc on it and override only if it's wrong.
- **RQ10 Accept the deviations:** DEV-1 (blocked-spot clearing), our climber rule (C1), our AoE spot finder (C8), user addCost on grids without costMultiplier (core's existing rule). **Recommend yes.** DEV-1 and the AoE finder land in T04/T06, which are ready now. If you'd rather not run them before this answer, hold those two.

## Priorities and order

- **P1** (Terran bot value): T04 blocked expansions, T11 effects, T02 pathing, T10 layers, T03 clean/custom grids, T12 gas-steal guard.
- **P2:** T05 detection, T06 AoE, T07 Terran spells, T13 agent picker.
- **P3:** T14 Protoss macro, T15 Protoss placements, T16 YAML.
- **Then:** T17 examples, T18 docs.

- **P4 (added 2026-10-28):** T20 smoothing, T21–T28 Zerg, T29–T35 RQ9 items. Within them: T29 adept shades (real grid gap) and T20 first; T35 arcade mode last.

Waves T01–T07: done. The current order for T08–T35, interleaved with the consistency queue and with file sets, is in "Runnable order with the consistency queue" after T35.

Staffing: junior by default. Senior: T09, T21, T23, T24, T25, T26, T28, T35 (reason in each ticket).

---

# Tickets

## T01 Scaffolding A: decision-free types and stubs

- Source: design C2, C3, C5, C6, C8, C9.
- What to build: the public types, interface members and exports for T02–T07, with stub bodies, so those tickets edit only their own implementation files.
- API contract: C2, C3, C5, C6, C8, C9 signatures exactly (the `InfluenceLayer` union stays at 4 layers; T08 widens it).
- Acceptance criteria:
  - [ ] Every C2/C3/C5/C6/C8/C9 type and interface member exists.
  - [ ] Stub resource methods throw `NodeSC2Error('not implemented: <name>')`. Stub behavior factories return a behavior whose execute returns false.
  - [ ] The new behaviors are exported from `@sc-bot/core/behaviors`.
  - [ ] Nothing changes at runtime for existing calls; existing tests pass.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: types.ts (InfluenceResource: getCleanGrid, getForcefieldPositions, widened addCost/drawDebug; PathingResource; IntelResource; BuildingTracker). Stub members in resources/influence.ts (getCleanGrid, getForcefieldPositions; addCost/drawDebug keep today's bodies with the widened type, a grid argument throws until T03), resources/pathing.ts, resources/intel.ts, resources/buildings.ts, each a one-line throw. New stub files behaviors/combat/aoe.ts and behaviors/combat/spells.ts. behaviors/index.ts exports.
  - Interfaces: C2, C3, C5, C6, C8, C9.
  - Follow: parity-6b T02 scaffolding (stub resource members and re-exports); behaviors/macro/structures.ts factory shape.
  - Don't touch: behaviors/combat/helpers.ts, individual.ts, group.ts, terran.ts (T03); systems/builder-plugin.ts (T04); constants/.
- Stack: core.
- Blocked by: None.
- Slice siblings: T02–T07.

## T02 Pathing: sensitivity, low-priority path, furthest safe spot, lowest-cost points

- Source: candidates #2, #2b, #2c; design C3.
- What to build: `findPath` honours sensitivity, plus `findLowPriorityPath`, `findFurthestSafeSpot` and `findLowestCostPoints` with ares' semantics and defaults.
- API contract: C3.
- Acceptance criteria:
  - [ ] Without sensitivity, `findPath` returns today's path. With s it returns exactly the cells at indices s−1, 2s−1, … of the full path, and the first of them is `nextPoint`'s pick.
  - [ ] `findLowPriorityPath` returns `[goal]` for a path under 10 points at sensitivity 4. Otherwise it returns 8 points at ares' linspace indices, then the goal.
  - [ ] `findLowestCostPoints` returns only finite cells within the radius whose cost equals the disc minimum. `findFurthestSafeSpot` returns the one furthest from the start. With no finite cell in the disc, they return empty and undefined.
  - [ ] All three accept a layer name or a grid object.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/pathing.ts (+ pathing.test.ts).
  - Interfaces: C3.
  - Follow: the `closestSafeSpot` scan in resources/pathing.ts; ares path_manager.py:154-250.
  - Don't touch: resources/influence.ts, behaviors/.
- Stack: core.
- Blocked by: T01.
- Slice siblings: T03, T10, T11.

## T03 Clean grids and custom grids in behaviors

- Source: candidates #3, #4; design C2.
- What to build: `getCleanGrid`, add-cost and debug-draw on a grid object, and every combat behavior's `layer` option accepting a grid.
- API contract: C2 (minus `getForcefieldPositions`, which is T11's).
- Acceptance criteria:
  - [ ] `getCleanGrid(layer)` holds the layer's base values for this loop with no unit/effect cost. Writing to it doesn't change `getGrid(layer)`.
  - [ ] `addCost(grid, …)` stamps only that grid and clamps to ≥ 1.
  - [ ] keepUnitSafe, pathUnitToTarget and pathGroupToTarget each follow a custom grid in a test: a wall of cost on the custom grid moves the chosen point. The other behaviors accept a grid in their types.
  - [ ] Existing behavior tests unchanged.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/influence.ts (getCleanGrid from the same base fill `build()` uses, split into a helper; addCost/drawDebug on grids); behaviors/combat/helpers.ts (`layerFor` returns the union), individual.ts, group.ts (`retreatPoint` resolves a grid), terran.ts (option types).
  - Interfaces: C2.
  - Follow: `resolve` in resources/pathing.ts; the ares tutorial influence_and_pathing, "create your own grid".
  - Don't touch: resources/pathing.ts (T02), behaviors/combat/aoe.ts and spells.ts (T06/T07).
- Stack: core.
- Blocked by: T01.
- Slice siblings: T02, T10, T11.

## T04 Blocked expansions: the tracker's expansion picker

- Source: candidate #9; design C6.
- What to build: the tracker's `getNextExpansion` and `isExpansionBlocked`; the blocked set, fed by action errors and the location rule, with DEV-1 clearing; townhall retargets through them; expansionController and the build runner's townhall step moved onto the picker. The agent methods stay as they are (T13).
- API contract: C6.
- Acceptance criteria:
  - [ ] `getNextExpansion` returns the first available expansion, in map order, that passes every C6 rule. `checkSafe: false` skips only the safety rule.
  - [ ] A CantBuildLocationInvalid action error on a tracked townhall's worker blocks that spot and retargets the build to the next one. With no spot left, the build fails `'blocked'`.
  - [ ] A blocked spot clears when an own detector (unit or scan) is within 7 and no enemy is within 9. The set resets per game.
  - [ ] expansionController and the build runner's townhall step use the picker. Existing expansion tests keep passing, or are updated where the old pick was a blocked spot.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/buildings.ts (`retargetTownhall` at :325, the step check at :421, the blocked set in state, action errors via frame.getActionErrors()); behaviors/macro/structures.ts:174; systems/builder-plugin.ts townhall branch (:743, replacing the `@TODO` there).
  - Interfaces: C6.
  - Follow: ares custom_bot_ai.py:451-516, building_manager.py:285-310, terrain_manager.py:628; spatial.unitsInRange for the 5.5/7/9 checks; ActionResult in the bundled proto typings.
  - Don't touch: agent/macro.ts (T13), resources/placement.ts, resources/intel.ts.
- Stack: core.
- Blocked by: T01.
- Slice siblings: T12, T13.

## T05 Detection

- Source: candidate #11; design C5.
- What to build: on intel, the enemy detector list, is-detected and own units in detector range, using ares' detector ranges.
- API contract: C5.
- Acceptance criteria:
  - [ ] The detector list has live enemy detector-type units and enemy scanner sweeps, at ares' ranges. Remembered (ghost) units are left out.
  - [ ] `isDetected` is true under ORACLEREVELATION whatever the range. It uses a strict `<` range for points. `byEnemy: false` checks own detectors and own scans.
  - [ ] `getOwnUnitsInDetectorRange` matches a brute-force scan on a fixture.
  - [ ] Results are cached per loop.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/intel.ts; new constants/detection.ts.
  - Interfaces: C5.
  - Follow: ares unit_memory_manager.py:108-130, 536-620; dicts/enemy_detector_ranges.py; spatial.unitsInRange.
  - Don't touch: resources/memory.ts, resources/spatial.ts.
- Stack: core.
- Blocked by: T01.
- Slice siblings: none.

## T06 AoE behaviors

- Source: candidate #12; design C8.
- What to build: `useAOEAbility`, `autoUseAOEAbility`, the AoE spot finder and ares' AoE ability table.
- API contract: C8.
- Acceptance criteria:
  - [ ] `findAoePosition` returns a spot covering at least minTargets and prefers bonus tags. It returns undefined when no candidate qualifies, and it's deterministic.
  - [ ] useAOEAbility casts at the spot (on the closest target for parasitic bomb and anti-armor missile).
  - [ ] It refuses to cast when own flying or ground units are inside and the matching avoid flag is set.
  - [ ] It refuses to stack an active effect or buff unless `stackSameSpell` is set.
  - [ ] Unless `recalculate` is set, it doesn't recompute while the unit is already casting at a spot that's still valid.
  - [ ] Unsupported ability ids return false with a debug warning.
  - [ ] autoUseAOEAbility picks the unit's ability as ares auto_use_aoe_ability.py does.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: behaviors/combat/aoe.ts (stub from T01); new utils/combat/aoe.ts; new constants/aoe.ts.
  - Interfaces: C8.
  - Follow: ares use_aoe_ability.py, auto_use_aoe_ability.py, dicts/aoe_ability_to_range.py; `useAbility` in behaviors/combat/individual.ts.
  - Don't touch: behaviors/combat/individual.ts, group.ts, terran.ts, helpers.ts (T03).
- Stack: core.
- Blocked by: T01.
- Slice siblings: T07.

## T07 Terran spell behaviors

- Source: candidate #13; design C9.
- What to build: `placePredictiveAoE`, `reaperGrenade`, `ghostSnipe` and `ravenAutoTurret`.
- API contract: C9. Behaviors take `layer?: InfluenceLayer | InfluenceGrid`.
- Acceptance criteria:
  - [ ] reaperGrenade doesn't cast without KD8 available or without ground targets.
  - [ ] With `placePredictive` set and a non-worker enemy facing the reaper, it casts at the predicted chase position.
  - [ ] Otherwise it casts through useAOEAbility on 2 or more targets near the closest enemy, when that enemy is within grenade range plus its radius.
  - [ ] placePredictiveAoE uses the world's game step for the delay index, and casts only at a visible spot within range.
  - [ ] ghostSnipe picks ares' best-value target and skips targets another ghost is already sniping.
  - [ ] ravenAutoTurret casts toward the closest enemy unit, as ares raven_auto_turret.py does.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: behaviors/combat/spells.ts (stub from T01).
  - Interfaces: C9.
  - Follow: ares reaper_grenade.py, place_predictive_aoe.py, ghost_snipe.py, raven_auto_turret.py; useAOEAbility (T06); pathing.findPath for the reaper's raw path.
  - Don't touch: behaviors/combat/aoe.ts, individual.ts, group.ts, terran.ts.
- Stack: core.
- Blocked by: T01, T06.
- Slice siblings: T06.

## T08 Scaffolding B: RQ-gated types and stubs

- Source: design C1, C4, C7, C10, C11, limited to the RQ answers.
- What to build: the remaining types, settings defaults and stubs for T09–T16 that are in scope.
- API contract: C1, C4, C7, C10, C11, as trimmed by RQ1/RQ2/RQ4/RQ6/RQ7.
- Acceptance criteria:
  - [ ] Every in-scope type and member exists. The new layer names are accepted wherever `InfluenceLayer` is.
  - [ ] The new layers exist in the influence grid record with a placeholder base: a ground copy for climber and priorityGroundAvoidance, an air copy for airVsGround and groundToAir (and tacticalGround if in scope). The record stays total; T10 replaces the bases.
  - [ ] Stubs throw `NodeSC2Error('not implemented: <name>')` or return false (behaviors). The new exports are in place.
  - [ ] Nothing changes at runtime for existing calls.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: types.ts (InfluenceLayer, InfluenceSettings, OpeningDefinition, PlacementFlag/PlacementRequest/UserPlacement/PlacementResource, PlacementTable); constants/influence.ts (INFLUENCE_DEFAULTS for C1/C4); resources/influence.ts (`LAYERS` + placeholder bases); resources/placement.ts stub members; new stub files behaviors/macro/protoss.ts, utils/config/ares-yaml.ts, utils/placement/placer.ts; behaviors/index.ts and index.ts exports.
  - Interfaces: as above.
  - Follow: T01.
  - Don't touch: systems/builder-plugin.ts, engine/config.ts.
- Stack: core.
- Blocked by: RQ answers ✓ (all in scope: RQ1 c, RQ2 a, RQ4 a, RQ6 c, RQ7 a); T01–T07 ✓; CS-PM14 (types.ts chain: T08 takes the slot after PM14, before CS-PM03).
- Slice siblings: T09–T16.

## T09 Climber mask (SENIOR)

- Senior because: there is no ares source to port (it's in map_analyzer's C extension). The cliff thresholds are a judgment call that has to be validated on three fixture maps, and a wrong mask silently sends reapers into terrain they can't climb.
- Source: candidate #1; design C1 "Climber mask rule"; RQ2, RQ3.
- What to build: a pure function that marks climbable cliff cells from the start pathing and terrain-height grids.
- API contract: C1 `computeClimberMask`.
- Acceptance criteria:
  - [ ] Pathable cells, cells outside the playable area and the out-of-map height sentinel are never marked.
  - [ ] On the simple64, acropolis and blueshift fixtures, a path from main to natural for a unit on the main's high ground is strictly shorter on ground base plus mask than on the ground base alone.
  - [ ] Every marked run joins two pathable cells within `maxGap` and `maxStep`.
  - [ ] Water and space map edges and double-level cliffs stay unmarked on the fixtures (the spot-checked cells are listed in the test).
  - [ ] The chosen `maxGap` and `maxStep`, and the mask time per map, are recorded in the ticket (ad hoc).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new utils/map/climber.ts (+ climber.test.ts).
  - Interfaces: C1.
  - Follow: utils/map/distance-field.ts and chokes.ts (typed-array grid utils, fixture tests); the `map._grids.height` encoding in resources/map.ts (getHeight).
  - Don't touch: anything else (new files only).
- Stack: core.
- Blocked by: RQ2, RQ3 answers.
- Slice siblings: T10.

## T10 Influence layers: climber, airVsGround, groundToAir, priorityGroundAvoidance, tacticalGround

- Source: candidate #1; design C1; RQ2.
- What to build: real bases for the new layers, ares' routing of every existing source into them, and tactical ground behind its setting.
- API contract: C1.
- Acceptance criteria:
  - [ ] climber = ground plus mask cells. The mask is computed once per game; live footprints still block.
  - [ ] airVsGround = air, with ground-pathable cells at `airVsGroundDefault`. groundToAir = air. priorityGroundAvoidance = ground. tacticalGround = 200 in the playable area.
  - [ ] Routing follows C1:
    - an enemy marine costs ground, climber, air, airVsGround and groundToAir;
    - an enemy viking (air) costs air and airVsGround but not groundToAir;
    - a missile turret costs groundToAir;
    - a storm costs priorityGroundAvoidance and not groundToAir;
    - a disruptor shot and a baneling cost priorityGroundAvoidance.
  - [ ] tacticalGround isn't built while disabled (getGrid returns its base). Enabled, an own marauder lowers the cells around it by army value and an enemy one raises them (×1.5 under 100 health).
  - [ ] `getCleanGrid` works for every new layer.
  - [ ] Existing layer values are unchanged in every existing test.
  - [ ] Influence build time before and after recorded (ad hoc).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/influence.ts (bases, `stamp` routing, a per-game mask cache cleared in reset); constants/influence.ts (layer lists for the priority sources; STATIC_DEFENSE air sources tagged for groundToAir).
  - Interfaces: C1.
  - Follow: `build()` in resources/influence.ts; ares grid_manager.py:589-860 for the per-source layer lists; army value from the existing getArmyValue unit costs (decisions "P2-T04 design correction": raw mineral + vespene).
  - Don't touch: resources/pathing.ts, behaviors/.
- Stack: core.
- Blocked by: T03, T08, T09.
- Slice siblings: T02, T03, T11.

## T11 Effects parity: KD8, parasitic bomb, forcefields, bile/nuke window

- Source: candidate #10; design C4; RQ4.
- What to build: costs for KD8 charges and parasitic bombs, the forcefield accessor, and ares' delayed bile/nuke window.
- API contract: C4; `getForcefieldPositions` (C2).
- Acceptance criteria:
  - [ ] A KD8CHARGE unit costs ground and climber at the `kd8Charge` cost, over range plus the effects buffer.
  - [ ] An enemy-alliance PARASITICBOMBDUMMY, and an own unit with the PARASITICBOMB buff, cost air, airVsGround, airAvoidance and groundToAir. An own-alliance dummy doesn't.
  - [ ] A bile first seen at loop L costs nothing before L+16. From L+16 to L+50 it costs its layers, even after the effect has left the observation, and nothing after that.
  - [ ] Nuke works the same with 250/320. The windows are configurable, and the bookkeeping resets per game.
  - [ ] `getForcefieldPositions` lists this loop's FORCEFIELD unit positions.
  - [ ] Settings for the new costs survive game reset (P2-D10).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/influence.ts (the effect loop, a delayed-effect map in state, fake-effect units from the units resource); constants/influence.ts (defaults; bile and nuke leave EFFECT_INFLUENCE's present-only path).
  - Interfaces: C4.
  - Follow: the effect loop in `build()`; ares grid_manager.py:440-570, 940-1025; python-sc2 constants.py:333 for fake-effect radii (for reference).
  - Don't touch: resources/pathing.ts, behaviors/.
- Stack: core.
- Blocked by: T10.
- Slice siblings: T10.

## T12 Gas-steal guard in openings

- Source: candidate #8; design C7; RQ7.
- What to build: ares' gas-steal guard, run with the opening options while an opening is active. On by default, switchable per opening.
- API contract: C7.
- Acceptance criteria:
  - [ ] With an enemy worker within 12 of the start and no gas building in the main, one worker per free main geyser takes the GAS_STEAL_PREVENTER role and holds on the geyser.
  - [ ] No worker is assigned when the current step is a gas step already started, when the main has 2 gas buildings, or when a gas building is pending.
  - [ ] The guard attacks an enemy worker in range when its weapon is ready.
  - [ ] When the current step is gas and affordable, the guard builds the gas there, and the step is marked started.
  - [ ] The guard goes back to GATHERING when enemy workers leave, a gas building is within 5, or the geyser or worker is gone.
  - [ ] `shouldHandleGasSteal: false` turns it off. Tuple build orders never run it. The opening key is accepted from config.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new utils/build-order/gas-steal.ts (state plus a per-step function taking world, the current task and a "mark started" callback); systems/builder-plugin.ts `runOpeningOptions` (:559) calls it, and its state resets on game start and opening switch; resources/openings.ts if it validates opening keys.
  - Interfaces: C7.
  - Follow: ares build_order_runner.py:844-945; `pickWorker`/`assignPersistent` in builder-plugin.ts for role handling; mining.selectWorker.
  - Don't touch: resources/buildings.ts.
- Stack: core.
- Blocked by: T04 (builder-plugin.ts), T08.
- Slice siblings: T04.

## T13 Agent expansion methods use the picker (RQ5)

- Source: design C6; RQ5.
- What to build: `agent.getNextExpansion` and `expandNow` delegate to the tracker's `getNextExpansion`. Signatures are unchanged, and there's no pathing RPC per call.
- API contract: unchanged signatures; behaviour per C6.
- Acceptance criteria:
  - [ ] `getNextExpansion` resolves to the tracker's pick, or null when there is none. `expandNow` with no location builds there.
  - [ ] No `queryPathing` call per expansion candidate.
  - [ ] Existing macro tests pass or are updated where the old pick differed.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: agent/macro.ts:341-386.
  - Interfaces: none new.
  - Follow: T04's picker.
  - Don't touch: resources/buildings.ts.
- Stack: core.
- Blocked by: T04, RQ5 answer.
- Slice siblings: T04.

## T14 Protoss macro behaviors: restorePower, protossStaticDefence (RQ1 b)

- Source: candidates #7, #14; design C11.
- What to build: the two Protoss macro behaviors.
- API contract: C11.
- Acceptance criteria:
  - [ ] restorePower acts on an unpowered structure that needs power, when no tracked pylon build is within power range of it. It requests an available 2x2 placement in power range with no worker en route, and builds a pylon there with a close worker.
  - [ ] restorePower returns false for Terran and Zerg.
  - [ ] protossStaticDefence keeps each base's pylon, cannon and battery counts at its settings (ares order: pylon first). It skips excluded bases and respects `maxOnRoute` and the tech-base location.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: behaviors/macro/protoss.ts (stub from T08).
  - Interfaces: C11.
  - Follow: ares restore_power.py, protoss_static_defence.py; behaviors/macro/structures.ts (buildStructure; the placement.request + buildings.build pattern).
  - Don't touch: resources/placement.ts (T15).
- Stack: core.
- Blocked by: T08.
- Slice siblings: T15.

## T15 Protoss placements: first pylon and gatekeeper (RQ1 b)

- Source: candidate #5; design C11.
- What to build: the `firstPylon` flag and request option, gatekeeper positions from user placements, the 16×16 avoid area around a user first pylon, and the build runner's early-pylon requests.
- API contract: C11.
- Acceptance criteria:
  - [ ] `request(PYLON, { firstPylon: true })` returns an available first-pylon spot when there is one, and otherwise a normal pylon spot.
  - [ ] User placements marked `gateKeeper` aren't building spots.
  - [ ] `getGatekeeperPositions(base)` returns the gatekeeper positions for the closest expansion. `getNatGatekeeperPosition` returns the first one at the own natural.
  - [ ] Generated formations avoid the 16×16 area centred on a user first pylon.
  - [ ] Protoss pylon steps before 60 s, and the persistent builder's pre-move before 30 s, request `firstPylon`.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/placement.ts (flag filter, user-placement intake, avoid area); systems/builder-plugin.ts (the pylon placement request and persistent pre-move), or utils/build-order/targets.ts if the request is built there.
  - Interfaces: C11.
  - Follow: ares placement_strategy.py:172-200, placement_manager.py:197-205, 574-710, build_order_runner.py:653, 834; the existing custom-placement handling in resources/placement.ts.
  - Don't touch: behaviors/macro/protoss.ts (T14).
- Stack: core.
- Blocked by: T08, T12 (builder-plugin.ts).
- Slice siblings: T14, T16.

## T16 YAML config and ares importers (RQ6)

- Source: candidate #6; design C10.
- What to build: YAML config files; the ares builds and placements importers; `createPlacer` moved into core.
- API contract: C10.
- Acceptance criteria:
  - [ ] `sc-bot.config.yml`/`.yaml` load with the same validation and precedence as JSON.
  - [ ] A JSON and a YAML default file both present → NodeSC2Error naming both. Malformed YAML → NodeSC2Error with the parser's message.
  - [ ] `parseAresBuilds` on ares' terran, protoss and zerg example builds gives settings whose openings parse with core's build-order parser. OneBaseTempests' unknown upgrade is still reported (BG-T08).
  - [ ] `UseData: True` sets dataDir `./data`. Unknown keys warn.
  - [ ] `parseAresPlacements` on ares' protoss_building_placements.yml gives a table that `createPlacer` turns into the same placements as the example's TS table for one map (spot-checked).
  - [ ] GateKeeper and FirstPylon keys map to C11 (or warn if T15 is out of scope).
  - [ ] The example imports `createPlacer` from core, and its tests still pass.
  - [ ] (added 2026-10-28, audits/r2-rq9.md §F) `createPlacer` matches map names as ares does (lowercase, strip a trailing `le`/`aie` with or without a space, strip spaces), not `startsWith`. Tests: "Ley Lines AIE" matches `LeyLines`, and a map that merely starts with "Pylon" doesn't match `Pylon`.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: engine/config.ts (`readConfigFile` by extension, default lookup); utils/config/ares-yaml.ts; utils/placement/placer.ts (`createPlacer` + `PlacementTable` moved); examples/ares/custom-building-placements.ts (import only); fixtures: copies of the ares YAML files as test data.
  - Interfaces: C10.
  - Follow: engine/config.ts; examples/ares/custom-building-placements.ts:202; ares managers/utils/user_placement_extractor.py, data_manager.py, build_order_runner.py:124-190.
  - Don't touch: resources/openings.ts, resources/placement.ts.
- Stack: core.
- Blocked by: T08; T15 if Protoss is in scope.
- Slice siblings: T15.

## T17 Examples: close the round-2 gaps

- Source: examples.md EX-T02/T05/T06 gap lists.
- What to build: the ares ports use the new APIs where they had workarounds.
- Acceptance criteria:
  - [ ] influence-and-pathing uses airVsGround, climber and groundToAir where the tutorial does, `findLowPriorityPath`, and a clean grid for "create your own grid".
  - [ ] custom-building-placements uses FirstPylon and GateKeeper, and can load a YAML table (RQ6 c).
  - [ ] build-runner keeps `shouldHandleGasSteal` from the YAMLs, and can load ares YAML openings directly (RQ6 c).
  - [ ] (added 2026-10-28) influence-and-pathing shows `smoothing: true` where the ares tutorial passes it.
  - [ ] The examples.md gap notes that are now closed are listed for T18.
  - [ ] Examples' fixture tests and type-check green.
- Implementation plan:
  - Where: examples/ares/influence-and-pathing.ts, custom-building-placements.ts, build-runner.ts, with their tests and openings.
  - Follow: the examples.md translation map.
  - Don't touch: core sources.
- Stack: core (examples).
- Blocked by: T02, T03, T10, T12, T15, T16, T20.
- Slice siblings: T18.

## T18 Docs + changelog

- Source: docs-plan.md §4 template; this file.
- What to build (retargeted 2026-10-28 to the doc layout from consistency.md CS-D01–D08; readme.md and docs/api.md are no longer reference pages): every API from T01–T35 documented in its topic page.
  - map.md: influence layers, clean grids, pathing additions, smoothing, effects, overlord spots.
  - combat.md: detection.
  - behaviors.md: AoE, spells, Protoss and Zerg behaviors, speedMining.
  - macro.md: expansions/picker, Protoss placements, the placement data loader, minShield, the creep and nydus resources (or a new zerg.md if they pass ~150 lines), the ability tracker.
  - build-orders.md: gas-steal guard, ENEMY_NAT_HG_SPOT, Protoss supply −1, buildCompleted, YAML importers.
  - running-games.md: YAML config, arcade mode.
  - commands.md: `actions.unloadByTag`, as a raw, non-arbitrated command.
  - units.md: previous-loop caches, totalSupply, anyInRangeBatch.
  - compatibility.md: ares deviations (DEV-1 to DEV-4, climber rule, AoE finder, tactical opt-in, creep cadences, nydus fixes) and the RQ9 not-ported list with reasons.
  - changelog: entry by feature name, no ticket ids.
  - examples/README.md: gap lists trimmed.
- Acceptance criteria:
  - [ ] Every new or changed public member appears once, in its owner page, in the doc contract's heading format with defaults.
  - [ ] Changelog Unreleased has Added/Changed and an "Upgrading" note: findPath sensitivity, the expansion picker, bile/nuke timing, adept shades ignored for 120 loops.
  - [ ] compatibility.md has no stale "not ported" line for anything ported here, and lists what stays unported with its reason.
  - [ ] Every example and doc TS block type-checks; every link resolves.
- Implementation plan: Where: docs/*.md, examples/README.md, docs/changelog.md. Don't touch: code.
- Stack: core (docs). Junior.
- Blocked by: every implementation ticket above, T17, consistency CS-D08 (layout), CS-D09 (docs files).
- Slice siblings: all.

## T19 Scaffolding C: Zerg, smoothing and RQ9 types and stubs

- Source: design C12–C17.
- What to build: every public type, interface member, resource registration and export for T20–T35, with stub bodies, so the feature tickets edit only their own implementation files.
- API contract: C12–C17 signatures exactly.
- Acceptance criteria:
  - [ ] Every C12–C17 member exists. `ResourceContainer` has `creep`, `nydus`, `abilityTracker`, registered in engine/create-world.ts after `influence` (creep), `mapAnalysis` (nydus) and at the end (abilityTracker).
  - [ ] Stub resource members throw `NodeSC2Error('not implemented: <name>')`. New resources are definitions whose members are stubs and whose onStep does nothing. Stub behaviors return false.
  - [ ] `ENEMY_NAT_HG_SPOT` exists in constants/build-target.ts (the parser still throws until T28).
  - [ ] Root exports `totalSupply`, `loadAresProtossPlacements`. `@sc-bot/core/behaviors` exports `tumorSpreadCreep`, `queenSpreadCreep`, `useTransfuse`, `nydusPathUnitToTarget` and `speedMining`.
  - [ ] Nothing changes at runtime for existing calls; existing tests pass; lint, tsc and tests green.
- Implementation plan:
  - Where: types.ts; engine/create-world.ts; one-line stub members in resources/{actions,map-analysis,mining,spatial,units,map}.ts; new stub files resources/creep.ts, resources/nydus.ts, resources/ability-tracker.ts, behaviors/combat/zerg.ts, behaviors/macro/speed-mining.ts; the root export of `totalSupply` re-exports utils/units/supply.ts (T36), it doesn't stub it; utils/pathing/smooth.ts belongs to T20a; constants/build-target.ts; behaviors/index.ts, index.ts; utils/placement/placer.ts (a `loadAresProtossPlacements` stub next to T08's placer stub).
  - Interfaces: C12–C17.
  - Follow: T01, T08 (scaffolding shape); resources/spatial.ts (`spatialResource` definition shape).
  - Don't touch: resources/influence.ts (T10/T11/T29), resources/placement.ts (CS-I04/T15), systems/builder-plugin.ts (T12/T15/T31).
- Stack: core. Junior.
- Blocked by: T08 (types.ts, behaviors/index.ts, index.ts, placer.ts); consistency CS-I05 (resources/units.ts).
- Slice siblings: T20–T35.

## Pure-file splits (added 2026-10-28 for "run anything and everything")

Four tickets that create new files only, so parity work can start while types.ts is held. Each later feature ticket (T20, T21, T28, T30/T32/T33) then wires the util in and no longer writes it. Same format as the parent tickets; acceptance criteria are the parent's criteria that apply to the pure function.

### T20a smoothPath util
- Source: T20, C12. What to build: `smoothPath(path: Int32Array, data: Float32Array, width: number): Int32Array` in utils/pathing/smooth.ts.
- Acceptance criteria: T20's corridor / Infinity-block / high-cost-blob / under-3-nodes cases, as unit tests on hand-built grids.
- Implementation plan: Where: utils/pathing/smooth.ts, smooth.test.ts. Follow: ma_ext.c `create_smoothed_path`; utils/pathing/astar.ts. Don't touch: anything else.
- Stack: core. Junior. Blocked by: none. T20 then wires it (pathing.ts, behaviors) after T19.

### T21a Creep grid functions (SENIOR)
- Senior because: T21's senior calls (edge rule, rounding at .5, quirk decisions, cadence model) are made here. T21 then wires them into the resource.
- Source: T21, C13; audits/r2-zerg.md §1, §5b.
- What to build: pure functions over a creep grid, a static pathing grid and a cost grid: `creepEdges`, `creepCoverage`, `isValidTumorSpot`, `expansionMask`, `overlordSpotterPositions`, `nearestCreepTile`. No World access.
- Acceptance criteria: T21's edge, coverage, valid-spot and spotter criteria on hand-built grids plus one fixture spot-check; each quirk decision recorded with a test.
- Implementation plan: Where: utils/map/creep.ts, creep.test.ts. Follow: utils/map/climber.ts (T09). Don't touch: anything else.
- Stack: core. SENIOR. Blocked by: none.

### T28a Overlord-spot generator (SENIOR)
- Senior because: same as T28; the generator is the senior part.
- Source: T28, C16. Changed per the lead's decision 2026-10-28 (core-arch.decisions.md, R2-T28a): DEV-4 is rejected. The source is SC2MapAnalysis `extension/ma_ext.c`, `get_map_data` + `flood_fill_overlord`.
- What to build: `computeOverlordSpots(...)`, a faithful port of `get_map_data`/`flood_fill_overlord`. Inputs: raw uint8 terrain heights, walkable = max(pathing, placement). Output: float centroids as MA returns them (ares parity), no thinning.
- Acceptance criteria: the spot list equals what the C code yields on the fixtures (simple64 yields 0 spots, as MA does); the ported functions are named in the code; no DEV-4 text or tuning constants left over from the substitute.
- Implementation plan: Where: utils/map/overlord-spots.ts, overlord-spots.test.ts. Follow: utils/map/climber.ts. Don't touch: anything else.
- Stack: core. SENIOR. Blocked by: none. T28 then wires it (map-analysis, parse, targets) after T19.

### T36 RQ9 data and util files
- Source: T30, T32, T33; C17.
- What to build:
  - constants/dicts/ability-cooldown.ts: ares' 17 cooldowns in loops, ares' formula verbatim, `int(s × 22.4) + 6` (truncation, not rounding), with locusts padded by 8, not 6 (ares quirk, kept).
  - constants/dicts/morph-source.ts: ares does_not_use_larva, 6 entries.
  - utils/units/supply.ts: `totalSupply(units: Iterable<Unit>): number`, summing `foodRequired`.
  - packages/core/data/protoss_building_placements.yml: ares' file verbatim, with a header line naming source, patch 5.0.14 and the MIT licence.
- Acceptance criteria: 3 cooldowns spot-checked against ares; dict entries match ares; `totalSupply` test incl. structures (0) and an empty input; the YAML parses with `Bun.YAML.parse`.
- Implementation plan: Where: the four new files plus tests next to the two code files. Don't touch: anything else (wiring and the three dedupes are T30/T32/T33).
- Stack: core. Junior. Blocked by: none.

## T20 Path smoothing (RQ8 b)

- Source: RQ8 b; design C12; audits/r2-rq9.md §A.
- What to build: `smoothPath` from SC2MapAnalysis' `create_smoothed_path`; a `smoothing` option on findPath/nextPoint and on every behavior that takes `sensitivity`.
- API contract: C12.
- Acceptance criteria:
  - [ ] Without `smoothing`, every path is unchanged (existing tests untouched).
  - [ ] A straight open corridor smooths to start and goal. A path around an Infinity block keeps the corner nodes and never crosses the block. A detour around a high-cost blob is kept when the straight line costs more than 1.002 × the path. Paths under 3 nodes are returned unchanged.
  - [ ] Smoothing happens before sensitivity thinning (a test with both).
  - [ ] `findLowPriorityPath` ignores smoothing.
  - [ ] pathUnitToTarget, moveToSafeTarget and pathGroupToTarget pass `smoothing` through.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: utils/pathing/smooth.ts (+ smooth.test.ts); resources/pathing.ts (apply in the full-path helper); behaviors/combat/individual.ts, group.ts (option pass-through).
  - Interfaces: `smoothPath(path: Int32Array, data: Float32Array, width: number): Int32Array`.
  - Follow: SC2MapAnalysis `extension/ma_ext.c` `create_smoothed_path` (read the source; the step list in C12 is a summary); utils/pathing/astar.ts (octile step cost).
  - Don't touch: resources/influence.ts.
- Stack: core. Junior: C12 specifies the algorithm completely and the C source is public; the tests pin the behaviour.
- Blocked by: T19, T20a (wires its util).
- Slice siblings: T26, T27.

## T21 Creep resource (SENIOR)

- Senior because: per-loop caching and refresh cadences on the hot path (hundreds of tumors call `findEdgePosition`). Each ares quirk needs a keep-or-fix decision (audits/r2-zerg.md §1 "Quirks": dead params, HATCHERY-only filters, the early return in `get_next_tumor_on_path`, modulo cadences). Rounding at .5 differs between Python and JS. Two map_analyzer helpers (`lowest_cost_points_array`, `cy_point_below_value`) are known only from call sites and must be matched against core's `findLowestCostPoints`/`isPositionSafe`.
- Source: RQ1 c; design C13; ares managers/creep_manager.py.
- What to build: the `creep` resource per C13.
- API contract: C13.
- Acceptance criteria:
  - [ ] On a fixture with creep: tiles equal the creep cells. Edges are exactly the C13 rule (a hand-built 7×7 grid test plus one fixture spot-check), and cells within 2.5 of own hatcheries are excluded.
  - [ ] Coverage equals creep-and-pathable / pathable × 100 and refreshes no more often than every 112 loops. Edges refresh no more often than every 16 loops, with game steps 1, 4, 8 and 16 (cadence test).
  - [ ] `findEdgePosition` honours radius, closest/furthest, spreadDistance from existing tumors and queens' tumor targets, and the expansion mask. With `cache` it returns the same point for a queen for up to 64 loops.
  - [ ] `nextTumorOnPath`, `randomPosition` (injectable RNG in tests), `tumorLowestCostPosition`, `shouldSpreadTumors`, `overlordSpotterPositions` and `blocksExpansion` behave per audits/r2-zerg.md §1 and §5b. Each keep-or-fix quirk decision is listed in the ticket and covered by a test.
  - [ ] A step with 300 tumors on a fixture stays within a recorded budget (ad hoc, recorded in the ticket).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/creep.ts (+ creep.test.ts).
  - Interfaces: C13.
  - Follow: ares creep_manager.py; the `builtLoop` cache in resources/influence.ts; pathing.findPath / findLowestCostPoints / isPositionSafe; influence.getCleanGrid + addCost for the tumor-influence grid.
  - Don't touch: resources/influence.ts, resources/pathing.ts, resources/map.ts.
- Stack: core. SENIOR.
- Blocked by: T19, T21a (wires its functions).
- Slice siblings: T22, T23, T28.

## T22 Zerg behaviors: tumorSpreadCreep, useTransfuse

- Source: RQ1 c; design C14; ares tumor_spread_creep.py, use_transfuse.py.
- What to build: the two behaviors.
- API contract: C14.
- Acceptance criteria:
  - [ ] tumorSpreadCreep:
    - returns false when `creep.shouldSpreadTumors()` is false or the tumor's spread ability isn't available;
    - otherwise casts at the furthest edge within 10.2 with spread distance 1;
    - falls back to a random creep spot;
    - returns false when there's neither.
  - [ ] useTransfuse:
    - returns true while already transfusing;
    - casts on the first target under 40 % health with healthMax ≥ 50, in range 7 + radii + extraRange, not itself;
    - two queens in the same loop don't transfuse the same target;
    - returns false without a candidate or energy.
  - [ ] Confirm the transfuse ability id against ares `TRANSFUSION_TRANSFUSION` (core `EFFECT_TRANSFUSION` 1664) and record it.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: behaviors/combat/zerg.ts (+ zerg.test.ts).
  - Interfaces: C14.
  - Follow: `useAbility` in behaviors/combat/individual.ts; the behaviors resource's per-loop dedupe (resources/behaviors.ts) for the transfuse guard.
  - Don't touch: resources/creep.ts.
- Stack: core. Junior.
- Blocked by: T21.
- Slice siblings: T23, T27.

## T23 queenSpreadCreep (SENIOR)

- Senior because: the behavior is stateful through the creep resource's per-queen edge cache and the queen's current order target. Its ares flow has quirks (`cancelIfCloseEnemy` only acts OR-ed with `preMove`; a build issued while the ability is on cooldown when `preMove` is off), and each one needs a keep-or-fix call. It also scans edges in a radius of 200 every call, so the cache is its only perf guard.
- Source: RQ1 c; design C14; ares queen_spread_creep.py.
- What to build: `queenSpreadCreep`.
- API contract: C14.
- Acceptance criteria:
  - [ ] The flow per audits/r2-zerg.md §2b steps 1–9, each step covered by a fixture test (keep-safe while spreading, en-route queen left alone, pre-move while on cooldown, edge vs path target when coverage is over 20 %, move when more than 5 away, cast otherwise).
  - [ ] Each quirk decision is recorded in the ticket, and listed for T18's compatibility notes.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: behaviors/combat/zerg.ts (+ zerg.test.ts).
  - Interfaces: C14.
  - Follow: keepUnitSafe (individual.ts); creep resource cache (T21).
  - Don't touch: resources/creep.ts (ask T21's owner for cache changes).
- Stack: core. SENIOR.
- Blocked by: T22 (same file), T21.
- Slice siblings: T22, T27.

## T24 Spent creep tumors out of the abilities query (SENIOR)

- Senior because: it changes which own units get available-ability data each loop (systems/unit.ts:276-299). A wrong exclusion makes `abilityAvailable` false for a real caster with no error anywhere, and the query is shared by every unit.
- Source: audits/r2-zerg.md §2a perf note; ares hides spent tumors (main.py:254, :680-700).
- What to build: burrowed creep tumors that have already spread (no spread ability left; CREEPTUMORBURROWED with no available abilities from the last query) are left out of later batched ability queries. They are still units in every collection.
- Acceptance criteria:
  - [ ] A fixture with spent tumors: the batched request no longer lists them, and active tumors and every other unit are still listed.
  - [ ] An active tumor still gets `abilityAvailable(BUILD_CREEPTUMOR_TUMOR)` true.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: systems/unit.ts (the batched query), systems/unit.test.ts or a new systems/unit-abilities.test.ts. Follow: ares main.py:680-700. Don't touch: engine/create-unit.ts.
- Stack: core. SENIOR.
- Blocked by: consistency CS-I05 (systems/unit.ts).
- Slice siblings: T22.

## T25 actions.unloadByTag (SENIOR)

- Senior because: it is the first command that isn't a raw unit command (an `ActionUI` cargo-panel unload), so it bypasses the command arbiter. Its ordering against the step-end flush and the raw immediate path decides whether a same-loop rally or move on the container lands first.
- Source: RQ9 low-value list; design C15; ares custom_bot_ai.py:383-437.
- What to build: `actions.unloadByTag(container, passengerTag)`.
- API contract: C15.
- Acceptance criteria:
  - [ ] Sends ares' request pair: a raw no-op on the container, then `ActionUI.cargoPanel` unload with the passenger's index in `container.passengers` (fake client asserts the exact request).
  - [ ] An unknown passenger tag does nothing and logs at debug.
  - [ ] Documented as raw and non-arbitrated, like `sendAction`. Its order against queued commands is stated and tested.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: resources/actions.ts (+ actions.test.ts or a new actions-unload.test.ts if actions.test.ts is held), test/fake-client.ts if it needs to record UI actions. Follow: `sendAction` and the raw immediate path in resources/actions.ts. Don't touch: resources/command-arbiter.ts.
- Stack: core. SENIOR.
- Blocked by: T19; consistency CS-I07, CS-I08 (resources/actions.ts).
- Slice siblings: T26.

## T26 Nydus resource and nydus-aware path (SENIOR)

- Senior because: the nydus pair choice comes from map_analyzer's C extension (`astar_with_nydus`). The senior either ports it from the public source or ships the documented fallback (C15), and owns that call. The resource also runs a multi-loop travel state machine (queue order, bans, repointing on nydus death).
- Source: RQ1 c; design C15; ares managers/nydus_manager.py, path_manager.py:342-376.
- What to build: the `nydus` resource, its nydus-aware `nextPoint`, and `mapAnalysis.getRegionCells`.
- API contract: C15.
- Acceptance criteria:
  - [ ] Main nydus points per audits/r2-zerg.md §4 (perimeter cells minus townhall/geyser/ramp exclusions, furthest-first), with a guard for fewer than 2 nearby geysers.
  - [ ] `findNydusAtLocation` per ares (enemy/own start shortcuts; else the region's cells in the distance band, lowest cost under maxCost, no enemies within 12, visible preferred).
  - [ ] `nextPoint` uses a nydus pair only when it shortens the trip (the test map has a long walk and a nydus pair); cache 44 loops; cache cleared when a nydus dies. The ticket says whether MA's rule or the fallback shipped.
  - [ ] Travel state machine: one unload per exit nydus per loop, queens first, rally to exitTowards, 5 s ban, passengers read from every own nydus, travellers repointed on nydus death, cleared when none are left.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: resources/nydus.ts (+ nydus.test.ts); resources/map-analysis.ts (`getRegionCells`). Follow: ares nydus_manager.py; `actions.unloadByTag` (T25); map-analysis `getRegion`/`getPerimeter`; pathing.findPath. Don't touch: resources/pathing.ts.
- Stack: core. SENIOR.
- Blocked by: T19, T25, T28 (resources/map-analysis.ts).
- Slice siblings: T25, T27.

## T27 nydusPathUnitToTarget

- Source: RQ1 c; design C14; ares nydus_path_unit_to_target.py.
- What to build: the behavior.
- API contract: C14.
- Acceptance criteria:
  - [ ] Returns false within successAtDistance.
  - [ ] When the nydus resource returns tags, the exit point is safe (≤ exitMaxInfluence) and the unit isn't banned: registers the traveller, then SMARTs the entry nydus when the next point is the entry, or moves to the next point otherwise.
  - [ ] Otherwise moves along the plain path.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: behaviors/combat/zerg.ts (+ zerg.test.ts). Follow: pathUnitToTarget (individual.ts). Don't touch: resources/nydus.ts.
- Stack: core. Junior.
- Blocked by: T26, T23 (same file).
- Slice siblings: T22, T23, T26.

## T28 Overlord spots and ENEMY_NAT_HG_SPOT (SENIOR)

- Senior because: the wiring has to feed the generator exactly the inputs MA uses (raw uint8 heights, not core's /10 heights; walkable = max(pathing, placement), not core's live pathing grid). Spots are float centroids that the consume-once lookup and the build target have to handle. A wrong input gives plausible-looking but wrong spots with no error. (The generator itself is T28a, a faithful port of ma_ext.c `get_map_data` + `flood_fill_overlord`; DEV-4 is rejected, decision 2026-10-28.)
- Source: RQ1 c (overlord spots), RQ9 (ENEMY_NAT_HG_SPOT); design C16; ares terrain_manager.py:307-398, build_order_runner.py:762-770.
- What to build: overlord spots on mapAnalysis, consumed by `takeOverlordSpot`, and the `ENEMY_NAT_HG_SPOT` build target resolved through it.
- API contract: C16.
- Acceptance criteria:
  - [ ] `getOverlordSpots()` equals T28a's `computeOverlordSpots` output for the map, computed once per game (acropolis and blueshift snapshotted; simple64 empty, below).
  - [ ] `takeOverlordSpot` returns the nearest unused spot, never the same spot twice in a game, and the map centre when none are left. It resets per game.
  - [ ] An `ENEMY_NAT_HG_SPOT` step parses, and resolves to `takeOverlordSpot(towards(enemyNatural, mapCenter, 10))`.
  - [ ] Wiring per the T28a decision: the generator gets the raw uint8 terrain heights (the start-raw height map, not `getHeight`'s /10 value) and walkable = max(start pathing, start placement) per cell. A test pins both against a fixture.
  - [ ] Spots stay float centroids end to end. `takeOverlordSpot` compares by distance, and consume-once removes the exact returned spot (no key collision from rounding). The build target passes the float position on as is.
  - [ ] simple64 yields 0 spots, as MA does: `getOverlordSpots()` is empty, `takeOverlordSpot` returns the map centre, and an `ENEMY_NAT_HG_SPOT` step on simple64 resolves to the centre without throwing (test). Acropolis and blueshift snapshots are non-empty.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: new utils/map/overlord-spots.ts (+ test); resources/map-analysis.ts; utils/build-order/parse.ts (drop the throw at :60); utils/build-order/targets.ts. Follow: utils/map/climber.ts (T09, grid util on fixtures); `ENEMY_NAT_VISION` in targets.ts. Don't touch: systems/builder-plugin.ts.
- Stack: core. SENIOR.
- Blocked by: T19, T28a (wires its generator). Not concurrently with T15 if T15 edits utils/build-order/targets.ts.
- Slice siblings: T21, T26.

## T29 Adept shades ignored until near completion

- Source: RQ9; design C17; ares main.py:738-799, :866-889; audits/r2-rq9.md §B.
- What to build: influence skips an enemy ADEPTPHASESHIFT until 120 loops after it was first seen; the first-seen map is pruned after 160 loops plus a margin and reset per game.
- Acceptance criteria:
  - [ ] Fake enemy shade first seen at loop L: no ground cost at L and L+119, its normal cost at L+120. A second shade seen later is tracked separately.
  - [ ] The first-seen map is empty after the shade disappears plus 160 loops, and after reset.
  - [ ] Other enemy units are unaffected (existing influence tests unchanged).
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: resources/influence.ts (the enemy loop in `build()`, state field), resources/influence.test.ts. Follow: the per-game state in influence.ts. Don't touch: resources/memory.ts (shades still exist as units; only the grid ignores them, which differs from ares hiding them everywhere and is documented by T18).
- Stack: core. Junior.
- Blocked by: T11 (resources/influence.ts).
- Slice siblings: none.

## T30 Ability cooldown tracker

- Source: RQ9 ("port if possible"; ares managers/ability_tracker_manager.py, dicts/ability_cooldowns.py); design C17. ares tracks only widow mines and nothing reads its tracker. Core ports the general mechanism because a bot that sets `skipAvailableAbilitiesQuery` has no other cooldown source.
- What to build: the `abilityTracker` resource, wired to the cooldown table that R2-T36 already shipped (constants/dicts/ability-cooldown.ts); T30 doesn't write or change the table.
- Acceptance criteria:
  - [ ] Cooldowns come from constants/dicts/ability-cooldown.ts unchanged (ares' `int(s × 22.4) + 6`, locusts + 8); one test reads a value through the tracker.
  - [ ] `used` then `ready` false until `readyAt`, true from then on. Untracked pairs are ready. `setCooldown` changes later `used` calls only. State resets per game.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: resources/ability-tracker.ts (+ test; it imports constants/dicts/ability-cooldown.ts, exists since R2-T36; don't edit it). Follow: resources/roles.ts (small resource with per-game state). Don't touch: systems/unit.ts.
- Stack: core. Junior.
- Blocked by: T19, T36 ✓ (cooldown table shipped).
- Slice siblings: none.

## T31 Build runner: Protoss supply −1 and buildCompleted

- Source: RQ9; design C17; ares build_order_runner.py:307-318 (supply), :213-220 (build_completed).
- What to build: Protoss non-pylon structure steps start one supply earlier; `system.buildCompleted` is a read-only getter on a build system.
- Acceptance criteria:
  - [ ] Protoss agent: a gateway step at 14 starts at supply 13, and a pylon step at 14 still waits for 14. Terran and Zerg are unchanged.
  - [ ] `buildCompleted` is false until the `buildComplete` hook would fire, then true. It resets on game start and opening switch. There's no setter.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: systems/builder-plugin.ts (supply gate around :204-219, :347, :554), systems/builder-plugin.test.ts. Follow: the existing gate. Don't touch: resources/buildings.ts.
- Stack: core. Junior.
- Blocked by: T15 (systems/builder-plugin.ts), T19 (the getter's type).
- Slice siblings: T12, T15.

## T32 ares Protoss placement data (opt-in)

- Source: RQ9; design C17; audits/r2-rq9.md §F.
- What to build: ship ares' protoss_building_placements.yml (patch 5.0.14, 7 maps, MIT; keep the licence header note) as packages/core/data/protoss_building_placements.yml, plus `loadAresProtossPlacements()` that parses it with T16's importer. Never loaded by default.
- Acceptance criteria:
  - [ ] `createPlacer(loadAresProtossPlacements())` on a fixture world named like one of the 7 maps yields placements equal to a hand-checked sample. On other maps it yields none.
  - [ ] The data file is in the published package (package.json `files`, if used) and is read relative to the module, not the cwd.
  - [ ] Docs delta: the maps and patch the data is for, and that it goes stale with map updates.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: packages/core/data/protoss_building_placements.yml (new), utils/placement/placer.ts, a test next to it, package.json (if needed). Follow: T16's `parseAresPlacements`. Don't touch: resources/placement.ts.
- Stack: core. Junior.
- Blocked by: T16, T36 (data file).
- Slice siblings: T16.

## T33 Small RQ9 helpers

- Source: RQ9 low-value list; design C17; audits/r2-rq9.md §G.
- What to build:
  - `minShield` on `mining.selectWorker` (Protoss only);
  - `spatial.anyInRangeBatch` (a loop over `anyInRange`, without ares' index-0 bug);
  - the `speedMining` behavior over the mining resource's internal speed-mine step (exported from mining.ts for it);
  - `totalSupply(units)`, replacing the three local copies;
  - constants/dicts/morph-source.ts (ares' 6 entries).
- Acceptance criteria:
  - [ ] Each helper has a test. ares' `any_enemies_in_range` index-0 bug is not reproduced (a test with a single unit at index 0).
  - [ ] behaviors/combat/spells.ts, terran.ts and examples/ares/custom-behaviors.ts use `totalSupply`; behaviour unchanged.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: resources/mining.ts, resources/spatial.ts, behaviors/macro/speed-mining.ts, utils/units/supply.ts, behaviors/combat/spells.ts, behaviors/combat/terran.ts, examples/ares/custom-behaviors.ts, constants/dicts/morph-source.ts, tests next to each. Follow: ares speed_mining.py; resources/mining.ts:433-455. Don't touch: resources/influence.ts.
- Stack: core. Junior.
- Blocked by: T19, T36 (totalSupply, morph dict); consistency CS-I07, CS-I08 (resources/mining.ts).
- Slice siblings: none.

## T34 Previous-loop own army and morphed enemy tags

- Source: RQ9 low-value list; design C17; ares unit_cache_manager.py:273, :317.
- What to build: `units.getPreviousArmy()` (own army as of the previous loop) and `units.getMorphedEnemyTags()` (enemy tags dropped this loop because they morphed into a type from the morph-source dict, or HELLION↔HELLIONTANK).
- Acceptance criteria:
  - [ ] Two-step fixture test: the previous army equals the first step's army. An enemy zergling that becomes a baneling shows its old tag in `getMorphedEnemyTags` for exactly one loop.
  - [ ] Both reset per game.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: resources/units.ts, systems/unit.ts (the snapshot at step start, the morph detection), tests. Follow: systems/unit.ts `unitTypeChanged`. Don't touch: resources/memory.ts.
- Stack: core. Junior.
- Blocked by: T19, T36 (morph-source dict), T24 (systems/unit.ts).
- Slice siblings: none.

## T35 Arcade mode (SENIOR)

- Senior because: it's cross-cutting. Every resource that assumes start locations or townhalls (mining, placement, intel, map-analysis bases, nydus, map) needs a guard. A wrong guard either still throws on arcade maps or silently disables a resource on a normal map. And there are no arcade fixtures, so the senior builds one (a fixture without enemy start locations or townhalls).
- Source: RQ9 low-value list; design C17; ares main.py:148, :357.
- What to build: `map.isArcade()`, true when the game starts with no enemy start location or no own townhall. On such maps, the listed resources skip their per-step work instead of throwing.
- Acceptance criteria:
  - [ ] An arcade fixture (derived from an existing one with start locations and townhalls removed) runs 50 steps with no resource error logged.
  - [ ] On the normal fixtures `isArcade()` is false and every existing test is unchanged.
  - [ ] lint, tsc and tests green.
- Implementation plan: Where: resources/map.ts, resources/mining.ts, resources/placement.ts, resources/intel.ts, resources/map-analysis.ts, resources/nydus.ts, a fixture under fixtures/, tests. Follow: ares arcade-mode guards (resource_manager.py:121, 225, 245; placement_manager.py:218, 235; intel_manager.py:136, 397). Don't touch: systems/.
- Stack: core. SENIOR.
- Blocked by: T26 (nydus.ts, map-analysis.ts), T28, T33 (mining.ts), T15 (placement.ts), consistency CS-I13a (intel.ts).
- Slice siblings: none.

## Runnable now (snapshot 2, 2026-10-28; priority list for "run anything and everything")

Based on core-arch.status.md, which is newer than the lead's last message: CS-PM03, I10 and R2-T09 are approved. In flight: CS-PM04, R2-T08, R2-T13, CS-I13 (unsplit), CS-I14. Approved and therefore free: CS-I02, I04, I05, I07, I08, I12, PM01, PM14, PM16, PM17, CS-D01–D10, R2-T01–T07, T09.

Can start now, all in parallel; file sets are disjoint from each other and from the in-flight set:

| ticket | blockers | files |
|---|---|---|
| R2-T24 spent tumors out of the abilities query (SENIOR) | CS-I05 ✓, CS-I10 ✓ | systems/unit.ts, systems/unit-abilities.test.ts (new) |
| R2-T20a smoothPath util (junior) | none (new files) | utils/pathing/smooth.ts, utils/pathing/smooth.test.ts |
| R2-T21a creep grid functions (SENIOR) | none (new files) | utils/map/creep.ts, utils/map/creep.test.ts |
| R2-T28a overlord-spot generator (SENIOR) | none (new files) | utils/map/overlord-spots.ts, utils/map/overlord-spots.test.ts |
| R2-T36 RQ9 data and util files (junior) | none (new files) | constants/dicts/ability-cooldown.ts, constants/dicts/morph-source.ts, utils/units/supply.ts, data/protoss_building_placements.yml, tests next to the code files |
| CS-D09 docs deltas so far | CS-D08 ✓ | docs/*.md, GLOSSARY.md, docs/changelog.md, examples/README.md. Applies the deltas recorded so far (PM01, PM02, PM13, PM14, PM15, PM16, PM17, PM03, the D10 nits); PM tickets that finish later edit docs themselves |
| CS-I15 (partial: pathing/spatial/units/flying tests) | CS-I11 ✓, CS-I12 ✓ | test/create-test-world.ts, resources/{pathing,spatial,units,flying}.test.ts. The intel/buildings/influence tests wait for CS-I13. Check CS-PM04's caller grep first: if PM04 is migrating `actions.*` calls in any of these test files, those files wait for it. |

Not runnable now, and why:
- **Only the types.ts order blocks them:** T12, T14, T15, T16 and T19 (all need T08's types), T10 (T08's types plus its influence.ts placeholders), and CS-PM05 onward (types.ts). Reordering doesn't help: types.ts is already held by two in-flight tickets (PM04 and T08). The new-file splits above are how to start more parity work now. T20/T21/T28/T30/T33/T32 then do only the wiring once T19 lands.
- CS-I06 is held by R2-T13 (agent/macro.ts), CS-I13 (buildings.ts, builder-plugin.ts) and CS-PM04 (actions.ts).
- R2-T25, T33 (rest), T34, T35, T26, T27, T22, T23, T29, T11, T31 are behind T19 or their lanes (order below).

Conflicts among the tickets already in flight (lead to settle):
- **R2-T08 ↔ CS-I13 on resources/influence.ts:** T08 adds layer placeholders; I13 does the influence remnants. Recommend CS-I13 leaves influence.ts out; that's CS-I13b, which runs after T08 in the influence lane.
- **CS-I13 ↔ CS-I14 on behaviors/combat/terran.test.ts:** I13 has the `toPoint`/`isFlying` import repoint; I14 has the helper migration. One of them takes the file and the other waits; recommend I14 owns it and does the import repoint too.
- **CS-PM04 ↔ CS-I13 / R2-T13 on caller files:** PM04 migrates `actions.*` callers, which may include behaviors/combat/*, systems/builder-plugin.ts, resources/buildings.ts and agent/macro.ts. Recommend PM04 leaves any caller file another ticket holds until that ticket lands.

## Runnable order with the consistency queue (2026-10-28)

The order runs from left to right. Tickets on the same row can run in parallel; their file sets don't overlap. T09 (lead, new files only) is left out. In flight from consistency.md's last snapshot: CS-PM14, PM16, PM17, I02, I05, I12, CS-DFIX → D08; nothing below starts on their files until they land.

**Shared-file chains** (strictly serial; each later ticket also needs its other blockers):
- types.ts (as run, 2026-10-28): CS-PM03 ✓ → CS-PM04 + R2-T08 (in flight together, lead's call) → CS-PM18 → R2-T19 → CS-PM05 → PM06 → PM07 → PM08 → PM09 → PM10.
- systems/builder-plugin.ts: T12 → T15 → T31 → CS-I06 → CS-I13a.
- resources/influence.ts: T08 → T10 → T11 → T29 → CS-I13b.
- resources/placement.ts: T08 → CS-I04 → T15 → T35 → CS-PM05 → PM06.
- resources/actions.ts: CS-I07 → CS-I08 → T25 → CS-PM04 → CS-I06 → CS-PM05.
- resources/mining.ts: CS-I07 → CS-I08 → T33 → T35 → CS-PM09.
- resources/map-analysis.ts: T19 → T28 → T26 → T35.
- systems/unit.ts: CS-I05 → T24 → T34 → CS-I10.
- systems/map.ts: CS-PM17 → CS-I04 → CS-I08 → CS-I10 → CS-PM07.
- agent/macro.ts: T13 → CS-I07 → CS-I08 → CS-I06 → CS-PM05.
- behaviors/combat/zerg.ts: T22 → T23 → T27.
- behaviors/combat/individual.ts, group.ts: T20 → CS-I13a (helpers/terran only, no overlap) → CS-PM10.
- docs/: CS-D08 → CS-D09 → T18 (later PM tickets edit docs after T18).

**Waves:**

| wave | tickets (parallel) | starts when | file sets |
|---|---|---|---|
| 1 (now) | T13 | — (T04 ✓, RQ5 a) | agent/macro.ts:341-386, new agent/expansion.test.ts (agent/macro.test.ts is CS-I12's) |
| 1 | T24 | CS-I05 lands | systems/unit.ts, systems/unit-abilities.test.ts (new) |
| 2 | T08 | CS-PM14 lands | types.ts, constants/influence.ts, resources/influence.ts, resources/placement.ts (stubs), behaviors/macro/protoss.ts, utils/config/ares-yaml.ts, utils/placement/placer.ts, behaviors/index.ts, index.ts |
| 2 | CS-PM01 | CS-I02 lands | engine/errors.ts, systems/create-system.ts, engine/create-resource-manager.ts, engine/create-engine.ts, engine/create-client.ts (+ tests) |
| 3 | T19 | T08, CS-I05 | types.ts, engine/create-world.ts, resources/{actions,map-analysis,mining,spatial,units,map}.ts (stub lines), new resources/{creep,nydus,ability-tracker}.ts, behaviors/combat/zerg.ts, behaviors/macro/speed-mining.ts, utils/pathing/smooth.ts, utils/units/supply.ts, constants/build-target.ts, behaviors/index.ts, index.ts, utils/placement/placer.ts |
| 3 | T10 | T08, T09 | resources/influence.ts, constants/influence.ts, resources/influence.test.ts |
| 3 | T12 | T08 | new utils/build-order/gas-steal.ts, systems/builder-plugin.ts, resources/openings.ts (+ tests) |
| 3 | T14 | T08 | behaviors/macro/protoss.ts (+ test) |
| 3 | CS-I04 | T08, CS-I02, CS-PM17 | resources/placement.ts, utils/map/blockers.ts, systems/map.ts |
| 4 | T20 | T19 | utils/pathing/smooth.ts, resources/pathing.ts, behaviors/combat/individual.ts, group.ts (+ tests) |
| 4 | T21 | T19 | resources/creep.ts (+ test) |
| 4 | T28 | T19 | utils/map/overlord-spots.ts, resources/map-analysis.ts, utils/build-order/parse.ts, utils/build-order/targets.ts (+ tests) |
| 4 | T30 | T19 | resources/ability-tracker.ts, constants/dicts/ability-cooldown.ts (+ test) |
| 4 | T11 | T10 | resources/influence.ts, constants/influence.ts (+ test) |
| 4 | T15 | T12, CS-I04 | resources/placement.ts, systems/builder-plugin.ts (+ tests; targets.ts only if T28 has landed) |
| 4 | CS-I07 | T13, T19, CS-PM01, CS-I02, CS-I05 | utils/collections.ts, utils/get-random.ts, resources/{actions,roles,mining,behaviors,flying,debug,squads,units-collection}.ts, agent/{macro,create-agent}.ts, engine/create-engine.ts, systems/{create-system,unit-plugin}.ts |
| 5 | T22 | T21 | behaviors/combat/zerg.ts (+ test) |
| 5 | T29 | T11 | resources/influence.ts (+ test) |
| 5 | T16 | T15 | engine/config.ts, utils/config/ares-yaml.ts, utils/placement/placer.ts, examples/ares/custom-building-placements.ts, fixtures (ares YAML) |
| 5 | T31 | T15 | systems/builder-plugin.ts (+ test) |
| 5 | CS-I08 | CS-I07, CS-I04 | utils/geometry/{point,units}.ts, resources/{units-collection,map,mining,actions}.ts, utils/combat/combat-sim.ts, engine/create-unit.ts, systems/map.ts, agent/macro.ts, engine/data-storage.ts |
| 6 | T23 | T22 | behaviors/combat/zerg.ts |
| 6 | T25 | CS-I08 | resources/actions.ts, test/fake-client.ts (+ test) |
| 6 | T33 | CS-I08 | resources/{mining,spatial}.ts, behaviors/macro/speed-mining.ts, utils/units/supply.ts, behaviors/combat/{spells,terran}.ts, examples/ares/custom-behaviors.ts, constants/dicts/morph-source.ts |
| 6 | T32 | T16 | data/protoss_building_placements.yml, utils/placement/placer.ts, package.json |
| 6 | CS-PM03 | T19, CS-I08 | types.ts, utils/geometry/point.ts, engine/data-storage.ts, resources/map.ts (callers), bot/ (anchor.ts, offense.ts) |
| 6 | CS-I13b | T29 | resources/influence.ts |
| 7 | T26 | T25, T28 | resources/nydus.ts, resources/map-analysis.ts (+ tests) |
| 7 | T34 | T33, T24 | resources/units.ts, systems/unit.ts (+ tests) |
| 7 | CS-I06 | T31, CS-I08, T25 | utils/economy.ts, agent/{macro,create-agent}.ts, resources/{actions,buildings}.ts, systems/builder-plugin.ts, behaviors/macro/{tech,structures,spawn}.ts (+ tests) |
| 7 | CS-PM04 | CS-PM03, T25 | types.ts, resources/actions.ts, every actions.* caller (grep at start; wait for any caller file in flight), examples/, bot/ |
| 8 | T27 | T26, T23 | behaviors/combat/zerg.ts |
| 8 | CS-I13a | CS-I06, T33, CS-I07, CS-I08 | resources/{buildings,intel}.ts, systems/builder-plugin.ts, behaviors/combat/{helpers,terran}.ts |
| 8 | CS-I10 | T34, CS-I08 | engine/per-world.ts, systems/unit.ts, systems/map.ts, utils/map/blockers.ts |
| 9 | T35 | T26, T28, T33, T15, CS-I13a | resources/{map,mining,placement,intel,map-analysis,nydus}.ts, fixtures/ (arcade), tests |
| 9 | T17 | T02, T03, T10, T12, T15, T16, T20 | examples/ares/{influence-and-pathing,custom-building-placements,build-runner}.ts + tests |
| 9 | CS-I14 | T20, T22, T23, T27, T33, CS-I12 | behaviors/{combat,macro}/*.test.ts, test/behavior-helpers.ts |
| 9 | CS-I15 | CS-I13a/b, T20, T29, T33, T34, CS-PM16 | test/create-test-world.ts, resources/{intel,buildings,influence,pathing,spatial,units,flying}.test.ts |
| 10 | CS-PM05 → PM06 → PM07 → PM08 → PM09 → PM10 → PM11 | serially, each after the previous and after T35, CS-I13a/b, CS-I10 | per consistency.md tickets (broad caller sets; run alone) |
| 10 | CS-D09 → T18 | CS-D08; T18 after every R2 ticket | docs/*.md, examples/README.md, docs/changelog.md |

Notes:
- CS-I13 is split into CS-I13a (buildings/builder-plugin/intel/behaviors helpers) and CS-I13b (influence.ts) so the influence lane doesn't wait on the builder-plugin lane (consistency.md updated).
- Seniors: T21, T23, T24, T25, T26, T28, T35 (and T09). Everything else is junior.
