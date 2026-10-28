import { EFFECT_HEAL, MORPH_SIEGEMODE, MORPH_UNSIEGE, SMART, UNLOADALLAT } from '../../constants/ability.ts';
import * as UnitType from '../../constants/unit-type.ts';
import { Units } from '../../resources/units-collection.ts';
import { CHANGELINGS } from '../../utils/combat/changelings.ts';
import { distance, distanceSquared } from '../../utils/geometry/point.ts';
import { isFlying } from '../../utils/geometry/units.ts';
import { totalSupply } from '../../utils/units/supply.ts';
import { keepUnitSafe, pathUnitToTarget } from './individual.ts';
import { plan } from '../plan.ts';
import type { Behavior, InfluenceGrid, InfluenceLayer, Point2D, Unit, UnitRole } from '../../types.ts';

const PICKUP_RANGE: Record<number, number> = {
    [UnitType.MEDIVAC]: 5,
    [UnitType.WARPPRISM]: 5,
    [UnitType.OVERLORDTRANSPORT]: 5,
};

const STATIC_DEFENCE = [UnitType.BUNKER, UnitType.PLANETARYFORTRESS, UnitType.SPINECRAWLER, UnitType.PHOTONCANNON];
const TANKS = [UnitType.SIEGETANK, UnitType.SIEGETANKSIEGED];

export function medivacHeal({
    unit,
    allies,
    layer,
    keepSafe = true,
}: {
    unit: Unit;
    allies: Unit[];
    layer?: InfluenceLayer | InfluenceGrid;
    keepSafe?: boolean;
}): Behavior {
    return {
        name: 'medivacHeal',
        execute(ctx) {
            if (unit.unitType !== UnitType.MEDIVAC) return false;
            if (keepSafe && keepUnitSafe({ unit, layer }).execute(ctx)) return true;
            if (unit.isUsingAbility(EFFECT_HEAL)) return true;

            const hurt = allies.filter(
                (ally) => ally.isBiological() && !ally.isMechanical() && ally.health! < ally.healthMax!,
            );
            if (hurt.length === 0) return false;
            ctx.order(unit, EFFECT_HEAL, Units.from(hurt).closestTo(unit));
            return true;
        },
    };
}

export function pickUpCargo({
    unit,
    targets,
    layer,
    switchCargoToRole,
}: {
    unit: Unit;
    targets: Unit[];
    layer?: InfluenceLayer | InfluenceGrid;
    switchCargoToRole?: UnitRole;
}): Behavior {
    return {
        name: 'pickUpCargo',
        execute(ctx) {
            const range = PICKUP_RANGE[unit.unitType!];
            const target = Units.from(targets).closestTo(unit);
            if (!target || range === undefined) {
                const passengers = (unit.passengers ?? []).map(({ tag }) => tag!);
                if (passengers.length > 0 && switchCargoToRole) {
                    ctx.world.resources.get().roles.assign(passengers, switchCargoToRole);
                }
                return false;
            }

            if (distance(unit.pos, target.pos) <= range) {
                ctx.order(unit, SMART, target);
                return true;
            }
            return pathUnitToTarget({ unit, target: target.pos, layer }).execute(ctx);
        },
    };
}

export function dropCargo({ unit }: { unit: Unit }): Behavior {
    return {
        name: 'dropCargo',
        execute(ctx) {
            if (!unit.cargoSpaceTaken || !ctx.world.resources.get().map.isPathable(unit.pos)) return false;
            ctx.order(unit, UNLOADALLAT, unit);
            return true;
        },
    };
}

export function pickUpAndDropCargo({
    unit,
    targets,
    target,
    layer,
    switchCargoToRole,
    shouldDropUnits = true,
    keepDropshipSafe = true,
    successAtDistance = 2,
}: {
    unit: Unit;
    targets: Unit[];
    target: Point2D;
    layer?: InfluenceLayer | InfluenceGrid;
    switchCargoToRole?: UnitRole;
    shouldDropUnits?: boolean;
    keepDropshipSafe?: boolean;
    successAtDistance?: number;
}): Behavior {
    return {
        name: 'pickUpAndDropCargo',
        execute(ctx) {
            return plan(
                pickUpCargo({ unit, targets, layer, switchCargoToRole }),
                pathUnitToTarget({ unit, target, layer, successAtDistance }),
                ...(shouldDropUnits ? [dropCargo({ unit })] : []),
                ...(keepDropshipSafe ? [keepUnitSafe({ unit, layer })] : []),
            ).execute(ctx);
        },
    };
}

export function siegeTankDecision({
    unit,
    closeEnemy,
    target,
    staySiegedNearTarget = false,
    remainSieged = false,
    forceUnsiege = false,
}: {
    unit: Unit;
    closeEnemy: Unit[];
    target: Point2D;
    staySiegedNearTarget?: boolean;
    remainSieged?: boolean;
    forceUnsiege?: boolean;
}): Behavior {
    const within = (units: Unit[], limit: number) =>
        units.filter(({ pos }) => distanceSquared(pos, unit.pos) < limit * limit);

    return {
        name: 'siegeTankDecision',
        execute(ctx) {
            if (!TANKS.includes(unit.unitType!)) return false;
            const enemies = closeEnemy.filter(
                (enemy) => !isFlying(enemy) && !enemy.isBurrowed && !CHANGELINGS.has(enemy.unitType!),
            );
            const nearTarget = (limit: number) => distanceSquared(unit.pos, target) < limit * limit;
            const farFromTarget = distanceSquared(unit.pos, target) > 200;

            if (unit.unitType === UnitType.SIEGETANK) {
                if (forceUnsiege || within(enemies, 6.5).length > 0) return false;
                const supply = totalSupply(enemies);
                if (
                    within(enemies, 13).some(({ unitType }) => STATIC_DEFENCE.includes(unitType!)) ||
                    (staySiegedNearTarget && nearTarget(5)) ||
                    (supply >= 4 && enemies.length > 1) ||
                    enemies.some(({ unitType }) => TANKS.includes(unitType!))
                ) {
                    ctx.order(unit, MORPH_SIEGEMODE);
                    return true;
                }
                return false;
            }

            if (forceUnsiege || (within(enemies, 4).length > 0 && within(enemies, 12).length < 2)) {
                ctx.order(unit, MORPH_UNSIEGE);
                return true;
            }
            if (remainSieged || (staySiegedNearTarget && nearTarget(7))) return false;

            const mid = { x: (unit.pos.x + target.x) / 2, y: (unit.pos.y + target.y) / 2 };
            if (distanceSquared(unit.pos, mid) <= 100) {
                const ahead = [...ctx.world.resources.get().spatial.unitsInRange(mid, 12, 'ownGround')].filter(
                    ({ tag }) => tag !== unit.tag,
                );
                if (ahead.length >= 3 && within(ahead, 8.5).length > 0) return false;
            }

            const relevant = enemies.filter(
                (enemy) =>
                    !enemy.isStructure() ||
                    (STATIC_DEFENCE.includes(enemy.unitType!) && distanceSquared(enemy.pos, unit.pos) < 110),
            );
            if (relevant.length === 0 && farFromTarget) ctx.order(unit, MORPH_UNSIEGE);
            return true;
        },
    };
}
