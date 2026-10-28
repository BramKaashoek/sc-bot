# ares-sc2 vs @sc-bot/core gap analysis

Scope: `packages/core` only. ares paths relative to `ares-sc2/src/ares/`, core paths relative to `packages/core/`.
Baseline: ares sits on top of python-sc2 (BotAI, Units, Ramp, already_pending, distribute_workers...). Core already ports most of that python-sc2 layer, so the gaps below are almost entirely the ares layer (managers + behaviors + build runner).

Status: **have** = equivalent; **partial** = exists but lacks listed pieces; **missing**; **core-only** = core has, ares doesn't.

## 1. Architecture / runtime

| capability | ares | core | core ref | notes |
|---|---|---|---|---|
| Plugin unit of logic | Manager + Hub + ManagerMediator request bus (`managers/hub.py`, `managers/manager_mediator.py:37`) | have (different model) | `systems/create-system.ts`, `engine/create-engine.ts:550` | core: systems with state/`stepIncrement`, engine systems serial, agent systems concurrent. No typed request/response bus; cross-system comms via events / `world.data.register` / unit labels |
| Behavior executor (register per-step behaviors, 1 per unit per frame) | `behavior_exectioner.py:51`, `main.py:459` | missing | — | core has no "behavior" object that is registered, executed and dropped each step |
| MacroPlan / CombatManeuver composition (ordered behaviors, first success wins) | `behaviors/macro/macro_plan.py`, `behaviors/combat/combat_maneuver.py` | missing | — | |
| Event hooks | python-sc2 set (`main.py:502-571`) | core-only (superset) | `systems/unit.ts:24-265`, `systems/map.ts:392-449` | core adds engaged/disengaged/switchedTargets, enteredVision/leftVision, newEffect/expiredEffect, unitFinished, chat |
| Custom pub/sub events | — | core-only | `resources/event-channel.ts` | |
| Per-unit labels | roles only | core-only (generic) | `engine/create-unit.ts:133-147` | |
| Earmarks (resource reservation) | — | core-only | `engine/data-storage.ts:55-81`, `agent/create-agent.ts:177` | used by build plugin `systems/builder-plugin.ts:235` |
| Config file (yml, feature toggles, effect costs) | `config.yml`, `config_parser.py:28` | missing | — | core: env vars only (`STEP_COUNT`, `DEBUG`, `DELAY`) |
| Game step size | `config.yml` GameStep, `main.py:92` | have | `engine/create-engine.ts:56` | env `STEP_COUNT` only, not per-bot |
| Action batching + dedupe | `main.py:151`, `custom_bot_ai.py:297` (group identical orders) | have / partial | `resources/actions.ts:647-670`, `:66` | core batches all queued commands in one request and drops repeats of current order; does not merge identical orders across units into one command |
| "Unit already ordered this frame" | python-sc2 | have | `resources/actions.ts:52,652` | |
| In-chat debug commands (spawn/kill units) | `chat_debug.py:40` | missing | — | core has the debug primitives (`resources/debug.ts`), no chat parser |
| Debug drawing | python-sc2 + `custom_bot_ai.py:110,519` (influence grid draw) | have | `resources/debug.ts`, `systems/debug.ts` | no grid/heatmap drawer (nothing to draw yet) |
| Ladder args, replay save | python-sc2 | have | `engine/create-engine.ts:109-153` | |
| In-process bot-vs-bot, replay runner | python-sc2 (partially) | core-only-ish | `engine/create-engine.ts:215,287` | |
| Test harness (fake client, fixtures, live spawn) | — (none shipped in src) | core-only | `test/fake-client.ts:279`, `test/create-test-world.ts:60`, `test/spawn-units.ts:41` | |

## 2. Units / state tracking

| capability | ares | core | core ref | notes |
|---|---|---|---|---|
| Units collection filters | python-sc2 `Units` | have | `resources/units-collection.ts:32-371` | |
| Unit helpers (dps, range, damage calc, weaponReady, realSpeed) | python-sc2 + `dicts/unit_data.py` | have | `engine/create-unit.ts:334-566` | |
| Per-type unit cache dicts (own_army_dict, structures_dict, enemy_army_dict) | `managers/unit_cache_manager.py:281,351,370` | partial | `resources/units.ts:135` | core filters full list per call (`getById` scans everything); no per-frame type index |
| Army value (own/enemy/ready) | `unit_cache_manager.py:146,164,220` | missing | — | trivial on top of `calculateCost` |
| Own unit count incl. pending | `unit_cache_manager.py:425`, `main.py:1057,1076` | have | `agent/macro.ts:324`, `resources/units.ts:190` | `alreadyPending` + `getPendingAt` |
| Enemy memory (ghost units, expiry) | `managers/unit_memory_manager.py:246,321,361` | partial | `systems/unit.ts:257`, `systems/frame.ts:105`, `engine/create-unit.ts:576-581` | core keeps out-of-vision enemies forever with `lastSeen`/`isMemory()`/`age()`; no expiry, no `getMemory()` accessor (`getAlive` drops them, need `getAll(ENEMY)`), no snapshot-structure vs moved-unit distinction |
| Spatial index (KD-tree units_in_range, any_enemies_in_range) | `unit_memory_manager.py:397,419,509` | missing | readme "Known limitations" | `getClosest`/`closerThan` are O(n) per query; fine now, hurts with many per-unit queries |
| Detection checks (own units in enemy detector range, is_detected) | `unit_memory_manager.py:536-600`, `dicts/enemy_detector_ranges.py` | missing | — | |
| Ability cooldown tracking | `managers/ability_tracker_manager.py:116,208`, `dicts/ability_cooldowns.py` | have (different) | `systems/unit.ts:275-289`, `engine/create-unit.ts:151-166` | core queries available abilities for all own units every step (accurate, 1 round-trip); `skipAvailableAbilitiesQuery` turns it off with no frame-based fallback |
| Adept shade tracking | `main.py:738,763` | missing | — | |
| Enemy race from first sighting (random) | python-sc2 | missing | `agent/create-agent.ts:306` (TODO) | |

## 3. Roles / squads

| capability | ares | core | core ref | notes |
|---|---|---|---|---|
| Unit roles (assign/clear/switch/get by role, auto-assign new units) | `managers/unit_role_manager.py:149,168,242,334`, `consts.py:492` | partial | `engine/create-unit.ts:133-147`, `resources/units.ts:207`, `systems/unit-plugin.ts:5` | labels + `withLabel` + unit systems filtered by label cover it ad hoc; no role enum, no batch ops, no "role → Units by type" query, no default role for new units |
| Squads (cluster role units into squads, main squad, squad centre) | `managers/squad_manager.py:24,187,252,480` | missing | — | |

## 4. Combat

| capability | ares | core | core ref | notes |
|---|---|---|---|---|
| Combat simulator / engagement predictor | `managers/combat_sim_manager.py:100` (sc2_helper native sim) | missing | — | core has per-pair `calculateDpsVsTarget` (`engine/create-unit.ts:563`) to build on |
| Influence grids (ground/air/avoidance/air-vs-ground/tactical) from enemy units, structures, effects | `managers/grid_manager.py:209,433,589,714`, `dicts/weight_costs.py` | missing | — | core tracks effects (`systems/map.ts:392`) but writes no cost layer |
| Pathing on cost grid, next-point, safe spot, is_position_safe | `managers/path_manager.py:154,210,251,403` | partial | `resources/map.ts:477`, `:316` | A* exists (weighted fork, `node.weight` honoured), but weights are static wall-proximity; graph cloned per call (`map.ts:493`) so per-unit per-step pathing will be slow |
| Individual micro behaviors (stutter fwd/back, kite, keep safe, path to target, shoot in range, AoE use/predictive, medivac heal, drops, siege tank, ghost snipe, reaper grenade, transfuse, raven turret, worker kite) | `behaviors/combat/individual/*` | missing | — | core gives primitives only: `weaponReady`, `distanceToWeaponReady`, `targetInRange`, `inAbilityCastRange` (`engine/create-unit.ts:385-414`) |
| Group micro (a-move, stutter group, keep group safe, path group) | `behaviors/combat/group/*` | missing | — | |
| Threats near own bases | `managers/enemy_to_base_manager.py:170,297`, mediator `get_main_ground_threats_near_townhall` | missing | — | |

## 5. Economy

| capability | ares | core | core ref | notes |
|---|---|---|---|---|
| Worker distribution | python-sc2 | have | `agent/macro.ts:434` | python-sc2 parity |
| Worker↔patch assignment bookkeeping | `managers/resource_manager.py:472,565,632,811` | missing | — | core relies on SC2 auto-balancing + `distributeWorkers` |
| Speed mining (mineral boost via precomputed targets) | `resource_manager.py:853`, `behaviors/macro/mining.py`, `speed_mining.py` | missing | — | `mineralLine` areas exist (`systems/map.ts:57`) but no per-patch target point |
| Worker safety / self-defence while mining, long-distance mining | `behaviors/macro/mining.py` | missing | — | |
| Select worker for building (removes from mining) | `resource_manager.py:322` | partial | `agent/macro.ts:239`, `resources/actions.ts:419-443` | no bookkeeping that the worker left mining; frame system "stuck" label after 250 loops (`systems/frame.ts:74`) |
| Workers per gas control | `manager_mediator.py:2661` | missing | — | |
| MULE / CC upgrades | `behaviors/macro/upgrade_ccs.py` | missing | — | |

## 6. Building / placement

| capability | ares | core | core ref | notes |
|---|---|---|---|---|
| Precomputed per-base building formations (2x2/3x3/addon-aware, pylon power) | `managers/placement_manager.py:929,1005,1074,1240` | missing | — | core searches rings with placement queries at build time (`resources/actions.ts:322`) |
| Request placement with reservation/release | `placement_manager.py:319,499,854` | missing | — | |
| User placement file (per-map yml) | `placement_manager.py:513`, `protoss_building_placements.yml` | partial | `types.ts:792` (`placer` resource), `systems/builder-plugin.ts:428` | hook exists, no format/loader |
| Ramp wall positions | python-sc2 Ramp + `placement_manager.py:1314` | have | `utils/map/ramp.ts:45-135` | depot/barracks/protoss wall |
| Natural wall | `BuildOrderTargetOptions.NAT_WALL` | partial | `systems/map.ts:123` | computes wall cells, no building positions |
| Construction tracking (move worker, reissue, timeout, retry) | `managers/building_manager.py:214,437,586` | partial | `systems/builder-plugin.ts:270`, `systems/frame.ts:74` | build plugin resets COMMAND_GIVEN after 250 loops; no worker escort/reissue |
| Cancel low-HP construction | `building_manager.py:705` | missing | — | `onUnitTookDamage` event exists to hang it on |
| Burrowed/blocked placement detection | `terrain_manager.py:427,483`, `custom_bot_ai.py:467,506` | missing | `systems/builder-plugin.ts:418` (TODO) | |
| Gas construction | `building_manager.py:491` | have | `resources/actions.ts:486` | |
| Flying structure move/land | `managers/flying_structure_manager.py:111,134` | partial | `resources/actions.ts:214` | only `swapBuildings`, uses fixed 100ms delays |
| Addon swap | `behaviors/macro/addon_swap.py` | partial | `resources/actions.ts:214` | |
| Warp-in | `managers/warp_in_manager.py:96,120` | have | `resources/actions.ts:570`, `agent/macro.ts:591` | no cross-system batching |
| Restore power (protoss) | `behaviors/macro/restore_power.py` | missing | — | |

## 7. Macro automation

| capability | ares | core | core ref | notes |
|---|---|---|---|---|
| Train / research / expand primitives | python-sc2 | have | `agent/macro.ts:530,624,425` | |
| Tech requirement progress | `custom_bot_ai.py:253` | have | `agent/macro.ts:366`, `agent/create-agent.ts:233` | |
| SpawnController (army composition proportions + priority) | `behaviors/macro/spawn_controller.py` | missing | — | |
| ProductionController (add production from composition/bank) | `behaviors/macro/production_controller.py` | missing | — | |
| AutoSupply | `behaviors/macro/auto_supply.py` | missing | — | |
| TechUp (build whatever is needed for a unit/upgrade) | `behaviors/macro/tech_up.py`, `dicts/unit_tech_requirement.py` | missing | `constants/dicts/tech-requirement.ts`, `research-requirements.ts` | data exists, no resolver |
| Build workers / expansion / gas / upgrade controllers | `behaviors/macro/build_workers.py`, `expansion_controller.py`, `gas_building_controller.py`, `upgrade_controller.py` | missing | — | |
| Build order runner | `build_runner/build_order_runner.py:228,287` | partial | `systems/builder-plugin.ts:125-303` | core: supply-tuple tasks, auto worker fill, earmarks, pause/resume, skip-by-state |
| BO text/yml format, multiple openings, switch opening | `build_order_parser.py:402`, `build_order_runner.py:124,192` | missing | — | core BO is TS arrays |
| BO targets (RAMP, NAT, THIRD, ENEMY_NAT proxy, MAP_CENTER...) | `consts.py:226` | partial | `systems/builder-plugin.ts:312` (`opts.near` unit type only) | |
| BO special steps (worker scout, overlord scout, chrono, gas steal, orbital, cancel gas) | `consts.py:207`, `build_order_runner.py:844` | partial | `systems/builder-plugin.ts:514` (`ability` task) | generic ability task only |

## 8. Map / terrain / intel

| capability | ares | core | core ref | notes |
|---|---|---|---|---|
| Expansion locations + ordering by path distance | python-sc2 + `terrain_manager.py:523` | have | `systems/map.ts:262`, `utils/map/expansion-locations.ts:115`, `resources/map.ts:127-163` | |
| Own/enemy nat, third, fourth | `terrain_manager.py:224-363` | have | `resources/map.ts:127-144` | |
| Defensive third | `terrain_manager.py:194` | missing | — | |
| Ramps, vision blockers, main ramp | python-sc2 | have | `resources/map.ts:429-455` | |
| Chokes / regions (map_analyzer) | `terrain_manager.py:599`, mediator `get_map_choke_points` | missing | — | core has only ramp detection; no general choke finder |
| Behind-mineral positions | `terrain_manager.py:559` | have | `systems/map.ts:65` (`areas.behindMineralLine`) | |
| Overlord spots | `terrain_manager.py:307,374` | missing | — | |
| Combat rally point | — | core-only | `resources/map.ts:225` | |
| Rush/strategy detection (ling/marine/marauder/roach/ravager/4gate/worker rush, proxy zealot, greedy, expanded) | `managers/intel_manager.py:145-409` | missing | — | |
| Enemy proxies | `custom_bot_ai.py:439` | missing | — | |
| Creep grid/edges, tumor spread, queen creep | `managers/creep_manager.py:105,269,504`, `behaviors/combat/individual/tumor_spread_creep.py` | partial | `resources/map.ts:109,199` | core: creep grid read only |
| Nydus | `managers/nydus_manager.py` | missing | — | |

## Ranked: most valuable missing/partial for a competitive bot

Context: the bot in `bot/` is Terran bio (marine/medivac micro, defense, strategy files), so Terran-relevant items rank higher; zerg creep/nydus are last.

| # | item | effort | depends on | why |
|---|---|---|---|---|
| 1 | Influence grids (ground/air from enemy units, static D, effects) + cost-aware pathing (`safe spot`, `is_position_safe`, `next point`) | L | none; needs a reusable per-step grid buffer and a non-cloning weighted A* | foundation for every ares combat behavior; storm/bile/lib-zone/tank avoidance |
| 2 | Combat simulator `canWinFight(own, enemy)` | M | none (build on `calculateDpsVsTarget`) | engage/retreat decisions, defense sizing |
| 3 | Unit roles + squads (role API over labels, squad clustering, main squad position) | M (roles S, squads M) | none | army management, drops, defenders vs main army |
| 4 | Enemy memory with expiry + spatial index (`unitsInRange`, `anyEnemiesInRange`) + army value | M | none | feeds 1, 2, 7; fixes O(n²) range queries |
| 5 | Placement solver (precomputed per-base formations incl. addon space, reservation) + building tracker (reissue, timeout, cancel low HP) | L | none; tracker can reuse `onUnitTookDamage` | reliable macro; removes per-build placement query storms |
| 6 | Mining manager (patch assignment, speed mining, worker safety, builder handoff) | M-L | 5 (builder handoff), 1 (worker safety) | speed-mining income; stops builders vanishing from mining |
| 7 | Intel: threats near bases + rush detection | M | 4 | defense triggers |
| 8 | Micro behaviors library (stutter fwd/back, keep safe, path to target, medivac heal, siege tank, drop/pickup) + behavior executor (1 action per unit per step) | M-L | 1, 3 | reusable bio micro; executor prevents systems clobbering each other's orders |
| 9 | Macro controllers: SpawnController, ProductionController, AutoSupply, TechUp, MacroPlan | M | 5 | composition-driven macro instead of hand-coded per-unit logic |
| 10 | Build order runner upgrades: string/yml format, named targets (RAMP/NAT/NAT_WALL/ENEMY_NAT), worker scout, opening switch | M | 5, 3 | faster opening iteration |
| 11 | Chokes / defensive positions (map_analyzer equivalent) | M-L | none | defense positioning beyond ramps |
| 12 | Flying structures / addon swap done properly (state machine, no fixed delays) | S-M | 5 | Terran-specific |
| 13 | Small: enemy race on first sight, chat debug commands, config file, workers-per-gas | S each | — | |
| 14 | Creep, nydus, adept shades | L | 1 | zerg/protoss only |

Dependency graph (short): 4 → 7; 1 → 8, 6 (safety); 3 → 8, 10; 5 → 6, 9, 10, 12.

## Core has, ares doesn't

- Event-driven model with richer lifecycle events: engaged/disengaged/switched target, enemy entered/left vision, effect start/expire, unit finished, unit type changed (`systems/unit.ts`, `systems/map.ts:392`).
- Pub/sub `EventChannel` with reader ids, custom events (`resources/event-channel.ts`).
- Earmarks / resource reservation integrated into `canAfford` and the build plugin (`engine/data-storage.ts`, `agent/create-agent.ts:177`).
- Generic per-unit labels + unit systems filtered by type/label with idle handlers (`systems/unit-plugin.ts`).
- Systems with React-like state and `stepIncrement` (`systems/create-system.ts`).
- Offline test harness: fake client replaying recorded fixtures, `createTestWorld`, `stepTo`, live `spawnUnits` (`test/`).
- In-process bot-vs-bot and replay runner in one engine (`engine/create-engine.ts:215,287`).
- Combat rally point helper (`resources/map.ts:225`); natural wall cell computation (`systems/map.ts:123`).
- Full available-abilities query each step (exact, vs ares' frame-count cooldown estimate) (`systems/unit.ts:275`).
