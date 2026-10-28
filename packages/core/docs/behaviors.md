# Behaviors and controllers

A behavior is a small named object whose `execute(ctx)` orders units and returns whether it acted. They are ares-sc2's combat behaviors and macro behaviors (called controllers here) as factory functions: `stutterUnitBack({ unit, target })`, `spawnController({ composition })`. You compose them in a [`plan`](#plan) and run it every step with the `behaviors` resource, instead of hand-coding per-unit micro and macro rules.

Import the factories from the `@sc-bot/core/behaviors` subpath, not the package root. The types (`Behavior`, `BehaviorContext`, `BehaviorsResource`, `ArmyComposition`) come from `@sc-bot/core` and are defined in `types.ts`:

```ts
// signature sketch
interface Behavior {
    readonly name: string;
    execute(ctx: BehaviorContext): boolean | Promise<boolean>; // true: it acted
}
type BehaviorContext = {
    world: World;
    order(units: Unit | Unit[], abilityId: number, target?: Point2D | Unit, opts?: { queue?: boolean }): boolean;
    hasOrdered(unit: Unit | string): boolean;
};
```

Every factory takes one options object. `Target` below is `Point2D | Unit`. `layer` is an [influence](map.md#influence) layer (`'ground'`, `'air'`, `'groundAvoidance'`, `'airAvoidance'`) or an `InfluenceGrid` from `influence.getCleanGrid()`, and defaults to `'air'` for a flying unit and `'ground'` otherwise. Most combat behaviors are synchronous, but `keepGroupSafe` is asynchronous; controllers are mixed (`spawnController`, `autoSupply`, `techUp`, `upgradeController` and `productionController` are asynchronous, since they await the [macro helpers](macro.md#agent-macro-helpers); `buildWorkers` returns the promise of `spawnController` when it gets that far; `buildStructure`, `expansionController`, `gasBuildingController` and `upgradeCCs` are synchronous). `behaviors.run` always returns a promise, and [`plan`](#plan) handles any mix.

Behaviors that work on a single unit take `unit`, group behaviors take `group: Unit[]` and send one multi-unit order. Where a group behavior "skips a duplicate", it sends no order (and returns `false`) when a sample unit of the group already has a duplicate or similar order, judged by `duplicateOrSimilarOrder` (see [Combat helpers](#combat-helpers)).

## Running a behavior

#### `behaviors.run(behavior: Behavior, opts?: { role?: UnitRole; priority?: number }) => Promise<boolean>`

Runs the behavior now, in the commander context of the caller, and resolves with its result (it rejects when the behavior throws). Commands it proposes are arbitrated and sent at the end of the step like any others (see [Command arbitration](commands.md#command-arbitration)); nothing is deferred until after the step, as it is in ares.

- `run(b)`: owner and priority are the caller's (the agent's handlers, or the system that calls it).
- `run(b, { priority })`: the same owner at that priority, through `actions.as`.
- `run(b, { role })`: as `roles.as(role, ...)`, so the owner is `'role:<ROLE>'`, which an [exclusive role](combat.md#roles) requires. `priority` defaults to the caller's.

**One action per unit per step per owner.** `ctx.order` drops a unit that the same owner already ordered in the same game loop: the second non-queued order is ignored, and `order` returns `false` when no unit is left. `queue: true` orders are always allowed. `ctx.hasOrdered(unit)` tells you whether the owner ordered the unit this loop. Another owner isn't blocked: it can order the same unit, and the arbiter keeps one owner per unit. Inside a [plan](#plan), the first behavior to order a unit wins it. The state is cleared when the game loop changes and with the game.

`ctx.order` proposes one command under the current commander: a `Unit` target gives a target-unit command, a `Point2D` a world-position command.

## plan

#### `plan(...behaviors: Behavior[]) => Behavior`

Runs the behaviors in order and stops at the first one that returns `true`; it returns `false` when none did. It handles synchronous and asynchronous behaviors in any mix (the result is a promise as soon as one behavior returns one), and replaces ares' `CombatManeuver` and `MacroPlan`. Its name is `plan(<names>)`.

## Combat helpers

Plain functions, exported next to the behaviors.

#### `attackReady(unit: Unit, target: Unit, stepLoops = 4) => boolean`

`false` when the unit can't hit the target. `true` when its weapon cooldown is at most `stepLoops` game loops. While cooling down, `true` when the gap between the target and the unit's range (edge to edge, with the ground range for a ground target when the unit has one, else the air range) is at least `unit.distanceToWeaponReady()`: the unit can't be in range before the weapon is ready.

#### `inAttackRange(unit: Unit, targets: Unit[], extraRange = 0) => Unit[]`

The targets the unit can hit from where it stands (`unit.targetInRange(target, extraRange)`).

#### `pickEnemyTarget(targets: Unit[]) => Unit | undefined`

The target with the lowest health plus shield; the first on a tie.

#### `duplicateOrSimilarOrder(world: World, unit: Unit, target: Point2D | Unit, abilityId: number, distanceSquaredCheck = 2) => boolean`

`true` when the unit is within `distanceSquaredCheck` (a squared distance) of the target, or its current order has the same ability (a specific ability counts as its general one) and the same unit target or the same target position rounded to whole cells.

#### `groupWeaponsOnCooldown(group: Unit[], stutterForward: boolean) => boolean`

`true` when the group's average weapon cooldown is above 2.5 (`stutterForward`) or above 5. `false` for an average of 0.

#### `center(units: Unit[]) => Point2D`

The average position of the units.

#### `ownUnitCount(world: World, unitType: number) => number`

Your finished units of a type plus `agent.alreadyPending`.

## Individual combat behaviors

#### `aMove({ unit, target, successAtDistance = 7 }) => Behavior`

`unit: Unit`, `target: Target`. Attack-moves. `false`, with no order, when the unit is already within `successAtDistance` of the target (`0` turns the check off).

#### `attackTarget({ unit, target }) => Behavior`

`unit: Unit`, `target: Target`. Attacks the target and returns `true`.

#### `shootTargetInRange({ unit, targets, extraRange = 0 }) => Behavior`

`targets: Unit[]`. Ignores targets that aren't current (ghosts) and cloaked ones. When a target is in range and the weapon is ready, attacks the one with the lowest health plus shield, or does nothing and returns `true` when the unit is already shooting an in-range target with its weapon ready. `false` when nothing is in range or the weapon won't be ready in time (`attackReady`).

#### `useAbility({ unit, abilityId, target? }) => Behavior`

`target?: Target`. Orders the ability and returns `true` when it is available to the unit (`unit.abilityAvailable`); `false` otherwise.

#### `stutterUnitForward({ unit, target }) => Behavior`

`target: Unit`. Attacks when `attackReady`, otherwise moves to the target. Always `true`.

#### `stutterUnitBack({ unit, target, layer? }) => Behavior`

`target: Unit`. Attacks when `attackReady`; otherwise runs `keepUnitSafe` and returns its result.

#### `keepUnitSafe({ unit, layer? }) => Behavior`

When the unit stands on a dangerous cell and a safe spot exists, paths to the closest safe spot and returns `true`. `false` when it is already safe or no safe spot exists.

#### `pathUnitToTarget({ unit, target, layer?, successAtDistance = 0, sensitivity = 5, senseDanger = true, dangerDistance = 20, dangerThreshold = 5 }) => Behavior`

`target: Point2D`. Moves to `pathing.nextPoint(unit.pos, target, ...)` (the options after `layer` are passed through, see [pathing](map.md#pathing)). `false` when the unit is already within `successAtDistance` of the target.

#### `moveToSafeTarget({ unit, target, layer?, usePathing = true, successAtDistance = 1, radius = 12, ...pathOptions }) => Behavior`

`target: Point2D`; `pathOptions` are the `sensitivity`, `senseDanger`, `dangerDistance` and `dangerThreshold` of `pathUnitToTarget`. Moves to the safe spot closest to the target within `radius` of it, by pathing (or a plain move without `usePathing`). `false` when the unit is within `successAtDistance` of the target or no safe spot exists.

#### `shootAndMoveToTarget({ unit, enemies, target, layer?, distToTarget = 4, attackDestructables = true }) => Behavior`

`enemies: Unit[]`, `target: Point2D`. `shootTargetInRange` on the enemies, then (with `attackDestructables`) on the map's destructables, then `pathUnitToTarget` with `successAtDistance = distToTarget`.

#### `workerKiteBack({ unit, target, shouldAttack = true }) => Behavior`

`target: Unit`. Attacks the target when `shouldAttack`, it is current and `attackReady`. Otherwise gathers: with no ground enemy within 6.5 (larva, eggs, creep tumors, MULEs and changelings don't count), at the mineral field closest to your main; with one, at the field closest to the worker among those nearer to a point 6 from the enemies' centre towards the worker than to the centre, and more than 4 from the worker, falling back to that same field. `false` when there are no mineral fields.

## Terran behaviors

#### `medivacHeal({ unit, allies, layer?, keepSafe = true }) => Behavior`

`allies: Unit[]`. `false` for anything but a medivac. Runs `keepUnitSafe` first (with `keepSafe`) and returns `true` when it acted; `true` when already healing; otherwise heals the closest hurt biological, non-mechanical ally (an SCV is mechanical, so it is ignored). `false` when no ally is hurt.

#### `pickUpCargo({ unit, targets, layer?, switchCargoToRole? }) => Behavior`

`targets: Unit[]`, `switchCargoToRole?: UnitRole`. For a medivac, warp prism or overlord transport (pickup range 5): `SMART`s the closest target when in range, else paths to it. With no targets (or any other unit type) it gives the passengers `switchCargoToRole`, when set, and returns `false`.

#### `dropCargo({ unit }) => Behavior`

Unloads everything at the unit's own position. `false` when the unit carries nothing or is on an unpathable cell.

#### `pickUpAndDropCargo({ unit, targets, target, layer?, switchCargoToRole?, shouldDropUnits = true, keepDropshipSafe = true, successAtDistance = 2 }) => Behavior`

`target: Point2D`. `plan(pickUpCargo, pathUnitToTarget, dropCargo, keepUnitSafe)`, the last two only with their option on.

#### `siegeTankDecision({ unit, closeEnemy, target, staySiegedNearTarget = false, remainSieged = false, forceUnsiege = false }) => Behavior`

`closeEnemy: Unit[]`, `target: Point2D`. `false` for anything but a tank (sieged or not). Flying enemies (by the enemy's own flying state), burrowed ones and changelings are ignored.

- Unsieged: `false` with `forceUnsiege` or an enemy within 6.5. Otherwise sieges (`true`) when a bunker, planetary fortress, spine crawler or cannon is within 13, or it is within 5 of `target` with `staySiegedNearTarget`, or the enemies number more than one and come to at least 4 supply, or one is a tank; else `false`.
- Sieged: unsieges (`true`) with `forceUnsiege`, or when an enemy is within 4 and fewer than two are within 12. Returns `false` with `remainSieged`, within 7 of `target` with `staySiegedNearTarget`, or when the tank is within 10 of the midpoint to `target` and three or more of your other ground units are within 12 of that midpoint, one of them within 8.5 of the tank. In the remaining case it unsieges when no relevant enemy is near (enemy structures count only as bunkers, planetary fortresses, spine crawlers or cannons within about 10.5) and the target is more than about 14 away, and returns `true` either way.

## Group behaviors

Each returns `false` for an empty group.

#### `aMoveGroup({ group, target }) => Behavior`

`target: Target`. Attack-moves the group; skips a duplicate, judged on the unit farthest from the target.

#### `keepGroupSafe({ group, closeEnemy, layer?, attackInRangeEnemy = true }) => Behavior`

`closeEnemy: Unit[]`. Per unit: shoots a target in range (`shootTargetInRange` on `closeEnemy`, with `attackInRangeEnemy`), otherwise `keepUnitSafe`. `true` when any unit moved to safety.

#### `pathGroupToTarget({ start, group, target, layer?, distanceCheckSquared = 26.25, successAtDistance = 0, sensitivity = 12, senseDanger = false, dangerDistance = 20, dangerThreshold = 5, preventDuplicate = true }) => Behavior`

`start: Point2D`, `target: Point2D`. Moves the group to `pathing.nextPoint(start, target, ...)`. `false` when `start` is within `successAtDistance` of the target, or, with `preventDuplicate`, when the unit closest to `start` is within `distanceCheckSquared` (squared) of a similar move.

#### `stutterGroupBack({ group, groupPosition, target, layer? }) => Behavior`

`groupPosition: Point2D`, `target: Target`. `true` for any non-empty group. With an average weapon cooldown of 5 or less it attacks the target (skipping a duplicate). While cooling down it does nothing when every unit is safe; otherwise it moves the group towards the closest safe spot to the best of eight directions away from the target (the one that ends farthest from it, 1.5 per unit of the group from `groupPosition`, clamped to the map and to cells with a finite cost; groups of two or more only), with sensitivity `min(group.length, 8)`, skipping a duplicate.

#### `stutterGroupForward({ group, target, enemies }) => Behavior`

`target: Target`, `enemies: Unit[]` (`groupPosition` is accepted and unused). `false` for no enemies. Attacks the enemies' centre when every unit has an enemy in range or the average weapon cooldown is 2.5 or less, otherwise moves to it; skips a duplicate, judged on the unit closest to the target; `true`.

#### `groupUseAbility({ abilityId, group, target?, syncCommand = true }) => Behavior`

`target?: Target`. Uses the ability with the whole group when every unit has it available (`syncCommand`) or when any unit has; `false` otherwise.

## AoE and spell behaviors

Cast against the abilities in [`constants/aoe`](constants.md#constantsaoe): blinding cloud, corrosive bile, anti-armor missile, EMP, fungal growth, KD8 charge, parasitic bomb, psi storm and nuke.

#### `useAOEAbility({ unit, abilityId, targets, minTargets, avoidOwnFlying = false, avoidOwnGround = false, bonusTags?, recalculate = false, stackSameSpell = false }) => Behavior`

`targets: Unit[]`, `bonusTags?: ReadonlySet<string>` (tags that count double when picking the spot). Casts at the position that covers the most targets (at least `minTargets`, from the 40 nearest), or on the closest target for anti-armor missile and parasitic bomb. `false` when the ability is unavailable or not enough targets are in reach, when a spot would cover your own flying (`avoidOwnFlying`) or ground (`avoidOwnGround`) units other than the caster, or when the spell is already in effect there (an active effect or a target with the buff) unless `stackSameSpell`. While the unit is already casting the ability it returns `true` without ordering again, as long as that cast still passes the checks (`recalculate` re-picks the spot instead). An ability that isn't in `constants/aoe` warns and returns `false`.

#### `autoUseAOEAbility({ unit, targets, bonusTags?, recalculate?, stackSameSpell? }) => Behavior`

Takes the first ability of `constants/aoe` that the unit has available and that has targets within its range, plus the unit's radius and 0.5 (EMP only counts targets with more than 48 shield or energy), and returns `useAOEAbility` for it. `minTargets` is 1 for corrosive bile and KD8 charge, 2 for EMP unless the opponent is Protoss, else 4; KD8 charge and psi storm avoid your own ground units, psi storm also your flying ones. `false` when no ability applies; it doesn't fall through to later abilities.

#### `placePredictiveAoE({ unit, path, enemyCenterUnit, aoeAbility, abilityDelay, reaperGrenadeRange = 5 }) => Behavior`

`path: Point2D[]` (the unit's route). Simulates the unit walking `path` and the enemy chasing it, and casts at the enemy's position `abilityDelay` game loops ahead. `false` for an empty path, an unavailable ability, a spot that isn't visible or one `reaperGrenadeRange` or more from the unit.

#### `reaperGrenade({ unit, enemyUnits, layer?, placePredictive = true, reaperGrenadeRange = 5 }) => Behavior`

Considers the ground enemies that aren't snapshots. With `placePredictive`, when the closest isn't a worker and the reaper faces it, throws at where `placePredictiveAoE` predicts it, along `pathing.findPath` towards it (30 points, `layer`). Otherwise throws through `useAOEAbility` (`minTargets` 2) at the enemies within about 4.5 of the closest one, when it is within `reaperGrenadeRange` plus its radius and at least two are there. `false` when it didn't throw.

#### `ghostSnipe({ unit, closeEnemy }) => Behavior`

`closeEnemy: Unit[]`. Only against Zerg. Snipes the most expensive (minerals plus gas, at least 100) current (not remembered) non-structure within about 11 that isn't on higher ground than the ghost and isn't already the target of another ghost. `false` when none qualifies.

#### `ravenAutoTurret({ unit, allCloseEnemy }) => Behavior`

`allCloseEnemy: Unit[]`. Looks at the non-structure enemies. `false` for one or none. For 3 supply or less it orders nothing and returns whether the raven is already casting. Otherwise drops a turret 3 from the closest enemy towards the raven, when that spot is on the placement grid.

## Controllers

Macro behaviors, built on the agent's [macro helpers](macro.md#agent-macro-helpers), the [`buildings`](macro.md#buildings) tracker and [placement](macro.md#placement). Training, research and morphs (including tech labs and orbital or planetary upgrades) deduct their cost from `agent.minerals` and `agent.vespene` when the command is proposed, so controllers later in the same plan see what is left. A structure build through `buildings` (`buildStructure`, `expansionController`, `gasBuildingController`) spends when the tracker sends the build command. A controller returns `true` when it started something, or, for `autoSupply`, `upgradeCCs` and `upgradeController`, when it is saving up, so the plan stops there. Zerg structure placement isn't supported: `buildStructure` and `productionController` return `false` for Zerg.

```ts
type ArmyComposition = Partial<Record<number, { proportion: number; priority: number }>>;
```

The key is a unit type id. `proportion` is the unit's share of the army (the proportions sum to 1, within 1e-6) and `priority` an integer from 0 to 10 (lower trains first).

#### `spawnController({ composition, freeflow = false, ignoreProportionsBelowUnitCount = 0, overProduceOnLowTech = true, maximum = 20, spawnTarget? }) => Behavior`

Trains toward `composition`. `spawnTarget?: Point2D` is passed to `agent.train` as `closestTo`. Throws `NodeSC2Error` at creation for a proportion sum other than 1 or a priority that isn't an integer from 0 to 10, unless `freeflow` is set.

Each step it goes through the types by priority. For each type that has its tech and an idle producer (a finished structure, powered for Protoss, with a free slot: two with a finished reactor, a tech lab for the units that need one) it skips the type when its share of the composition, units in production included, is already above its proportion, and otherwise trains up to `maximum`, limited by money and supply. When it can't afford a type it stops there, so cheaper types further down don't starve it. `freeflow`, or a total below `ignoreProportionsBelowUnitCount`, ignores the proportions and carries on to the next type instead. With `overProduceOnLowTech`, when only one type has its tech it tops that type up to `maximum`. Once warp gate research is done it returns `false` while a finished gateway is idle, so the gateway can morph. `true` when anything was trained.

#### `buildWorkers({ toCount }) => Behavior`

Trains your race's worker, at most `toCount - agent.supplyWorkers` at once, through a one-type `spawnController`. `false` when you have enough or can't afford one.

#### `buildStructure({ structureType, base?, maxOnRoute = 1, closestTo?, toCount = 0, techProgressCheck = 0.85, flags?, findAlternative = true }) => Behavior`

`base?: Point2D`, `closestTo?: Point2D`, `flags?: PlacementFlag[]`. Requests the structure through `buildings.build` with a placement request (`base`, `closestTo`, `flags`, `findAlternative`); `true` when a build started. `false` for Zerg, at `maxOnRoute` tracked builds of the type moving or ordered, when `toCount` (above 0) is reached by finished plus pending structures, or when the required tech is under `techProgressCheck`.

#### `autoSupply({ base?, closestTo?, returnTrueIfSupplyRequired = true }) => Behavior`

Builds supply by ares' thresholds. Terran and Protoss: when supply left is at most `max(5, 2 * production structures)` and fewer supply structures than half the production structure count (rounded up) are pending, up to 6 at a time; with no production structure, at 2 left and none pending. Terran depots use the `supplyDepot` placement flag. Zerg trains overlords by ares' rules on townhalls, and returns `true` once one is trained whatever the option says. Otherwise returns `returnTrueIfSupplyRequired` whenever supply is required, whether or not it could build; `false` otherwise, and at the 200 supply cap.

#### `expansionController({ toCount, canAffordCheck = true, checkLocationIsSafe = true, maxPending = 1, prioritize = false }) => Behavior`

Builds a townhall at `buildings.getNextExpansion({ checkSafe: checkLocationIsSafe })` (see [macro.md](macro.md#buildings)). `false` when townhalls (finished plus pending) reach `toCount`, `maxPending` are pending, there is no such expansion, or you can't afford one. `prioritize` and `canAffordCheck = false` both skip the affordability check.

#### `gasBuildingController({ toCount, maxPending = 1 }) => Behavior`

Builds gas buildings through `buildings.buildGas` until you have `toCount` (built, plus tracked builds not started). `false` at `toCount`, at `maxPending` pending, or under 35 minerals.

#### `upgradeCCs({ to, prioritize = false }) => Behavior`

`to: ORBITALCOMMAND | PLANETARYFORTRESS`. Morphs the first finished idle command center. `false` with none, or when the required structure (barracks, engineering bay) isn't done; when you can't afford it, returns `prioritize`.

#### `techUp({ desired, base?, ignoreExistingTechlabs = false }) => Behavior`

`desired: { unit: number } | { upgrade: number }`. Does the next missing step towards training the unit or researching the upgrade: builds the producing or researching structure and what it requires through `buildStructure`, adds a tech lab to an idle barracks, factory or starport without an add-on (not while one of that type already has an idle tech lab, or any tech lab of that type exists, both of which `ignoreExistingTechlabs` overrides; and never while another idle one of that type has an add-on of any kind), or morphs a lair or hive. `true` when it started a step.

#### `upgradeController({ upgrades, base?, autoTechUp = true, prioritize = false }) => Behavior`

`upgrades: number[]`. Goes through the list in order, skipping upgrades that are owned or researching. Researches the first it can (`agent.research`), after `techUp` has built the research structure or required building (an armory for level 2 weapons) when `autoTechUp` is on. With `prioritize` and an upgrade it can't afford yet, returns `true` to hold the bank.

#### `productionController({ composition, base, addProductionAtBank = [400, 400], alpha = 0.9, unitPendingProgress = 0.75, maxProductionStructures = 12 }) => Behavior`

`base: Point2D`, `addProductionAtBank: [minerals, gas]`. Adds production structures for the composition. `false` for Zerg. For each type, in priority order, it first runs `techUp` (with `ignoreExistingTechlabs` while the type's share is at or under its proportion, so another tech lab can be added) and returns `true` if that started a step, then adds the producing structure when either rule holds:

- Bank rule: minerals and gas are at or above `addProductionAtBank` and there are fewer producers than the income supports, scaled by `alpha` and the type's proportion.
- Income rule: the type's share is under its proportion divided by 1.2, no producer is idle, nearly done with its order (`unitPendingProgress`) or nearly built, there are fewer producers than the income pays for (rounded down), no producer of a Terran army is in a [flight plan](macro.md#flying) within 19 of `base`, and fewer producers are pending than income / 1000 (rounded down, so below 1000 combined collection income it never builds this way). A type with a proportion of 0.15 or less that already has a producer pending is skipped.

It stops adding at `maxProductionStructures` (counted over all producer types of the unit, a gateway and a warp gate together) and skips a type whose producer's tech is under 95%, or while a producer of the type is still not started (`notStarted(producer) > 0`). Income comes from `frame.getScore()`, which needs `score: true` in the agent's `interface` (the default has it).

## Using behaviors in a bot

A combat step: fight on when the main squad wins, otherwise retreat to safety.

```ts
import { canWinFight } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import { aMoveGroup, keepGroupSafe, plan, stutterGroupForward } from '@sc-bot/core/behaviors';
import { VICTORY_CLOSE } from '@sc-bot/core/constants/engagement-result';
import { ATTACKING } from '@sc-bot/core/constants/unit-role';

export async function onStep({ resources }: World) {
    const { behaviors, map, roles, spatial, squads } = resources.get();
    const group = roles.get(ATTACKING).filter((unit) => unit.isCombatUnit());
    if (group.length === 0) return;

    const position = squads.getMainSquadPosition(ATTACKING);
    const enemies = [...spatial.unitsInRange(position, 14, 'enemyGround')];
    const target = map.getEnemyNatural()!.townhallPosition;

    const winning = enemies.length === 0 || canWinFight(group, enemies) >= VICTORY_CLOSE;
    await behaviors.run(
        winning
            ? plan(stutterGroupForward({ group, target, enemies }), aMoveGroup({ group, target }))
            : keepGroupSafe({ group, closeEnemy: enemies }),
        { role: ATTACKING },
    );
}
```

A macro plan: the first controller that acts (or is saving up) ends the step's plan.

```ts
import { createAgent } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import {
    autoSupply,
    buildWorkers,
    expansionController,
    plan,
    productionController,
    spawnController,
    upgradeCCs,
    upgradeController,
} from '@sc-bot/core/behaviors';
import { Race } from '@sc-bot/core/constants/enums';
import { MARAUDER, MARINE, ORBITALCOMMAND } from '@sc-bot/core/constants/unit-type';
import { STIMPACK } from '@sc-bot/core/constants/upgrade';

const composition = {
    [MARINE]: { proportion: 0.8, priority: 1 },
    [MARAUDER]: { proportion: 0.2, priority: 0 },
};

export const bot = createAgent({
    settings: { race: Race.TERRAN },
    async onStep({ resources }: World) {
        const { behaviors, map } = resources.get();
        const base = map.getMain()!.townhallPosition;
        await behaviors.run(
            plan(
                autoSupply({ base }),
                buildWorkers({ toCount: 44 }),
                expansionController({ toCount: 3 }),
                upgradeCCs({ to: ORBITALCOMMAND }),
                upgradeController({ upgrades: [STIMPACK], base }),
                productionController({ composition, base }),
                spawnController({ composition }),
            ),
        );
    },
});
```

The macro plan runs as the agent's own commander. Controllers that build go through `buildings`, whose commands are proposed as the `BUILDING` role. [`examples/behaviors-bot.ts`](../examples/behaviors-bot.ts) is a complete Terran bio bot made only of controllers and behaviors.
