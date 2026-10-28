# core-arch status
Tier: build (ares parity, autonomous). packages/core only.
Worktree: /home/bram/code/other/sc-bot-core-arch (branch core-arch)
Ship: commit on core-arch, push core-arch:main. No PRs.
Staffing rule (user, 2026-10-27): junior by default; senior only with a concrete reason written in the owner column. One dev session per ticket, shut down when done. Junior escalates or gets rejected once → senior.

## Commits
- Batch 1 969ffa3: core-arch T01–T05 + early parity utils.
- Batch 2 23e861b: all approved phase 2–6 work except P4-T09 (buildings.ts/.test.ts). Verified in clean checkout: tsc clean, 333 pass.
- Batch 3 14e08e3 (pushed): P4-T08, P4-T09, P4-T11, P3-T07, P5-T02–T08, EX-T02. Clean-checkout check by reviewer-lite: tsc clean, 3× 440 pass / 0 fail.
- Batch 4 db2c44a (pushed): P6B-T05, P4-T12, P4-T13, P5-T09, EX-T01, EX-T03, EX-T04. Pre-push check: tsc clean, 3× 467 pass / 0 fail.
- Batch 5 18b4dd5 (pushed): speed-mining fix (townhall corner pathing), score default interface + sample bot tuning, CN-B01, CN-A01, P6A-T07, EX-T05. Pre-push: tsc clean, 3× 470 pass / 0 fail.
- Batch 6 32cc87f (pushed): P6B-T06, P6B-T07, P5-T10, CN-A02, CN-B05, BG-T01–T08, EX-T06. Pre-push: tsc clean, 3× 506 pass / 0 fail.
- Batch 7 982078d (pushed): consolidation chain (CN-A01–A04, B01–B05, C01–C03, D01), BG-T01–T10, BG-ST/FP/CR/AB/AM, score default, EX-T07/T08, bot/ migrations + training.ts fix. Pre-push: tsc clean, check:data clean, 3× 531 pass / 0 fail.

## Live teammates
- architect: specs, design Q&A, ticket upkeep (replaces technical-architect-4 + business-analyst-4)
- reviewers: one plain subagent per review
- junior-backend-6b06 (P6B-T06), senior-backend-mining (speed-mining bug: SENIOR unknown root cause), junior-backend-509b (P5-T09 live run)., junior-backend-cnb01 (CN-B01).

## Shipped (main)
core-arch T01–T05; P2-T01–T09; P3-T01–T06, T08; P4-T01–T07, T10; P5-T01; P6A-T01–T06; P6B-T01–T04.

## Open tickets
| T | status | owner / staffing |
|---|---|---|
| P4-T09 building tracker | APPROVED | dev-p4-t09 (junior, done) |
| P4-T08 speed mining/safety/self-defence/LDM | APPROVED (nits mutation-verified; :365 flake not reproducible in 47 runs, attributed to concurrent edits) | senior-backend-408 (SENIOR: per-step performance-sensitive micro; done) |
| P3-T07 docs | APPROVED | dev-p3-t07 (junior, done) |
| P5-T02 helpers + individual | APPROVED; nit done | dev-p5-t02 (junior, done) |
| P5-T03 terran | APPROVED (test fix verified by mutation: 16/1 without fix, 17/0 with) | junior-backend-503 (junior, done) |
| P4-T11 builder-plugin/actions.build/macro integration | APPROVED; shipped 14e08e3 | senior-backend-411 (SENIOR: cross-cutting) |
| P4-T12 live smoke (SC2) | APPROVED (live suites must run serially: test/live.ts kills any SC2 started during the run) | junior-backend-412 (junior, done) |
| P4-T13 docs | APPROVED | junior-backend-413 (junior, done) |
| P5-T04 group | APPROVED | dev-p5-t04 (junior, done) |
| P5-T05 macro helpers + spawn | APPROVED; nits + import done (spawn.ts imports REQUIRES_TECHLAB from agent/macro.ts → ships with P4-T11) | junior-backend-505 (junior, done) |
| P5-T06 structures | APPROVED; nit done | junior-backend-506 (junior, done) |
| P5-T07 tech | APPROVED (fix verified by lead: tech tests 7/0) | junior-backend-507 (junior, done) |
| P5-T08 production | APPROVED (gateway nit lead-verified) | senior-backend-508 (SENIOR: reviewer rejected junior once; done) |
| P5-T09 sample bot/live/perf | APPROVED (fix per dev Verified:; live run pending SC2) | senior-backend-509 (SENIOR: reviewer rejected junior once; done) |
| P5-T10 docs | APPROVED (see below) | junior |
| P6A-T07 docs | APPROVED (fixes per dev Verified:) | senior-backend-6a07 (SENIOR: reviewer rejected junior once; done) |
| P6B-T05 runner tasks/targets | APPROVED | senior-backend-6b05 (done; SENIOR: cross-cutting (builder-plugin + placement, mining, flying, roles, targets) |
| P6B-T06 runner openings/switch | APPROVED | senior-backend-6b06 (SENIOR: reviewer rejected junior once; done) |
| P6B-T07 docs | APPROVED (+ normalizeBuildOrder per-element fix) | senior-backend-6b07 (SENIOR: reviewer rejected junior once; done) |

Docs chain: P3-T07 → P4-T13 → P6A-T07 → P5-T10 → P6B-T07.
Backlog: systems/unit.ts:204 isStructure throw on unknown types; enemy lift/land not tracked on grid; builder-plugin earmark names `task${index}` collide across build systems (one settles the other's); OneBaseTempests upgrade id missing; buildings replan drops an explicit `at` (replan calls placement.request(unitType, undefined)) — silently moves or fails noPlacement; placement.add() on Zerg throws (refreshLive with undefined grids).; lowered supply depot kept blocked on pathing grid (SC2: fully pathable); Nydus Canal corners pathable in SC2.; buildings.ts:63 fallback worker pick (mining off) ignores roles (can take persistent builder/defender) → fold into CN-A04 (one build-worker picker).; spine/spore crawler uproot/re-root leaves the old site blocked forever (pre-existing; systems/map.ts type-change handling).; builder-plugin earmark block passes an ability id to canAfford for ability tasks (same class as the fixed upgrade bug).; data regeneration (scripts/generate-data.ts) not reproducible — committed constants drift; generic ability tasks (builder-plugin) still use stale AbilitiesByUnit for casters.; destructibles without an NxN name (diagonal/huge rocks, ramp blockers, Collapsible towers, XelNagaDestructibleBlocker*) get no footprint in getFootprint (systems/map.ts:147) — rely on the SC2 start grid only; document or fix.

## Examples (examples.md)
Plan approved (EX-D1–D7 in decisions log).
| T | status | owner / staffing |
|---|---|---|
| EX-T01 ares combat ports | APPROVED (nit applied per dev Verified:) | senior-backend-901 (SENIOR: reviewer rejected junior once; done) |
| EX-T02 ares API tours | APPROVED (final fixes lead-verified) | senior-backend-902 (SENIOR: reviewer rejected junior once; done) |
| EX-T03 update existing examples | APPROVED (optional nit: ramp-wall sequencing unguarded at example level; EX-T07 smoke covers) | junior-backend-903 (junior, done) |
| EX-T04 managing-production | APPROVED (composition-sum AC struck, see decisions) | senior-backend-904 (SENIOR: reviewer rejected junior once; done) |
| EX-T05 custom-building-placements | APPROVED (nits per dev Verified:) | junior-backend-905 (junior, done) |
| EX-T06 build-runner + openings | APPROVED (expected values generated from ares YAML; additions trimmed per D7) | junior-backend-906 (junior, done) |
| EX-T07 live smoke | ready (EX-T03, T04, T06 ✓) | junior |
| EX-T08 docs | blocked (EX-T01–T07, P6B-T07) | junior |

## Consolidation (consolidation.md)
Audits done (.agent-work/audits/); architect writing consolidation.md. Gate: no consolidation ticket starts before batch 3 is committed + pushed (user). Bot-facing removals go to user.

## Consolidation tickets
| T | status | owner / staffing |
|---|---|---|
| CN-B01 rich gas | APPROVED | junior-backend-cnb01 (junior, done) |
| CN-A01 geometry dedupe | APPROVED (squaredDistance kept as a delegating wrapper) | junior-backend-cna01 (junior, done) |
| Speed-mining bug (map footprints) | APPROVED (step-2 speed 3845 vs auto 3428) | senior-backend-mining (SENIOR: unknown root cause; done) |
| Score default interface + sample bot army tuning | APPROVED (live test 3/3 pass) | junior-backend-509b (junior, done) |
| P5-T10 docs | APPROVED | junior-backend-510 (junior, done) |
| CN-A02 map bookkeeping | APPROVED | junior-backend-cna02 (junior, done) |
| CN-B05 small fixes | APPROVED (stuck path now live; stuck clears on idle) | junior-backend-cnb05 (junior, done) |

## Bug tickets (bugs.md)
| T | status | owner / staffing |
|---|---|---|
| BG-T01 earmark name collision | APPROVED (+ upgrade earmarks now use canAffordUpgrade: upgrades were never earmarked before) | junior-backend-bgt01 (junior, done) |
| BG-T02 explicit `at` replan | APPROVED | junior-backend-bgt02 (junior, done) |
| BG-T03 Zerg placement.add | APPROVED | junior-backend-bgt03 (junior, done) |
| BG-T04 isStructure unknown types | APPROVED (+ debug.ts food totals tolerant, untested) | junior-backend-bgt04 (junior, done) |
| BG-T05 enemy structures on grid | APPROVED (+ graph follows pathing grid; rocks/towers blocked, unbuildable rocks walkable per live probe) | done; SENIOR: memory/out-of-vision judgment + per-step cost |
| BG-T06 lowered depot pathing | APPROVED | junior-backend-bgt06 (junior, done) |
| BG-T07 nydus + creep tumor pathing | APPROVED | junior-backend-bgt07 (junior, done) |
| BG-T09 data regen reproducible (generator authoritative, --check) | APPROVED (check:data script) | junior-backend-bgt09 (junior, done) |
| BG-T10 ability-task casters from generated dict (BQ7) | APPROVED | senior-backend-bgt10 (SENIOR: reviewer rejected junior once; done) |
| BG-T08 tempest upgrade (live data check) | APPROVED: absent in live data (296 upgrades; only TempestRangeUpgrade id 100); parse test row added; P6B-T07 must document it | junior-backend-bgt08 (junior, done) |
| EX-T07 live smoke (examples) | done; live 3/3 twice (ramp-wall 3x3+2x2+2x2; production 2 factories, 8-9 marines; build-runner ThreeRax complete at 213-224 s); APPROVED (const import nit) | junior-backend-907 (junior) |
| CN-A03 constants consolidation | APPROVED (getStructures no longer throws on unknown types) | junior-backend-cna03 (junior, done) |
| BG-AB ability earmark uses unit cost | APPROVED (ability tasks not earmarked; slow openings test given 30s timeout) | junior-backend-bgab (junior, done) |
| BG-BR behaviors dedupe has no reset | CLOSED: not a bug; docs say clears on loop change and reset | junior-backend-bgbr (junior, done) |
| BG-CR crawler uproot/re-root stale block | APPROVED (+ own structure records, records reset per game, assignBase on lift/land) | senior-backend-bgcr (SENIOR: reviewer rejected junior once; done) |
| BG-FP destructibles without NxN footprint | APPROVED (live grid; placement drop acropolis -95, blueshift -12; walls unchanged on fixtures) | senior-backend-fp (SENIOR: footprint derivation judgment, map-wide grid impact) |
| CN-C03 producer lookups → dicts (Q9 reversed) | APPROVED (warp-in per gate + spend; one addon-host list; LurkerRange → LurkerDenMP) | senior-backend-cnc03 (SENIOR: data-source swap) |
| CN-B04 one base computation | APPROVED (lift/land assignBase handled in BG-CR) | junior-backend-cnb04 (junior, done) |
| CN-C02 root point exports + GAME_LOOPS_PER_SECOND + bot/ migration | APPROVED | senior-backend-cnc02 (SENIOR: reviewer rejected junior once; done) |
| CN-B02 one net-cost model | APPROVED (+ actions.upgrade check+spend, train-task earmarks settle) | senior-backend-cnb02 (SENIOR: money accounting across 5 layers) |
| CN-B03 one pending count | APPROVED (abandoned Terran structures count, user (a), documented) | senior-backend-cnb03 (SENIOR: double-count judgment) |
| CN-A04 one build-worker picker (+ buildings.ts:63 fallback ignores roles) | APPROVED (role-aware picker, stall cooldown + tracker-picked swap, mining exclude, cargo return) | SENIOR: cross-cutting worker ownership |
| CN-C01 public API removals | APPROVED (expandNow guarded against repeat calls; earmark behaviour documented) | senior-backend-cnc01 (SENIOR: reviewer rejected junior once; done) |
| EX-T08 examples docs | APPROVED | junior-backend-908 (junior, done) |
| CN-D01 consolidation docs | APPROVED | senior-backend-cnd01 (SENIOR: reviewer rejected junior once; done) |
| BG-ST tracked build stuck 'moving' forever (live ThreeRax) | APPROVED (stall guard + example lowers depots; live validation via EX-T07 rerun) | senior-backend-bgst (SENIOR: unknown root cause, cross-cutting) |
| BG-AM ability-task earmarks at net morph cost | APPROVED (held only while a caster exists; busy-producer train keeps earmark) | senior-backend-bgam (SENIOR: reviewer rejected junior once; done) |
| BOT-TR bot/systems/military/training.ts double-count (user: "fix training.ts") | APPROVED (getById(...).ready.length + alreadyPending; one-line, matches production.ts:27) | junior-backend-bottr (junior, done) |

## Round 3 (user: "do 3, then 1 and 2")
| T | status | owner |
|---|---|---|
| BOT-3 earmarks on (build.ts) + flier reachability helper isGroundReachable (utils.ts, offense.ts) | done, uncommitted; live-checked via hardening runs | junior-backend-bot3 (done) |
| R2 ares parity round 2 plan | in progress (respawned after session restart) | architect-4 |
| LIVE hardening runs (~20 games) | in progress (respawned after session restart) | junior-backend-live2 |

## parity-r2 (parity-r2.md)
| T | status | owner |
|---|---|---|
| R2-T01 scaffolding A | APPROVED | junior-backend-r201 (done) |
| R2-T02, T05 | APPROVED | junior-backend-r202,r205 (done) |
| R2-T03 | APPROVED | junior-backend-r203 (done) |
| R2-T06 | approved | junior-backend-r206 |
| R2-T04 | approved | senior-backend-r204, r204b, junior-backend-r204c |
| R2-T07 | approved | junior-backend-r207, junior-backend-r207b |
| R2-T08–T18 | blocked (RQ1–RQ10, user) | see ticket |
| CS consistency audit | in progress | architect-5 |

## Consistency (consistency.md)
| T | status | owner |
|---|---|---|
| CS-I01 comment/dead-code sweep (cold files) | approved (nit: orphaned @TODO create-engine.ts:~507 left for owner) | junior-backend-csi01 |
| CS-I09 resource reset from fresh state | approved | senior-backend-csi09, junior-backend-csi09b |
| CS-I11 shared test helpers | approved (stage command-arbiter rename at commit) | junior-backend-csi11 |
| CS-D01–D08 docs | approved | junior-backend-csd01..csd08, senior-backend-csdfix, senior-backend-docfix2 |
| CS-D08 doc swap | blocked (D01–D07, I01) | junior |
| CS-PM12 earmarks optional | approved (senior rework) | senior-backend-cspm12 |
| CS-I02–I08, I10, I12–I14, CS-PM01–PM11 | queued (order in consistency.md) | |
| PQ1–PQ8 | user (morning); PQ8 interim (a) by lead | |
| CS-PM13 runGame/createGame failures | approved (format fix by lead; docs delta in D08) | junior-backend-cspm13 |
| CS-PM14 map signatures/getPrevious/PixelMap/Expansion getters | approved (docs delta → D09: resources.md:165 getPrevious, map.md PixelMap + live getters) | junior-backend-cspm14 |
| CS-PM15 build/unit events delivered | approved | junior-backend-cspm15 |
| PQ9 addEarmark existing-name semantics | user question (rec: latest wins) | — |
| CS-I03 | approved | junior-backend-csi03 |
| CS-PM02 | approved | junior-backend-cspm02 |
| CS-I02 | approved (rethrow kept; site tests added) | junior-backend-csi02, junior-backend-csi02b |
| CS-I05 | approved | junior-backend-csi05, junior-backend-csi05b |
| CS-I12 | approved | junior-backend-csi12, junior-backend-nits2 |
| CS-PM01 | approved (docs → D09: commands.md:275, running-games.md:240 silly:system → debug:system) | junior-backend-cspm01 |
| CS-I04 | approved | junior-backend-csi04 |
| CS-I07 | approved | junior-backend-csi07 |
| CS-D09 | approved | junior-backend-csd09, junior-backend-d09b |
| CS-D10 glossary | approved (nits → D09) | junior-backend-csd10 |
| CS-PM03 | approved | junior-backend-cspm03, senior-backend-cspm03, junior-backend-pm03c |
| CS-I08 | approved (nits fixed by lead; re-export seam → CS-I13) | junior-backend-csi08 |
| CS-PM16 | approved | junior-backend-cspm16, junior-backend-pm16b |
| bot/ PM03 call-site fixes (user-requested) | done | junior-backend-botfix |
| intel no-main crash (found by PM01) | done (mutation-checked) | junior-backend-intelfix |
| CS-PM17 effect dedupe by alliance/owner | approved (mutation-checked) | junior-backend-cspm17 |
| R2-T09 climber grid | approved (minStep 20 = one level, ramp-flank evidence; wiring → T08/T10) | senior-backend-r209, r209b |
| CS-I10 | approved | junior-backend-csi10 |
| CS-PM04 | in progress | junior-backend-cspm04 |
| R2-T08 scaffolding B | in progress (shares types.ts with PM04) | junior-backend-r208 |
| R2-T13 agent expansion picker | in progress | junior-backend-r213 |
| CS-I13 hot-file remnants | in progress | junior-backend-csi13 |
| CS-I14 behaviors test helpers | in progress | junior-backend-csi14 |
| CS-I06 | runnable; held until R2-T13 + PM04 leave agent/macro.ts | — |
| batch-8 review | PM04, I13, I14, T08 approved (nits done); T13 CHANGES → senior-backend-r213b | reviewer, junior-backend-b8nits |
| R2-T24 | approved | senior-backend-r224 |
| R2-T20a | approved (faithful MA port, harness diff 0) | senior-backend-r220b |
| R2-T21a | approved | senior-backend-r221a, junior-backend-r221b |
| R2-T28a | approved (faithful port; matches reviewer port 0/14/50) | senior-backend-r228b |
| R2-T36 | approved | junior-backend-r236 |
| CS-D09 | approved | junior-backend-csd09, junior-backend-d09b |
| R2-T19 scaffolding C | approved | junior-backend-r219, senior-backend-r213c |
| LIVE-1 canAfford vs build/train throw | root cause: bot check-then-act race; awaiting user choice | senior-backend-bug-afford |
| LIVE-2 unpowered cyber core stuck + LIVE-3 refinery spam | approved (tests mutation-checked; not live-confirmed) | senior-backend-bug-build, bug-build2 |
| R2-T13 | approved (guard covers all active statuses) | senior-backend-r213c |
