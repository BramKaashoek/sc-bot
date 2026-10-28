# bugs: core backlog bug fixes

Source: .agent-work/core-arch.status.md backlog line; core-arch.decisions.md "backlog: systems/unit.ts:204 isStructure throw", "backlog: enemy lift/land not tracked on grid", OneBaseTempests line (:106); speed-mining footprint evidence (scratchpad mining-bug/footprints.json, live SC2 pathing grid per structure type).
Scope: packages/core only. bot/ untouched.

Status: DRAFT. Root causes below were confirmed in the code by the architect unless marked otherwise. Open decisions: BQ1–BQ7 at the end.

Paths are relative to packages/core. Line numbers are from the working tree on 2026-10-27; systems/builder-plugin.ts has P6B-T06's uncommitted edits, so its numbers will shift.

## Proposed order

1. Now, in parallel (no shared files with in-flight work): BG-T02, BG-T03, BG-T04, BG-T08.
   - BG-T03 touches resources/placement.ts, which CN-A02 (:104) and CN-A03 (:59) also touch. Run it before CN-A02 starts; otherwise after.
   - BG-T02 touches resources/buildings.ts, which CN-A03 (:27), CN-B02 (:78, :290) and CN-A04 (:63-72) also touch. All three are queued behind it.
2. After P6B-T06 lands: BG-T01 (systems/builder-plugin.ts). Run it before CN-B02, which also edits builder-plugin.ts.
3. After CN-A02 (the footprint-loop prefactor in systems/map.ts): BG-T06 → BG-T07 → BG-T05, serial (same file, same helper).
4. After CN-C03 lands (its uncommitted generate-data.ts / researched-from.ts edits): BG-T09. After BG-AM lands (builder-plugin.ts): BG-T10. The two are independent of each other.

Edges for the PM: BG-T03 ↔ CN-A02 (placement.ts), BG-T02 → CN-A03/CN-B02/CN-A04 (buildings.ts), P6B-T06 → BG-T01 → CN-B02 (builder-plugin.ts), CN-A02 → BG-T06 → BG-T07 → BG-T05 (systems/map.ts), CN-C03 → BG-T09 (generate-data.ts), BG-AM → BG-T10 (builder-plugin.ts).

---

### BG-T01 Earmark names collide across build systems

- What's wrong: every build system names its earmarks `task${index}` (systems/builder-plugin.ts:392, :588, :802, and the switchOpening settle at :274). Two build systems that both earmark task 0 share one name.
- Root cause (confirmed): data.addEarmark ignores a name that already exists (engine/data-storage.ts:58-61), so the second system's earmark is never added and it believes it has one. getEarmarkTotals(name) excludes every earmark with the caller's name (:67-69), so each system treats the other's reservation as its own, and agent.canAfford / settleEarmark (agent/create-agent.ts:190-191, data-storage.ts:77-79) removes the other system's earmark when the first one spends.
- Fix: each builder-plugin instance gets a unique earmark prefix when the plugin is applied (a module-level counter; system names aren't guaranteed unique). One local `earmarkName(task)` helper replaces every `task${task.index}` site, including the switchOpening settle and the upgrade path.
- Acceptance criteria:
  - [ ] Two build systems in one world, both earmarking their task 0 at low minerals, leave two earmarks in `data.get('earmarks')` (fails today: one).
  - [ ] When system A's task spends, system B's earmark is still present (fails today: A's settle removes it).
  - [ ] An upgrade task's earmark (canAffordUpgrade path) uses the same per-system name (test with two systems, one upgrade earmark each).
  - [ ] switchOpening settles only its own system's earmarks (two systems, switch one; the other's earmark survives).
  - [ ] Existing builder-plugin tests pass; lint, tsc and tests green.
- Implementation plan:
  - Where: systems/builder-plugin.ts (earmark naming only) + builder-plugin.test.ts.
  - Interfaces: none public. Earmark names are internal strings; nothing outside builder-plugin parses them (grep confirmed: buildings.ts only passes the name through).
  - Follow: existing earmark tests in systems/builder-plugin.test.ts.
  - Don't touch: engine/data-storage.ts (addEarmark's dedupe is relied on by buildings.ts:303 re-adding settled earmarks), resources/buildings.ts.
- Stack: core. Staffing: junior.
- Blocked by: P6B-T06 (same file, in flight).

### BG-T02 Tracked build with an explicit `at` gets moved by replan

- What's wrong: buildings.build(unitType, { at }) never reserves a solver spot, but replan (resources/buildings.ts:273-286) calls placement.request(build.unitType, build.placementRequest) with placementRequest undefined. When the `at` cell becomes unplaceable (:408-409) or BUILD is rejected maxAttempts times (:307), the build silently moves to a solver spot at the main, or fails noPlacement (always, for Zerg and for 5x5 types, since request returns undefined).
- Root cause (confirmed): replan doesn't know the build was pinned to a caller's position; `reserved` (false for `at` builds) is the only origin signal and it's also cleared by a failed replan.
- Fix (per BQ1, recommended): a build created with `at` is never replanned. Where replan would run, it fails with failure `'blocked'`. Townhalls (retargetTownhall) and gas (geyser retarget) keep their own paths. The builder plugin already recovers: its 250-loop COMMAND_GIVEN reset (systems/builder-plugin.ts:308-309) re-runs the task once `buildings.pending` is 0, re-resolving the target.
- Acceptance criteria:
  - [ ] A Terran depot built with `at` whose cells become unplaceable fails `'blocked'` with its target unchanged and no placement reserved (fails today: target moves to a solver spot, status stays active).
  - [ ] The same build after maxAttempts rejected BUILDs fails `'blocked'` (fails today: moves).
  - [ ] A build created with `placement` options still replans to a new solver spot with the same flags (existing behavior, extend the existing test).
  - [ ] Townhall retarget and gas retarget tests unchanged.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/buildings.ts: internal `Build` type gains an origin flag (e.g. `pinned: boolean`) set in build() from `at`; replan() fails pinned builds with `'blocked'`. Tests in resources/buildings.test.ts.
  - Interfaces: none public; `TrackedBuild.failure` already includes `'blocked'` (types.ts:1031).
  - Follow: retargetTownhall's fail path (buildings.ts:311-322); test "retargets a blocked townhall to a free expansion, else fails blocked" (buildings.test.ts:223).
  - Don't touch: :27, :63-72, :78, :290 regions (CN-A03, CN-A04, CN-B02); systems/builder-plugin.ts.
- Stack: core. Staffing: junior (after BQ1 is answered; the code change is local).
- Blocked by: None. Blocks CN-A03, CN-B02, CN-A04 (same file).

### BG-T03 placement.add() throws on Zerg

- What's wrong: placement.add(placements) after the solver ran calls refreshLive(world, state.grids!) (resources/placement.ts:595). For Zerg (and any non-Terran/Protoss race) onStep marks the state solved and returns before creating grids (:628-630), so grids is undefined and refreshLive throws reading `grids.height` (:135).
- Root cause (confirmed): as above. Placement is Terran/Protoss only by design (parity-4 D4 "Zerg undefined"; request returns undefined for Zerg, :514).
- Fix (per BQ2, recommended): add() is a no-op with a debug log when there are no grids, matching request(). Zerg custom placements are out of scope.
- Acceptance criteria:
  - [ ] On a solved blueshift-zerg world, placement.add([...]) doesn't throw and getPlacements() stays empty (fails today: TypeError).
  - [ ] add() before the solver runs on Zerg still doesn't throw (pending list is never applied).
  - [ ] Terran/Protoss add() tests unchanged.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: resources/placement.ts add() (:589-597 only) + placement.test.ts (next to "returns undefined for a Zerg agent", :253).
  - Follow: request()'s Zerg guard (:514).
  - Don't touch: :59, :76, :104 (CN-A02/CN-A03).
- Stack: core. Staffing: junior.
- Blocked by: None. Order against CN-A02 (same file): before it if CN-A02 hasn't started.

### BG-T04 Unit.isStructure throws on unknown unit types

- What's wrong: systems/unit.ts:207-209 builds `previous = { isStructure: currentUnit.isStructure() }` for every own unit each step; :202 and :223 also call it. For a unit type missing from game data, isStructure (engine/create-unit.ts:234-236) → data() → data.getUnitTypeData (engine/data-storage.ts:31-34) reads `.race` of undefined and throws. The throw aborts the unit system's forEach for the frame, so every unit after it gets no create/update/events that step; the error is only debug-logged (create-system.ts:119-128).
- Root cause (confirmed): getUnitTypeData has no guard for unknown ids, and isStructure goes through it. Real game data is unaffected (every live type is in data); fixtures and future game versions with new types hit it.
- Fix: isStructure reads the attributes through a tolerant lookup and returns false for an unknown type. Same pattern as the existing tolerant lookup at create-unit.ts:259 (`data.get('units')?.[id]`). getUnitTypeData stays as is (its many `!` callers are out of scope).
- Acceptance criteria:
  - [ ] An own raw unit of an unknown type (e.g. 99999) listed before a known unit in the same observation: the known unit is created and its `unitCreated` fires that step (fails today: forEach aborts, known unit missing).
  - [ ] Same for an existing unknown-type unit on the update path (step twice; a later known unit still updates).
  - [ ] `isStructure()` on an unknown-type unit returns false (engine/create-unit.test.ts).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: engine/create-unit.ts isStructure (:234-236) + create-unit.test.ts; systems/unit.test.ts for the two step-level cases.
  - Follow: create-unit.ts:259; fixture world helpers in systems/unit.test.ts.
  - Don't touch: engine/data-storage.ts, systems/unit.ts (no change needed there).
- Stack: core. Staffing: junior.
- Blocked by: None.

### BG-T05 Enemy structures are never on the pathing/placement grid

- What's wrong (verified, wider than the backlog line): it's not only lift/land. The map system blocks grid cells in onUnitCreated (systems/map.ts:475-485), which is fed by `unitCreated`, an own-units-only event (systems/unit.ts:218-219). Enemy structures only reach map.ts through onEnemyFirstSeen, which records expansion ownership and touches no cells (:530-544). `unitTypeChanged` is own-only too (systems/unit.ts:178, :191-197), so enemy lift/land is also missed. Result: placement.canPlace (resources/placement.ts:184, reading map._grids) accepts spots under enemy proxies/cannons, and pathing routes through enemy walls. onUnitDestroyed does fire for dead enemies (systems/frame.ts:109, all alliances) and "frees" cells that were never blocked (harmless today).
- Root cause (confirmed): no enemy-structure path into the grid exists.
- Fix (per BQ3, recommended): the map system keeps a per-tag record of the enemy structure cells it blocked (type, position). Each step it reconciles currently visible enemy structures against the record: new ground structure → block; type changed to flying → free; landed or seen at a different position → free old cells, block new; destroyed (onUnitDestroyed, enemy) → free. Out-of-vision structures stay blocked (memory semantics). Uses the same footprint and pathingCells helpers as own structures (so lowered depots, townhall and nydus corners behave the same, after BG-T06/T07). `unitTypeChanged` stays own-only (python-sc2 parity: on_unit_type_changed is own units).
- Acceptance criteria:
  - [ ] An enemy barracks first seen at P blocks its footprint for placement and pathing (fails today).
  - [ ] It lifts (type → BARRACKSFLYING): cells freed. It lands at Q: Q blocked, P stays free (fails today).
  - [ ] It lifts out of vision and is next seen landed at Q: P freed, Q blocked.
  - [ ] It dies: cells freed. An enemy structure out of vision stays blocked.
  - [ ] An enemy townhall leaves its corner cells pathable; an enemy lowered depot is pathable (after BG-T06).
  - [ ] Own-structure grid tests unchanged; lint, tsc and tests green.
- Implementation plan:
  - Where: systems/map.ts (onStep reconcile, onUnitDestroyed enemy branch) + systems/map.test.ts.
  - Interfaces: none public.
  - Follow: onUnitTypeChanged (:517-528) and its test "frees the footprint of %p when it lifts and blocks it where it lands" (map.test.ts:66); the single footprint helper from CN-A02.
  - Don't touch: systems/unit.ts event semantics, resources/placement.ts.
  - Perf: reconcile only changed/new enemy structures (by tag/type/pos), not every enemy cell each step.
- Stack: core. Staffing: SENIOR. Reason: open judgment calls (memory semantics for snapshots, out-of-vision lift/land, overlap with dead/never-blocked cells) and a per-step cost on every enemy structure.
- Blocked by: BG-T07 (systems/map.ts, pathingCells), which is blocked by BG-T06, which is blocked by CN-A02.

### BG-T06 Lowered supply depot stays blocked for pathing

- What's wrong: a depot blocks its 2x2 for pathing at creation (systems/map.ts:483). Lowering it is a SUPPLYDEPOT → SUPPLYDEPOTLOWERED type change, which onUnitTypeChanged ignores because neither type is flying (:518-520). In SC2 a lowered depot is fully pathable (footprints.json: SUPPLYDEPOTLOWERED, all 4 cells pathable) and still not placeable.
- Root cause (confirmed): pathingCells (:32-35) only knows the townhall-corner exception, and onUnitTypeChanged only handles flying ↔ ground.
- Fix: pathingCells returns no pathing cells for SUPPLYDEPOTLOWERED. onUnitTypeChanged handles any type change on a ground structure by freeing the old type's pathing cells and blocking the new type's (placeable unchanged); flying ↔ ground keeps today's behavior.
- Acceptance criteria:
  - [ ] Depot built → 4 cells unpathable; lowered → pathable and still unplaceable; raised → unpathable again (fails today at "lowered").
  - [ ] A lowered depot that dies frees placement; pathing stays free.
  - [ ] A depot created already lowered (unitCreated with SUPPLYDEPOTLOWERED) blocks placement only.
  - [ ] Existing lift/land and townhall-corner tests unchanged; lint, tsc and tests green.
- Implementation plan:
  - Where: systems/map.ts pathingCells + onUnitTypeChanged; systems/map.test.ts.
  - Follow: map.test.ts:66 (lift/land table test).
  - Don't touch: resources/map.ts.
- Stack: core. Staffing: junior.
- Blocked by: CN-A02 (same file; prefactor first).

### BG-T07 Nydus Canal corners blocked for pathing

- What's wrong: pathingCells (systems/map.ts:32-35) leaves corners pathable only for townhalls. SC2 also leaves the 4 corners of a NYDUSCANAL (3x3) pathable (footprints.json: NYDUSCANAL pathableInFp = the 4 corners). Same evidence shows CREEPTUMORBURROWED (1x1) fully pathable, while we block it (see BQ4).
- Root cause (confirmed): the corner rule is hard-coded to townhallTypes and the 5x5 half-extent (`< 2`).
- Fix: pathingCells drops corner cells by footprint half-extent for a set of corner-pathable types (townhalls + NYDUSCANAL), and drops all cells for fully-pathable types (SUPPLYDEPOTLOWERED from BG-T06; CREEPTUMORBURROWED if BQ4 = yes).
- Acceptance criteria:
  - [ ] Own NYDUSCANAL created → its 4 corners pathable, the other 5 cells unpathable, all 9 unplaceable (fails today: corners unpathable). Destroyed → all freed.
  - [ ] Townhall corners unchanged (existing test).
  - [ ] (BQ4 = yes) Own CREEPTUMORBURROWED → cell pathable, unplaceable (fails today).
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: systems/map.ts pathingCells; systems/map.test.ts.
  - Follow: the existing townhall-corner assertions in map.test.ts:66-98.
  - Don't touch: anything outside pathingCells.
- Stack: core. Staffing: junior.
- Blocked by: BG-T06 (same function).

### BG-T08 OneBaseTempests "16 tempestgroundattackupgrade"

- What's wrong: the ares OneBaseTempests opening has a step `16 tempestgroundattackupgrade`; core's parser rejects it (unknown command) because constants/upgrade.ts has no such id.
- Root cause (confirmed against fixture game data): fixtures/data.json has 296 upgrades (ids 0–295) and none for a Tempest ground attack; the only Tempest upgrade is TempestRangeUpgrade (100), researched by ability 47. constants/upgrade.ts is generated from that data. Not checked against a live client (no local SC2 install found from this session).
- Fix (per BQ5, recommended): no code. If the live client's data (one `data` request through test/live.ts) also lacks it, document it as unsupported: a line in the build-order parser docs (folded into P6B-T07, docs chain) saying upgrade names must exist in the game data and that ares' tempestgroundattackupgrade isn't in current data. examples.md EX-T06 already drops the step and says why. If the live data has it, regenerate fixtures/data.json and constants, and the step parses.
- Acceptance criteria:
  - [ ] Live client data checked; result recorded in this ticket.
  - [ ] Unsupported branch: docs line present in the P6B-T07 docs; parse.test.ts asserts `16 tempestgroundattackupgrade` throws NodeSC2Error naming the step (likely already covered; add if not).
  - [ ] Supported branch: the step parses to an upgrade task (fails today).
- Implementation plan: Where: docs only (unsupported) or fixtures/data.json + scripts/generate-data.ts output (supported). Don't touch: utils/build-order/parse.ts.
- Stack: core. Staffing: junior.
- Blocked by: None (docs line lands with P6B-T07).

### BG-T09 Game-data regeneration isn't reproducible

- What's wrong: `bun run generate:data` (scripts/generate-data.ts) on the committed tree rewrites constants/ability.ts (1076 lines), constants/unit-type.ts (85) and constants/dicts/unit-abilities.ts (1368 → 140), so CN-C03 couldn't regenerate and hand-applied the LurkerRange line (decisions "Q9 reversed", LurkerRange note).
- Root cause (confirmed by running it on a scratch copy of the current working tree, CN-C03's edits included): the drift is formatting only. The generator writes unformatted source: formatConstant pads `${id};` to 7 chars before the comment (:177) and the dict rows put every array on one line (`list`, writeDict :365-374); the committed files are that output after `biome format`, which collapses the padding and wraps lines over 120 chars. Regenerate + `biome format --write constants` gives zero diff, and a second run is idempotent. No generator logic change, no fixture data change, no ordering issue (every output list is sorted; unitAbilities merges sets before sorting, so readdirSync order doesn't matter). Evidence: scratchpad bg-t09/ (orig/ vs core/constants).
- Options:
  - A (recommended, BQ6): regeneration produces no diff, guarded by a test. Cost: one script change (~40 lines: collect outputs in memory, format each through the repo's biome, write or compare), one test (the generator runs in ~0.1 s plus a biome spawn per file), and a `check:data` script. Ongoing cost: a fixture recapture or a hand edit to a generated file fails the test until the generator is rerun or the override moves into the generator (as CN-C03 already did with RESEARCHER_BY_UPGRADE). That is the point of the check.
  - B: dicts become hand-owned, the script is demoted (deleted or marked one-shot). Cost: rewrite the generated-file headers in 11 files (5 constant modules, 6 dicts) and readme.md:1978/:2138; every future SC2 version bump or fixture recapture becomes a hand merge of ~3k generated lines; the derivation logic (RESEARCHER_BY_LINK, morph/addon rules, supplements) stops being executable, so a wrong dict entry can't be traced back; BG-T10 would then read a hand-owned unitAbilities. No upside beyond deleting ~500 lines.
- Fix (A): the generator stops writing directly. Every file it produces (the merged constant files, buff/effect, the six dicts) goes into an in-memory map, each entry is formatted by piping it to the root devDependency `biome format --stdin-file-path=<target path>` (so the repo's biome.json applies), and then either written (default) or compared (`--check`: no writes; prints each differing file and exits 1). nameIndexes are parsed from the in-memory content instead of re-reading the written file. Output directory overridable by env (`CONSTANTS_DIR`, same pattern as capture-fixtures.ts:91 `CAPTURE_DIR`), so the test never writes into the tree. The padEnd in formatConstant can go (biome owns layout).
- Acceptance criteria:
  - [ ] Write mode into a temp copy of constants/ (env override) leaves it byte-identical to constants/ (test; fails without the format step: ability.ts, unit-type.ts, unit-abilities.ts differ).
  - [ ] `--check` against the committed constants/ exits 0 and writes nothing (test: spawn the script, assert exit code and that no file under constants/ changed).
  - [ ] `--check` against a temp copy with one edited line in dicts/researched-from.ts exits non-zero and names that file (test; fails today: no check mode, the script overwrites).
  - [ ] `bun run generate:data` on a clean tree leaves `git status` clean (manual, recorded in the ticket).
  - [ ] readme.md:2138 says the generator formats its output and mentions `check:data`.
  - [ ] lint, tsc and tests green.
- Implementation plan:
  - Where: scripts/generate-data.ts (output collection, format, write/check, env dir override); new scripts/generate-data.test.ts; packages/core/package.json (`check:data`); readme.md :2138 only.
  - Interfaces: CLI only. `bun scripts/generate-data.ts [--check]`, env `CONSTANTS_DIR`. Exit 1 with the list of differing files under `--check`.
  - Follow: capture-fixtures.ts env override (:91); Bun.spawnSync for the biome call.
  - Don't touch: generated files under constants/ (they must come out unchanged), constants/dicts/research-requirements.ts (hand-owned input), the derivation logic (RESEARCHER_BY_*, supplements, ONE_WAY_MORPH_PRODUCTS).
- Stack: core. Staffing: junior (root cause known, change is local to one script, no game logic).
- Overlaps: CN-C03 has uncommitted edits to scripts/generate-data.ts (RESEARCHER_BY_UPGRADE) and constants/dicts/researched-from.ts. No other in-flight ticket touches the generator, generated constants, package.json or readme.md:2138.
- Blocked by: CN-C03 (same file).

### BG-T10 Ability tasks find casters through the stale ability map

- What's wrong: the builder plugin's ability task (systems/builder-plugin.ts:847-882) finds casters with abilityCasters (:98-107), which calls data.findUnitTypesWithAbility (engine/data-storage.ts:24-30). That reads AbilitiesByUnit = constants/unit-ability-map.ts, a hand-captured pre-4.10 map, not the generated constants/dicts/unit-abilities.ts.
- Root cause (confirmed in code and fixture data; scratchpad bg-t10/compare.txt and coverage.txt). Three defects, all in the ability fn's path:
  1. Misses. The stale map has only generic ids for addons/lift/burrow and lacks 182 specific abilities the generated dict has, among them BUILD_TECHLAB/REACTOR_BARRACKS/FACTORY (421, 422, 454, 455), RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL1 (864, Armory) and BUILD_LURKERDEN (1163, Drone). Without `on`, such a task finds no caster type: getByType([]) is empty, the earmark is settled and it returns CANNOT_SATISFY forever. With `on`, availability admits it (:103).
  2. Generic ids never pass the cast gate. SC2 reports specific ids in availableAbilities (blueshift/type-abilities.json: Barracks has 421/422/452, never 3682/3683/3679), and Unit.abilityAvailable is a plain includes (engine/create-unit.ts:153-154). So unitsCanDo (:860) is empty for a generic task such as BUILD_REACTOR, LIFT or BURROWDOWN: the earmark is held while a caster type exists and the command is never sent. Existing tests only assert earmarks for BUILD_REACTOR (builder-plugin.test.ts:294-311), not the command. Sending a generic id is fine (the plugin already sends HARVEST_RETURN 3667).
  3. Dead stale entries. MORPH_LURKERDEN (2112, available=false in 4.10 data) is listed on HydraliskDen, so a task for it holds its earmark forever with a caster type present and nothing castable (the BG-AM leak shape). RESEARCH_GROOVEDSPINES/MUSCULARAUGMENTS on LurkerDenMP are pre-4.7 but available, same effect only when the den exists without a HydraliskDen.
- Pushback on the brief: the "wrong casters" in the CN-C03 diff (lift/burrow/mode targets, Factory/Starport for BarracksTechLab) are wrong for a producer-of-unit-type question, which CN-C03 already moved to the dicts (units.getProductionUnits uses addonHost/trainedFrom, resources/units.ts:220-222). For a caster question they're right: every lifter can cast generic LIFT, every addon host can cast generic BUILD_TECHLAB. They are not part of this bug.
- Source of truth (BQ7, recommended "both"): caster types come from static data, the cast gate stays live.
  - Static: data.findUnitTypesWithAbility(id) returns the types whose generated unitAbilities entry holds `id` or an ability that remaps to `id` (AbilityData.remapsToAbilityId), unioned with the stale map's types for `id` when that ability's data is `available`. Ascending type ids, no duplicates.
  - Live: the ability fn's cast gate accepts a unit whose available abilities contain task.id or an id that remaps to it.
  - Why not live only: availability is queried without ignoreResourceRequirements (create-unit.ts:163) and drops while the caster is busy, so it can't tell "no caster" from "caster can't cast yet"; the earmark hold needs the type answer (the reason in the comment at builder-plugin.ts:96-97).
  - Why not the dict alone: 187 available (type, ability) pairs in the stale map aren't covered by the dict even with remaps. Most are generics on many types (CANCEL/CANCEL_LAST/HALT, BURROWDOWN on 11 types because the type-abilities capture drops burrow, unload/rally), plus the *OFF toggles and 13 research abilities the fixtures never captured (StarportTechLab 790/799/803-806, FactoryTechLab 768, SpawningPool 1252, ...). Dict-only drops them until a full fixture recapture with SC2. The union keeps every caster that works today; only the 1282/1283-on-LurkerDen pair stays wrong.
  - Not dependent on BG-T09: no regeneration is needed; the dict is used as committed.
- Acceptance criteria:
  - [ ] findUnitTypesWithAbility(BUILD_LURKERDEN) = [DRONE], (RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL1) = [ARMORY], (BUILD_TECHLAB_BARRACKS) = [BARRACKS, BARRACKSFLYING] (test; fails today: []).
  - [ ] findUnitTypesWithAbility(MORPH_LURKERDEN) = [] (test; fails today: [HYDRALISKDEN]).
  - [ ] Guard, passes today: generic BUILD_TECHLAB still returns all six hosts (Barracks/Factory/Starport and flying), LIFT includes COMMANDCENTER and BARRACKS, RESEARCH_BANSHEECLOAKINGFIELD returns [STARPORTTECHLAB] (stale-only, kept by the union).
  - [ ] An ability task BUILD_REACTOR_BARRACKS with no `on`, one finished idle Barracks reporting 422 available: the plugin sends 422 on that Barracks (test; fails today: no command, earmark settled).
  - [ ] An ability task with generic BUILD_REACTOR, a Barracks reporting 422 available: the plugin sends BUILD_REACTOR on it (test; fails today: unitsCanDo empty, no command).
  - [ ] Existing ability-task earmark test (builder-plugin.test.ts:240) passes unchanged; lint, tsc and tests green.
- Implementation plan:
  - Where: engine/data-storage.ts findUnitTypesWithAbility (dict + remap + filtered stale union; falls back to plain matching while 'abilities' data isn't loaded yet); systems/builder-plugin.ts: a remap-aware availability check used at :103 and :860 only; tests in systems/builder-plugin.test.ts and a findUnitTypesWithAbility test against createTestWorld('blueshift').
  - Interfaces: none new. findUnitTypesWithAbility keeps its signature (types.ts:819); its readme line (:1370) gains "specific or generic id".
  - Follow: createdTypeByAbility's per-data-object WeakMap cache (resources/units.ts:22-38) for the inverted dict; the remap lookup at agent/macro.ts:165 / resources/actions.ts:122.
  - Don't touch: Unit.abilityAvailable (create-unit.ts:153; other callers rely on exact ids, e.g. :248), constants/unit-ability-map.ts and the AbilitiesByUnit export (retiring them needs a full recapture and an API call; follow-up), resources/actions.ts (swapBuildings :244 also reads the stale map for generic LIFT, which works; CN-A04/CN-C03 own the file), builder-plugin earmark logic (BG-AM).
- Stack: core. Staffing: junior (spec is concrete, two local changes; earmark logic, where BG-AM's junior was rejected, is not touched).
- Overlaps: systems/builder-plugin.ts with BG-AM (in flight, owns abilityCasters and the ability fn). engine/data-storage.ts: no in-flight ticket (CN-C01 doesn't touch findUnitTypesWithAbility). readme.md :1370 only.
- Blocked by: BG-AM (same functions).

---

## Decisions for the user

- BQ1 (BG-T02): a tracked build given an explicit `at` is never moved; when its spot is blocked or BUILD is rejected maxAttempts times it fails `'blocked'`, and the builder plugin re-resolves its target on its 250-loop reset. Alternative: re-find a spot near `at` (findPlacement near the point). Recommended: fail.
- BQ2 (BG-T03): on Zerg, placement.add() becomes a silent no-op (debug log), consistent with request() returning undefined. Zerg custom placements stay out of scope. Recommended: yes.
- BQ3 (BG-T05): enemy structures get blocked on the grid (not just lift/land), kept blocked while out of vision, freed on death/lift; unitTypeChanged stays own-only. Recommended: yes.
- BQ4 (BG-T07): also make a burrowed creep tumor's cell pathable (live grid evidence shows it is). Recommended: yes.
- BQ5 (BG-T08): close as "document as unsupported" if the live client confirms the id is absent. Recommended: yes.
- BQ6 (BG-T09): keep the generator authoritative. It formats its own output through biome, and a `--check` test fails when the committed constants differ from a regeneration. Alternative: hand-own the dicts and demote the script. Recommended: generator + check.
- BQ7 (BG-T10): ability-task casters come from the generated unitAbilities dict (remap-aware) unioned with the stale map's entries for available abilities, and the cast gate becomes remap-aware. Alternative: dict only, which drops 187 stale-map caster pairs the fixtures never captured (generic cancel/burrow/unload, *OFF toggles, 13 research abilities) until a full SC2 recapture. Recommended: union.
