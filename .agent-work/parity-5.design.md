# parity-5 design

Author: technical-architect (2026-10-26). It covers ares-gap ranked #8 (behavior executor plus micro library) and #9 (macro controllers). It builds on:
- core-arch: the executor, `as()` and ALS commander context.
- parity-2: pathing `nextPoint`/`closestSafeSpot`/`isPositionSafe`, influence layers, spatial.
- parity-3: `roles.as`, squads, `canWinFight`.
- parity-4: placement, buildings, mining, flying. The contract comes from technical-architect-2 and is pinned in parity-4.design.md.

All paths are under packages/core/ and were checked against the worktree. ares paths are relative to ares-sc2/src/ares/.

## Current state (verified)
- ares: behaviors are dataclasses with `execute(ai, config, mediator) -> bool`. `register_behavior` appends to a list that runs once in `_after_step` (behavior_exectioner.py, main.py:443-473). `CombatManeuver` and `MacroPlan` are the same thing: `any(b.execute())`, so the first success wins (combat_maneuver.py, macro_plan.py). Behaviors command units directly (`unit.attack`, `give_same_action`).
- core: there is no behavior concept. Commands are proposals arbitrated per tag at step end. Owner and priority come from ALS (`runAsCommander`/`currentCommander`, resources/command-context.ts; `actions.as`, actions.ts:624). The engine flushes after agent systems (engine/create-engine.ts:587-597).
- Macro helpers already exist and propose synchronously (no `await` inside the body, so they propose before they resolve):
  - `agent.train(type, amount, closestTo, trainOnlyIdle)` handles reactors, techlab requirements, warpgates and larva (agent/macro.ts:525).
  - `agent.research(upgrade)` (:619).
  - `alreadyPending`, `alreadyPendingUpgrade`, `techRequirementProgress`, `canAfford`/`canAffordN`/`calculateCost`/`calculateSupplyCost`, `supplyLeft/Used/Cap`.
  - Spend is deducted at proposal time, like ares' `ai.minerals -=`.
- Data dicts exist: constants/dicts/trained-from.ts, researched-from.ts, research-requirements.ts and tech-requirement.ts.
- Unit helpers exist: `targetInRange(target, bonus)`, `weaponReady()`, `abilityAvailable(id)`, `isUsingAbility(ids)`, `isBiological()`, `passengers`, `cargoSpaceTaken`, `weaponCooldown` (game loops).
- `distanceToWeaponReady()` (create-unit.ts:385) computes `realSpeed()/22.4 × cooldown`. realSpeed is in normal-speed units, which is 16 loops/s. Phase 5 does its own math (see helpers) and does not rely on it. Filing a fix there is a separate item.
- Abilities: ATTACK 3674, MOVE 16, SMART 1, EFFECT_HEAL 386, MORPH_SIEGEMODE 388, MORPH_UNSIEGE 390, UNLOADALLAT 3669, MORPH_ORBITALCOMMAND 1516, and the PF morph (verify the name in constants/ability.ts).
- package.json `exports` has `.`, `./constants/*` and `./types`.
- Score: `frame.getScore().scoreDetails.collectionRateMinerals/Vespene`.

## B0. Behavior contract + executor: resources/behaviors.ts, behaviors/plan.ts
types.ts:
```ts
export type BehaviorContext = {
    world: World;
    order(units: Unit | Unit[], abilityId: number, target?: Point2D | Unit, opts?: { queue?: boolean }): boolean;
    hasOrdered(unit: Unit | string): boolean;          // by this owner, via behaviors, this game loop
};
export interface Behavior { readonly name: string; execute(ctx: BehaviorContext): boolean | Promise<boolean> }
export interface BehaviorsResource {
    run(behavior: Behavior, opts?: { role?: UnitRole; priority?: number }): Promise<boolean>;
}
export type ArmyComposition = Partial<Record<number, { proportion: number; priority: number }>>;   // priority 0 (first) – 10
export interface ResourceContainer { ...; behaviors: BehaviorsResource }
```
- `run` executes immediately, in the caller's commander context. With `role`, it wraps in `roles.as(role, fn, { priority })`. With only `priority`, it wraps in `actions.as({ priority }, fn)`. It returns the behavior's result.
  - Why immediate, not ares' deferred list: owner attribution then comes from ALS for free, and cross-system conflicts are already the arbiter's job.
- `ctx.order`: builds one `ActionRawUnitCommand` (targetUnitTag for a Unit, targetWorldSpacePos for a point, queueCommand). Without `queue`, it first drops the tags that this owner (`currentCommander().owner`) already ordered via behaviors this game loop. If no tags are left it returns false. Otherwise it calls `actions.queueAction(command)`, records the tags and returns true.
  - This gives one action per unit per step per owner. The arbiter then picks one owner per unit, so the step ends with one action per unit.
- State is `Map<owner, Set<tag>>`, cleared lazily when `frame.getGameLoop()` changes. There is no onStep. reset clears it.
- engine/create-world.ts: register `behaviors` after `flying`.
- package.json `exports` gains `"./behaviors": "./behaviors/index.ts"`. Behavior factories are imported from `@sc-bot/core/behaviors`, not the root, so the root namespace stays small and the `behaviors` resource name doesn't collide.
- behaviors/plan.ts: `plan(...behaviors: Behavior[]): Behavior` runs them in order and returns true at the first true. It awaits only when a result is a Promise. This one function replaces both CombatManeuver and MacroPlan.
- behaviors/index.ts re-exports every factory (later tickets append their lines).
- Factory style: plain functions returning `{ name, execute }` objects, as with `createSystem`. No classes. Option objects use ares field names in camelCase.
- Tests:
  - plan: first-success, short-circuit, mixed sync/async;
  - order: dedupes the same owner's second non-queued order for a tag in one loop, allows `queue: true`, and allows it again next loop;
  - two systems at different priority ordering one unit: one 'won', one 'dropped' via commandResults;
  - `run({ role: 'ATTACKING' })` gives owner `role:ATTACKING`;
  - a Unit target vs a point target in the command shape.
- Follow: core-arch command-context/arbiter; ares behavior_exectioner.py and combat_maneuver.py (semantics only).

## B1. Combat helpers + individual behaviors: behaviors/combat/helpers.ts, behaviors/combat/individual.ts
Default layer for every pathing/safety behavior: `layer ?? (isFlying(unit) ? 'air' : 'ground')`, via phase-2 `pathing`.

helpers.ts (pure over Unit/World, no commands):
- `attackReady(unit, target, stepLoops = 4)`. This ports cy_attack_ready.
  - True when `weaponCooldown <= stepLoops`.
  - Also true when `gap / (realSpeed()/16) >= weaponCooldown`, with gap = `max(0, dist − unit.radius − target.radius − range)` and range = ground or air range by `isFlying(target)`. That is the time in loops to walk into range.
  - False when the unit can't attack the target.
- `inAttackRange(unit, targets, extraRange = 0)`: `unit.targetInRange(t, extraRange)`.
- `pickEnemyTarget(targets)`: lowest `health + shield`, ties to the first.
- `duplicateOrSimilarOrder(world, unit, target, abilityId, distanceSquared = 2)`, ported from combat_group_behavior.py:
  - True when the unit is within the distance of the target.
  - Otherwise compare the first order. Both ability ids are mapped to their general id through `world.data.getAbilityData(id).remapsToAbilityId ?? id`. The order matches when the ids are equal and the target is the same tag, or the same rounded point.
- `groupWeaponsOnCooldown(group, stutterForward)`: average `weaponCooldown`. ≤0 → false; otherwise forward > 2.5, back > 5.0.
- `center(units)`: avgPoints. `towards(from, to, distance)`.

individual.ts. Each entry gives its options and then its behavior; options are camelCase, with defaults where ares has them.
- `aMove({ unit, target, successAtDistance = 7 })` (a_move.py): attack-move to the target. Returns false when the unit is already within `successAtDistance` of it.
- `attackTarget({ unit, target })` (attack_target.py): issues ATTACK on the target and always returns true.
- `shootTargetInRange({ unit, targets, extraRange = 0 })` (shoot_target_in_range.py):
  - Candidates: targets that are current and not cloaked unless detected (`cloak` CLOAKED_DETECTED).
  - True with no order when the unit's current order target is among the in-range candidates and `weaponCooldown === 0`.
  - Otherwise, if `pickEnemyTarget(inRange)` is `attackReady`, ATTACK it.
- `useAbility({ unit, abilityId, target? })` (use_ability.py): `abilityAvailable` guard.
- `stutterUnitForward({ unit, target })`: attackReady → attackTarget, else MOVE to the target's position.
- `stutterUnitBack({ unit, target, layer? })`: attackReady → attackTarget, else keepUnitSafe. ares' non-pathing variant only warns, so it is dropped.
- `keepUnitSafe({ unit, layer? })`: safe (`pathing.isPositionSafe`) → false. Otherwise pathUnitToTarget to `pathing.closestSafeSpot(unit.pos)` with successAtDistance 0.
- `pathUnitToTarget({ unit, target, layer?, successAtDistance = 0, sensitivity = 5, senseDanger = true, dangerDistance = 20, dangerThreshold = 5 })`: MOVE to `pathing.nextPoint(...)`. Returns false within successAtDistance. ares' `smoothing` is not offered.
- `moveToSafeTarget({ unit, target, layer?, usePathing = true, successAtDistance = 1, radius = 12, sensitivity, senseDanger, dangerDistance, dangerThreshold })`.
- `shootAndMoveToTarget({ unit, enemies, target, layer?, distToTarget = 4, attackDestructables = true })`: shootTargetInRange on enemies, then on `units.getDestructables()`, then pathUnitToTarget.
- `workerKiteBack({ unit, target, shouldAttack = true })` (worker_kite_back.py):
  - Mineral fields come from `units.getMineralFields()` and the start from `map.getMain().townhallPosition`.
  - Close enemies come from `spatial.unitsInRange(unit, 6.5, 'enemyGround')`, excluding larva, eggs, creep tumors and changelings.
- Tests: every behavior gets its true and false branches on createTestWorld fixtures. Assert on the proposals through `actions.flushQueuedActions()` and `client.sent.actions`.
  - Path/safe behaviors use influence `addCost` to make danger.
  - attackReady: ready, cooling but far, and cooling and close.
  - duplicateOrSimilarOrder: specific vs general ability id.

## B2. Terran individual: behaviors/combat/terran.ts
- `medivacHeal({ unit, allies, layer?, keepSafe = true })` (medivac_heal.py):
  - Returns false for a non-medivac.
  - keepUnitSafe first.
  - If it is already using EFFECT_HEAL, return true.
  - Else EFFECT_HEAL on the closest ally that is `isBiological()` and below max health.
- `pickUpCargo({ unit, targets, layer?, switchCargoToRole? })` (pick_up_cargo.py):
  - Pickup range is 5 for MEDIVAC/WARPPRISM/OVERLORDTRANSPORT (ares dicts/pickup_range.py).
  - With no targets: assign the role to its `passengers` tags (via `roles.assign`) and return false.
  - Within range: SMART on the closest target. Otherwise MOVE to `pathing.nextPoint`.
- `dropCargo({ unit })` (drop_cargo.py):
  - False when `cargoSpaceTaken === 0` or `!map.isPathable(unit.pos)`.
  - Otherwise UNLOADALLAT targeting the unit itself. The live smoke verifies the command shape.
- `pickUpAndDropCargo({ unit, targets, target, layer?, switchCargoToRole?, shouldDropUnits = true, keepDropshipSafe = true, successAtDistance = 2 })`: a plan of pickUpCargo, then (if it has cargo) pathUnitToTarget, dropCargo and keepUnitSafe.
- `siegeTankDecision({ unit, closeEnemy, target, staySiegedNearTarget = false, remainSieged = false, forceUnsiege = false })` (siege_tank_decision.py), ported with ares' squared constants:
  - Considered enemies: ground (`!isFlying(e)`; this fixes ares' bug of testing the tank's own type), not burrowed, not changelings.
  - SIEGETANK: if forceUnsiege, or any enemy within 6.5 → false. Siege (MORPH_SIEGEMODE) when there is static D within 13, or staySieged and within 5 of the target, or (supply ≥ 4 and > 1 enemy), or any enemy tank.
  - SIEGETANKSIEGED:
    - Unsiege on forceUnsiege, or when enemies are too close (≥1 within 4 and <2 within 12).
    - Otherwise stay sieged (false) when remainSieged, or staySieged and within 7 of the target.
    - Also stay sieged when own units are between the tank and the target: `spatial.unitsInRange(mid, 12, 'ownGround')` has ≥3 units and the closest is within 8.5. The midpoint must be within 10.
    - Otherwise unsiege when no relevant enemy (a non-structure, or static D within ≈10.5) remains and the target is > ≈14.1 away.
  - Returns true while sieged, as ares does.
- Tests: medivac heals the closest hurt bio and ignores a hurt SCV; pickup in and out of range and role switch; drop on unpathable → false; siege/unsiege for each rule.

## B3. Group behaviors: behaviors/combat/group.ts
All of ares' group behaviors are ported (group/*.py). Each issues one multi-tag `ctx.order` for the group.
- `aMoveGroup({ group, target })`: skip when the unit farthest from the target already has a duplicate/similar ATTACK order.
- `keepGroupSafe({ group, closeEnemy, layer?, attackInRangeEnemy = true })`: per unit, shootTargetInRange, else keepUnitSafe. True if any unit moved.
- `pathGroupToTarget({ start, group, target, layer?, distanceCheckSquared = 26.25, successAtDistance = 0, sensitivity = 12, senseDanger = false, dangerDistance = 20, dangerThreshold = 5, preventDuplicate = true })`.
- `stutterGroupBack({ group, groupPosition, target, layer? })`: if the weapons are cooling (back), do nothing when all units are safe. Otherwise:
  - Retreat point: the best of 8 directions at `n × 1.5`, clamped to the map and finite on the grid. With one unit, use groupPosition.
  - Then closestSafeSpot, then `nextPoint(groupPosition, spot, { sensitivity: min(n, 8) })`, then MOVE unless the order is a duplicate.
  - Otherwise ATTACK the target position.
- `stutterGroupForward({ group, groupPosition, target, enemies })`: all units in range → ATTACK the enemy centre. Weapons cooling (forward) → MOVE to the enemy centre. Otherwise ATTACK the enemy centre. Each order is deduped.
- `groupUseAbility({ abilityId, group, target?, syncCommand = true })`: all (sync) or any unit has `abilityAvailable`.
- Tests: each behavior gets one multi-tag command and one duplicate suppression; the retreat direction is away from the target.

## B4. Macro helpers + spawn: behaviors/macro/helpers.ts, behaviors/macro/spawn.ts
helpers.ts:
- `ownUnitCount(world, type)` = `units.getById(type).length + agent.alreadyPending(type)`. This is ares get_own_unit_count.
- `structurePending(world, type)` = `buildings.pending(type)` plus own structures of that type with `buildProgress < 1` whose tag is not a `structureTag` of `buildings.getTracked()`. This is the counting rule technical-architect-2 gave.

spawn.ts:
- `spawnController({ composition: ArmyComposition, freeflow = false, ignoreProportionsBelowUnitCount = 0, overProduceOnLowTech = true, maximum = 20, spawnTarget? })` (spawn_controller.py). Port:
  - At creation, throw `NodeSC2Error` unless the proportions sum to 1 (±1e-6) and every priority is an integer 0–10, or `freeflow` is set. ares asserts in execute; failing at creation is earlier.
  - Protoss: return false while warpgate is researched and idle ready gateways exist.
  - Go through the types sorted by priority:
    - Skip a type when `techRequirementProgress < 1` or it has no producer type in `trainedFrom`.
    - If `!agent.canAfford(type)`: in freeflow, or below `ignoreProportionsBelowUnitCount`, `continue`; otherwise stop the loop.
    - Skip a type when its proportion is over target (unless freeflow or below threshold).
    - Otherwise `await agent.train(type, amount, spawnTarget)` with amount = `min(agent.canAffordN(type, maximum), floor(supplyLeft / supplyCost))`.
  - Over-produce on low tech, exactly as ares: when only one type is tech-ready, top up to `maximum`.
  - Return true if anything was trained.
  - Not ported: baneling/ravager/archon morphs (non-Terran) and `ignored_build_from_tags` (agent.train has no exclusion).
- `buildWorkers({ toCount })` (build_workers.py): `toCount − supplyWorkers` workers via spawnController with the worker type and maximum = that count.
- Tests:
  - Proportions are steered toward the target with two types.
  - Priority order is followed.
  - Unaffordable at top priority stops lower priorities (non-freeflow) and does not stop them in freeflow.
  - A reactor rax trains 2.
  - A bad composition throws.
  - buildWorkers stops at toCount.

## B5. Structure controllers: behaviors/macro/structures.ts
- `buildStructure({ base?, structureType, maxOnRoute = 1, closestTo?, toCount = 0, techProgressCheck = 0.85, flags?: PlacementFlag[], findAlternative = true })` (build_structure.py). It returns false when:
  - `buildings.getTracked()` for the type in status 'moving' or 'ordered' is ≥ maxOnRoute;
  - toCount > 0 and ready + `structurePending` ≥ toCount;
  - `techRequirementProgress < techProgressCheck`.
  Otherwise it returns `!!buildings.build(structureType, { placement: { base, closestTo, flags, findAlternative } })`. The tracker picks the worker and switches roles (phase 4).
  - Not ported: ares' `to_count_per_base` (needs per-base placement bookkeeping that phase 4 doesn't expose) and Zerg placement (phase 4 P4-D4 returns undefined, so false).
- `autoSupply({ base?, closestTo?, returnTrueIfSupplyRequired = true })` (auto_supply.py): `numSupplyRequired` is ported exactly, for both the zerg and non-zerg branches.
  - Production structures: own finished BARRACKS/FACTORY/STARPORT/GATEWAY/WARPGATE/ROBOTICSFACILITY/STARGATE/HATCHERY/LAIR/HIVE, the ALL_PRODUCTION_STRUCTURES equivalent.
  - Pending supply: `structurePending(depot/pylon)`; for zerg, `alreadyPending(OVERLORD)`.
  - Zerg: `agent.train(OVERLORD)`. Otherwise: buildStructure(SUPPLYDEPOT or PYLON, flags ['supplyDepot'] for Terran).
- `expansionController({ toCount, canAffordCheck = true, checkLocationIsSafe = true, maxPending = 1, prioritize = false })`:
  - It returns false when ready townhalls + `structurePending(townhallType)` ≥ toCount, when pending ≥ maxPending, or when (canAffordCheck and not prioritize and it can't afford).
  - The location is the first `map.getExpansions()` entry (already ordered by path from main) that is not occupied, is `pathing.isPositionSafe` when checked, and passes `placement.canPlace(townhallType, townhallPosition)`.
  - It then calls `buildings.build(townhallType, { at })`.
- `gasBuildingController({ toCount, maxPending = 1 })`: count = own gas buildings + `buildings.pending(gasType)`. It returns false at toCount, at maxPending, or when minerals < 35. Otherwise it calls `buildings.buildGas()`, which picks the geyser by phase-4 rules.
- `upgradeCCs({ to: ORBITALCOMMAND | PLANETARYFORTRESS, prioritize = false })` (upgrade_ccs.py): the first ready idle CC gets the morph ability, guarded by `techRequirementProgress(to) === 1` and canAfford. With prioritize and unaffordable, it returns true and bank-holds.
- Tests (fixtures + stubbed phase-4 resources where the solver isn't needed):
  - autoSupply thresholds per ares table (0 / 1 / 3 production, pending);
  - buildStructure: maxOnRoute and toCount guards;
  - expansion skips an unsafe or occupied location;
  - gas count includes pending;
  - orbital morph proposal.

## B6. Tech controllers: behaviors/macro/tech.ts
- `techUp({ desired: { unit: number } | { upgrade: number }, base?, ignoreExistingTechlabs = false })` (tech_up.py), port:
  - Lair/Hive skip.
  - researchedFrom: `researchedFrom[upgrade]`, or `trainedFrom[unit][0]` (GATEWAY for gateway units), or the structure itself.
  - Techlab branch (BUILD_TECHLAB_FROM {BARRACKSTECHLAB→BARRACKS, FACTORYTECHLAB→FACTORY, STARPORTTECHLAB→STARPORT}). The addon is built with `agent.train(<X>TECHLAB, 1)`, which issues BUILD_TECHLAB_<X> on an idle addon-less host. The test verifies it; if `creationAbility` doesn't map it, the ticket issues the ability via `ctx.order` instead.
  - Tech requirements from `techRequirement` (one requirement per type in core).
  - buildStructure for missing structures; Lair/Hive morphs.
- `upgradeController({ upgrades: number[], base?, autoTechUp = true, prioritize = false })` (upgrade_controller.py). For each upgrade not done or pending (`alreadyPendingUpgrade`):
  - With no research structure (with equivalents): techUp if enabled.
  - Otherwise, an idle ready (and powered) structure: `agent.research(upgrade)` → true.
  - Unaffordable with prioritize → true.
  - A missing `requiredBuilding` (researchRequirements) → techUp(requiredBuilding).
- Tests: techUp for MARAUDER builds BARRACKSTECHLAB on an idle rax; techUp for an upgrade whose structure is missing builds it via buildStructure; upgradeController researches stim when it can, techs to the armory for +2, bank-holds with prioritize.

## B7. Production controller: behaviors/macro/production.ts
`productionController({ composition, base, addProductionAtBank = [400, 400], alpha = 0.9, unitPendingProgress = 0.75, maxProductionStructures = 12 })` (production_controller.py; ares' ignore_below_proportion is never read, so it is dropped):
- Ported for Terran. Protoss uses the same logic, minus RestorePower (not ported). Zerg returns false.
- Per type, by priority: techUp first; tech progress of the producer < 0.95 → skip; tracked-but-not-started production → skip; ≥ max structures → skip.
- Bank rule (`_building_production_due_to_bank`): collection rate / (cost + 1) × alpha × proportion.
- `target ≤ 0.15` with a pending producer → skip.
- Income cap: `structures ≥ floor((rateM + rateV) / (cost × 4.5))`.
- Flying production nearby → skip (`flying.getPlans()` with a structure within 19 of base).
- `proportion × 1.2 ≥ target` → skip; can already produce (idle ready, order progress ≥ unitPendingProgress, or build progress in [0.9, 1)) → skip; pending ≥ floor(income / 1000) → skip.
- Otherwise buildStructure(producer, flags ['production']).
- Rates come from `frame.getScore().scoreDetails`.
- Tests: adds a barracks when income supports it and none is idle; doesn't add when an idle rax exists; bank rule; flying rax skip.

## B8. Sample bot + live smoke: examples/behaviors-bot.ts, engine/behaviors.live.test.ts
- Roadmap exit: "a sample bot built only from controllers and behaviors macros and fights without hand-coded per-unit logic". It is a Terran bio bot.
- One macro system runs a `plan(autoSupply, buildWorkers, gasBuildingController, expansionController, upgradeCCs(ORBITAL), upgradeController([STIMPACK, SHIELDWALL, TERRANINFANTRYWEAPONSLEVEL1]), productionController(comp), spawnController(comp))` with comp marine .7 / marauder .2 / medivac .1, and enables mining through `mining.configure({ enabled: true })`.
- One army system:
  - `roles.configure({ defaultRole })` puts combat units into ATTACKING.
  - Per main squad: `canWinFight(squad.units, nearbyEnemies)` ≥ VICTORY_CLOSE → `stutterGroupForward`/`aMove`; else `keepGroupSafe`.
  - Medivacs run `medivacHeal`.
  - Everything goes through `behaviors.run(plan(...), { role: 'ATTACKING' })`.
- Live smoke, skipped without SC2 like create-engine.live.test.ts: vs Easy AI for 8 game minutes. Assert supply ≥ 60, ≥ 2 townhalls, ≥ 1 upgrade done, and that every unit command in commandResults came from a behavior or controller owner.
- Each behavior also gets its fixture test in B1–B7, which satisfies "each behavior has a fixture or live test".
- Perf (A3, roadmap): resources/behaviors.perf.test.ts on the blueshift fixture with 50 marines and 20 enemies. Per step: the influence build plus `plan(shootTargetInRange, stutterUnitBack, pathUnitToTarget)` per marine. Median over 20 runs ≤ 10ms (`performance.now()`).

## B9. Docs (docs-plan.md §2 Phase 5)
- readme.md:
  - New top-level "Behaviors and controllers" after Systems, with a TOC line. It covers:
    - the `behaviors` resource and `run`;
    - `plan` (= CombatManeuver/MacroPlan);
    - one action per unit per step per owner, plus arbitration;
    - roles via `run({ role })`;
    - a table of every behavior and controller with options and defaults;
    - one combat example and one macro example.
  - Macro helpers points to the controllers.
  - Examples lists behaviors-bot.ts.
  - Resources destructure line and TOC: `behaviors`.
  - "Where this library differs from ares-sc2":
    - immediate execution vs ares' after-step;
    - per-owner dedupe;
    - factories instead of dataclasses;
    - one `plan`;
    - no `smoothing`;
    - the siege tank flying-filter fix;
    - spawnController without morphs or ignored tags;
    - buildStructure without to_count_per_base;
    - Zerg placement unsupported.
  - Known limitations: the not-ported behaviors (ghost snipe, reaper grenade, raven auto-turret, AoE use/predictive, transfuse, queen creep/inject, tumor, nydus, restore power, protoss static defence, archon/baneling/ravager morphs).
- docs/api.md: `## Behaviors` (contract, executor, every combat factory), `## Controllers` (every macro factory, ArmyComposition), and `### behaviors` under Resources.
- docs/design.md: one paragraph on behaviors vs systems vs the executor.
- docs/internals.md: Resources list adds `behaviors`.
- docs/changelog.md: `Unreleased › Phase 5: behaviors and macro controllers`, with Added and Migrating bot/ (optional adoption: replace per-unit micro in bot/systems/combat with behaviors under `role: 'ATTACKING'`; the macro plan replaces hand-rolled supply/production; mining must be enabled for controllers to use builders well).

## Order / file ownership
- B0: types.ts, engine/create-world.ts, package.json, resources/behaviors.ts (+test), behaviors/plan.ts, behaviors/index.ts.
  - It is the only phase-5 ticket that touches types.ts, create-world.ts or package.json.
  - Blocked by the phase-4 scaffolding ticket (P4 P0), on shared files and the `flying` registration.
- B1: behaviors/combat/helpers.ts, individual.ts (+tests). Blocked by B0, parity-2 T08 (pathing) and T03 (spatial).
- B2: behaviors/combat/terran.ts (+test). Blocked by B1 and parity-3 T03 (roles).
- B3: behaviors/combat/group.ts (+test). Blocked by B1.
- B4: behaviors/macro/helpers.ts, spawn.ts (+tests). Blocked by B0 and phase-4 P3 (buildings, for `structurePending`).
- B5: behaviors/macro/structures.ts (+test). Blocked by B4 and phase-4 P1 (placement) and P3 (buildings).
- B6: behaviors/macro/tech.ts (+test). Blocked by B5.
- B7: behaviors/macro/production.ts (+test). Blocked by B6 and phase-4 P5 (flying).
- B8: examples/behaviors-bot.ts, engine/behaviors.live.test.ts, resources/behaviors.perf.test.ts.
  - Blocked by B2, B3 and B7, parity-3 T01 (sim), T04 (squads) and T06 (intel), and phase-4 P4 (mining).
- B9: blocked by B0–B8 and the previous docs ticket in the chain (P6a docs per DA3).
- Parallelism:
  - behaviors/index.ts is appended by B1–B7. Each ticket adds only its own export lines, so conflicts are trivial. If the PM wants zero shared files, B0 writes all export lines up front, pointing at stub files.
  - B2, B3, B4 and B5 can run in parallel once their blockers are done.
- Don't touch: bot/, agent/macro.ts, resources/actions.ts, command-arbiter.ts, every phase-2/3/4 resource file.

## Decisions taken (for the team lead's log)
- P5-D1. `behaviors.run` executes immediately in the caller's commander context, not deferred like ares. Owner and priority come from ALS, and cross-owner conflicts are the arbiter's job.
- P5-D2. One action per unit per step per owner, enforced by `ctx.order` dedupe. Together with the arbiter's one owner per tag, that gives ares' one action per unit. A global (cross-owner) dedupe would let a low-priority system block a high-priority one.
- P5-D3. A single `plan()` replaces CombatManeuver and MacroPlan, which have the same semantics in ares.
- P5-D4. Behaviors are factory functions returning `{ name, execute }` objects, with ares option names in camelCase, matching core's functional style.
- P5-D5. `execute` returns `boolean | Promise<boolean>`. Combat behaviors are sync; macro controllers await the agent helpers.
- P5-D6. Behaviors are imported from the `@sc-bot/core/behaviors` subpath (a package.json exports entry), not the root, to keep the root small and avoid the `behaviors` resource name clash.
- P5-D7. Macro controllers build on the existing agent helpers (train/research/alreadyPending/techRequirementProgress) and phase-4 buildings/placement. They reuse tested code, and spend is deducted at proposal time like ares.
- P5-D8. The ported set is Terran-first:
  - Individual: aMove, attackTarget, shootTargetInRange, useAbility, stutter fwd/back, keepUnitSafe, pathUnitToTarget, moveToSafeTarget, shootAndMoveToTarget, workerKiteBack, medivacHeal, pick up/drop cargo, siegeTankDecision.
  - Group: all 6 group behaviors.
  - Macro: spawn, buildWorkers, buildStructure, autoSupply, expansion, gas, upgradeCCs, techUp, upgradeController, productionController.
  - Not ported (documented): ghost snipe, reaper grenade, raven turret, AoE, transfuse, queen/creep/nydus, restore power, protoss static D, zerg/protoss morphs.
- P5-D9. `attackReady` is computed in game loops from `realSpeed()/16`, not from `distanceToWeaponReady()`, which divides by 22.4 on a normal-speed value. Whether core's helper itself is wrong is a separate item.
- P5-D10. siegeTankDecision filters enemies by the enemy's own isFlying. That is a fix: ares tests the tank's type, so flyers are never excluded.
- P5-D11. spawnController validates the composition at creation (throws), not every step.
- P5-D12. ares options without a core counterpart are dropped and documented: `smoothing`, `ignored_build_from_tags`, `to_count_per_base`, `good_positioning`.
- P5-D13. Exit evidence is a Terran bio sample bot plus a live smoke vs Easy AI (skipped without SC2), plus a fixture test per behavior. The perf budget is 50 marines' plans plus the influence build at ≤ 10ms median.

Nothing needs the user.

## Addendum (technical-architect, 2026-10-26): blocker ids
Blocker ids now that parity-4.md is ticketed:
- Phase-4 P0 scaffolding is P4-T04.
- P1 placement is P4-T05.
- P3 buildings is P4-T09.
- P4 mining is P4-T07 (bookkeeping) and P4-T08.
- P5 flying is P4-T10.
- parity-3 sim, roles, squads and intel are P3-T01, T03, T04 and T06.
- parity-2 spatial and pathing are P2-T03 and P2-T08.
The B9 docs ticket goes after P6a's docs ticket in the chain (DA3).

## Addendum (technical-architect, 2026-10-26): attackReady after P3-T08
Once P3-T08 lands, `attackReady` uses `unit.distanceToWeaponReady()` (≥ the gap → ready) instead of its own `realSpeed()/16` math. Add P3-T08 to B1's blockers. P5-D9 now reads: "attackReady uses the fixed distanceToWeaponReady (P3-T08)".
