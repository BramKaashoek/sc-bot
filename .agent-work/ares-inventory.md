# ares-sc2 capability inventory

Paths relative to `src/ares/` unless prefixed `docs/`. ~28.7k LOC Python. External deps: python-sc2 (BotAI), `map_analyzer` (SC2MapAnalysis: MapData, chokes, pyastar grids), `cython_extensions` (cy_distance_to, cy_flood_fill_grid, cy_towards, cy_point_below_value...), `sc2_helper` (C++ combat simulator), scipy KDTree, numpy.

## 1. Manager / mediator architecture

- `AresBot(CustomBotAI)` entry class users subclass — main.py:67
- `CustomBotAI(BotAI)` helper layer (mediator accessor, ladder detection, misc helpers) — custom_bot_ai.py:47, mediator prop :81, ladder_match :62
- Lifecycle: `on_before_start` loads user `<race>_builds.yml`, sets race worker/gas/supply/townhall types, fixes broken expansion locs — main.py:302, :1150
- `on_start`: game_step from config (realtime → 1), arcade-mode detection, register managers, create BuildOrderRunner + BehaviorExecutioner + ChatDebug — main.py:334
- `on_step`: hub.update_managers → build runner → recycle idle BUILD_RUNNER_SCOUT workers to GATHERING — main.py:406
- `_after_step`: executes registered behaviors, deferred unload/same-order/archon-morph/zerg-placement actions, resets grids, does warp-ins — main.py:443
- Custom `_prepare_step` / `_prepare_units` that routes every unit into manager caches in one pass (enemy/neutral/own, adept shades, memory units) — main.py:178, :200, :585, :642, :668, :738, :893
- Event fan-out: on_unit_created / destroyed / took_damage / construction started / complete / on_end → Hub — main.py:475-571; hub.py:230-316
- `register_managers()` overridable; Hub accepts replacement managers per slot + `additional_managers` list — main.py:378; hub.py:38, init :216, update order :330
- `Manager` ABC: `initialise`, `update(iteration)`, `manager_request(receiver, request, reason, **kwargs)` — managers/manager.py:17, :55, :64, :92
- `ManagerMediator`: single facade; ~180 typed accessor/command methods routing `ManagerRequestType` → manager's `manager_requests_dict` lambda — managers/manager_mediator.py:26, :62, :80
- `ManagerRequestType` enum (all request ids) — consts.py:281; `ManagerName` enum — consts.py:464
- Deferred action queues: `give_same_action` (one command for many tags), `do_unload_container`, `request_archon_morph`, `request_zerg_placement` — main.py:151, :159, :170, :173; executed custom_bot_ai.py:297, :372; main.py:1126

## 2. Unit roles & squads

- `UnitRole` enum, ~55 roles (ATTACKING, ATTACKING_MAIN_SQUAD, DEFENDING, GATHERING, BUILDING, PERSISTENT_BUILDER, SCOUTING, HARASSING_*, DROP_*, QUEEN_*, CONTROL_GROUP_ONE..NINE, BUILD_RUNNER_SCOUT, ...) — consts.py:492
- UnitRoleManager: auto-catch new units into default role, assign/batch_assign/clear/batch_clear/switch_roles — managers/unit_role_manager.py:24, catch :149, assign :168, batch :194, clear :211/:227, switch :334
- Role queries: units from role (optionally filtered by type), from multiple roles, all except roles, single type from single role, role dict — managers/unit_role_manager.py:242, :308, :350, :392
- SquadManager: on-demand clustering of a role's units into `UnitSquad`s by `squad_radius` (default 6), optional type filter — managers/squad_manager.py:73, `_get_squads` :187
- UnitSquad object: tags, units, position, main_squad flag — managers/squad_manager.py:24
- Squad lifecycle: create / assign to closest / merge with closest / regenerate / remove / remove tag — managers/squad_manager.py:252-438
- Main squad detection + per-role main squad position — managers/squad_manager.py:480, :516; mediator `get_position_of_main_squad` manager_mediator.py:1926
- docs: docs/tutorials/assigning_unit_roles.md, docs/tutorials/unit_squads_group_behaviors.md

## 3. Combat behaviors

### Framework
- `Behavior` protocol `execute(ai, config, mediator) -> bool` (bool = "acted this frame") — behaviors/behavior.py:11
- `BehaviorExecutioner` runs registered behaviors once per step in `_after_step` — behavior_exectioner.py:12, :37, :51; `register_behavior` main.py:459
- `CombatManeuver`: ordered list of behaviors, first one returning True wins (priority chain) — behaviors/combat/combat_maneuver.py:16
- Interfaces: CombatBehavior / CombatIndividualBehavior / CombatGroupBehavior — behaviors/combat/combat_behavior.py:12; individual/combat_individual_behavior.py:12; group/combat_group_behavior.py:17

### Individual (behaviors/combat/individual/)
- AMove — a_move.py:20
- AttackTarget — attack_target.py:18
- ShootTargetInRange (lowest-health pick) — shoot_target_in_range.py:20
- ShootAndMoveToTarget (move, shoot in-range enemies/destructables en route) — shoot_and_move_to_target.py:23
- StutterUnitBack (shoot if weapon ready else retreat on grid) — stutter_unit_back.py:22
- StutterUnitForward — stutter_unit_forward.py:20
- KeepUnitSafe (move to safest cell on influence grid) — keep_unit_safe.py:22
- MoveToSafeTarget (nearest safe point to a destination) — move_to_safe_target.py:24
- PathUnitToTarget (A* on grid, danger-aware) — path_unit_to_target.py:21
- NydusPathUnitToTarget (path using nydus network) — nydus_path_unit_to_target.py:21
- UseAbility (generic cast, cooldown-aware) — use_ability.py:20
- UseAOEAbility (min targets, avoid own units/fliers) — use_aoe_ability.py:33
- AutoUseAOEAbility (pick unit's AOE automatically) — auto_use_aoe_ability.py:23
- PlacePredictiveAoE (WIP, predict enemy pos) — place_predictive_aoe.py:22
- PickUpCargo / DropCargo / PickUpAndDropCargo (medivac/prism/overlord/nydus) — pick_up_cargo.py:25, drop_cargo.py:20, pick_up_and_drop_cargo.py:24
- MedivacHeal (heal close allies, optional keep-safe) — medivac_heal.py:20
- SiegeTankDecision (siege/unsiege heuristic) — siege_tank_decision.py:32
- GhostSnipe — ghost_snipe.py:23
- RavenAutoTurret — raven_auto_turret.py:20
- ReaperGrenade (KD8 charge) — reaper_grenade.py:32
- UseTransfuse (queen) — use_transfuse.py:22
- QueenSpreadCreep (along path start→target) — queen_spread_creep.py:22
- TumorSpreadCreep (edge-first then random) — tumor_spread_creep.py:18
- WorkerKiteBack (kite using mineral walk) — worker_kite_back.py:29

### Group (behaviors/combat/group/)
- AMoveGroup (single command for group) — a_move_group.py:19
- GroupUseAbility (single command, filtered spam) — group_use_ability.py:18
- KeepGroupSafe — keep_group_safe.py:19
- PathGroupToTarget (one path for group, dedup actions) — path_group_to_target.py:20
- StutterGroupBack (in unison, on grid) — stutter_group_back.py:32
- StutterGroupForward (in unison toward enemies) — stutter_group_forward.py:20
- docs: docs/tutorials/combat_maneuver_example.md, docs/tutorials/custom_behaviors.md

### Combat simulation
- CombatSimManager.can_win_fight(own, enemy, timing_adjust, good_positioning, workers_do_no_damage) → `EngagementResult` (11 buckets VICTORY_EMPHATIC..LOSS_EMPHATIC) via sc2_helper sim — managers/combat_sim_manager.py:31, :100; consts.py:265

## 4. Macro behaviors (behaviors/macro/)

- MacroPlan (priority-ordered macro behaviors) — macro_plan.py:15
- AutoSupply (all races, supply lead calc) — auto_supply.py:23
- BuildWorkers(to_count) — build_workers.py:19
- BuildStructure (pick mining worker + precalculated placement, assign BUILDING role) — build_structure.py:23
- ExpansionController(to_count, max_pending) — expansion_controller.py:17
- GasBuildingController(to_count) — gas_building_controller.py:19
- SpawnController (army composition dict: proportion + priority; ignores unbuildable) — spawn_controller.py:25
- ProductionController (add production facilities from same composition dict; T/P) — production_controller.py:29
- TechUp (auto-build tech path for a unit/upgrade) — tech_up.py:31
- UpgradeController (research list, auto-build required tech) — upgrade_controller.py:27
- UpgradeCCs (orbital/PF) — upgrade_ccs.py:18
- AddonSwap (Terran fly-swap structures onto addons) — addon_swap.py:28
- RestorePower (re-pylon unpowered protoss structures) — restore_power.py:36
- ProtossStaticDefence (pylons/cannons/batteries per nexus) — protoss_static_defence.py:26
- Mining (full worker control: assign, speed mine, LDM, keep safe, worker defense) — mining.py:41, execute :88, _keep_worker_safe :249, _long_distance_mining :303, _do_mining_boost :421, _worker_attacking_enemy :521
- SpeedMining (single worker) — speed_mining.py:24
- Tech helpers: `tech_ready_for_unit` custom_bot_ai.py:253; `pending_or_complete_upgrade` :198; `not_started_but_in_building_tracker` :171; `structure_present_or_pending`/`unit_pending`/`structure_pending` main.py:1057, :1076, :1092; `get_build_structures` (incl. reactor/techlab readiness priority) main.py:915
- Static data dicts: COST_DICT, unit_tech_requirement, does_not_use_larva, unit_alias, structure_to_building_size, unit_data — dicts/*.py; `calculate_cost` main.py:162
- docs: docs/tutorials/managing_production.md

## 5. Build runner / openings

- BuildOrderRunner: runs opening from YAML (`<race>_builds.yml`), step index, started/complete flags — build_runner/build_order_runner.py:50, run_build :228, do_step :287
- YAML options: AutoSupplyAtSupply, ConstantWorkerProductionTill, PersistentWorker, ShouldHandleGasSteal — build_order_runner.py:68-80, configure :124
- Step syntax `"<supply> <command> [xN|*N] [@ target]"`; commands from `BuildOrderOptions` (ADDONSWAP, CANCEL_GAS, CHRONO, CORE, GAS, GATE, EXPAND, ORBITAL, OVERLORD_SCOUT, SUPPLY, WORKER, WORKER_SCOUT) plus any UnitTypeId/UpgradeId name — consts.py:207; parser build_runner/build_order_parser.py:34, :85, :402, :579
- Dict-form steps — build_order_parser.py:495
- Step targets `BuildOrderTargetOptions` (NAT, THIRD..SIXTH, RAMP, NAT_WALL, REAPER_WALL, ENEMY_NAT/THIRD/FOURTH/RAMP/SPAWN, ENEMY_NAT_HG_SPOT, ENEMY_NAT_VISION, MAP_CENTER, SUPPLY/PRODUCTION/UPGRADE/BUNKER) — consts.py:226; resolve build_order_parser.py:676, build_order_runner.py:566, :756
- Generated step kinds: structure / unit / upgrade / addon — build_order_parser.py:191, :254, :304, :342
- Worker/overlord scouting with main scouting points — build_order_parser.py:613
- Persistent builder worker — build_order_runner.py:720; constant worker production — :735; gas steal handling — :844
- `switch_opening(name, remove_completed)`, `set_build_completed`, `set_step_complete/started`, `look_ahead` — build_order_runner.py:192, :117, :176, :184, :222
- BuildOrderStep dataclass — build_runner/build_order_step.py:15
- Opening selection by opponent history (winrate or cycle-on-loss) — managers/data_manager.py:167, :196, :278
- docs: docs/tutorials/build_runner.md

## 6. Placement / walls

- PlacementManager: precomputed 2x2/3x3 (and 5x5) formations for every expansion at start — managers/placement_manager.py:59, initialise :233, _find_placements_for_base_location :929
- Per-race formation solvers: Terran (addon-aware) :1005, Protoss (pylon-power) :1074, Zerg :1240; optimal pylon per base :1202; mineral-line avoidance :1152
- Ramp walls: Protoss main ramp (incl. gatekeeper) :1314; Terran main ramp (depots/barracks) :1362; natural bunker :1559; PvZ nat gatekeeper pos :197; mediator `get_gatekeeper_positions` manager_mediator.py:1722
- `request_building_placement(base, structure, wall, find_alternative, reserve, within_psionic_matrix, pylon_build_progress, closest_to, ...)` — placement_manager.py:319; options bag `PlacementRequest` managers/utils/placement_strategy.py:20
- Powered / unpowered placement strategies — managers/utils/placement_strategy.py:76, :172
- `can_place_structure` :266; reserve/lock placement with worker-en-route timeout :499, :1520 (config Placement.WorkerOnRouteTimeout); make available/unavailable :854, :900; on started/destroyed :791, :819
- User-defined placements from YAML per map/spawn/race, merged without overriding defaults — placement_manager.py:513, :523; managers/utils/user_placement_extractor.py:13, :130; consts BuildingPlacementOptions consts.py:163; protoss_building_placements.yml
- Zerg placement request via deferred action — main.py:173, :1126
- Wall-off detection constants + `main_ramp_walled_off` — consts.py:573; custom_bot_ai.py:535
- Debug draw of placements — placement_manager.py:1400
- docs: docs/tutorials/custom_building_placements.md

### Building execution
- BuildingManager: building_tracker (worker → structure/pos/time), handles move/build orders, retries, cancel after timeout (config Building.CancelOrder) — managers/building_manager.py:52, :143, :214
- `build_with_specific_worker` :647; `construct_gas` :491; `is_pending(type, simul_amount)` :586; `find_valid_position` :615; `cancel_structure` :456; all building targets :437; blocked expansion tracking (attr) :52
- Structure under attack cancel hook — building_manager.py:705
- FlyingStructureManager: move structures with land target, tracking — managers/flying_structure_manager.py:20, :111
- WarpInManager: queued warp-in requests resolved at end of step — managers/warp_in_manager.py:22, :96, :120

## 7. Pathing & influence grids

- GridManager: grids from map_analyzer — ground (pyastar), air, air_vs_ground, climber, ground_to_air, ground/air avoidance, priority ground avoidance, tactical ground (optional) — managers/grid_manager.py:70, :164-196
- Per-step reset from cached clean grids — grid_manager.py:368
- Enemy unit influence by class: generic, melee, anti-air, ground attack, weight-cost units, disruptor, baneling, infestor, oracle — grid_manager.py:714-853; dicts/weight_costs.py
- Structure influence: cannon, turret, spore, bunker, PF, auto-turret — grid_manager.py:589-710
- Effects influence: storm, bile, blinding cloud, KD8, lib zone, lurker spines, nuke, forcefield, parasitic bomb (config Pathing.Effects cost/range) — grid_manager.py:441-568
- Delayed effects (e.g. bile landing) tracked across frames — grid_manager.py:940-1025
- Public `add_cost` / `add_cost_to_multiple_grids` — grid_manager.py:289, :329
- Config: RangeBuffer, EffectsRangeBuffer, CostMultiplier, Features.UpdateGrids/TacticalGroundGrid — config.yml
- PathManager: `find_path_next_point` (A*, sensitivity, smoothing, danger distance) :251; `find_low_priority_path` :210; `raw_pathfind` :378; `find_nydus_path_next_point` :342 — managers/path_manager.py:33
- Safety: `find_closest_safe_spot` :154, `find_furthest_safe_spot` :184, `is_position_safe` :403; mediator `find_lowest_cost_points` manager_mediator.py:1227
- Whole-map KDTree / array for point queries — manager_mediator.py:1587, :1605
- Forcefield positions — manager_mediator.py:1463
- Debug: draw influence in game — custom_bot_ai.py:519; config DebugOptions.ActiveGrid/ShowPathingCost
- docs: docs/tutorials/influence_and_pathing.md

## 8. Terrain / expansion analysis

- TerrainManager: own/enemy nat/third/fourth, defensive third, expansion ordering by path distance — managers/terrain_manager.py:39, :194-363, :523
- Own/enemy expansions lists (path-distance sorted) — manager_mediator.py:2058, :2220
- `get_next_expansion_location` — custom_bot_ai.py:451; `is_free_expansion` terrain_manager.py:292
- Enemy main ramp — terrain_manager.py:277; map chokes (ChokeArea) / base-to-choke info — :599; manager_mediator.py:2177
- Overlord spots, closest OL spot, OL spot near enemy nat — terrain_manager.py:307, :319, :374
- Flood fill area from a point — terrain_manager.py:401
- Behind-mineral positions — terrain_manager.py:559
- Location blocked / blocked by burrowed unit; positions blocked by burrowed enemy — terrain_manager.py:427, :483, :628; custom_bot_ai.py:467, :506
- Initial pathing grid; map_analyzer MapData object exposed — manager_mediator.py:2151, :1540
- Nydus network: optimal nydus positions in own/enemy main, traveller tracking, travel bans — managers/nydus_manager.py:32, :129, :143, :190, :366, :462

## 9. Intel / enemy tracking

- UnitCacheManager: per-frame dicts by type (own army, own structures, enemy army, enemy workers), get_units_from_tags, own unit count (incl. pending), army value (enemy/own/ready) — managers/unit_cache_manager.py:37, :146, :164, :220, :390, :425
- Old own army dict (previous frame) / removed units — manager_mediator.py:2308, :2392
- UnitMemoryManager: remembers enemy units out of vision (snapshot, expiration, ghost units), based on sharpy — managers/unit_memory_manager.py:33, :246, :301, :321, :361
- KDTrees (AllOwn/AllEnemy/EnemyFlying/EnemyGround) + `units_in_range` / `any_enemies_in_range` batch queries — unit_memory_manager.py:397, :419, :509; consts.py:564
- Detection: enemy detectors + ranges, is position/unit detected, own units in enemy detector range — unit_memory_manager.py:108, :536, :561, :600; dicts/enemy_detector_ranges.py
- EnemyToBaseManager: ground/flying enemies near each townhall, main threats near TH, TH with largest ground threat, enemy-left-base hysteresis (config Distances) — managers/enemy_to_base_manager.py:30, :170, :224, :297
- IntelManager rush detection: did-enemy-rush, expanded, base outside natural, marauder/marine/ravager/ling/roach rush, four gate, worker rush, reaper, greedy, proxy zealot — managers/intel_manager.py:26, :145-368, :409; mediator manager_mediator.py:630-877
- Enemy proxies — custom_bot_ai.py:439
- Opponent history persistence (results per build, per opponent id) — managers/data_manager.py:37, :294, :309, :334 (config UseData)

## 10. Ability / cooldown tracking

- AbilityTrackerManager: manual per-unit ability last-used frame for abilities the API doesn't expose cooldowns for — managers/ability_tracker_manager.py:19, catch_unit :116, update :208, :233; dicts/ability_cooldowns.py
- Mediator: get/update unit_to_ability_dict — manager_mediator.py:119, :133
- AOE ranges, pickup ranges, turn rates — dicts/aoe_ability_to_range.py, dicts/pickup_range.py, dicts/turn_rate.py

## 11. Resource / mining

- ResourceManager: worker↔mineral patch / gas dicts, worker→townhall, patch→workers — managers/resource_manager.py:40, :811; mediator manager_mediator.py:1094-1164
- Auto worker assignment (2 per patch, gas count via `set_worker_per_gas`) — resource_manager.py:472, :502, :565, :632, :658, :128
- Initial worker split — resource_manager.py:658
- `select_worker(target_position, force_close, select_persistent_builder, only_select_persistent_builder, min_health_perc, min_shield_perc)` — resource_manager.py:322
- Available minerals; safe mineral fields at townhalls (for LDM) — resource_manager.py:133, :172
- Speed-mining targets via circle intersections (sharpy) — resource_manager.py:853, :885; config Mining.*DistanceFactor
- Townhall destroyed / mineral depleted / gas removed cleanup — resource_manager.py:715, :727, :771, :791
- Debug output — resource_manager.py:942 (config DebugOptions.ResourceDebug)

## 12. Creep (Zerg)

- CreepManager: creep grid/tiles/edges, coverage %, closest creep tile, nearby creep edge position, random creep position, next tumor on path, tumor influence lowest-cost position, overlord creep spotter positions, expansion-blocking mask, spread interval — managers/creep_manager.py:29, :105, :160, :164, :242, :269, :383, :504, :610, :657, :674, :740

## 13. Caching / perf

- `property_cache_once_per_frame` decorator — cache.py:8
- Single-pass unit sorting in `_prepare_units` instead of python-sc2's — main.py:200
- KDTrees for spatial queries (own/enemy/whole map) — unit_memory_manager.py:397; path_manager.py:15
- Cython helpers (`cython_extensions`) used throughout for distance/towards/flood fill
- Lazy squads (computed only when requested) — squad_manager.py:187
- Feature flags to skip grid updates / tactical grid / placement calc — config.yml Features, Placement.CalculatePlacements
- Configurable game_step / debug game_step — main.py:334; config.yml

## 14. Debug / chat

- ChatDebug: in-game chat commands — kill/create units by type, cooldown, food, god, resources, show map, tech tree, upgrades — chat_debug.py:26, :40-121
- `draw_text_on_world` — custom_bot_ai.py:110
- Influence grid drawing — custom_bot_ai.py:519; placement drawing placement_manager.py:1400; terrain/nydus debug draw terrain_manager.py:659, nydus_manager.py:358; enemy-to-base debug print enemy_to_base_manager.py:329
- docs: docs/tutorials/chat_debug.md

## 15. Config

- `config.yml` defaults merged with user `config.yml` and `<race>_builds.yml` — config_parser.py:11, :28; main.py:302
- Keys: UseData, Debug, GameStep, DebugGameStep, DebugOptions{ActiveGrid, ChatDebug, DebugSpawn, ShowPathingCost, ShowBuildingFormation, ResourceDebug}, Distances{Flying/GroundEnemyNearBases, *LeavingBases}, Features{TacticalGroundGrid, UpdateGrids}, Building.CancelOrder, Placement{CalculatePlacements, WorkerOnRouteTimeout}, Mining{GeyserDistanceFactor, GeyserThreshold, MineralDistanceFactor, TownhallDistanceFactor}, Pathing{RangeBuffer, EffectsRangeBuffer, CostMultiplier, Effects{...cost/range}} — config.yml
- Arcade mode (no enemy starts/townhalls) — main.py:334

## 16. Misc helpers (CustomBotAI)

- `get_total_supply(units)` :147; `split_ground_fliers` :225; `unload_by_tag` / `unload_container` :383, :416 — custom_bot_ai.py
