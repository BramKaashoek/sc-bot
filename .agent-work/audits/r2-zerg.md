# R2 Zerg audit: creep, queen spread, tumor spread, transfuse, nydus, overlord spots

Paths: ares = `ares-sc2/src/ares/` (scratchpad copy); core = `packages/core/`. Read-only research, nothing executed.
External deps whose source is NOT in the ares repo: `map_analyzer` (spudde123/SC2MapAnalysis @ develop, pyproject.toml:18), `cython_extensions` (cython-extensions-sc2 ^0.18, pyproject.toml:19). Anything marked EXT below is inferred from call sites only.

## 0. Summary table

| # | Feature | ares lines | est. core lines (impl + tests) | Level | Reason |
|---|---|---|---|---|---|
| 1 | CreepManager resource | 787 (~560 logic) | ~400 + ~350 | senior for design + perf, junior for per-method ports once the shell exists | per-step cache, grid orientation, banker's rounding, 2 external helpers to substitute, `ResourceContainer` wiring |
| 2a | `tumorSpreadCreep` | 69 | ~40 + 60 | junior (after #1) | thin; two calls into #1; one perf decision (see 2a) |
| 2b | `queenSpreadCreep` | 106 | ~70 + 100 | senior | implicit retained state (edge cache, order-target match), mixed squared/plain distances, several quirks to keep or fix |
| 3 | `useTransfuse` | 62 | ~35 + 50 | junior | self-contained; only decision is where the per-frame `transfused_tags` set lives |
| 4 | Nydus manager + nydus pathing + per-unit unload | 472 + 96 + ~50 (path_manager) | ~450 + ~300 | senior | `pathfind_with_nyduses` is EXT (no source), core has no per-passenger unload action, multi-frame travel state machine |
| 5 | Overlord spots | ~60 (terrain_manager) + EXT `map_data.overlord_spots` | ~100-150 + 80 | senior | algorithm is not in ares; it must be designed (user's decision) |
| - | Zerg placement bits | n/a | ~0-30 | junior | already mostly covered; section 6 |

No ares code assigns any of these UnitRoles: `QUEEN_CREEP`, `OVERLORD_CREEP_SPOTTER`, `QUEEN_NYDUS`, `NYDUS_SPOTTER`, `DROPPERLORD_CREEP` exist only as enum constants (consts.py:506,532,541-549). There is no queens manager in ares (no inject, no queen role assignment; `managers/` has only unit_role_manager's `ZERG_STATIC_DEFENCE` set at :33). The bot owns queen assignment. All those roles already exist in core `constants/unit-role.ts:10,34,43-49`.

## 1. CreepManager (`managers/creep_manager.py`)

Registered hub.py:179 for all races; in `managers` list after squad_manager (hub.py:205). Mediator access via `ManagerRequestType` dict (creep_manager.py:43-72); mediator wrappers at manager_mediator.py:260-540.

### State
| field | meaning | line |
|---|---|---|
| `_creep_grid`, `_creep_tiles`, `_creep_edges` | per-frame cached; edges only recomputed when `last_game_loop % 16 == 0` or first call | :30-32, :106 |
| `_creep_coverage: float` | percent of pathable tiles with creep, refreshed when `game_loop % 112 == 0` | :37, :208-225 |
| `_queen_edge_position_cache: dict[tag -> {position, frame}]` | edge result reused while a queen's ability is on cooldown; expires after 64 frames | :41, :230-240 |
| `_overlord_spotter_dict`, `_setup_overlord_spotter_dict` | dead, never read (grep) | :38-39 |
| `_expansion_block_mask` (cached_property) | bool [y][x], true where cell centre (+0.5) is within 5 of any `ai.expansion_locations_list` | :683-692 |
| `EDGE_FILTER` | 3x3 kernel, centre 8, others -1 | :33 |

### Config keys
None. No `config[...]` is read in creep_manager.py and config.yml has no creep section. All thresholds are literals (listed per method).

### Per-step work (`update`, :206-228)
1. Every 112 loops: coverage = (creep==1 and pathable) / pathable * 100, using `creep_grid.T` against `get_ground_grid` (ground grid is [x][y], sc2 grids [y][x]); pathable = not inf; 0.0 if none.
2. Every frame: expire queen edge cache entries (>= 64 frames old).
Everything else is lazy and per-frame cached (`property_cache_once_per_frame`).

### Public mediator API
| mediator method | args -> return | semantics | line |
|---|---|---|---|
| `get_creep_grid` | -> ndarray [y][x] | `state.creep.data_numpy`, values 0/1 | :160 |
| `get_creep_tiles` | -> (N,2) array of (y,x) | `np.where(grid == 1.0)` | :164 |
| `get_creep_edges` | -> (edge_y, edge_x) arrays | see algorithm below; integer corner coords, not +0.5 | :105 |
| `get_creep_coverage` | -> float 0-100 | last 112-loop sample | :50 |
| `get_closest_creep_tile(pos)` | Point2 -> Point2 or None | brute-force squared distance over all creep tiles; integer corner point | :242 |
| `get_random_creep_position(position, max_attempts=20)` | -> Point2 or None | random angle, distance uniform [6,9]; skip outside map border 1; first `_valid_creep_placement` wins | :740 |
| `find_nearby_creep_edge_position(position, search_radius=15, closest_valid=True, spread_dist=3.0, townhall_avoid_dist=15 (dead), unit_tag=None, cache_result=False)` | -> Point2 or None | edges within radius that have creep, are outside the expansion mask, pass `_valid_creep_placement`, and are >= `spread_dist` from every existing tumor / queen tumor order target; closest (or furthest) to `position`; optional per-unit cache | :383 |
| `get_next_tumor_on_path(grid, from_pos, to_pos, max_distance=999.9, min_distance=0, min_separation=5.0, find_alternative=True)` | -> Point2 or None | raw path (sensitivity 12) from->to; first path point with no creep whose closest creep tile is in (min_distance, max_distance) of `from_pos` and has valid placement decides: return it, else a nearby edge alternative, else None | :269 |
| `get_tumor_influence_lowest_cost_position(position)` | -> Point2 or None | lowest-cost points (radius 9) on the tumor-influence grid; sorted nearest first, iterated furthest first; >= 3 from tumor; valid placement | :610 |
| `should_calculate_tumor_spread` | -> bool | perf gate: coverage < 40 -> True; else `game_loop % int(coverage/2) == 0` | :657-672 |
| `get_overlord_creep_spotter_positions(overlords, target_pos)` | -> dict[tag -> Point2] | section 5b | :504 |
| `position_blocks_expansion(position)` | -> bool | mask lookup, False out of bounds | :674 |
| internal `get_tumor_influence_grid` | ground base grid copy + `add_cost(weight 50, radius 5)` per tumor/target | only used by the lowest-cost method | :188 |
| internal `existing_tumor_positions_or_order_targets` | positions of all own tumors (CREEP_TUMOR_TYPES) + `order_target` of own queens using `BUILD_CREEPTUMOR` | | :169 |

### Algorithms stated exactly
- Edge detection (:105-157): `convolve(creep, EDGE_FILTER, constant, cval=0)`, edge = value > 1. For a creep cell value = 8 - (creep neighbours), so edge = creep cell with >= 2 non-creep neighbours (map border counts as non-creep). AND `pathable_convolved == 9` (3x3 box sum over `game_info.pathing_grid`, cval=1: all nine cells pathable on static terrain, buildings ignored). Then drop edges within 2.5 of any own `UnitTypeId.HATCHERY` (compared with integer cell coords).
- `_valid_creep_placement` (:694-738): `int(round(x))`, `int(round(y))` must be in map bounds (python round is banker's; JS `Math.round` differs at .5, so choose explicitly); optional visibility check (always False in ares calls); `cy_has_creep(creep_grid, pos)`; not in expansion mask (uses `int(pos)`, i.e. floor, not rounded); `cy_in_pathing_grid_ma(ground_grid, pos)`; `is_position_safe(ground_grid, pos)` (weight <= 1.0, path_manager.py:403-424).
- Quirks (decide per ticket keep vs fix):
  1. `townhall_avoid_dist` is dead. The enemy-townhall avoid (>= 15) exists only in `get_next_tumor_on_path` (:338-343).
  2. In `get_next_tumor_on_path` both townhall checks (:338-356) are skipped when `find_alternative=False` (early return :357). Docstring says `min_separation` default 3.0, code 5.0. The `return None` at :379 is inside the range/placement `if`, so later path points are tried only when that test fails.
  3. Own-hatchery filters (:130, :346) use `HATCHERY` only; Lair/Hive are not matched.
  4. Refresh cadences key on game-loop modulo: edges `% 16`, coverage `% 112`, spread gate `% int(coverage/2)`. If game_step does not divide these, they fire rarely or never (with step 16 the spread gate aligns only some of the time). Core should use "loops since last run >= interval" (judgment).
  5. `get_tumor_influence_lowest_cost_position` and `get_closest_creep_tile` have no internal caller in ares (bot-facing). `get_random_creep_position` uses unseeded `random`.
  6. `_valid_creep_placement`'s `grid` argument serves as both cost grid and pathability (inf = unpathable).

### What core already has
| ares need | core | gap |
|---|---|---|
| creep grid | `map._mapState.creep` Grid2D [y][x] (`resources/map.ts:74`, `types.ts:422`); `hasCreep(p)` (`map.ts:115`); `getCreep()` returns Point2D[] of every creep cell, allocated per call (`map.ts:205`) | no edges, tiles cache, coverage, closest tile; do not use `getCreep()` in hot paths |
| static pathing grid | `map.isPathable`, `map.getGrids().pathing` | 3x3 "all pathable" mask: trivial loop, compute once |
| ground grid with costs | `influence.getGrid('ground')` rebuilt per loop (`influence.ts:180`); `influence.getCleanGrid('ground')` (`influence.ts:183`) = terrain only = ares `get_cached_ground_grid`; `influence.addCost(grid, centre, radius, weight)` (`influence.ts:194`) = `map_data.add_cost` | none |
| raw path | `pathing.findPath(start, goal, {layer or grid, sensitivity})` (`pathing.ts:89`), returns [] when none (ares: None) | core retargets an unpathable goal to nearest finite cell within 3 (`pathing.ts:5,82`); MA may not |
| lowest-cost points | `pathing.findLowestCostPoints(from, {layer, radius})` (`pathing.ts:125`), returns cell centres (+0.5) | EXT `lowest_cost_points_array` semantics unknown (centres vs corners, radius test); verify with a fixture |
| position safety | `pathing.isPositionSafe(point, {layer, limit=1})` uses `<=` (`pathing.ts:176`); ares `cy_point_below_value` probably strict (EXT) | boundary at exactly 1.0 may differ; clamp-to-1 in influence makes cost==1 common, so confirm |
| own structures / queens by type | `units.getById(...)`, `getStructures` | none |
| expansion locations | `map.getExpansions()[i].townhallPosition` | build mask lazily |
| enemy townhalls / start | `units.getEnemyStructures()` + `townhallTypes`; `map.getLocations().enemy[0]` | none |
| tumor placement-grid hooks (hub.py:243-248, 322-326) | generic own-structure block/release in `systems/map.ts:64-106`; `burrowedCreepTumor` pathing rule: no pathing footprint (`utils/geometry/units.ts:162`) | verify CREEPTUMOR* have footprint data; otherwise port the two hooks |
| per-loop cache pattern | `builtLoop` pattern in `influence.ts:176-183` | reuse |
| RNG | `utils/get-random.ts` (Math.random, unseeded) | tests need an injectable rng |
| roles | all present | none |

### What is missing
New `resources/creep.ts` + `CreepResource` in `types.ts` (+ `ResourceContainer` at ~`types.ts:1210`) + export + tests + docs. Suggested surface: `getEdges()`, `getTiles()`, `getCoverage()`, `closestTile(p)`, `findEdgePosition(p, opts)`, `nextTumorOnPath(...)`, `randomPosition(p, attempts)`, `tumorLowestCostPosition(p)`, `shouldSpreadTumors()`, `overlordSpotterPositions(overlords, target)`, `blocksExpansion(p)`. Static mask (3x3 pathable) computed once; edges every 16 loops; read the Grid2D directly. Hot spot: hundreds of tumors times `findEdgePosition`; port the spread gate.

Not faithfully portable: nothing hard. Substitutes: `scipy.convolve` -> hand 3x3 loop; `np.where` -> loops; `cy_*` helpers trivial. `cy_in_pathing_grid_ma` exact semantics EXT, use `grid.get(p) !== Infinity`.

## 2. Queen creep spread and tumor spread

### 2a. `behaviors/combat/individual/tumor_spread_creep.py` (69 lines)
`TumorSpreadCreep(unit, target)`; `target` is unused in `execute` (dead param).
1. False unless `mediator.should_calculate_tumor_spread` (:47).
2. False unless `BUILD_CREEPTUMOR_TUMOR in unit.abilities` (off cooldown) (:49).
3. Edge first: `find_nearby_creep_edge_position(position=tumor, search_radius=10.2, closest_valid=False (furthest edge), spread_dist=1.0)` -> `unit(BUILD_CREEPTUMOR, pos)` (:53-60). 10.2 is cast range 10 plus slack.
4. Fallback `get_random_creep_position(tumor.position)` (6-9 away, 20 tries) (:63-67).
5. Else False.
No own state or cooldown beyond the ability check. ares also hides spent tumors from `all_units` (`_used_tumors`: burrowed tumors with a Point2 order target, main.py:254, :680-700) to avoid iterating hundreds.

Core: no tumor behavior (`behaviors/combat/individual.ts:20` only lists tumors in `KITE_IGNORED_TYPES`). Ability ids exist (`constants/ability.ts:30-32`). Template: `useAbility` (`individual.ts:88`), `unit.abilityAvailable`, `ctx.order`. Perf risk: `systems/unit.ts:276-299` sends one batched abilities query for ALL own units every step; hundreds of tumors inflate every query. ares avoids that by hiding spent tumors. Judgment (senior): accept, or exclude spent burrowed tumors from the query. Do not leave to a junior silently.

### 2b. `behaviors/combat/individual/queen_spread_creep.py` (106 lines)
`QueenSpreadCreep(unit, cancel_if_close_enemy=True, pre_move_queen_to_tumor=True)`. Flow (:115-175):
1. `spreading = unit.is_using_ability(BUILD_CREEPTUMOR)`.
2. If spreading and either flag: `KeepUnitSafe(unit, ground_grid)`; if it acted, True.
3. If spreading and no `CREEPTUMORQUEEN` within sqrt(3) (`< 3.0` squared) of `unit.order_target`: True (leave en-route queen alone). If a tumor already stands at the target, fall through and pick a new spot.
4. `ability_available = BUILD_CREEPTUMOR_QUEEN in unit.abilities`.
5. `edge_position = find_nearby_creep_edge_position(position=queen, search_radius=200, unit_tag, cache_result=not ability_available)` (spread_dist 3.0, closest edge). While on cooldown the manager returns the same cached point for up to 64 frames per queen (:421-436); cache cleared once the ability is available.
6. If not ability_available and `pre_move_queen_to_tumor`: move toward `edge_position` when farther than 3 (sq > 9); return True even with no edge. If the flag is False and the ability is unavailable it falls through and may issue a build that will not execute.
7. `target = map_center if queen is off creep else get_enemy_nat` (:153-157).
8. If `edge_position` and `get_creep_coverage > 20`: spot = edge; else `get_next_tumor_on_path(grid, from=queen, to=target, find_alternative=True)`.
9. Spot: sq distance > 25 (5 tiles) -> `move(spot)`, else `BUILD_CREEPTUMOR_QUEEN` at spot; True. No spot: False.
Quirks: `cancel_if_close_enemy` only ever appears OR-ed with `pre_move_queen_to_tumor` (it cannot act alone in a distinct way); docstring example (`QueenSpreadCreep(queen, queen.position, target)`) does not match the signature; queen energy is implicit via the ability list.
Queens management dependency: none; the caller picks which queens to feed it (tests/test_bots/melee_bot.py:110-112 feeds all queens).

Core gaps: `keepUnitSafe` exists (`individual.ts:155`); `pathing.isPositionSafe/closestSafeSpot` exist; `unit.isUsingAbility` takes explicit ids (`types.ts:269`; pass `BUILD_CREEPTUMOR`, `_QUEEN`, `_TUMOR`, since python-sc2's matching is family-aware); order target via `orders[0].targetWorldSpacePos`; `map.getEnemyNatural()` (`map.ts:142`), `map.getCenter()` (`map.ts:297`) exist. Everything else depends on #1. Behaviors in core are stateless closures, so the per-tag edge cache must live in the creep resource.
Judgment (senior): which quirks to keep; the 200-radius full-map scan (the cache is the only perf guard).

## 3. Transfuse (`behaviors/combat/individual/use_transfuse.py`, 62 lines)
`UseTransfuse(unit, targets, extra_range=0.0)`; no config keys.
- If queen `is_using_ability(TRANSFUSION_TRANSFUSION)`: True (:40).
- If `TRANSFUSION_TRANSFUSION in unit.abilities` (:43): candidates from `targets` where `health_percentage < 0.4` (fraction), `distance(queen, u) < 7.0 + queen.radius + u.radius + extra_range`, `u.health_max >= 50`, `u.tag != queen.tag`, `u.tag not in ai.transfused_tags` (:44-53).
- If any: add first candidate's tag to `ai.transfused_tags` and `UseAbility(TRANSFUSION_TRANSFUSION, queen, candidates[0])` (:54-60); else False.
- `transfused_tags` is bot state: created main.py:145, reset every step main.py:863 (guard lasts one frame; stops two queens healing one unit in the same step).
Core: `EFFECT_TRANSFUSION` 1664 (`constants/ability.ts:198`; confirm it is the ares `TRANSFUSION_TRANSFUSION` id). Has `useAbility` (`individual.ts:88`), `unit.radius`, `health/healthMax` from proto, `distanceTo`, `inAbilityCastRange` (`types.ts:302`; keep literal 7.0 for parity). Missing: the per-frame set. Mechanical port; the only decision is where the set lives (per-world store reset on loop). Keep the "already using ability" first line: core `useAbility` does not short-circuit on it.

## 4. Nydus (`managers/nydus_manager.py` 472 + path_manager.py + behavior)

Registered hub.py:182, 206. `update` works only when `ai.race == Zerg`, returns early in arcade mode (:178-188). Only config key: `config["Debug"]` (labels, :187). `UNIT_NYDUS_TRAVEL_BAN_DURATION = 5.0` s (:34).

### State
| field | meaning | line |
|---|---|---|
| `all_enemy_main_nydus_points`, `all_own_main_nydus_points` | candidate main nydus spots, best first; default [enemy start] / [own start] (arcade: map centre) | :56-61 |
| `_nydus_travellers: dict[tag -> {ENTRY, EXIT, EXIT_TOWARDS, UNIT_TYPE}]` | units that committed to travel (keys consts.py:131-135) | :65 |
| `_nydus_tags_with_actions: set` | nydus tags that already unloaded this frame; cleared each frame | :66, :182 |
| `_units_banned_from_travelling: dict[tag -> time]` | set on unload; expires after 5 s | :68, :416, :462-472 |

### Public API (mediator wrappers manager_mediator.py:928-1090, 1280)
| method | semantics | line |
|---|---|---|
| `find_nydus_at_location(base_location, min_base_distance=15, max_nydus_distance=25, max_cost=20)` | enemy start -> primary enemy main; own start -> primary own main; else region of base: cells <= 25 from base and >= 15 from every region base, lowest ground-grid cost (< max_cost), drop spots with enemies within 12, prefer visible, closest to base | :261-338 |
| `get_primary_nydus_enemy_main` / `_own_main`, `get_enemy_main_nydus_points` | first of list, or 10 tiles from start towards map centre | :129-152 |
| `add_to_nydus_travellers(unit, entry_nydus_tag, exit_nydus_tag, exit_towards)` | registers traveller | :340 |
| `remove_from_nydus_travellers(unit_tag)`, `clear_nydus_travellers`, `get_nydus_travellers_dict`, `get_banned_nydus_travellers` | accessors | :354, :89-98 |
| `remove_destroyed_nydus(tag)` (called from hub.py:258 on every destroyed unit) | repoint ENTRY/EXIT refs to the nydus closest to own nat; clear all if none left | :429-460 |
| `find_nydus_path_next_point(start, target, grid, large, sensitivity=5, smoothing=False)` | -> (next_point, exit_towards, [entry_tag, exit_tag] or None); cache keyed by (start, target) for 44 loops; cache cleared when any nydus dies (hub.py:260-262) | path_manager.py:342-376, :143-152 |

### Main spots (`initialise`, :154-259)
For own and enemy main: region = `map_data.in_region_p(start)`; candidates = `region.perimeter_points` that are pathable; remove points within 15 of the townhall, within 11 of the two geysers within 12 of the main (indexes `enemy_gases[0]` and `[1]`, raises if fewer than 2), within 13 of the main ramp top; sort by `-(d2(townhall) + d2(ramp))` (furthest from both first). Own ramp `ai.main_base_ramp.top_center`; enemy ramp via mediator.

### Per-frame state machine (`_handle_nydus_travellers`, :366-427)
Input: own `NYDUSNETWORK + NYDUSCANAL`.
1. None: clear travellers, return.
2. Exactly one: set every traveller's EXIT to it; with no travellers, return. Otherwise fall through.
3. Passengers are read only from `nyduses[0].passengers_tags` (:388). Quirk: with 2+ nyduses, units in other nyduses are never unloaded here.
4. Build per-exit queues; queens `appendleft` (first), others `append`.
5. For each exit nydus that `is_ready`, has a queue and has not acted this frame: `RALLY_BUILDING` to the unit's EXIT_TOWARDS, `unload_by_tag` the first queued unit, mark acted, ban the unit at `ai.time` (:403-416). One unit per nydus per frame.
6. Passengers absent from `_nydus_travellers` (entered by other means, or exit died mid-unload) get ENTRY=EXIT=nydus closest to own nat, EXIT_TOWARDS=map centre, UNIT_TYPE None (:418-427).
`unload_by_tag` (custom_bot_ai.py:384-415 region) finds the passenger index in the proto and sends a raw no-op (`ability_id=0`) plus `ActionUI(cargo_panel=ActionCargoPanelUnload(unit_index))` (:417-433); the UI cargo-panel unload is the only way to unload one passenger. With `exit_towards` it also sets `RALLY_BUILDING` and `remove_from_nydus_travellers`. Bans expire in `_review_travel_bans` (:462-472).

### Behavior `NydusPathUnitToTarget` (`behaviors/combat/individual/nydus_path_unit_to_target.py`, 96 lines)
Params: unit, grid, target, success_at_distance=0, large=False, sensitivity=5, smoothing=False, exit_nydus_max_influence=10.0. Flow (:118-158): False if within success distance; `find_nydus_path_next_point`; if nydus tags returned AND exit point safe on `grid` (<= 10.0) AND unit not banned: register traveller; if the first path point equals the entry nydus's rounded position then `unit.smart(entry_nydus)` (enter), else `move(point)`; otherwise ordinary: `move(point)` or `move(target)`.

### Nydus edges in pathing
ares inserts no edges itself; it calls EXT `map_data.pathfind_with_nyduses(start, target, grid, large, smoothing, sensitivity)` -> `(paths, nydus_tags)` (path_manager.py:359-363). From the consumer: `paths` has one or two paths; `paths[0][0]` = next point (empty -> target); if `len(paths) == 2`, `paths[1][1]` = exit_towards; `nydus_tags` = [entry_tag, exit_tag]. How MA picks pairs and its cost model are not visible. Nothing in grid_manager.py or ground-grid construction mentions nydus (grep).

### Core status
- Exists: nydus canal corner pathing (BG-T07; `utils/geometry/units.ts:149-164`, test `systems/map.test.ts:307`); roles `NYDUS_SPOTTER`/`QUEEN_NYDUS`; abilities `RALLY_BUILDING` (`ability.ts:289`), `UNLOADALL_NYDASNETWORK` (`:471`), `BUILD_NYDUS*` (`:51-52`); nydus unit types in groups (`constants/groups.ts:67-68`); `map-analysis` `getRegion(point)` and `getPerimeter(region)` (`resources/map-analysis.ts:293`: walkable cells touching non-walkable, angle-ordered, cell centres) as the perimeter_points substitute; `Region.expansions` as `region.bases` (`types.ts:1125-1131`); `map.getEnemyMainRamp()` (`map-analysis.ts:315`), `map.getMainBaseRamp()`; `unit.passengers` proto field (`behaviors/combat/terran.ts:70`).
- Missing: (a) nydus resource with the state above; (b) nydus-aware path query; (c) per-passenger unload: core `actions.sendAction` takes raw unit commands only (`resources/actions.ts:822`, `types.ts:527-528`); `ActionCargoPanelUnload` exists in the proto typings but core never builds `actionUi`; new action ~30 lines; (d) region cell lookup: `Region` has no point list (labels are private in `map-analysis.ts` `Analysis`), needed by `find_nydus_at_location`; add an accessor; (e) the `nydusPathUnitToTarget` behavior and ready-check helpers.
- Substitute for `pathfind_with_nyduses` (senior judgment): with `pathing.findPath` compare direct path length against `len(start -> entry) + len(exit -> target)` over own ready nydus pairs; use the nydus only when materially shorter; return `{nextPoint, exitTowards, tags}`; 44-loop cache keyed by (start, target); when entering, `nextPoint` must be the nydus position so the behavior issues `SMART` on it. Not faithful to MA (selection rule unrecoverable from ares); the ticket must say so.
- Port hazards: queue order (queens first); passengers read from `nyduses[0]` only (keep or fix); `enemy_gases[0]/[1]` crash on maps with fewer than 2 nearby geysers (guard); `in_region_p` may be None (initialise then keeps defaults).

## 5. Overlord spots

### 5a. Terrain spots (`managers/terrain_manager.py`)
| API | semantics | line |
|---|---|---|
| `ol_spots` (cached_property) | `[Point2(t) for t in map_data.overlord_spots]`, docstring "High ground Overlord hiding spots" | :307-316 |
| `ol_spot_near_enemy_natural` (cached_property) | `get_closest_overlord_spot(from=towards(enemy_nat, map_center, 10))` | :318-335 |
| `get_closest_overlord_spot(from_pos)` | nearest spot (linear scan), fallback `map_center`, then POPS it from the cached list (each spot handed out once) | :374-398 |
| mediator `get_closest_overlord_spot`, `get_ol_spots`, `get_ol_spot_near_enemy_nat` | wrappers | manager_mediator.py:2026, 2191, 2205 |
| consumers | build-order target `ENEMY_NAT_HG_SPOT`: runner (build_order_runner.py:762-770, calls `get_closest_overlord_spot`, so pops on every call) and parser (build_order_parser.py:682-683, via the cached property) | |
CORRECTED 2026-10-28 (lead, decisions log, R2-T28a): the source does exist. SC2MapAnalysis `extension/ma_ext.c`, `get_map_data` + `flood_fill_overlord`, computes `overlord_spots`. The original claim here ("no source is available") was wrong. T28a ports it faithfully: raw uint8 terrain heights, walkable = max(pathing, placement), float centroids (ares parity), no thinning. The substitute below is obsolete (DEV-4 rejected).
~~The ALGORITHM IS EXTERNAL: `MapData.overlord_spots` in SC2MapAnalysis; no source is available and ares only calls it.~~ Contract: list of (x, y) tuples of high-ground hiding positions (docstring).
Core: no equivalent. `ENEMY_NAT_HG_SPOT` is absent from `constants/build-target.ts`; `OVERLORD_SCOUT` maps to `ENEMY_NAT_VISION` only (`utils/build-order/parse.ts:35`). Available inputs: `map.getTerrainHeight` (`map.ts:444`), `map.isPathable`, regions, `map.getEnemyNatural()`, `towards` in `utils/geometry/point.ts`.
Substitute (OBSOLETE, the source was found; kept for history): candidates = playable, non-pathable cells at least R from any pathable cell (cliff/void interiors out of ground range) and higher than nearby ground, clustered and thinned; closest-to-enemy-natural selection with consume-once semantics. Alternative: skip hiding spots and only keep `ENEMY_NAT_VISION`. Est. 100-150 lines + fixture tests.

### 5b. Overlord creep spotters (`creep_manager.py:504-608`)
`get_overlord_creep_spotter_positions(overlords, target_pos) -> dict[tag -> Point2]`. Algorithm: creep edges sorted by distance to `target_pos` (`argpartition` with `num_to_keep = len(edges) - 1` keeps all but the furthest, so effectively a sort minus the last, :535-546); skip edges within 50 (sq < 2500) of enemy start; greedily pick edges at least 18 apart until count == number of overlords; assign each position the closest unassigned overlord; if that overlord is not moving and within 9 (sq < 81) keep it in place; clamp to [1, size-1]. No ares caller; role `OVERLORD_CREEP_SPOTTER` is never assigned. Pure function of #1 edges, so mechanical (~60 lines). Quirk: exactly one edge gives `num_to_keep = 0` and an empty result.

## 6. Zerg-specific placement the above depends on
- ares `placement_manager.py:85` `SKIP_CREEP_CHECK_IDS = {HATCHERY, NYDUSCANAL}`; `:307-316` passes `avoid_creep = race != Zerg` and the skip flag to `cy_can_place_structure`. The Zerg formation solver is an unimplemented TODO (:1240-1242); Zerg builds use deferred `request_zerg_placement` (main.py:173, :1126-1146): `find_placement(unit_type, towards(base, map_center, 6), 30)` + select worker + build.
- Core already matches: `resources/placement.ts:57,187` `CREEP_EXEMPT = [HATCHERY, NYDUSCANAL]` and `checkCreep = race !== ZERG && !exempt`; solver skips Zerg (`placement.ts:626`); async `actions.findPlacement` exists (`types.ts:526`).
- Tumors are placed by ability target and validated by the creep resource's `_valid_creep_placement`, not by `placement.canPlace`, so placement needs no change for creep spread.
- Tumor placement-grid refresh hooks (hub.py:243-248, 322-326): generic in core (`systems/map.ts:64-106`); verify tumor footprint data.
- `request_zerg_placement` deferred-action analogue is out of scope here.

## 7. Suggested ticket split
1. `resources/creep.ts`: grid reads, edges (16-loop refresh), coverage, closest tile, expansion mask, `findEdgePosition`, `randomPosition`, `nextTumorOnPath`, tumor influence/lowest cost, spread gate, per-unit edge cache, `overlordSpotterPositions`. Senior shell + decisions, junior-able method ports after. ~400 + 350.
2. `tumorSpreadCreep`, `queenSpreadCreep`, `useTransfuse` in `behaviors/combat/` + `behaviors/index.ts` exports. Junior for tumor and transfuse; senior for queen. ~150 + 200. Depends on 1.
3. Nydus: resource, path query, cargo-panel unload action, region cell accessor, `nydusPathUnitToTarget`. Senior. ~450 + 300. Independent of 1.
4. Overlord spots: blocked on user decision; senior. Optionally add `ENEMY_NAT_HG_SPOT`.
5. Perf decision: batched ability query includes all tumors (`systems/unit.ts:276-299`); settle before 2 ships to a Zerg bot.

## 8. Verify before ticketing
- EXT semantics: `lowest_cost_points_array`, `cy_in_pathing_grid_ma`, `cy_point_below_value` (section 1 table).
- Transfuse ability id mapping (`EFFECT_TRANSFUSION` 1664 vs ares `TRANSFUSION_TRANSFUSION`).
- Footprint data for `CREEPTUMOR*` in core.
- Session note: an unrelated test-gate hook fired twice on `utils/map/climber.test.ts` (another agent's file); this audit is read-only and did not touch it.
