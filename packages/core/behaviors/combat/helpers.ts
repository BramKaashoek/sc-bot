import { avgPoints, distance, distanceSquared, towards } from '../../utils/geometry/point.ts';
import { isFlying } from '../../resources/units-collection.ts';
import type { InfluenceLayer, Point2D, Unit, World } from '../../types.ts';

export type Target = Point2D | Unit;

export const positionOf = (target: Target): Point2D => ('pos' in target ? target.pos : target);
export const layerFor = (unit: Unit, layer?: InfluenceLayer): InfluenceLayer =>
    layer ?? (isFlying(unit) ? 'air' : 'ground');

export function attackReady(unit: Unit, target: Unit, stepLoops = 4): boolean {
    const canHit = unit.targetInRange(target, Number.POSITIVE_INFINITY);
    if (!canHit) return false;
    if (unit.weaponCooldown! <= stepLoops) return true;
    const range = !isFlying(target) && unit.groundRange() > 0 ? unit.groundRange() : unit.airRange();
    const gap = Math.max(0, distance(unit.pos, target.pos) - unit.radius! - target.radius! - range);
    return gap >= unit.distanceToWeaponReady();
}

export function inAttackRange(unit: Unit, targets: Unit[], extraRange = 0): Unit[] {
    return targets.filter((target) => unit.targetInRange(target, extraRange));
}

export function pickEnemyTarget(targets: Unit[]): Unit | undefined {
    return targets.reduce<Unit | undefined>(
        (best, target) => (!best || target.health! + target.shield! < best.health! + best.shield! ? target : best),
        undefined,
    );
}

const generalAbility = (world: World, abilityId: number) =>
    world.data.getAbilityData(abilityId)?.remapsToAbilityId || abilityId;

const rounded = ({ x, y }: Point2D) => `${Math.round(x)},${Math.round(y)}`;

export function duplicateOrSimilarOrder(
    world: World,
    unit: Unit,
    target: Point2D | Unit,
    abilityId: number,
    distanceSquaredCheck = 2,
): boolean {
    const targetPos = 'pos' in target ? target.pos : target;
    if (distanceSquared(unit.pos, targetPos) < distanceSquaredCheck) return true;

    const [order] = unit.orders ?? [];
    if (!order || (!order.targetUnitTag && !order.targetWorldSpacePos)) return false;
    if (generalAbility(world, order.abilityId!) !== generalAbility(world, abilityId)) return false;
    if (order.targetWorldSpacePos) return rounded(order.targetWorldSpacePos as Point2D) === rounded(targetPos);
    return 'tag' in target && order.targetUnitTag === target.tag;
}

export function groupWeaponsOnCooldown(group: Unit[], stutterForward: boolean): boolean {
    const average = group.reduce((sum, unit) => sum + unit.weaponCooldown!, 0) / group.length;
    if (!(average > 0)) return false;
    return stutterForward ? average > 2.5 : average > 5;
}

export function center(units: Unit[]): Point2D {
    return avgPoints(units.map(({ pos }) => pos));
}

export { towards };
