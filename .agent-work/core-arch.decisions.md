# core-arch decisions

## 2026-10-26 — scope
Asked by: user. Affects: all.
Fix two architecture issues found in the ares gap analysis (see ares-gap.md):
1. Closed ResourceContainer (types.ts:782) + hand-maintained createWorld/resetGameState (engine/create-world.ts) → resources register themselves with their own reset.
2. No unit-command arbitration: agent systems run concurrently (engine/create-engine.ts:589) and command units directly via actions.do/sendAction or queueAction; only identical-order dedupe (resources/actions.ts:64); last writer wins. Need a single step-end command executor/arbitration point.
User words: "plan fixing 1 and 2". Tier: "change, slug core-arch".

## 2026-10-26 — .agent-work gitignore
User chose: "Add to .gitignore" (goes in the PR).

## 2026-10-26 — architect open questions Q1–Q7
Asked by: technical-architect. Affects: technical-architect, business-analyst, developers.
- Q1 built-in resource defs: one CORE_RESOURCES array in engine/create-world.ts. User: "Accept all (Recommended)".
- Q2 plugin registration: explicit world.resources.register(def) per world (e.g. in system setup), types via declaration merging in plugin's own file. User: "Explicit register() (Recommended)".
- Q3 same-priority tie-break: registration order (agent.use() order). User: "Accept all (Recommended)".
- Q4 command return: Promise<void> resolved on proposal, PLUS a commandResults event delivered next step (won/dropped/rejected per command). User: "void + result event".
- Q5 settings.batchActions: remove. User: "Accept all (Recommended)".
- Q6 train/research on same structure from different systems: arbitrate like any command; loser retries next step. User: "Arbitrate normally (Recommended)".
- Q7 swapBuildings: stays on raw immediate send path. User: "Accept all (Recommended)".

## 2026-10-26 — plan approved + autonomy + scope → ares parity
Asked by: team lead. Affects: everyone.
Plan core-arch.md approved as-is incl. no refund on drop, rejected build frees worker immediately, agent handlers beat systems at equal priority, Q8 (T02 parallel with T01).
User words: "go. and keep going, no need to ask for every step. use best judgement to get ares parity"
Consequences: re-tier to build. After T01–T05, continue with ares gap items (ares-gap.md ranked list) in phases, without per-step user approval. Team lead decides open design questions on best judgement and logs them here. Still no push/PR without user; bot/ stays untouched (CLAUDE.md).

## 2026-10-26 — shipping: no PRs, straight to main
User words: "no PRs btw, straight to main"
How (shipping): team lead commits reviewed tickets on core-arch, rebases on origin/main and pushes core-arch:main. Never touch the user's main checkout (it has uncommitted bot/ work).

## 2026-10-26 — T02 ALS + Bluebird leak (team lead, best judgement)
senior-backend-2 found ALS context leaks across callbacks of Bluebird promises (.then/.map) under Bun 1.4.3 + Bluebird 3.7.2; `Bluebird.config({ asyncHooks: true })` fixes all cases. Decision: option (a), call Bluebird.config({ asyncHooks: true }) once in command-context.ts, with a regression test. Why: it fixes the hazard for any handler code using Bluebird, while swapping dispatch to Promise.all alone wouldn't.

## 2026-10-26 — T02 arbiter details (team lead, best judgement)
- Generic arbitrate<P extends Proposal> returning { commands: Emitted<P>[], dropped } — accepted (architect approved).
- Committed tags: the SAME owner may still command a tag it raw-sent / early-flushed this step (its own follow-ups pass); only other owners need to strictly outrank. Why: a system's own sequence shouldn't be blocked by itself.
- Same-owner grouping by owner string; cross-owner identical priority+rank tie → earliest seq. Accepted.

## 2026-10-26 — parity-2 design decisions D1–D11 (technical-architect; accepted by team lead per user mandate)
- D1 per-step updates via new ResourceDefinition.onStep (sync, registration order, after engine systems, before agent).
- D2 spatial + influence built lazily once per game loop on first access.
- D3 ghosts stay in the units store; expiry deletes them (30s ground/air, ares defaults); re-seen forgotten tag doesn't refire enemyFirstSeen; burrowed ghosts kept until expiry.
- D4 spatial = uniform bucket grid on typed arrays, center-to-center distance.
- D5 army value = stateless query on units (getArmyValue), not a resource.
- D6 pathing = own typed-array A* with reused buffers; map.path/PF.js stay for static analysis.
- D7 ares grid conventions: 1 free, Infinity blocked, safe ≤ 1.
- D8 layers ground/air/groundAvoidance/airAvoidance; climber/tactical/airVsGround/groundToAir deferred.
- D9 effects: storm, bile, lib zones, lurker spines, blinding cloud, nuke (while present); skip KD8, parasitic bomb, landing prediction.
- D10 configure() settings survive game reset.
- D11 ghosts count in enemy spatial + influence.

## 2026-10-26 — parity-2 ticket assumptions PA1–PA4 accepted (team lead)
PA1 getArmyValue signature + stub land in parity-2 T01. PA2 parity-2 T05 (stamp/constants) and T07 (pure A*) unblocked now (new files only). PA3 perf budget: 50 nextPoint calls with danger over ≥¼ map < 10ms total. PA4 ticket ids local per file; cross-refs as "core-arch Tnn".

## 2026-10-26 — T02 review fixes (team lead)
Same-owner rule fixed so the holder's owner keeps a committed tag even when a third owner ranks between its old and new context. Drop groups keyed by proposal identity. Tagless proposals: T03 rejects at queue time (ActionManagerError), arbiter unchanged. T03 reports dispatch timing with/without Bluebird asyncHooks.

## 2026-10-26 — documentation plan required
User words: "dont forget to plan the updating of the documentation"
How: business-analyst writes .agent-work/docs-plan.md (inventory of packages/core readme.md + docs/*, which doc sections each phase changes/adds, ownership: every phase has a final docs ticket, keep readme/api/changelog consistent). Every phase spec must include a docs ticket per that plan.

## 2026-10-26 — parity-2 T05 constants (team lead)
- Skip-list test deleted by test gate: accepted. The skipped ares entries (KD8Charge, ParasiticBomb, forcefield handler, climber/airVsGround/groundToAir/tactical/priority layers) are documented in the docs "differs from ares-sc2" section (P2 T09) instead.
- Spine crawler: keep the added entry (ground, weight 22, range 7). ares has no handler — deliberate fix, documented as a difference.
- Banelings: DO add to groundAvoidance (ares' handler is dead code because WEIGHT_COSTS is checked first). Why: for a Terran bio bot, baneling avoidance is the most valuable avoidance case; deliberate fix, documented as a difference.

## 2026-10-26 — parity-3 design decisions P3-D1–D14 (technical-architect; accepted by team lead)
D1 combat sim = pure exported functions (canWinFight, simulateFight), not a resource. D2 own deterministic focus-fire time-step on calculateDpsVsTarget with per-type DPS cache. D3 no splash/healing/spells/terrain/micro/goodPositioning (documented limits). D4 EngagementResult uses ares 0–10 scale/buckets. D5 roles in a `roles` resource, not labels (unit-plugin label semantics). D6 default role ares-style: workers except MULE → GATHERING, once per tag, configurable defaultRole. D7 role ownership = roles.as(role) → actions.as({owner:'role:<ROLE>'}) + opt-in `exclusive` arbiter filter (drop reason 'not-owner'). D8 squads = separate lazy resource, clustered once per loop per (role, types). D9 squad merge smaller→larger, deterministic counter ids (deviation from ares). D10 intel = onStep resource registered after pathing; sticky flags + threat hysteresis. D11 rush rules gate on unit types, not race. D12 `greedy` defined by us: 2nd T/P townhall < 65s, 3rd hatch < 90s (configurable; ares never sets it). D13 new `enemyStrategyDetected` event once per flag. D14 sim HP includes shields both sides (ares omits own shields).
Scheduling: P3 Q2 (sim, new files) unblocked; Q1 scaffolding after parity-2 T01 + Q2; phase-4/6a scaffolding chained after P3 Q1 (shared types.ts/create-world.ts/index.ts); P3 Q5 (arbiter + actions.ts flush) after core-arch T03/T04, never parallel with phase-4 tickets touching actions.ts.
ares source re-cloned at /tmp/claude-1000/-home-bram-code-other-sc-bot-core-arch/04392267-2dfa-4dcb-bdfd-9b007e57092a/scratchpad/ares/ares-sc2/src/ares (old path gone).

## 2026-10-26 — parity-4 ticket assumptions PA4-1..7 (BA-2; accepted by team lead)
PA4-1 scaffolding chain P2 T01 → P3 T02 → P4 T04 → P6a scaffolding. PA4-2 phase-3 roles/intel contract confirmed. PA4-3 P4 T03 (map lift/land) blocks T05. PA4-4 actions.ts "not in parallel" constraints sequenced by team lead (P4 T10/T11 vs P3 T05). PA4-5 standard mining lands in T07, speed/safety/self-defence/LDM in T08. PA4-6 live smoke tests are T12 (needs local SC2). PA4-7 P4 T03 re-check vs 6a systems/map.ts edits.

## 2026-10-26 — parity-6a design decisions 6a-D1–D19 (technical-architect-3; accepted by team lead)
D1 new `mapAnalysis` resource (resources/map.ts + systems/map.ts untouched → P4-T03 unblocked). D2 lazy once per game, triggered by first onStep; features.eagerMapAnalysis. D3 clearance (EDT) watershed + persistence merging, 4-connectivity (no map_analyzer). D4 defaults maxChokeWidth 14, peakRatio 2.2, minRegionArea 150. D5 analysis grid = startRaw pathing with own start townhall 5x5 cleared; minerals walkable; structures ignored. D6 regions not split by height; choke.ramp links ramps (deviation, documented). D7 defensive choke = base region's choke on shortest ground route to target (enemy main default); position 4 cells back. D8 cached Dijkstra distance fields (≤32). D9 defensive third = getThirds() with longer pathFromEnemy. D10 overlord/scout spots deferred with #14 (Zerg). D11 budget: analysis ≤50ms median on acropolis, cold getDefensivePosition all expansions ≤100ms — AMENDED: measured ad hoc per perf rule, no committed wall-clock test. D12 config = JSON `sc-bot.config.json` in cwd or SC_BOT_CONFIG path. D13 precedence env STEP_COUNT > createEngine({config}) > file > defaults. D14 registry passes config.resources.<name> to configure() after create + every reset. D15 malformed/explicitly-named-missing file throws at createEngine; unknown keys warn. D16 features: chatDebug (false), eagerMapAnalysis (true). D17 chat debug = engine-held system, reader 'agent', own player's chat only, ares command set. D18 enemy race detected in agent onStep from first live enemy's UnitTypeData.race; sets opponent.race, fires `enemyRaceDetected` once. D19 workersPerGas = per-call option distributeWorkers(ratio, {workersPerGas}) 0–3 (RangeError); phase-4 mining must use the same name/semantics.
AMENDED: D15 unknown top-level config keys kept on world.config without warning (CoreConfig is an interface, extendable by declaration merging; only unknown keys inside `features` warn) — so 6b can add `builds`. workersPerGas: in mining it's a MiningSettings field validated by configure() (same name/range 0–3, RangeError); only distributeWorkers takes it per call. NEW D20 mapAnalysis.getPerimeter(region) (edge cells sorted by angle) + getEnemyMainRamp() for the 6b worker scout.
Sequencing: scaffolding chain P2 T01 → P3 T02 → P4 T04 → 6a-T01 → P5 T01. 6a-T05 (create-agent.ts) free; 6a-T06 (macro.ts) after core-arch T04 and never parallel with P4-T11. 6a-T02 (chokes/distance-field, new files) unblocked.

## 2026-10-26 — parity-6b design decisions P6b-D1–D11 (technical-architect; accepted by team lead)
D1 extend existing builder-plugin (strict order, earmarks, skip/pause kept); string steps compile to [supply, task] tuples. D2 openings JSON via 6a config `resources.openings` or inline. D3 default keeps core's worker insertion to reach step supply; constantWorkerProductionTill > 0 switches to ares supply-gate semantics; never stacked. D4 no ares minerals>470 look-ahead — strict order is the user's deliberate choice (commit 4c6dce6). D5 proxy targets (enemy side, MAP_CENTER) use findPlacement near the point. D6 `openings` resource = ares data manager: cycle/winrate per opponent id then race, JSON history in dataDir (opt-in, nothing written by default). D7 new ResourceDefinition.onGameEnd hook, called before options.onGameEnd. D8 worker scout via mining.selectWorker({role:'BUILD_RUNNER_SCOUT'}) inside roles.as; keeps role. D9 persistent builder via selectWorker({role:'PERSISTENT_BUILDER'}) passed as buildings.build worker; released at opening end. D10 not ported (documented): ENEMY_NAT_HG_SPOT, gas-steal handling, Protoss supply−1 start; overlord scout defaults ENEMY_NAT_VISION; no overlord-spot follow-up (Terran bot). D11 parse errors throw NodeSC2Error at game start naming the step.
Scheduling: O1 parser (new files) unblocked; O3 scaffolding last in chain (after P5-T01, 6a-T01, O1); O5 → O6 builder-plugin serial after P4-T11/T10/T07, P3-T03, P5-T06. No actions.ts/macro.ts edits.

## 2026-10-26 — parity-6b ticket assumptions (BA; team lead)
PA1 scaffolding chain final: P2 T01 → P3 T02 → P4 T04 → P6A-T01 → P5 T01 → P6b T02. PA2 gas steal: port our own gas-steal step (cheap, roadmap lists it, parity mandate) as an architect delta (e.g. `GAS @ENEMY_SPAWN` / ares gas_steal semantics) folded into P6b T03/T05; handling the enemy stealing our gas stays excluded and documented. PA3 openings exit met by T05 fixture end-to-end opening (no new live test). PA4 parseBuildOrder documented in P3-T07's Utilities section.

## 2026-10-26 — P6A-T02 plateau handling (team lead)
Accepted deviation from 6a design C1 step 3: equal-clearance plateaus flood breadth-first from labelled cells (standard watershed) instead of strict index order — fixes corridor choke placement (width 4 centred vs √20 at far mouth). Deterministic; fixture counts unchanged. Perf ad hoc: analyzeChokes 1.45/5.95/5.25 ms (simple64/acropolis/blueshift), budget ≤50.

## 2026-10-26 — REVERT gas-steal step (team lead)
Architect verified ares has NO gas-steal build step (GAS ignores targets, build_order_runner.py:440-460; ShouldHandleGasSteal only defends). My PA2 decision rested on a false premise; a gas-steal step would be scope beyond parity. Reverted: no `gas @<target>`, no geyserAt, no buildGas({retarget}). Docs list it as not in ares. Flagged to user as an optional extra.

## 2026-10-26 — parity-6a ticket assumptions P6A-A1–A7 (BA-3; accepted by team lead)
Overlord spots out (6a-D10); no committed perf test (T03 records ad hoc medians); mapAnalysis registers after phase-4 resources; docs-plan §2 6a amended; rest as listed in parity-6a.md.

## 2026-10-26 — backlog: systems/unit.ts:204 isStructure throw
`previous = { isStructure: currentUnit.isStructure() }` runs before update; isStructure() throws for unit types missing from world.data (create-unit.ts:234), killing the unit system's onStep for the frame (silently, debug-logged). Real game data unaffected; bites fixtures. Fix after P2-T02 (may touch systems/unit.ts): guard or compute after update.

## 2026-10-26 — P3-T02 notes (team lead)
UnitRole has all 60 ares roles (design said 56; consts.py:492-561 has 60). toEngagementResult not re-exported from root.

## 2026-10-27 — examples decisions EX-D1–D7 (architect; accepted)
D1 layout: examples/*.ts updated in place; ares ports at examples/ares/<tutorial-kebab>.ts; openings at examples/ares/openings/<race>.config.json via createEngine({configFile}). D2 test-imported examples export their agent and run only under import.meta.main. D3 no new type-check script (tsconfig already covers examples/). D4 fixture tests only for examples with own logic (roles, squads, combat maneuver, custom behavior, production, placements, build runner); API tours type-check only. D5 committed parse test for every translated opening. D6 live smoke for ramp-wall, managing-production, build-runner only. D7 ports keep ares' race and the tutorial's final bot; config_file skipped (ares tutorial empty); partial ports list their gaps.
Backlog: OneBaseTempests "16 tempestgroundattackupgrade" fails to parse (no core upgrade id) — check current game data.
Ticket ids: EX-T01..T08 (dev names junior-backend-9NN).

## 2026-10-27 — consolidation work package (user)
User words: "we also need to determine where we now have multiple ways of doing the same thing, and only keep the best one"
Architect audits packages/core for overlapping capabilities (old node-sc2 paths vs new parity resources/behaviors, plus duplicated helpers) and writes .agent-work/consolidation.md: each overlap, the recommended keeper, what to remove/deprecate, bot/ call sites affected (read-only grep), migration notes. Removals of public APIs that bot/ uses go to the user for a decision before any ticket runs.

## 2026-10-27 — P5-T07 pending-upgrade check (team lead)
alreadyPendingUpgrade stays a faithful python-sc2 port (progress 0 for just-queued). upgradeController uses an ares-style pending_or_complete check local to tech.ts: complete, or any own structure has an order with the upgrade's research ability (regardless of progress). Avoids double research from a second idle structure.

## 2026-10-27 — examples work package (user)
User words: "lets also plan to update the existing examples and expand them with translated ares examples"
Scope: update packages/core/examples/* (bot-vs-bot, cannon-rush, ladder, ramp-wall, tutorial, watch-replay, worker-rush) to the new APIs, and add TS translations of the ares tutorial examples (docs/tutorials: roles, influence & pathing, combat maneuver, squads/group behaviors, managing production, build runner + example builds yml, custom building placements, chat debug, config file, custom behaviors). Architect writes .agent-work/examples.md (tickets), sequenced after the APIs each example uses.

## 2026-10-27 — P4-T08 deviations (accepted)
1. LDM field safety checked at the mineral's speed-mining target (mineral cell itself is unpathable → always unsafe). 2. Safe LDM field list recomputed each step (ares caches until empty). 3. Flee issues no command when closestSafeSpot is undefined (ares always moves). Mineral targets keyed by position (ares). Perf ad hoc: 66 workers/3 bases onStep median 0.286 ms (≤2).

## 2026-10-27 — P5-T03 review fixes (team lead)
siegeTankDecision "own units between tank and target" excludes the tank itself (ares counts it — evident bug, same spirit as D10; documented). pickUpCargo keeps ares' default senseDanger (drop the `false`). Use ares' exact squared constants (200, 110). Use Units.closestTo; drop duplicated empty-cargo early return.

## 2026-10-27 — PM skill reread (user: "reread the PM skill and roles")
Adopted: reviewers/reviewer-lite run as plain subagents, one spawn per review, no name (named reviewer-3/reviewer-lite-3 shut down). Rework from a ticket's review stays with that ticket's developer — keep the dev alive until its review passes. New dev names use a numeric ticket suffix (e.g. junior-backend-505 for P5-T05, senior-backend-408 for P4-T08); live dev-p4-t08/dev-p4-t11/dev-p5-t05 keep their names until done. Skill now merges BA+architect into one `architect` role, but that agent type isn't loaded in this session — keep technical-architect-4 + business-analyst-4 until a respawn can use it. Shared task list tools (TaskCreate) aren't available to the lead here; status file stays the tracker.

## 2026-10-27 — P4-T11 placement path (technical-architect-4; accepted)
Builder plugin passes `placement: { flags }` to buildings.build (no direct placement.request); a placer.place result goes as `at`; undefined build() falls back to findPlacement + actions.build. Why: tracker refreshes/releases the reservation and replan keeps the flags.

## 2026-10-27 — P5-T02/T03 notes (team lead)
P5-T02 approved (attackReady `gap >= distanceToWeaponReady()` is correct; AC wording slip). P5-T03 deviations accepted: medivacHeal heals biological AND non-mechanical (B2's biological-only would heal SCVs); siegeTankDecision return values follow ares; dropCargo uses UNLOADALLAT (3669) — confirm in live smoke (P5-T09).

## 2026-10-27 — junior-by-default, one dev session per ticket (user)
User words: "Every ticket goes to a junior unless there's a concrete reason it needs a senior: for example an unknown root cause; concurrency, performance, security or data migration; cross-cutting concerns; or open judgment calls in the plan. Write the reason next to the ticket in the status file; no reason means a junior. If a junior escalates or reviewer rejects its ticket once, hand the ticket to a senior." and "From now on, use one developer session per ticket: shut it down when the ticket is done."
Applied: all live seniors shut down; each in-flight ticket respawned per this rule, continuing from disk.

## 2026-10-27 — batch 2 shipped; P4-T09 review fixes (team lead)
Batch 2 pushed 23e861b (all approved work except buildings.ts/buildings.test.ts), verified in a clean checkout (tsc clean, 333 pass). User words: "commit all but those files".
P4-T09 deviations accepted (docs P4-T13): untracked resume only after opt-in; damage-triggered low-HP cancel; 'tracked' mode skips adopted builds; buildGas picks geyser closest to a townhall.
P4-T09 review CHANGES to apply: (1) tracked-mode low-HP cancel must also cover P/Z tracked builds after they're marked done (remember structure tags); (2) don't consume the earmark until the BUILD is actually sent — check tech first, use a non-settling affordability check, settle on send; (3) keep active builds' placement reservations alive each step; (4) structure check before worker replacement (Zerg drone consumed); (5) buildGas max doesn't double-count a tracked refinery under construction; (6) mining enabled → mining.selectWorker only; fallback skips workers on other active builds; (7) tests for P/Z done/timeout/cancel, long wait vs reservation, earmarked build waiting on tech (extend existing cases); (8) assign BUILDING once.
Team rotation now (per rotation rule): fresh architect, BA and devs.
Fix 6: add `isEnabled(): boolean` to MiningResource (types.ts + mining.ts, done by senior-backend-6 who owns mining.ts in P4-T08); tracker uses mining.selectWorker only when isEnabled(). As built: always calls mining.selectWorker (returns undefined when disabled) and falls back to closestFreeWorker only when mining is disabled — equivalent; accepted. Fix 3: tracker keeps reservations alive via synchronous release(target)+reserve(target) each step for active builds owning their reservation (no placement.ts change).

## 2026-10-26 — P6b-T04 openings fixes (team lead)
History file format matches ares exactly (keys EnemyRace, Duration, StrategyUsed, Result as ares' ints per consts.py/data_manager.py) so an existing ares data/ folder is reused. Builds with no records score winrate 0 (no NaN). Junk array entries dropped with a warning. minGames > 10 falls back to cycle, as ares does.

## 2026-10-26 — P4-T09 tracker decisions (technical-architect; accepted)
1. Tracker adopts untracked unfinished Terran structures (ares resume) only after the bot called buildings.build/buildGas that game (flag resets per game) — keeps phase 4 opt-in (D3); always-adopt broke macro.test.ts.
2. Low-HP cancel fires only when health dropped since the previous step (ares on_structure_took_damage), threshold max(50, 0.09 × healthMax). Corrects design's "every step" which would cancel fresh depots.

## 2026-10-26 — P6b-T03 scout waypoints (team lead)
Inset scout points that leave the region (cliff edge) are dropped (ares keeps them); fallback [main] if none remain. Deliberate, documented.

Also: port ares' scout perimeter filter (drop points within 8 of the region's ramp top before sorting). NAT_WALL keeps its wall flag when enemies are at the main ramp (ares drops both — quirk not ported, documented).

## 2026-10-26 — P4-T06 Protoss placement notes (accepted)
Powered wall fallback uses ramp top (shared Terran rule) vs ares ramp bottom — minor, documented. ares PoweredPlacementStrategy closestTo overwrite quirk not ported. Optimal-pylon tie → last (ares).

## 2026-10-26 — rotate teammates for context (user)
User words: "dude you gotta get a new reviewer in every so often. 500k context?"
Rule: rotate reviewers after ~4–5 reviews (fresh spawn, new name suffix); rotate long-running devs/architect/BA likewise when their context grows. State lives in .agent-work files so a fresh teammate can pick up.

## 2026-10-26 — batch 2 drain (team lead)
Devs finish their current ticket (+ pending nits), report, then hold without starting the next until batch 2 is reviewed, committed and pushed. Avoids committing partially edited files.

## 2026-10-26 — P3-T04 squads radius (team lead)
Keep the design key (role, sorted types); radius not in key. Documented: use one radius per (role, types) — first call in a loop decides it.

## 2026-10-26 — P6b-T02 buildOrder widening deferred (team lead)
SystemObject.buildOrder stays Array<BuildTask> in T02; widening to Array<BuildTask | BuildOrderStep> lands with P6b-T05 (owns builder-plugin.ts).

## 2026-10-26 — P6A-T03 defensive offset (team lead)
getDefensivePosition walks back until path length reaches `offset` (diagonal step = √2), so "4 cells back" means distance; AC bound offset + 1.5 holds. Perf ad hoc (acropolis): analysis 10.25 ms (≤50), cold getDefensivePosition all 16 expansions 20.64 ms (≤100).

## 2026-10-26 — P4-T07 mining deviations (team lead; accepted)
Early-ground-threat "mine near start" rule moves to P4-T08 (needs intel). getMineralTarget stays T08. Dead/lifted townhall = no own townhall within 10 (mineral)/12 (gas). selectWorker + gas pick skip busy (command-labelled / constructing) workers (deviation). Assignment every step (ares every 4th; core default step is 4 loops already). Commands are HARVEST_GATHER/HARVEST_RETURN via queueAction inside roles.as(GATHERING) (ares gather parity; actions.gather sends SMART). Gas buildings = gasMineTypes + RICH types.

## 2026-10-26 — P2-T06 influence details (technical-architect; accepted)
Own liberator zones (effect alliance SELF) are not stamped — ares stamps them, which makes a Terran bot path around its own libs (deliberate deviation, documented). All other effects stay all-alliance. costMultiplier applies to built-in sources only, not user addCost (ares). Unfinished enemy structures and snapshot auto-turrets skipped (ares). Lib zones go to ground only (T05).

## 2026-10-26 — P4-T05 placement deviations (team lead)
Solve waits for expansions + agent.race + first map state (fixes a game-2 solve running before map state, error swallowed by onStep isolation). Nat bunker marks a 5x3 kernel (ares 3x3) so a barracks taking the bunker spot keeps addon room (deviation, documented). AC 5a asserted via mechanism (released cells have avoid=0 at 2x2 scan start) since fixtures never reuse them. drawDebug untested (gate DELETE accepted). Perf ad hoc: solve 2.2ms, request 0.022ms (blueshift).

## 2026-10-26 — P3-T05 arbiter API (team lead)
arbitrate takes requiredOwner?: (owner, tag) => string | undefined (string = drop 'not-owner' with that `by`) instead of a boolean mayCommand, so `by: 'role:<ROLE>'` can be reported; flush builds it from roles.mayCommand + roles.roleOf. RolesResource contract unchanged. Accepted.

## 2026-10-26 — P2-T04 design correction (technical-architect)
Pending army value: findUnitTypesWithAbility returns producers, not products. Use a lazily built abilityId → unitType map from available UnitTypeData (first wins; rebuilt per game). Count orders[0] on ready non-townhall structures (+orders[1] with reactor) and orders[0] on eggs; townhalls skipped (ares). Filter by combatTypes. No queen deviation (queens not in combatTypes, matching ares). Zerglings: existing valued at half calculateCost (it prices the pair); a pending egg counts the full pair. Accepted. SUPERSEDED after review: existing units are valued at raw UnitTypeData mineralCost + vespeneCost (total, ares calculate_unit_value parity — morphed banelings/ravagers/lurkers/broodlords not undervalued; zergling 25 as-is, no halving). calculateCost stays for pending orders only.

## 2026-10-26 — P2-T02 review finding overturned (team lead)
Dead enemies do NOT linger: systems/frame.ts:105 deletes dead enemies from _units[ENEMY] in the same step (verified by reading). Reviewer's blocking finding rejected; dev's regression assertion kept; no onStep sweep / filter change. P2-T02 APPROVED.

## 2026-10-26 — commit freeze (team lead)
Batch 1 = everything approved through P2-T01/P3-T02/P4-T04 + P2-T02 (once reviewed). To get a clean commit, devs plan/read only (no edits to repo files) until batch 1 is committed and pushed; new isolated files under scratchpad are fine. Parser (P6b-T01) files excluded from batch 1 if not yet approved.

## 2026-10-26 — scaffolding tickets: no registration-order tests (team lead)
Registration-order assertions in scaffolding tickets (P4-T04 AC1, and later 6a-T01 / P5-T01 / P6b-T02) are dropped — the test gate deletes them as restating a list. Settings-survive-reset (P4-T04 AC2) is tested in the first ticket that implements a real getter (P4-T05/T07).

## 2026-10-26 — backlog: enemy lift/land not tracked on grid
unitTypeChanged is emitted for own units only (systems/unit.ts:182), so enemy structures lifting/landing don't update the placement grid. Low priority; revisit after phase 4.

## 2026-10-26 — first ship batch (team lead)
Batch 1 (core-arch T01–T05 + approved standalone parity tickets) is committed together with P2-T01/P4-T03 once reviewed, because shared files already carry in-flight P2-T01 edits and hunk-splitting is fragile. Only reviewed work is ever committed.

## 2026-10-26 — parity-5 ticket assumptions (BA; accepted by team lead)
P5-PA1 P5 T01 chains after P6a scaffolding (shared types.ts/create-world.ts; behaviors registered last) and after P3 T03 (run({role}) uses roles.as). PA2 behaviors/index.ts append-only per ticket. PA3 live smoke owner assertion accepts mining/buildings/flying owners. PA4 P5 T02 may split helpers/individual. PA5 PF morph = MORPH_PLANETARYFORTRESS 1450. Scaffolding chain now: P2 T01 → P3 T02 → P4 T04 → P6a scaffolding → P5 T01.

## 2026-10-26 — P4-T01 formation solver deviations (accepted by team lead)
FormationGrids.height: Uint8Array renamed terrainHeight (design declared `height` twice). Optional startPlaceable?: Uint8Array — floodArea uses startPlaceable ?? placeable; findBuildingLocations uses live placeable. Stride reduction opt-in via reduceXStride (ares param). P4 T05 resource must pass terrainHeight + startPlaceable.

## 2026-10-26 — P3-T01 review fixes (team lead; overrides design Q2 step 3)
1. Static attackers (speed 0): start = min over hittable targets of max(0, gap)/target.realSpeed(); Infinity only if every such target is also static. Why: design rule silenced static D / sieged tanks against an approaching army (LOSS_EMPHATIC for tank vs 3 marines).
2. DPS cache keys add attacker finished/active and target GUARDIANSHIELD, RAVENSHREDDERMISSILETINT, shield>0.
3. Sieged tank min range 2: zero DPS when distance < min range.
4. Test shields on own side too (swap sides in existing case).

## 2026-10-26 — parity-5 design decisions P5-D1–D13 (technical-architect; accepted by team lead)
D1 behaviors.run executes immediately in caller's commander context. D2 one action per unit per step per owner (ctx.order dedupe); arbiter picks one owner per tag. D3 single plan() replaces CombatManeuver + MacroPlan. D4 behaviors = factory functions → {name, execute}, camelCased ares options. D5 execute returns boolean | Promise<boolean>. D6 behaviors exported from `@sc-bot/core/behaviors` subpath. D7 macro controllers build on agent helpers + phase-4 buildings/placement; spend deducted at proposal. D8 Terran-first port set (individual + 6 group behaviors + spawn/buildWorkers/buildStructure/autoSupply/expansion/gas/upgradeCCs/techUp/upgradeController/productionController); non-Terran/spell items documented as not ported. D9 attackReady from realSpeed()/16 game loops, not distanceToWeaponReady(). D10 siegeTankDecision filters flyers by enemy isFlying (deliberate fix of ares bug). D11 spawnController validates composition at creation. D12 drop smoothing, ignored_build_from_tags, to_count_per_base, good_positioning (documented). D13 exit evidence: examples/behaviors-bot.ts + live smoke vs Easy AI (skipped w/o SC2), fixture test per behavior, perf 50 marines ≤10ms median measured ad hoc (per perf rule).
Scheduling: P5 B0 after P4-T04 (only P5 ticket touching types.ts/create-world.ts/package.json); behaviors after P2-T08/T03 + P3-T03; macro after P4-T05/T09/T10; sample bot after P3-T01/T04/T06 + P4-T07. No overlap with actions.ts/macro.ts.
Open: possible core bug — distanceToWeaponReady() may be ~1.4× off (divides normal-speed value by 22.4); investigating.
RESOLVED: real bug inherited from python-sc2 (create-unit.ts:385-388); fix `/16` as new ticket P3-T08 (blocked by core-arch T03/T04); no bot/ call sites; documented under "differs from python-sc2" (P3-T07). P5-D9 AMENDED: attackReady uses the fixed distanceToWeaponReady; P5 B1 blocked by P3-T08.

## 2026-10-26 — P3-T01 combat sim (team lead)
Tank AC: accept the 1-zealot variant (sieged tank wins with timingAdjust, worse without); 4 zealots can't hold without splash (P3-D3). timingAdjust defaults true (ares can_win_fight). Extra export toEngagementResult OK (T02 decides re-export). Perf: no committed wall-clock test (test-gate DELETE stands); measured ad hoc 60v60 median 0.42ms (budget 3ms). Applies to all perf ACs: measure ad hoc and record in the ticket, unless a perf test is deterministic.

## 2026-10-26 — T03/T04 review fixes (team lead)
1. High-level unit methods (move/attack/attackMove/smart/mine/etc.) are a no-op (resolve, nothing queued) on an empty unit list; only raw queueAction throws on tagless commands. Why: old behaviour was effectively a no-op; bot/systems/combat/offense.ts:139-158 relies on it.
2. Flush merges results per (proposal, outcome, result) before onNotSent + event: one entry per group, onNotSent once.
3+5. Commit emitted tags synchronously right after arbitrate (before awaiting send); after the response, un-commit tags whose command SC2 rejected (if still owned by that flush). Why: closes the concurrent mid-step flush race without locking rejected units.
4. Add flush-level patrol test.
6. as() ignores undefined context values.
7. GameEndedError/ConnectionClosedError from a send must still propagate (not swallowed by flush catch). Migration notes added: commands issued after the end-of-step flush go out next step; systems added mid-game via agent.use are attributed to the caller's commander.

## 2026-10-26 — parity-4 review deltas (technical-architect-2)
mining.selectWorker takes optional role (default BUILDING); untracked builders (plain actions.build/macro) pass role GATHERING so mining reclaims them when idle. Fixed for phase 5. P4 T04 drops index.ts edit (export type * covers it). Custom placements used when their flags are requested, exempt from ramp-distance rule. swapBuildings queues nothing itself; flying manager issues lift next step.

## 2026-10-26 — parity-3 ticket assumptions (BA; accepted by team lead)
P3-PA1 combat-sim types live in P3 T01's own files; P3 T02 re-exports from types.ts/index.ts. PA2 P3 T02 adds all types P3 T05 needs. PA3 team lead serializes P3 T05 against phase-4 actions.ts tickets (P4 T10/T11). PA4 scaffolding chain: P2 T01 → P3 T02 → P4 scaffolding → P6a scaffolding.

## 2026-10-26 — parity-4 design decisions P4-D1–D14 (technical-architect-2; accepted by team lead)
D1 four onStep resources placement, buildings, mining, flying (that order, after phase-3). D2 resource commands via actions.as({owner, priority}); buildings 10, flying 10, mining -10. D3 everything opt-in (mining after configure({enabled:true})). D4 port ares Terran solver (5x3 addon kernel, ramp wall via Ramp getters, nat bunker) as pure util + resource; protoss solver follow-up ticket; Zerg undefined. D5 sizes from getFootprint. D6 Terran solver avoids mineralLine cells (deviation). D7 generalized flag filters; alternatives only at own occupied bases. D8 canPlace includes addon room by default for rax/factory/starport. D9 per-map placements via optional Placer.placements(world) + placement.add(); no YAML loader. D10 tracker = ares state machine; onNotSent BUILD retries, maxAttempts 5 then re-place; timeout 120s non-Terran + gas; no tracker events. D11 low-HP cancel default 'tracked' (configurable 'all'/'off'). D12 mining manages only GATHERING-role workers, skips command-labelled/constructing; distributeWorkers unchanged, docs say use one or the other. D13 flying = per-step state machine, no timers; actions.swapBuildings delegates to flying.swap → Promise<void>. SUPERSEDES core-arch Q7 (user had accepted "keep raw"); team lead accepted under the parity mandate — flagged to user. D14 systems/map.ts onUnitTypeChanged frees/blocks footprints on lift/land (existing bug fix).
AMENDED (aligned with phase-3 contract): D2 role-managed commands via roles.as(role, fn, {priority}) — mining GATHERING -10, tracker BUILDING 10; role-less (flying) via actions.as({owner:'flying'}) 10. D12 mining manages roles.get(GATHERING); self-defence only when intel.getMainThreat('ground') reports ground threats. Phase-4 resources register after intel; P4 scaffolding after P2 T01 + P3 Q1; flying/integration never parallel with P3 Q5; mining bookkeeping after P3 roles ticket; speed mining/safety after P3 intel ticket.
Unblocked (new files): utils/placement/formation.ts, utils/mining/targets.ts, systems/map.ts lift/land fix. Risk: speed-mining live assertion at step 2; weaker at default STEP_COUNT 4.

## 2026-10-26 — parity-2 T06 notes from T05 review (team lead)
- Keep float weights (no int() truncation like ares). Why: truncation is an ares artifact, not intent; differences ≤1 cost.
- T06 adds effectsRangeBuffer to every effect radius (EffectInfluence has no buffer field), as ares does.
- Keep inclusive disk stamp (possibly one ring larger than ares' strict `<` at integer radii). Why: errs on the safe side for avoidance.
All three documented under "differs from ares-sc2" (P2 T09).

## 2026-10-26 — parity-2 T06/T08 input guards (BA, accepted by team lead)
addCost clamps finite costs to ≥1 (no throw); out-of-bounds path endpoints clamp to nearest in-bounds cell; A* buffers reallocate on grid size mismatch. Architect may flip to throw / [] if objecting.

## 2026-10-26 — docs plan assumptions DA1–DA5 accepted (team lead)
DA1 docs/changelog.md stale (2019): keep, add `## Unreleased` with a subsection per phase, no version until user picks one. DA2 legacy node-sc2 docs (overview/tutorial/design) not rewritten, only touch points. DA3 docs tickets serialized: core-arch T05 → P2 T09 → P3 → P4 → P6a → P5 → P6b. DA4 code tickets never edit docs. DA5 examples type-checked ad hoc, no committed test.

## 2026-10-26 — session crash; team respawned
All in-process teammates lost. Recovered from disk: T01 approved (nits maybe pending), T02 done (review restarted), T03 partial, P2-T07 A* partial (utils/pathing/astar.ts, tsc error), P2-T05 no files found (restart). Phase 3/4/6a designs were never written to disk → redo.

## 2026-10-26 — parity roadmap accepted (team lead, best judgement per user mandate)
parity-roadmap.md phases 2–6 as written; #12 flying structures/addon swap in phase 4; zerg creep/nydus/adept shades excluded until after phase 6. BA assumptions A1–A4 accepted (same loop per phase; bot adoption = migration notes; perf budgets per phase design measured via frame step timer; phase 3 roles use `as()` override).

## 2026-10-27 — P4-T11 reservation ownership (technical-architect-4)
Builder plugin passes `placement` options to buildings.build (not request + `at`), so the tracker owns refresh/release and replans keep the flags; placer.place result → build({ at }); build() undefined → existing findPlacement path. No "why undefined" API.

## 2026-10-27 — example gap headers (lead)
The comment-gate hook rejects "Port of…/Gaps:…" file headers in examples/ares as WHAT comments. Gap lists and the chat-debug command list move to the examples docs (EX-T08, from examples.md's translation map and the devs' reports); example files carry no headers. Overrides the EX-T01/T02 header AC. One-line why comments stay.

## 2026-10-27 — commit before consolidating (user)
User: "lets make sure to commit before consolidating". No consolidation ticket starts until all approved work is committed and pushed (batch 3, gated on P4-T11), and in-flight tickets touching the same files are committed first.

## 2026-10-27 — consolidation decisions CN-D1–D3 (architect; accepted)
CN-D1 keeper = the one core itself builds on; layered wrappers aren't duplicates. CN-D2 internal-only merges (CN-T01–T05) proceed under the mandate; every public change goes through Q0–Q15 (user). CN-D3 not duplicates, no action: gather vs mine, units.* vs memory.getEnemies, army value vs supplyArmy, command bypasses, placement.request vs findPlacement, Ramp getters vs wall solver, config precedence, priority settings, getThirds vs getDefensiveThird. Tickets CN-T01..T09 in consolidation.md; gated on batch 3 commit (user).

## 2026-10-27 — Q0 removal policy (user)
User: "q0 you can update bot/ in this specific case". Consolidation may migrate bot/ call sites itself (explicit exception to the CLAUDE.md bot/ hints-only rule, scoped to consolidation migrations). Q1–Q15 pending: user wants use cases/differences per question first.

## 2026-10-27 — consolidation answers (user; numbering per rewritten consolidation.md Q0–Q11)
User: "q1 can we keep both, for their own purposes? map.path for building, pathing.findPath for units? q2 use best. other Qs: use best if there clearly is one, restate other questions".
- Q1 keep both: map.path = static map structure (placement, expansion ordering, regions); pathing.* = unit movement. Docs state the split.
- Q2 remove units.getClosest; Units#closestNUnits/closestTo are the keepers; migrate bot/economy.ts:16 (Q0 allows bot/ migration).
- Clear best, accepted: Q3 export point helpers from root (bot drops its copies); Q5 expandNow on buildings.build; Q6 remove structurePending after CN-B03; Q7 one canAfford with options on net cost, remove canAffordUnit/canAffordN; Q8 hasTechFor = techRequirementProgress >= 1; Q10 remove frame.timeInSeconds, export GAME_LOOPS_PER_SECOND.
- Restated to user (open): Q4 distributeWorkers, Q9 producer lookup (needs diff), Q11 getCombatRally vs getDefensivePosition.

## 2026-10-27 — lead never verifies (user)
User: "never verify work yourself — no builds, typechecks, tests, clean checkouts or reading diffs. Trust the developer's Verified: line and the reviewer's report; if in doubt, spawn reviewer-lite to rerun the checks." Batch 3 (14e08e3) clean-checkout check goes to a reviewer-lite before push.
- Q11 (user): keep both getCombatRally and getDefensivePosition; docs state rally point vs choke hold point.

## 2026-10-27 — P6B-T05 supply-gate entry point (lead)
New `fillWorkers?: boolean` (default true) on SystemObject.buildOptions; T05 honours it in normalizeBuildOrder + runner gate and tests it; T06 sets it from constantWorkerProductionTill. Why: gives T05's AC an entry point; additive, default keeps current behavior.

## 2026-10-27 — EX-T04 AC struck (lead)
"A composition not summing to 1 throws at creation" struck from EX-T04: the example hardcodes a valid composition, the test gate rejected a sum test, and behaviors/macro/spawn.test.ts:161 covers the throw.
- Q4 (user): (a) remove agent.distributeWorkers; mining is the only worker manager.
- Q9 (user): "lets keep the 'upgrade' way of doing tings" — read as: game ability data (units.getProductionUnits / getUpgradeFacilities, used by actions.train/upgrade) is the single producer/researcher source; trainedFrom/researchedFrom callers move onto it. All Q0–Q11 answered.

## 2026-10-27 — wind-down (user)
User: "let them finish, but dont pick up new". In-flight tickets (P6B-T05, EX-T03, P4-T12, P4-T13, P5-T09) and the architect's CN-C update run to approval, including review/rework; no new tickets start. Batch 3 push still pending its pre-push check.
- CN-D5 (architect; accepted): Q9 keeper = ability data for core reads only; constants/dicts stay exported and untouched (removing public constants wasn't asked). CN-C03 (SENIOR: data-source swap under train/research/controllers; wrong producer silently stops production) step 1 is a disagreement diff that waits for user ack. consolidation.md status FINAL; order CN-A01 → A02 → A03 → B02 → A04 → B03 → B04 → C01 → C02 → C03 → D01, B01/A01 first after the batch 3 push.

## 2026-10-27 — P4-T12 speed-mining result (user: option 1)
Live SC2: speed mining 3–5% worse than auto at step 1–2, ~7% better at step 4 (loop 6720, 12 SCVs, Simple64). The step-2 assertion is marked expected-to-fail; a new senior bug ticket is to be opened after the break (root cause unknown; suspects: one-step executor latency, the 0.75–2 window at resources/mining.ts:443/:454). SC2 is at /home/bram/code/other/StarCraft II (Base75689); SC2PATH is not set by default.

## 2026-10-27 — P6B-T05 AC7 coverage (lead)
AC7's runner row for `gas @enemy_spawn` is dropped (test gate); the property is defended by utils/build-order/parse.test.ts (parser drops `at` on gas) and targets.test.ts:87 (structurePlacement undefined for gas). Same for the @ramp wall-flag row (targets.test.ts:68).

## 2026-10-27 — P6B-T05 reset ordering (lead)
The 250-loop COMMAND_GIVEN reset runs before the supply gate (so a reset task is held until supply recovers). Accepted as intentional; side effect in default mode: a reset task's earmark can be created one loop earlier. Non-functional.

## 2026-10-27 — score in default interface (lead)
P5-T09 live run: productionController throws every step because frame.getScore() is null; the default interface (agent/create-agent.ts:177) doesn't request score. Fix: default interface requests score (python-sc2 parity), getScore readers are null-safe, and the engine's "Agent handler error" warning (create-engine.ts:577) includes the error. Owner: junior-backend-509b.

## 2026-10-27 — speed-mining root cause (lead)
Root cause (senior-backend-mining): systems/map.ts:480 marks a structure's full square footprint unpathable. Workers clipping a townhall's cut corner sit in an Infinity cell, so mining's mustFlee (resources/mining.ts:385-391) flips them between flee MOVE and SMART (2377 flee MOVEs at step 2, 384 at step 4). Fix: real pathing footprints (cut corners) in systems/map.ts's pathing-grid marking, as in ares/map_analyzer. Rejected: a mining-local exemption (masks the bug for combat keepUnitSafe) and changing isPositionSafe semantics (safe-spot searches could land on unpathable cells).

## 2026-10-27 — P6B-T06 review calls (lead)
- switchOpening drops upgrade steps already pending or done (ares build_order_parser.py:781-784). Accepted; T07 documents it.
- A switch resets the persistent builder (ares configure_opening_from_yml_file :171 resets assigned_persistent_worker), so the new opening picks its own.
- History records every chosen opening (blueprint string, function or choose()), not only choose() picks, so winrate covers all games.

## 2026-10-27 — bug ticket answers (user)
BQ1 explicit-`at` build fails 'blocked' (never moved). BQ2 placement.add on Zerg is a no-op + debug log. BQ3 full enemy-structure grid tracking (block on sight, keep while out of vision, free on death/lift, re-block on land). BQ4 burrowed creep tumor cell pathable. BQ5 check live SC2 data; if tempestgroundattackupgrade is absent, document as unsupported (docs line lands with P6B-T07). Start P5-T10, CN-A02, CN-B05, BG-T04, BG-T08 now; BG-T02/T03 unblocked too.
- P6B-T06: `OpeningsResource.record(name)` is public on the type (the runner needs it); P6B-T07 documents it as runner-internal (bots calling it would corrupt winrate history).

## 2026-10-27 — BG-T05 graph walkability (lead)
resources/map.ts setPlaceable also marked the PathFinding graph unwalkable, so lowered depots and townhall/nydus corners were unwalkable for map.path while isPathable said true. Fixed in BG-T05: graph walkability follows the pathing grid only.
- Rocks: onGameStart also marks destructible rock footprints unpathable (grid + graph), freed on destruction; watchtowers/UNBUILDABLE plates stay walkable. Keeps the graph-follows-grid fix from opening rocks.

## 2026-10-27 — ability-task earmarks (lead)
Builder-plugin ability tasks are not earmarked (the ability fn has no cost gate, so an earmark would leak; unit cost of e.g. OrbitalCommand is 550 vs a 150 morph). Follow-up after CN-B02: earmark net morph cost for ability tasks and settle it in the ability fn.

## 2026-10-27 — rock shapes from the live grid (lead)
Destructibles without an NxN name: the loop-0 start grid can't give their shape (flat rocks absent, ramp rocks merged with cliffs). Read SC2's live pathing grid (gameInfo) at step 1 and on each rock death (~1 RPC each), apply only rock-related cell diffs, keep placement in sync, fall back to current behaviour if the RPC fails. Rejected: a static per-type shape table (maintenance, misses map variants).

## 2026-10-27 — Q9 reversed (user)
User: "q9 tables, run the lurkerrange check". After the CN-C03 diff (ability data misses 24 upgrades, Lurker/LurkerDen, WarpGate; reads stale unit-ability-map.ts), the keeper is the hand-written trainedFrom/researchedFrom dicts. CN-C03 step 2: move actions.train/upgrade, builder-plugin and any other ability-data producer lookups onto the dicts (with WarpGate/Lair/Hive/GreaterSpire equivalents), fixing the BarracksTechLab-from-Factory bug. LurkerRange researcher settled by a live SC2 check.

## 2026-10-27 — abandoned Terran structures count as pending (user)
User: "a". alreadyPending counts an abandoned unfinished Terran structure (no SCV holding its build order), keeping alreadyPending == structurePending and present(). Note: bots not using the building tracker (bot/ today) won't resume it, so production stays one short until something finishes or cancels it.
- BG-FP: if the step-1 live-grid read fails, those rocks keep footprint behaviour for the game (no per-step retry, to avoid request spam on a lasting failure). Accepted (lead).
- LurkerRange (CN-C03, lead): live SC2 4.10 offers it from neither den; researchedFrom set to LurkerDenMP (4.11+/python-sc2). Ladder runs current versions. Full data regeneration drifts in unrelated constants — backlog (separate regen ticket).

## 2026-10-27 — BQ6 (user)
"bq6 generator as source of truth": scripts/generate-data.ts stays authoritative; it formats its own output via biome and gets a --check mode + test that fails when committed constants differ from a fresh run (BG-T09).
- BQ7 (user: "go with recommendation"): ability-task casters come from the generated unitAbilities dict (remap-aware) unioned with stale-map entries whose abilities the game data marks available; the cast gate also counts remapped ids (BG-T10).
- CN-D01 (lead): the readme's "Changes compared to node-sc2" section may name removed APIs as migration history; the no-removed-names rule applies everywhere else.

## 2026-10-27 — next work (user)
User: "do 3 for me, then 1 and 2". (3) bot/ follow-ups written by the team (explicit exception to the bot/ hints-only rule, scoped to: re-enable earmarks in bot/systems/build.ts:19; fix the flying-enemy filters in bot/systems/combat/utils.ts:17 and offense.ts:35). (1) ares parity round 2: architect compiles the remaining gaps into a plan + tickets. (2) live hardening: run the sample bot and examples vs harder AIs/more maps, ticket the bugs found. Worktree fast-forwarded to main a8b1f38 (user's "twerk").
- Workflow (user: "1"): keep working in the core-arch worktree, push batches straight to origin/main, fast-forward the worktree to main before new work; never touch the main checkout.

## 2026-10-27 — overnight autonomy (user)
User: "im going to bed. just keep auto going and dont do things you need permission for". Overnight rules: run parity-r2 tickets that need no user decision (RQ-blocked tickets wait); turn live-hardening core bugs into tickets and fix them; no bot/ edits beyond the already-authorized files; no public API removals; batches commit + push to main after a clean-checkout pre-push check (push to main is standing-authorized). Queue every user decision for the morning.
- Consistency work package (user, overnight): make the framework internally consistent, outwardly consistent, and clean up the docs. Overnight scope: audit + internal-only fixes + doc cleanup; any public API rename/reshape is proposed as a question for the user (no public changes overnight).
- (user) "minor changes dont need to wait for me": minor public consistency changes (naming alignment, option shapes, doc-only, additive aliases) may proceed overnight; bot/ call sites they touch may be migrated (Q0 precedent). Major changes (removing/reshaping widely used APIs, semantic changes, anything bot/ relies on heavily) still wait as PQs.
- (user) "dont worry too much about my current bot": bot/ reliance is no longer a reason to classify a change as major; bot/ call sites are migrated by the ticket (or listed in Migrating bot/ when trivial). Major = removing/reshaping core concepts or semantic changes.

## 2026-10-27 — parity-r2 kickoff (lead, overnight)
parity-r2.md: 18 tickets, RQ1–RQ10 for the user (morning). Running now: T01 scaffolding → T02–T07 in parallel. T06/T07 (AoE + Terran spell behaviors; P5-D8 had deferred spells) go ahead: additive parity behaviors, lead's call under the overnight minor-changes rule. T08–T18 wait on RQs.

## 2026-10-28 — overnight lead calls (user asleep)
- PQ8 interim (lead, conservative; user may override in the morning): option (a) — no batch is pushed to main while a public member is still a stub. R2 work commits locally; pushes resume when stubs are implemented. RQ-gated stubs (e.g. influence.getForcefieldPositions, T11) keep pushes on hold until answered or the stub is removed from the public type.
- DQ1 (lead may settle): (a) restructure docs per CS-D01–D08 (topic pages, ~220-line readme, api.md + legacy pages merged and retired). R2-T18 retargets to the new pages.
- R2-T02: floor (ares linspace dtype=int) kept over the design's "round".
- R2-T04 (lead, overrides design C6 per ares source): only action error 44 adds an expansion to the persistent blocked set (ares custom_bot_ai.py:514); the location rule is a live check per pick (custom_bot_ai.py:476-504). A tracked townhall build retargets only when its target is in the blocked set or canPlace fails; a live location-rule hit alone doesn't move it. builder-plugin's townhall branch routes through the tracker so error 44 feeds the set.

- 2026-10-28 (lead, overnight): R2-T07 — drop `retreatTarget` from reaperGrenade options (required but unused; ares ignores it too; bot/ has no callers). Amends design C9.

- 2026-10-28 (lead, overnight): R2-T04 review — retarget uses getNextExpansion default checkSafe: true (design C6 / ares parity); drop BuildOptions.checkSafe. Supersedes PQ2(d). DEV-1 clearing stays implemented pending user answer on RQ10 (revert is small if declined).

- 2026-10-28 (lead, overnight): CS-I02 — keep agent-handler fatal rethrow (GameEndedError → clean onGameEnd via runLoop; ConnectionClosedError rejects runGame one frame earlier than before). Matches system handlers. Docs + changelog updated in CS-D08.

- 2026-10-28 (lead, overnight): R2-T04 — also feed CommandResult.result === 44 (townhall, onNotSent) into the blocked set (reviewer option a); safe regardless of which channel SC2 uses. Extends "only action error 44" to both channels of error 44. Live confirmation still wanted.

- 2026-10-28 (user): parity-r2 RQ answers — RQ1 c (Terran+Protoss+YAML+Zerg); RQ2 a; RQ3 a; RQ4 a; RQ5 a; RQ6 c; RQ7 a; RQ8 b (port path smoothing); RQ9 "port if possible" (adept shades, ability tracker, ENEMY_NAT_HG_SPOT, Protoss supply -1, ares Protoss placement data, low-value items); RQ10 yes (DEV-1, climber C1, AoE finder C8, addCost rule); RQ11 "do it nicer?" — wants built-in replacement but a better design than register({replace:true}); architect to propose options for user.

- 2026-10-28 (lead): batch 8 committed 8b99ccd and pushed core-arch:main at user request (intermediate; unreviewed: CS-PM04, I13, I14, R2-T08, T13; user overrode PQ8 interim no-stub-push). Devs paused; resume list: T24, T20a, T21a, T28a, T36, CS-D09, CS-I15 partial; reviews for PM04/I13/I14/T08/T13; CS-I06 after.

- 2026-10-28 (lead): R2-T20a — faithful port of ma_ext.c create_smoothed_path/calculate_line_weight incl. first-segment quirk (RQ8 b = port); smoothPath input includes the start node (MA shape); T20 prepends start to findPath output.

- 2026-10-28 (lead): R2-T21a keeps three deliberate ares bug fixes, record as DEV entries for the user: creepEdges clears around all own townhalls (ares: HATCHERY only); isValidTumorSpot bounds-checks the floored cell (ares: rounded point, out-of-range read); spotters consider every edge (ares drops furthest edge first, so one edge gives none).

- 2026-10-28 (lead): R2-T28a — DEV-4 rejected (source recovered: ma_ext.c get_map_data + flood_fill_overlord). Faithful port, raw uint8 terrain heights, walkable = max(pathing, placement), float centroids (ares parity), no thinning. audits/r2-zerg.md:188 claim "no source" is wrong.

- 2026-10-28 (lead): R2-T21a correction — the isValidTumorSpot ares defect is banker-round bounds vs truncated lookup (rejects outer half of last cell on even widths), not an out-of-range read. Floor-both fix kept.
- 2026-10-28 (lead): batch 9 pushed 73b77f2 (unreviewed: R2-T19, R2-T13 rework; reviews stopped at user request). Resume: re-review T19 + T13, then CS-I06, T19 feature tickets per parity-r2.md runnable order; RQ11' awaits user; live-hardening report pending (junior-backend-live2).

- 2026-10-28 (lead, correction): R2-T13 pending guard — my "moving-only" call was wrong: SC2 charges at placement, so the guard must cover every active status (moving/ordered/constructing) for both the no-location and explicit-location paths. Restores the changelog guarantee "calling every step sends one worker". Also: programmatic at: ENEMY_NAT_HG_SPOT must throw not-implemented until R2-T28 (not silently resolve to own start).
