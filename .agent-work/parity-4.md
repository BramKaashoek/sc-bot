# parity-4: placement solver, building tracker, mining manager, flying structures

Source: parity-roadmap.md phase 4 (ares-gap.md ranked #5, #6, #12); user mandate 2026-10-26 "use best judgement to get ares parity" (decisions.md).
Design: .agent-work/parity-4.design.md (technical-architect-2), decisions P4-D1..D14 (+ amendment) logged in core-arch.decisions.md. Scope: packages/core only.

Status: FINAL (reviewed by technical-architect-2; PA4-7 resolved) (best judgement under user mandate; assumptions listed at the end).

Ticket numbers here are local to this file. "core-arch Tnn" refers to core-arch.md, "parity-2 Tnn" to parity-2.md, "parity-3 Tnn" to parity-3.md.

## Problem Statement

Core builds by asking SC2 for placements ring by ring, every time, and nothing stops two systems from picking the same spot in one step. Once a build order is sent, nobody watches it: a rejected or stuck build sits for 250 loops before anything resets it, a dead builder isn't replaced, and a dying structure is never cancelled. Mining is left to SC2's auto-mining. Nothing records which worker mines which patch, there's no speed mining, workers don't flee danger, and a worker pulled to build never formally leaves or rejoins mining. Swapping Terran structures onto addons relies on fixed 100 ms sleeps, and the map's placement grid doesn't follow a structure that lifts off or lands.

## Solution

Add four opt-in resources, registered after the phase-3 resources and updated in the per-step hook:

- **placement:** solves Terran building formations per base once per game: 3x3 with addon room, 2x2, the main-ramp wall and the natural bunker. It answers placement requests from that solution, with flag preferences and reservation, without querying SC2. It also takes per-map user placements through the existing placer hook. Protoss (pylon power) follows as a second ticket; Zerg gets no answer, so callers fall back to the query-based search.
- **buildings:** tracks each requested build as a state machine (move, order, construct, done or failed). It reissues dropped or rejected orders, re-places after repeated failures, replaces a dead builder, times out Protoss/Zerg and gas builds, and cancels low-HP construction.
- **mining:** once enabled, owns workers with the GATHERING role. It keeps worker↔patch and worker↔gas bookkeeping, does speed mining, keeps workers safe using the phase-2 grids, defends itself against threats near the base, mines long-distance, controls workers per gas, and hands builders out and takes them back.
- **flying:** a per-step state machine that lifts, flies and lands structures, with no timers. It provides swap and addon swap, and `actions.swapBuildings` delegates to it.

Resource-issued commands go through the core-arch executor under their own commander. The tracker and flying win over bot systems at priority 10. Mining is at -10, so any bot system command beats it. The builder plugin, `actions.build` and the macro builder pick switch to these resources when they're available. One existing bug gets fixed: the map's placement grid now follows lift-off and landing.

## Non-goals

- Zerg placement formations (request returns nothing; callers keep the query path).
- Burrowed/blocked placement detection (canPlace is grid-only).
- A YAML/file loader for user placements; the placer hook takes code (D9).
- Tracker events (D10); results stay readable through the tracker's state.
- Vespene speed boost (off in ares too).
- Replacing `agent.distributeWorkers` or `actions.findPlacement`/`canPlace`; they stay for Zerg and ad-hoc use.
- Natural wall building positions (only via user placements, as in ares).
- MULE/CC upgrades, restore power, warp-in changes.
- Per-bot step size (phase 6a), which closes the speed-mining-at-step-4 gap.
- bot/ changes (migration notes only).

## User Stories

1. As a bot author, I want building spots precomputed per base at game start, so that placing a building doesn't fire placement queries.
2. As a bot author, I want 3x3 production spots to always leave room for an addon, so that a barracks never ends up unable to build a reactor.
3. As a bot author, I want to ask for a spot by preference (wall, supply depot, production, bunker), so that each building lands where it belongs.
4. As a bot author, I want the main-ramp wall spots and a natural bunker spot in the solution, so that a standard Terran wall needs no maths of my own.
5. As a bot author, I want a requested spot reserved until it's built on or times out, so that two systems never get the same spot.
6. As a bot author, I want to release a reservation myself, so that an abandoned plan frees its spot right away.
7. As a bot author, I want a spot to become free again when its building dies, so that rebuilding uses the same layout.
8. As a bot author, I want to fall back to my other bases when the requested base is full, so that a request doesn't fail while space exists.
9. As a bot author, I want to supply my own placements per map and have them used when I request their flags (e.g. wall, supplyDepot), so that I can hand-tune walls and layouts.
10. As a bot author, I want a grid-only can-place check, so that I can validate a spot without a round-trip to SC2.
11. As a bot author, I want to see the solved spots in the debug overlay, so that I can check the layout.
12. As a Protoss bot author, I want pylon-aware placements and powered requests, so that structures land in pylon power.
13. As a bot author, I want to start a build with one call that picks the spot and the worker, so that I don't hand-roll build logistics.
14. As a bot author, I want a dropped or rejected build order retried, and the building re-placed after repeated failures, so that one bad spot doesn't stall my build.
15. As a bot author, I want a dead builder replaced, so that construction continues.
16. As a bot author, I want a Terran structure whose SCV died mid-build resumed by another SCV, so that half-built structures aren't abandoned.
17. As a bot author, I want builds that can't complete to time out and release their worker and spot, so that nothing is stuck forever.
18. As a bot author, I want low-HP construction cancelled automatically (my tracked builds by default, optionally all), so that I recover most of the cost instead of losing it.
19. As a bot author, I want to know how many builds of a type are pending, so that my macro logic doesn't double-build.
20. As a bot author, I want gas builds to pick a free geyser and retarget when the enemy takes it, so that gas timings hold.
21. As a bot author, I want mining to be opt-in, so that enabling core upgrades doesn't take over my workers.
22. As a bot author, I want workers split and assigned to patches (at most 2 each) and gas (configurable per gas), so that income is maximised and visible.
23. As a bot author, I want speed mining, so that my income beats SC2's auto-mining.
24. As a bot author, I want mining workers to flee danger and come back, so that I don't lose workers to harass.
25. As a bot author, I want mining workers to defend themselves when the base is under ground attack, so that a small poke doesn't kill the mineral line.
26. As a bot author, I want idle unassigned workers to long-distance mine safely, so that surplus workers still earn.
27. As a bot author, I want a builder taken out of mining and returned after the build, so that workers don't vanish from mining.
28. As a bot author, I want any of my systems to override mining for a worker in that step, so that pulling workers for defense just works.
29. As a bot author, I want to look up a worker's assignment, the workers on a patch and a patch's speed-mining target, so that I can inspect and debug the economy.
30. As a Terran bot author, I want to fly a structure to a spot and land it there without sleeps, so that relocations are reliable.
31. As a Terran bot author, I want to swap two structures, or put a structure on the closest idle addon, so that I can do addon swaps in one call.
32. As a bot author, I want the map placement grid to follow a structure that lifts and lands, so that placement checks don't see ghosts.
33. As a bot author using the build system, I want Terran/Protoss build tasks to use the precomputed placements and the tracker, so that my build order is faster and more reliable without code changes.
34. As a bot author who doesn't use these features, I want no behaviour change, so that upgrading core is safe.

## Implementation Decisions

From the Architect (full contract in parity-4.design.md, decisions P4-D1..D14 + amendment):

- Four resources (placement, buildings, mining, flying), registered in that order after the phase-3 resources (after intel). Each does its per-step work in the registry step hook. Each reset keeps the settings and drops the per-game state (D1).
- Commands go through the executor. Role-managed commands use the phase-3 role commander: mining runs as GATHERING at -10, the tracker as BUILDING at 10. Flying uses its own commander, 'flying', at 10 (D2, amended).
- Everything is opt-in. Placement only answers requests. Buildings and flying only drive what the bot handed them. Mining stays idle until enabled (D3).
- Placement (D4–D9):
  - The Terran solver is ported from ares as a pure formation module plus the resource: 5x3 kernel for addon room, ramp wall via the existing ramp maths, natural bunker. A Protoss solver follows; Zerg gets no answer.
  - Sizes come from the existing footprint helper.
  - Mineral lines are avoided for Terran too (a deviation from ares).
  - Selection uses generalised flag preferences. Alternatives come only from own occupied bases.
  - Can-place includes addon room by default for barracks, factory and starport.
  - User placements come from an optional new placer hook (per map, read once at solve time) and an `add` call.
  - Reservations time out after 60 game seconds. Spots become taken when a structure appears and free again when it dies.
- Buildings (D10, D11):
  - The tracker is ares' state machine, as specified in design P3.
  - Dropped/rejected orders retry. After 5 failures the build is re-placed.
  - Timeout is 120 game seconds, for non-Terran and gas builds only.
  - No events.
  - Low-HP cancel defaults to tracked builds only.
  - Issuing a build sets the worker's command label and deducts the cost, as today.
- Mining (D12):
  - It manages only GATHERING-role workers. It skips workers with a command label or a construction order, so plain `actions.build` callers still hand off.
  - Self-defence only happens when intel reports a main ground threat.
  - `distributeWorkers` stays unchanged; the docs say to use one or the other.
- Flying (D13): a per-step state machine re-derived from the unit, with no timers. `actions.swapBuildings` delegates to it and resolves with no value. This supersedes core-arch Q7 (raw send); the team lead accepted it under the parity mandate and flagged it to the user.
- Map (D14): a lift frees the landed footprint, and a landing blocks the new one.
- Integration (P6):
  - Builder-plugin Terran/Protoss structure tasks request placements and go through the tracker, falling back to the query search when there's no answer.
  - The 250-loop reset is suppressed while a build is still tracked.
  - Gas tasks use the tracker.
  - `actions.build` and the macro builder pick use the mining worker selection when mining is enabled.
- Seconds settings use 22.4 game loops per second.

## Testing Decisions

All offline seams use the core harness: the fixture world builder (blueshift, acropolis, simple64 where available), stepping to recorded or synthetic observations, the fake client (asserting sent actions and query call counts), and `commandResults` for arbitration outcomes. Agreed with the Architect in design P1–P6.

- **Pure modules (formation, mining targets):** exact-cell and geometry tests, with no world.
- **Placement:** resource seam on fixtures. Every spot passes can-place, there are no footprint overlaps, the wall matches the ramp maths, reservation, taken/available bookkeeping, user placements, zero SC2 queries (deterministic, committed).
- **Buildings:** resource seam with fake-client results for rejected/dropped, plus synthetic observations for worker death, structure appearance, low HP and gas retarget.
- **Mining:** resource seam on fixtures. Split, caps, gas fill/drain, selectWorker handoff, speed-mining command shapes at the window edges, flee on a stamped cost, priority loss to a bot system, zero proposals when disabled.
- **Flying:** synthetic observations through lift → fly → land; swap; addon swap; busy structure.
- **Map grid:** systems seam with synthetic lift/land observations.
- **Perf (team lead's perf rule, decisions.md "P3-T01 combat sim"):** wall-clock perf tests aren't committed. Each perf criterion (placement solve ≤ 100 ms median of 5 and request ≤ 0.5 ms on blueshift; mining step with 66 workers on 3 bases ≤ 2 ms median) is measured ad hoc by the developer, and the median goes in the ticket. Deterministic checks (query call counts, buffer reuse) stay as committed tests.
- **Integration:** builder-plugin test asserting zero queries and tracking; actions.build worker choice.
- **Live smoke** (needs SC2, skipped otherwise, like the engine live test): solved spots accepted by real placement queries; speed-mining income beats auto at step 2; addon swap completes.
- **Prior art:** parity-2 resource tests, engine/create-world.test.ts, systems/builder-plugin.test.ts, resources/actions.test.ts, engine/create-engine.live.test.ts.

## Out of Scope

See Non-goals.

## Further Notes

Migration notes for the user's bot/ (no tickets):
- Additive and opt-in; nothing breaks at compile time except `actions.swapBuildings`, which now resolves with no value (bot/ doesn't call it).
- Behavior changes:
  - Build-system Terran/Protoss structure tasks now use precomputed placements and the tracker. Spots differ from today's ring search (addon room always kept, mineral lines avoided). A `placer.place` hook still wins.
  - The map placement grid now frees cells when a structure lifts off and blocks them where it lands.
- Recommended adoption:
  - Replace `findPlacement` for depots and production with `placement.request` or `buildings.build`.
  - `wall.ts` can use the placement wall spots (flag `wall`).
  - Provide per-map hand-tuned spots via `placer.placements`.
  - Enable mining (`mining.configure({ enabled: true })`) instead of relying on SC2 auto-mining, and then stop calling `distributeWorkers` (it fights mining).
  - Worker pulls for defense keep working (bot systems beat mining at priority 0 vs -10).
  - Use `flying.addonSwap` instead of hand-rolled swaps.

Assumptions (BA, best judgement):
- PA4-1 Scaffolding chain (team lead, parity-3 PA4; decisions.md "parity-6a design decisions"): parity-2 T01 → parity-3 T02 → parity-4 T04 → parity-6a T01 → parity-5 T01. All of them edit types.ts, create-world.ts, constants/index.ts and index.ts.
- PA4-2 The Phase-3 contract is confirmed (design delta). Roles = parity-3 T03 `RolesResource` (`get`, `assign`, `roleOf`, `as`, `UnitRole` from constants/unit-role.ts); threat gate = parity-3 T06 `intel.getMainThreat('ground')?.ground` non-empty.
- PA4-3 T03 (map lift/land) blocks T05 placement. Can-place reads the live grid, and the design calls the bug one that "phase 4 depends on". T03 is unblocked and small, so the edge costs nothing.
- PA4-4 "Not in parallel with" constraints (actions.ts shared with parity-3 T05) are listed per ticket. They are not blocking edges; the PM sequences them.
- PA4-5 Standard (non-speed) mining commands land with the bookkeeping in T07, so mining is usable before the phase-2 pathing and phase-3 intel tickets finish. Speed mining, safety, self-defence and long-distance mining come in T08.
- PA4-6 Live smoke tests are their own ticket (T12). They can't run in CI without SC2, and the user/PM runs them locally. The roadmap's "measurable income over auto-mining" exit is met by T12.
- PA4-7 Resolved: phase 6a doesn't edit systems/map.ts (nor resources/map.ts or systems/frame.ts), per technical-architect-3. T03 is unblocked.

---

# Tickets

## T01 Pure formation solver (design P1, pure part)

- Source: design P1 (formation.ts); D4.
- What to build: a pure, typed-array flood fill of a base's buildable area, and the ares building-location scan over it. The scan uses a stride lattice and a kernel/building size, marks accepted kernels as avoid and can reduce the stride on small areas. Also a helper that marks a rectangle as avoid.
- API contract: design P1 `FormationGrids`, `floodArea`, `findBuildingLocations`, `markAvoid`.
- Acceptance criteria:
  - [ ] `floodArea` returns exactly the cells of the same terrain height that are placeable in the start grid and within `maxDist` (euclidean) of the start, on synthetic grids. It's iterative (no recursion) and handles a start on an unplaceable cell (empty result).
  - [ ] `findBuildingLocations` accepts a kernel only when every cell is in the area, placeable, pathable, not avoid and (with avoidCreep) not creep. It returns building centres at (x + w/2, y + h/2).
  - [ ] Accepted kernels are written to `avoid`, so a second pass over the same area never overlaps the first.
  - [ ] A 5x3 kernel with a 3x3 building leaves the addon's 2x2 (centre +2.5, -0.5) inside the kernel.
  - [ ] Stride reduction (opt-in `reduceXStride`): xStride ≥ 7 on an area < 300 cells scans at 5.
  - [ ] No allocation proportional to the number of calls: buffers are reused across `floodArea` calls on the same grids (generation stamps).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new utils/placement/formation.ts + formation.test.ts.
  - Interfaces: design P1 signatures verbatim.
  - Follow: ares placement_manager.py:929-1003 (cy_find_building_locations semantics); utils/pathing/astar.ts (typed arrays, index y*width+x, generation stamps).
  - Don't touch: utils/map/flood.ts (stays for systems/map.ts), types.ts, any resources/ file.
- Stack: core.
- Blocked by: None (pure, new files only).
- Slice siblings: T05, T06.

## T02 Pure mining targets (design P4, pure part)

- Source: design P4 (targets.ts).
- What to build: circle intersections, per-mineral speed-mining targets from all mineral fields and townhall positions (sharpy/ares method), and the townhall drop-off target.
- API contract: design P4 `circleIntersections`, `mineralTargets`, `townhallTarget`.
- Acceptance criteria:
  - [ ] `circleIntersections` returns 0 points for disjoint, nested or concentric circles and 2 for crossing circles (exact values on hand-computed cases).
  - [ ] `mineralTargets` gives each mineral a target at distance ≈ radius (1.35) from the mineral centre on the townhall side, and moves it off neighbouring minerals as ares does (matches ares resource_manager.py:853-882 on a recorded mineral line from a fixture).
  - [ ] `townhallTarget` = towards(townhall, from, 2.75 × factor), default factor 1.08.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: new utils/mining/targets.ts + targets.test.ts.
  - Interfaces: design P4 signatures verbatim.
  - Follow: ares managers/resource_manager.py:853-940; existing geometry helpers (towards/distance) in utils/geometry.
  - Don't touch: types.ts, resources/.
- Stack: core.
- Blocked by: None (pure, new files only).
- Slice siblings: T07, T08.

## T03 Map grid follows lift/land (design P2)

- Source: design P2; D14.
- What to build: when a Terran structure changes type to its flying variant, free its landed footprint in the placement and pathing grids at its position. When a flying structure lands, block the landed footprint at the landing position.
- Acceptance criteria:
  - [ ] Synthetic observations: a barracks lifts → its footprint cells become placeable and pathable.
  - [ ] It lands 6 cells away → the new footprint is blocked and the old one stays free.
  - [ ] Works for command center, barracks, factory, starport (all of `flyingStructureTypes`).
  - [ ] Existing create/destroy grid behavior is unchanged (existing map tests pass).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: systems/map.ts (new `onUnitTypeChanged` handler next to the unitCreated ~:469 / unitDestroyed ~:500 handlers); systems/map.test.ts.
  - Interfaces: `onUnitTypeChanged(world, { unit, previousType })` handler on the map system; no public API change.
  - Follow: the existing footprint marking in the unitCreated/unitDestroyed handlers; `flyingStructureTypes` in constants/groups.ts; `getFootprint`.
  - Don't touch: calculateWall, expansion areas, resources/map.ts.
- Stack: core.
- Blocked by: None.
- Slice siblings: T05, T10.

## T04 Phase-4 scaffolding (design P0)

- Source: design P0; D1.
- What to build:
  - All phase-4 types in types.ts: placement, buildings, mining and flying types and interfaces; the `Placer.placements` hook; four container keys.
  - The four definitions appended to the core resources list after the phase-3 resources, in the order placement, buildings, mining, flying.
  - Stub resources where `configure` works, `onStep` is a no-op, every other method throws a core "not implemented" error, and `reset` keeps settings.
  - Any phase-4 root re-exports.
- API contract: design P0 (all interfaces).
- Acceptance criteria:
  - [ ] `placement`, `buildings`, `mining`, `flying` exist on the resources after world creation (no registration-order assertion; decisions.md "scaffolding tickets: no registration-order tests").
  - [ ] Stub methods throw a core "not implemented" error (settings-survive-reset is tested in T05 and T07).
  - [ ] `Placer` accepts `placements` and existing `place`-only placers still type-check.
  - [ ] `selectWorker` opts include `role`.
  - [ ] Existing tests pass; lint, tsc and tests green.
- Implementation plan:
  - Where:
    - types.ts: every type/interface in design P0, `ResourceContainer` keys, `Placer.placements`.
    - engine/create-world.ts: 4 CORE_RESOURCES entries.
    - New stubs resources/placement.ts, buildings.ts, mining.ts, flying.ts.
    - engine/create-world.test.ts: registration/reset test.
  - Interfaces: design P0.
  - Follow: parity-2 T01 and parity-3 T02 scaffolding; `NodeSC2Error` (engine/errors.ts).
  - Don't touch: actions.ts, macro.ts, builder-plugin.ts, systems/map.ts. After this ticket, no other phase-4 ticket edits types.ts except T10 (the one `swapBuildings` line).
- Stack: core.
- Blocked by: parity-2 T01, parity-3 T02 (same files: types.ts, create-world.ts, index.ts).
- Blocks (scaffolding chain, PA4-1): parity-6a T01.
- Slice siblings: all.

## T05 Placement resource, Terran (design P1)

- Source: design P1; D4–D9.
- What to build: the placement resource.
  - A once-per-game Terran solve on the first step with expansions: mineral-line avoid, user placements first (flag custom), natural bunker, per-base 3x3 (5x3 kernel) and 2x2 passes, main ramp wall from the ramp maths, and the ramp-top exclusion.
  - Grid-only `canPlace`.
  - `request` with flag preferences, alternatives at own bases, and reservation.
  - `reserve`/`release`/`getPlacements`/`add`/`configure`.
  - Per-step taken/available/timeout bookkeeping.
  - `drawDebug`.
  - Zerg returns undefined.
- API contract: design P0 `PlacementResource`, `PlacementRequest`, `Placement`, `UserPlacement`, `PlacementSettings`, `Placer.placements`.
- Acceptance criteria (blueshift + acropolis fixtures):
  - [ ] Every solved spot passes `canPlace` on the fixture's start state; no two spots' footprints overlap (3x3 counted with the 5x3 addon kernel).
  - [ ] The solve floods the start-of-game placement grid (`startPlaceable`) with `terrainHeight`, and the 3x3 passes set `reduceXStride`: a test with a structure placed before the solve shows the flood area unchanged and no spot on the structure.
  - [ ] Main ramp `wall` spots equal the ramp getters (barracksCorrectPlacement 3x3, cornerDepots 2x2); a throwing or null ramp getter is skipped without failing the solve.
  - [ ] A `bunker` spot exists at the natural.
  - [ ] No spot within 6 of the main ramp top centre except wall and custom spots; no auto-solved spot on mineral-line cells.
  - [ ] Two consecutive `request(SUPPLYDEPOT)` calls return different spots; a reserved spot isn't returned until `release` or until the reservation timeout passes (stepTo past 60 game s).
  - [ ] `request(..., { flags: ['wall'] })` prefers wall spots; with none left it returns the closest non-wall spot to the ramp top (main).
  - [ ] Base full with `findAlternative` → a spot at another own occupied base; `findAlternative: false` → undefined.
  - [ ] A spot becomes `taken` (with tag) when an own structure appears there, and `available` after it dies.
  - [ ] `placer.placements` spots (set via `resources.set({ placer })`) are flagged `custom` (plus their own flags), solved first, picked when a request names one of their flags, and otherwise only after non-custom spots (no-flag rule); invalid user spots are skipped with a debug log.
  - [ ] `canPlace` includes addon room by default for barracks/factory/starport; gas types reject a spot with a gas building within 3.5.
  - [ ] Zerg agent → `request` returns undefined.
  - [ ] Zero `client.query` calls from solve, request and canPlace (fake-client call count).
  - [ ] Perf, measured ad hoc and not committed (perf rule): solve ≤ 100 ms (median of 5) on blueshift; request ≤ 0.5 ms. Medians recorded in the ticket.
  - [ ] `drawDebug` sends cells through the debug resource.
  - [ ] `configure` settings (e.g. `reservationTimeout`) survive a game reset; solved placements and reservations don't (moved from T04).
  - [ ] After each 3x3 scan, every kernel filtered out (terrain height mismatch, or ramp-top dist² > 36) is released with `unmarkAvoid(grids, x0, y0, w, h)` from utils/placement/formation.ts (T01), so the following 2x2 pass can use those cells: a test shows a 2x2 spot on a cell that only a filtered-out 3x3 kernel had marked (design review delta 5a).
  - [ ] One `FormationGrids` object is built per game and reused by every scan (the formation module caches its scratch buffers per object); no per-call grids literal is built (spy or identity check across scans and across `add`) (review delta 5b).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/placement.ts (replace the stub); new resources/placement.test.ts.
  - Interfaces: design P0/P1.
  - Grids for T01's formation module (P4-T01 deviations, design review delta 3): pass `terrainHeight` (not `height`) and `startPlaceable` = the start-of-game placement grid, so floodArea floods the start grid while findBuildingLocations checks the live `placeable`. Stride reduction is opt-in: set `reduceXStride` on the 3x3 passes (design P1).
  - Follow: ares placement_manager.py:233-264, 319-434, 499-511, 791-928, 1005-1072, 1362-1398, 1520-1601 and placement_strategy.py:172-380; T01's formation module; `map.getMainBaseRamp()` and utils/map/ramp.ts; `map._grids.placement` and `map._grids.pathing` (live; pathing 1 = blocked), `map._mapState.creep`, start grids via `map.inPlacementGrid` / `map.getTerrainHeight` for floodArea; `getFootprint` (utils/geometry/units.ts); `debug.setDrawCells`.
  - Don't touch: types.ts, actions.ts (findPlacement/canPlace stay), builder-plugin.ts, systems/map.ts.
- Stack: core.
- Blocked by: T01, T03 (PA4-3), T04.
- Slice siblings: T01, T06, T09, T11.

## T06 Placement resource, Protoss (design P1b)

- Source: design P1b; D4.
- What to build: the Protoss solve in the same resource: production pylons, 3x3 and extra 2x2 passes, optimal pylon per base, main ramp wall (protoss wall pylon/buildings), and `powered` requests honouring `pylonBuildProgress`. Pylons never take staticDefence spots.
- API contract: design P0 `PlacementRequest.powered`/`pylonBuildProgress`, flags `productionPylon`/`optimalPylon`/`staticDefence`.
- Acceptance criteria (fixtures with a Protoss agent):
  - [ ] Every solved spot passes canPlace; no footprint overlaps.
  - [ ] Each base has an `optimalPylon` spot (the 2x2 with the most 3x3 spots within 6.5).
  - [ ] Main ramp wall spots equal the protoss ramp getters.
  - [ ] `powered: true` returns only spots within 6.5 of an own pylon at the same terrain height with buildProgress ≥ pylonBuildProgress; none → undefined (or an alternative base).
  - [ ] A pylon request never returns a `staticDefence` spot.
  - [ ] The review confirms the formation scan order (y outer, x inner) matches ares for `dropInterval`, so the dropped spots are the same as ares'; a fixture test pins the spot list for one base (review delta 5c).
  - [ ] Terran results unchanged (T05 tests pass).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/placement.ts; resources/placement.test.ts.
  - Interfaces: design P1b.
  - Follow: ares placement_manager.py:1074-1240, 1314; placement_strategy.py:76-170.
  - Don't touch: types.ts, formation.ts (raise a follow-up if the pure module needs a change).
- Stack: core.
- Blocked by: T05.
- Slice siblings: T05.

## T07 Mining: bookkeeping, worker selection, gas, standard mining (design P4a)

- Source: design P4 (bookkeeping, selectWorker, standard mining); D12, D2 amended.
- What to build: the mining resource behind `enabled`.
  - The worker↔patch/gas/townhall maps over GATHERING-role workers.
  - The per-step pass: drop dead/mined-out resources and dead bases; gas fill/drain one worker per pass up to `workersPerGas`; assign unassigned workers to available minerals; initial split on the first pass.
  - `selectWorker` (removes the worker from bookkeeping, role BUILDING) and `release` (role GATHERING).
  - Lookups: `getAssignment` and `getWorkersOn`.
  - Standard mining commands (with the 0.5 s per-worker lock) issued under `roles.as(UnitRole.GATHERING, …, { priority: settings.priority })`. Managed workers = `roles.get(UnitRole.GATHERING, { types: worker type })`.
  - Skip workers with a `command` label or a construction order.
- API contract: design P0 `MiningResource`, `MiningSettings`, `MiningAssignment`; parity-3 T03 `RolesResource`.
- Acceptance criteria:
  - [ ] Disabled (default) → zero proposals and no role changes.
  - [ ] Enabled: the initial split puts 2 workers on the 4 closest patches and 1 on the rest; never more than 2 per patch.
  - [ ] Gas fills to `workersPerGas` one worker per pass and drains one per pass when lowered.
  - [ ] configure({ workersPerGas: 4 | -1 | 1.5 }) throws RangeError and keeps the previous value; 0 drains all gas workers one per pass.
  - [ ] Only available minerals are used: visible, not snapshot, < 10 from a townhall with buildProgress > 0.85.
  - [ ] A mined-out patch or dead townhall frees its workers, and they are reassigned on the next pass.
  - [ ] `selectWorker` removes the worker from bookkeeping and sets role BUILDING; the next pass doesn't reassign it; `release` returns it and the next pass assigns it.
  - [ ] `selectWorker` prefers unassigned gatherers unless `forceClose`; `minHealth` filters.
  - [ ] `selectWorker(pos, { role: GATHERING })` keeps the role. While the worker has a `command` label or a build order it isn't reassigned and gets no proposals. Once idle it's reassigned on the next pass.
  - [ ] Workers with a `command` label or a build order get no mining proposals.
  - [ ] A bot system at priority 0 commanding a gathering worker wins; mining's result is `dropped` (outranked) in `commandResults`.
  - [ ] `configure` settings survive a game reset; per-game maps don't (also covers the check moved from T04).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/mining.ts (replace the stub); new resources/mining.test.ts.
  - Interfaces: design P0/P4.
  - Follow: ares managers/resource_manager.py:40-128, 322-470, 472-688, 715-811; behaviors/macro/mining.py:264-301; parity-3 `roles.get`/`roles.as`; units' `getBases`, `getMineralFields`, gas `vespeneContents` (not `gasMineTypes`, which lacks RICH variants; design risk 5).
  - Don't touch: types.ts, agent/macro.ts (distributeWorkers), actions.ts, buildings.ts.
- Stack: core.
- Blocked by: T04, parity-3 T03 (roles).
- Slice siblings: T02, T08, T09, T11.

## T08 Mining: speed mining, safety, self-defence, long-distance (design P4b)

- Source: design P4 (commands); D12 amended.
- What to build:
  - Mineral targets computed once per game.
  - Speed-mining command logic (move + queued smart, one owner) for minerals.
  - Keep-safe flee via pathing.
  - Self-defence gated on `intel.getMainThreat('ground')?.ground` being non-empty, using spatial range queries and `weaponReady`.
  - Far-from-resource path back via `pathing.nextPoint`, plus stray gather correction.
  - Long-distance mining for unassigned workers.
  - ares' early-threat rule: before 300 game seconds, while intel reports ground threats at the main base, workers mine near the start location (moved from T07; decisions.md "P4-T07 mining deviations").
  - Each piece is toggled by its setting.
- API contract: design P0 `MiningSettings` (speedMining, townhallDistanceFactor, keepSafe, fleeAtHealth, weightSafetyLimit, selfDefence, longDistanceMine), `getMineralTarget`.
- Acceptance criteria:
  - [ ] `getMineralTarget` returns T02's target for each mineral.
  - [ ] Speed-mining command shapes at the window edges (0.75 and 2): a worker inside the window toward its mineral gets MOVE target + queued SMART mineral; returning inside the window gets MOVE townhallTarget + queued SMART townhall; 2 orders → nothing; outside the window → the plain command. Move + queued smart arrive together for one owner.
  - [ ] `speedMining: false` → standard mining only.
  - [ ] Flee: a cost stamped at the worker (influence addCost) on groundAvoidance → MOVE to `pathing.closestSafeSpot`; health ≤ fleeAtHealth and unsafe on ground → flee; value > weightSafetyLimit → flee.
  - [ ] Self-defence only when intel reports a main ground threat: the worker attacks the lowest-health enemy in range when its weapon is ready; no threat → no attack.
  - [ ] A worker > 6 from its resource, not carrying → MOVE to `pathing.nextPoint` toward it.
  - [ ] Long-distance: an unassigned worker with no available local mineral mines the closest safe unassigned field.
  - [ ] Early threat: before 300 s with a ground threat at the main base (intel), workers are assigned to minerals near the start location; at or after 300 s, or with no main ground threat, normal assignment applies.
  - [ ] Perf, measured ad hoc and not committed (perf rule): one mining onStep with 66 workers on 3 bases ≤ 2 ms (median). Median recorded in the ticket.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/mining.ts; resources/mining.test.ts (no committed perf test).
  - Interfaces: design P4.
  - Follow: ares behaviors/macro/mining.py:88-246, 249-301, 303-418, 421-532; speed_mining.py:58-125; T02 targets; parity-2 `pathing.isPositionSafe`/`closestSafeSpot`/`nextPoint`, `influence.getGrid`, `spatial.unitsInRange` (self-defence: `spatial.unitsInRange(worker, worker.groundRange() + worker.radius + 0.5, 'enemyGround')`); parity-3 `intel.getMainThreat`.
  - Don't touch: types.ts, pathing.ts, influence.ts, spatial.ts, intel.ts.
- Stack: core.
- Blocked by: T02, T07, parity-2 T03 (spatial), parity-2 T08 (pathing), parity-3 T06 (intel).
- Slice siblings: T02, T07, T12.

## T09 Building tracker (design P3)

- Source: design P3; D10, D11, D2 amended.
- What to build: the buildings resource.
  - `build` and `buildGas`: target from `at` or `placement.request`; worker from `worker`, `mining.selectWorker` when mining is enabled, or the closest free worker; role BUILDING.
  - The per-build state machine (design P3 steps 1–8), issuing commands under `roles.as(UnitRole.BUILDING, …, { priority: settings.priority })`. `roles.assign(worker, BUILDING)` happens before the first proposal.
  - BUILD proposals with `onNotSent` retry and re-place after maxAttempts.
  - Release of the worker and the placement on done/failed.
  - Low-HP cancel per `cancelLowHp`, plus `cancel`, `pending`, `getTracked` and `configure`.
- API contract: design P0 `BuildingTracker`, `TrackedBuild`, `BuildOptions`, `BuildingSettings`.
- Acceptance criteria:
  - [ ] `build` with no placement or no worker returns undefined and releases any reservation it made.
  - [ ] A worker far from the target gets MOVE (via `pathing.nextPoint`); within range it gets BUILD; the status goes moving → ordered → constructing → done.
  - [ ] A rejected BUILD (fake-client result) is reissued next step; after `maxAttempts` (5) the placement is released and a new one is requested; an outranked (dropped) BUILD is reissued.
  - [ ] Worker dies → replaced; no replacement → failed 'noWorker'.
  - [ ] A Terran structure with no constructing SCV (builder died) → an SCV is sent to resume it (SMART), tracked or not.
  - [ ] A structure appearing at the target → done with structureTag (Terran at buildProgress ≥ 1, P/Z at > 0); the worker is released (GATHERING, or `mining.release` when enabled, and mining assigns it next pass).
  - [ ] Protoss/Zerg or gas build older than `timeout` → failed 'timeout', worker and reservation released.
  - [ ] A townhall target that can't be placed retargets to the next free expansion; none → failed 'blocked'.
  - [ ] Gas: an enemy gas on the target geyser → retarget to another free geyser near own townhalls; `buildGas({ max })` limits simultaneous gas builds (default 1).
  - [ ] Low HP (< max(50, 9% max)) on a tracked unfinished structure → CANCEL_BUILDINPROGRESS and failed 'cancelled'; 'all' also cancels untracked; 'off' cancels none; creep tumours never.
  - [ ] Issuing BUILD sets the worker's `command` label (cleared by onNotSent) and deducts cost; it waits while `canAfford(unitType, earmark)` is false or tech isn't ready.
  - [ ] `pending(type)` counts tracked builds not done/failed; `getTracked` includes done/failed only from the current loop.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/buildings.ts (replace the stub); new resources/buildings.test.ts.
  - Interfaces: design P0/P3.
  - Follow: ares managers/building_manager.py:143-436, 456-489, 491-584, 647-718; actions.build (resources/actions.ts ~:456-469) for label/spend; core-arch `queueAction` + `onNotSent`; T05 placement; T07 `selectWorker`/`release`; parity-2 `pathing.nextPoint`; `agent.canAfford`, `agent.techRequirementProgress`.
  - Don't touch: types.ts, actions.ts, builder-plugin.ts, placement.ts, mining.ts.
- Stack: core.
- Blocked by: T05, T07, parity-2 T08 (pathing).
- Slice siblings: T05, T07, T11.

## T10 Flying structures + swapBuildings (design P5)

- Source: design P5; D13 (supersedes core-arch Q7).
- What to build:
  - The flying resource: a per-tag plan re-derived from the unit each step (gone/landed → drop; landed elsewhere → lift, cancelling the queue first if busy; flying far → move; near → land; or hover), with no timers. Commands go under `actions.as({ owner: 'flying', priority })`.
  - `move`, `swap`, `addonSwap`, `cancel`, `getPlans`, `configure`.
  - `actions.swapBuildings` delegates to `flying.swap` after its existing preconditions and resolves with no value.
- API contract: design P0 `FlyingStructures`, `FlightPlan`; `actions.swapBuildings(a, b): Promise<void>`.
- Acceptance criteria:
  - [ ] Synthetic observations walk lift → flying type → move → land at destination → plan dropped.
  - [ ] A busy landed structure gets CANCEL_QUEUE5 + queued LIFT; an idle one gets LIFT.
  - [ ] `land: false` hovers at the destination without landing.
  - [ ] A rejected LAND is re-proposed next step.
  - [ ] `swap(a, b)` completes with both structures landed at each other's position.
  - [ ] `addonSwap` picks the closest ready idle addon of the requested kind, moves the attached structure to the host's spot, and lands the host at `addOnLandPosition()`; returns false when no host/addon is found.
  - [ ] `swapBuildings` sends and queues nothing itself and contains no `Bluebird.delay`; the LIFT proposals come from the flying onStep on the next dispatch and leave in that step's flush.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/flying.ts (replace the stub); new resources/flying.test.ts; resources/actions.ts (`swapBuildings` body ~:207-240 only); types.ts (`swapBuildings` return type line ~:497 only); resources/actions.test.ts if it covers swapBuildings.
  - Interfaces: design P0/P5.
  - Follow: ares managers/flying_structure_manager.py:111-160, behaviors/macro/addon_swap.py:55-131; `flyingStructureTypes`, `reactorTypes`, `techLabTypes` (constants/groups.ts); `Unit.addOnLandPosition` (engine/create-unit.ts ~:310).
  - Don't touch: actions.ts outside swapBuildings, builder-plugin.ts.
- Stack: core.
- Blocked by: T04, core-arch T04 (actions.ts chain).
- Not in parallel with: parity-3 T05 (actions.ts), T11 (actions.ts).
- Slice siblings: T03, T11, T12.

## T11 Integration: builder plugin, actions.build, macro builder pick (design P6)

- Source: design P6.
- What to build:
  - Builder-plugin Terran/Protoss structure tasks (not townhall/gas/addon): a `placer.place` result → `buildings.build` with `at` and the earmark. Otherwise `buildings.build` with `placement` options (flags supplyDepot for depots, production for addon hosts) and the earmark, so the tracker owns the reservation and keeps the flags across replans; the plugin makes no `placement.request` of its own. If that returns undefined, fall back to today's findPlacement + actions.build path, unchanged (technical-architect-4).
  - The COMMAND_GIVEN 250-loop reset only when nothing is pending for that type.
  - Gas tasks via `buildings.buildGas`.
  - `actions.build` and the macro builder pick prefer `mining.selectWorker(pos, { forceClose: true, role: UnitRole.GATHERING })` when mining is enabled.
- API contract: design P6 (no new public API).
- Acceptance criteria:
  - [ ] Builder-plugin Terran depot/barracks tasks make zero `client.query` calls and appear in `buildings.getTracked()`.
  - [ ] COMMAND_GIVEN isn't reset after 250 loops while `buildings.pending(type) > 0`; it still resets when nothing is pending.
  - [ ] A `placer.place` result still wins over the placement solver.
  - [ ] A solver-placed task's reservation lives as long as the build: it's kept alive while the build waits (still reserved past 60 game s), and released when the build is done or failed. The solver path passes `placement` (not `at`) to `buildings.build`, and the plugin calls `placement.request` nowhere. A replan after maxAttempts keeps the task's flags (P4-T09 review; technical-architect-4).
  - [ ] When `build({ placement })` returns undefined (Zerg, no placement, no worker), the task falls back to today's findPlacement path (existing tests pass).
  - [ ] Gas tasks are tracked.
  - [ ] `actions.build` and `selectBuildWorker` with mining enabled take `mining.selectWorker`'s worker; with mining disabled the behavior is unchanged.
  - [ ] After the structure finishes, that worker is reassigned to a patch by mining (no manual release).
  - [ ] Existing builder-plugin, actions and macro tests pass; lint, tsc and tests green.
- Implementation plan:
  - Where: systems/builder-plugin.ts (~:332-454, buildPlacement and the build task fn; COMMAND_GIVEN reset ~:270) + systems/builder-plugin.test.ts; resources/actions.ts (`build` builder pick ~:417-442 only); agent/macro.ts (`selectBuildWorker` ~:239 only).
  - Interfaces: none new. Calls: `buildings.build(unitType, { at, earmark })` for a placer result; `buildings.build(unitType, { placement: { flags }, earmark })` otherwise; undefined → existing findPlacement path. Don't add an API that says why build() returned undefined (noPlacement vs noWorker): with no worker the fallback finds none either and the task retries next step, as now.
  - Follow: design P6; T05 `request`, T09 `build`/`buildGas`/`pending`, T07 `selectWorker`.
  - Don't touch: findPlacement/canPlace bodies, distributeWorkers, townhall/addon branches of builder-plugin, types.ts.
- Stack: core.
- Blocked by: T09, T10 (actions.ts), core-arch T04 (macro.ts, actions.ts).
- Not in parallel with: parity-3 T05 (actions.ts); parity-6a T06 (agent/macro.ts, distributeWorkers workersPerGas); either order.
- Slice siblings: T05, T07, T09, T10.

## T12 Live smoke tests (design P7)

- Source: design P7; roadmap phase 4 exit (speed mining measurable, addon swap without sleeps).
- What to build: three live tests, skipped without SC2 like the engine live test:
  - Placement: every solved Terran spot (3x3 with addon spot) is accepted by a real placement query at game start.
  - Mining: speed-mining income beats auto-mining.
  - Flying: an addon swap completes.
- Acceptance criteria:
  - [ ] placement.live: simple64 + blueshift, ≤ 2% of spots rejected by `query.placements`; rejected spots are listed in the output.
  - [ ] mining.live: 12 SCVs, one base, simple64, step 2: minerals at loop 6720 with mining enabled (speedMining) > with mining disabled. The step-4 result is recorded without asserting. Both numbers are recorded in the ticket.
  - [ ] flying.live: barracks+reactor ↔ factory addon swap; both land at the swapped positions within 30 game s.
  - [ ] Skipped cleanly when SC2 isn't available; lint, tsc and tests green.
- Implementation plan:
  - Where: new resources/placement.live.test.ts, resources/mining.live.test.ts, resources/flying.live.test.ts.
  - Follow: engine/create-engine.live.test.ts (skip guard, engine setup); test/spawn-units.ts.
  - Don't touch: non-test code (failures go back to the owning ticket as follow-ups).
- Stack: core (live tests).
- Blocked by: T05, T08, T10, T11.
- Slice siblings: T05, T08, T10.

## T13 Docs + changelog (design P8)

- Source: docs-plan.md §2 (Phase 4), §3; design P8.
- What to build:
  - readme.md:
    - New `### placement`, `### buildings`, `### mining`, `### flying` under Resources, each with a method table, defaults and one Terran example. Add them to the TOC and the `resources.get()` destructure line.
    - actions: the findPlacement/canPlace rows point to placement; the `swapBuildings` row (flying-backed, resolves on proposal).
    - Macro helpers: builder handoff, and "distributeWorkers vs mining: pick one".
    - Build systems: Terran/Protoss build tasks use precomputed placements and the tracker.
    - map: the grid now follows lift/land.
    - ares deviations: Terran mineral-line avoidance, flag-filter selection, alternatives only at own bases, no tracker events, low-HP cancel default 'tracked'; buildings (decisions.md "batch 2 shipped; P4-T09 review fixes" and "P4-T09 tracker decisions"): an untracked unfinished Terran structure is resumed only after the bot has called `buildings.build`/`buildGas` that game (ares always resumes), low-HP cancel fires only on a step where the structure's health dropped (ares on_structure_took_damage; threshold max(50, 9% max)), 'tracked' mode doesn't cancel adopted (resumed-untracked) builds, and `buildGas` picks the free geyser closest to an own townhall; mining: `selectWorker` and gas picks skip busy (command-labelled or constructing) workers, assignment runs every step (ares every 4th), and the townhall rule (a resource counts as dead/lifted when no own townhall is within 10 for minerals or 12 for gas) (decisions.md "P4-T07 mining deviations").
    - Known limitations: no burrowed/blocked-placement detection, Zerg not precomputed, no vespene boost, speed mining weaker at step 4.
    - The "Changes compared to node-sc2" entry for swapBuildings.
  - docs/api.md: the four resources, `actions.swapBuildings` return, `Placer.placements`.
  - docs/internals.md: Resources list, with the registration-order rationale.
  - docs/changelog.md: `Unreleased › parity-4`.
- Acceptance criteria:
  - [ ] readme.md: the sections above; TOC and `resources.get()` destructure line list placement, buildings, mining, flying.
  - [ ] docs/api.md: every public method/type of design P0 in the §3.2 format, with defaults.
  - [ ] `swapBuildings` docs at readme.md ~742 (actions table), ~1062 and ~1077 (Changes compared to node-sc2) and docs/api.md ~815 say it delegates to `flying.swap` and returns `Promise<void>`; none still says it sends immediately or resolves with `ResponseAction[]`.
  - [ ] docs/internals.md Resources list updated.
  - [ ] docs/changelog.md: `Unreleased › parity-4` with Added/Changed (swapBuildings return and delegation to `flying.swap`, superseding core-arch Q7's "stays on the raw immediate path", builder-plugin placement + tracker, map grid lift/land) and Migrating bot/ (from this file's Further Notes).
  - [ ] The flying section states: a plan whose destination never accepts LAND is re-proposed every step until the bot calls `flying.cancel`; and flying commands run at priority 10, so bot commands to a structure in transit are dropped as outranked.
  - [ ] ares deviations and Known limitations updated.
  - [ ] The buildings section and ares deviations state the four P4-T09 deviations: resume of untracked structures only after opt-in (`build`/`buildGas` called that game), damage-triggered low-HP cancel, 'tracked' mode skips adopted builds, `buildGas` picks the geyser closest to a townhall.
  - [ ] Every new example type-checks (scratch file + tsc, not committed); no mention of the old swapBuildings return/sleep semantics remains.
- Implementation plan: Where: packages/core/readme.md, docs/api.md, docs/internals.md, docs/changelog.md. Don't touch: code.
- Stack: core (docs).
- Blocked by: T03, T05, T06, T08, T09 (incl. its review fixes), T10, T11, parity-3 T07 (docs chain).
- Slice siblings: all.
