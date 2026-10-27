import { ATTACK, HARVEST_GATHER, MOVE } from '../../constants/ability.ts';
import { CloakState } from '../../constants/enums.ts';
import * as UnitType from '../../constants/unit-type.ts';
import { isFlying } from '../../resources/units-collection.ts';
import { distance, distanceSquared } from '../../utils/geometry/point.ts';
import { attackReady, center, inAttackRange, pickEnemyTarget, towards } from './helpers.ts';
import type { Behavior, InfluenceLayer, Point2D, Unit } from '../../types.ts';

type Target = Point2D | Unit;

type PathOptions = {
    layer?: InfluenceLayer;
    sensitivity?: number;
    senseDanger?: boolean;
    dangerDistance?: number;
    dangerThreshold?: number;
};

const positionOf = (target: Target): Point2D => ('pos' in target ? target.pos : target);
const layerFor = (unit: Unit, layer?: InfluenceLayer): InfluenceLayer => layer ?? (isFlying(unit) ? 'air' : 'ground');

const KITE_IGNORED_TYPES = [
    UnitType.EGG,
    UnitType.LARVA,
    UnitType.CREEPTUMOR,
    UnitType.CREEPTUMORBURROWED,
    UnitType.CREEPTUMORQUEEN,
    UnitType.MULE,
    UnitType.CHANGELING,
    UnitType.CHANGELINGMARINE,
    UnitType.CHANGELINGMARINESHIELD,
    UnitType.CHANGELINGZEALOT,
    UnitType.CHANGELINGZERGLING,
    UnitType.CHANGELINGZERGLINGWINGS,
];

export function aMove({
    unit,
    target,
    successAtDistance = 7,
}: {
    unit: Unit;
    target: Target;
    successAtDistance?: number;
}): Behavior {
    return {
        name: 'aMove',
        execute(ctx) {
            if (successAtDistance > 0 && distance(unit.pos, positionOf(target)) < successAtDistance) return false;
            ctx.order(unit, ATTACK, target);
            return true;
        },
    };
}

export function attackTarget({ unit, target }: { unit: Unit; target: Target }): Behavior {
    return {
        name: 'attackTarget',
        execute(ctx) {
            ctx.order(unit, ATTACK, target);
            return true;
        },
    };
}

export function shootTargetInRange({
    unit,
    targets,
    extraRange = 0,
}: {
    unit: Unit;
    targets: Unit[];
    extraRange?: number;
}): Behavior {
    return {
        name: 'shootTargetInRange',
        execute(ctx) {
            const visible = targets.filter((target) => target.isCurrent() && target.cloak !== CloakState.CLOAKED);
            const inRange = inAttackRange(unit, visible, extraRange);
            if (inRange.length === 0) return false;

            const orderTarget = unit.orders?.[0]?.targetUnitTag;
            if (orderTarget && unit.weaponCooldown === 0 && inRange.some(({ tag }) => tag === orderTarget)) return true;

            const target = pickEnemyTarget(inRange)!;
            if (!attackReady(unit, target)) return false;
            ctx.order(unit, ATTACK, target);
            return true;
        },
    };
}

export function useAbility({ unit, abilityId, target }: { unit: Unit; abilityId: number; target?: Target }): Behavior {
    return {
        name: 'useAbility',
        execute(ctx) {
            if (!unit.abilityAvailable(abilityId)) return false;
            ctx.order(unit, abilityId, target);
            return true;
        },
    };
}

export function stutterUnitForward({ unit, target }: { unit: Unit; target: Unit }): Behavior {
    return {
        name: 'stutterUnitForward',
        execute(ctx) {
            if (attackReady(unit, target)) return attackTarget({ unit, target }).execute(ctx);
            ctx.order(unit, MOVE, target.pos);
            return true;
        },
    };
}

export function stutterUnitBack({
    unit,
    target,
    layer,
}: {
    unit: Unit;
    target: Unit;
    layer?: InfluenceLayer;
}): Behavior {
    return {
        name: 'stutterUnitBack',
        execute(ctx) {
            if (attackReady(unit, target)) return attackTarget({ unit, target }).execute(ctx);
            return keepUnitSafe({ unit, layer }).execute(ctx);
        },
    };
}

export function pathUnitToTarget({
    unit,
    target,
    layer,
    successAtDistance = 0,
    sensitivity = 5,
    senseDanger = true,
    dangerDistance = 20,
    dangerThreshold = 5,
}: PathOptions & { unit: Unit; target: Point2D; successAtDistance?: number }): Behavior {
    return {
        name: 'pathUnitToTarget',
        execute(ctx) {
            if (distance(unit.pos, target) < successAtDistance) return false;
            const next = ctx.world.resources.get().pathing.nextPoint(unit.pos, target, {
                layer: layerFor(unit, layer),
                sensitivity,
                senseDanger,
                dangerDistance,
                dangerThreshold,
            });
            ctx.order(unit, MOVE, next);
            return true;
        },
    };
}

export function keepUnitSafe({ unit, layer }: { unit: Unit; layer?: InfluenceLayer }): Behavior {
    return {
        name: 'keepUnitSafe',
        execute(ctx) {
            const { pathing } = ctx.world.resources.get();
            const grid = layerFor(unit, layer);
            if (pathing.isPositionSafe(unit.pos, { layer: grid })) return false;
            const safeSpot = pathing.closestSafeSpot(unit.pos, { layer: grid });
            if (!safeSpot) return false;
            return pathUnitToTarget({ unit, target: safeSpot, layer: grid, successAtDistance: 0 }).execute(ctx);
        },
    };
}

export function moveToSafeTarget({
    unit,
    target,
    layer,
    usePathing = true,
    successAtDistance = 1,
    radius = 12,
    ...path
}: PathOptions & {
    unit: Unit;
    target: Point2D;
    usePathing?: boolean;
    successAtDistance?: number;
    radius?: number;
}): Behavior {
    return {
        name: 'moveToSafeTarget',
        execute(ctx) {
            if (distance(unit.pos, target) <= successAtDistance) return false;
            const grid = layerFor(unit, layer);
            const safeSpot = ctx.world.resources.get().pathing.closestSafeSpot(target, { layer: grid, radius });
            if (!safeSpot) return false;
            if (!usePathing) return useAbility({ unit, abilityId: MOVE, target: safeSpot }).execute(ctx);
            return pathUnitToTarget({ ...path, unit, target: safeSpot, layer: grid, successAtDistance }).execute(ctx);
        },
    };
}

export function shootAndMoveToTarget({
    unit,
    enemies,
    target,
    layer,
    distToTarget = 4,
    attackDestructables = true,
}: {
    unit: Unit;
    enemies: Unit[];
    target: Point2D;
    layer?: InfluenceLayer;
    distToTarget?: number;
    attackDestructables?: boolean;
}): Behavior {
    return {
        name: 'shootAndMoveToTarget',
        execute(ctx) {
            if (shootTargetInRange({ unit, targets: enemies }).execute(ctx)) return true;
            if (
                attackDestructables &&
                shootTargetInRange({ unit, targets: ctx.world.resources.get().units.getDestructables() }).execute(ctx)
            ) {
                return true;
            }
            return pathUnitToTarget({ unit, target, layer, successAtDistance: distToTarget }).execute(ctx);
        },
    };
}

export function workerKiteBack({
    unit,
    target,
    shouldAttack = true,
}: {
    unit: Unit;
    target: Unit;
    shouldAttack?: boolean;
}): Behavior {
    return {
        name: 'workerKiteBack',
        execute(ctx) {
            if (shouldAttack && target.isCurrent() && attackReady(unit, target)) {
                return attackTarget({ unit, target }).execute(ctx);
            }
            const { units, spatial, map } = ctx.world.resources.get();
            const minerals = units.getMineralFields();
            if (minerals.length === 0) return false;

            const start = map.getMain().townhallPosition;
            const enemies = spatial
                .unitsInRange(unit, 6.5, 'enemyGround')
                .filter(({ unitType }) => !KITE_IGNORED_TYPES.includes(unitType));
            if (enemies.length === 0) {
                ctx.order(unit, HARVEST_GATHER, minerals.closestTo(start));
                return true;
            }

            const enemyCenter = center(enemies);
            const behind = towards(enemyCenter, unit.pos, 6);
            const escapes = minerals.filter(
                ({ pos }) =>
                    distanceSquared(pos, behind) < distanceSquared(pos, enemyCenter) &&
                    distanceSquared(pos, unit.pos) > 16,
            );
            ctx.order(
                unit,
                HARVEST_GATHER,
                escapes.length > 0 ? escapes.closestTo(unit.pos) : minerals.closestTo(start),
            );
            return true;
        },
    };
}
