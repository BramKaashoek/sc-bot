import { ATTACK, MOVE } from '../../constants/ability.ts';
import { distanceSquared, toPoint } from '../../utils/geometry/point.ts';
import { isFlying } from '../../utils/geometry/units.ts';
import {
    center,
    duplicateOrSimilarOrder,
    groupWeaponsOnCooldown,
    inAttackRange,
    layerFor,
    type Target,
} from './helpers.ts';
import { keepUnitSafe, shootTargetInRange } from './individual.ts';
import type { Behavior, InfluenceGrid, InfluenceLayer, Point2D, Unit, World } from '../../types.ts';

const DIRECTIONS: Point2D[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
];

const byDistanceTo = (group: Unit[], point: Point2D, farthest: boolean) =>
    group.reduce((best, unit) => {
        const closer = distanceSquared(unit.pos, point) < distanceSquared(best.pos, point);
        return closer === farthest ? best : unit;
    });

function retreatPoint(
    world: World,
    group: Unit[],
    groupPosition: Point2D,
    target: Point2D,
    layer: InfluenceLayer | InfluenceGrid,
) {
    const grid = typeof layer === 'string' ? world.resources.get().influence.getGrid(layer) : layer;
    const length = group.length * 1.5;
    let best = groupPosition;
    let bestDistance = 0;
    for (const direction of DIRECTIONS) {
        const candidate = {
            x: Math.max(0, Math.min(grid.width - 1, groupPosition.x + direction.x * length)),
            y: Math.max(0, Math.min(grid.height - 1, groupPosition.y + direction.y * length)),
        };
        if (!Number.isFinite(grid.get(candidate))) continue;
        const distance = distanceSquared(candidate, target);
        if (distance > bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }
    return best;
}

export function aMoveGroup({ group, target }: { group: Unit[]; target: Target }): Behavior {
    return {
        name: 'aMoveGroup',
        execute(ctx) {
            if (group.length === 0) return false;
            const farthest = byDistanceTo(group, toPoint(target), true);
            if (duplicateOrSimilarOrder(ctx.world, farthest, target, ATTACK)) return false;
            return ctx.order(group, ATTACK, target);
        },
    };
}

export function keepGroupSafe({
    group,
    closeEnemy,
    layer,
    attackInRangeEnemy = true,
}: {
    group: Unit[];
    closeEnemy: Unit[];
    layer?: InfluenceLayer | InfluenceGrid;
    attackInRangeEnemy?: boolean;
}): Behavior {
    return {
        name: 'keepGroupSafe',
        async execute(ctx) {
            let moved = false;
            for (const unit of group) {
                if (attackInRangeEnemy && (await shootTargetInRange({ unit, targets: closeEnemy }).execute(ctx))) {
                    continue;
                }
                if (await keepUnitSafe({ unit, layer }).execute(ctx)) moved = true;
            }
            return moved;
        },
    };
}

export function pathGroupToTarget({
    start,
    group,
    target,
    layer,
    distanceCheckSquared = 26.25,
    successAtDistance = 0,
    sensitivity = 12,
    smoothing = false,
    senseDanger = false,
    dangerDistance = 20,
    dangerThreshold = 5,
    preventDuplicate = true,
}: {
    start: Point2D;
    group: Unit[];
    target: Point2D;
    layer?: InfluenceLayer | InfluenceGrid;
    distanceCheckSquared?: number;
    successAtDistance?: number;
    sensitivity?: number;
    smoothing?: boolean;
    senseDanger?: boolean;
    dangerDistance?: number;
    dangerThreshold?: number;
    preventDuplicate?: boolean;
}): Behavior {
    return {
        name: 'pathGroupToTarget',
        execute(ctx) {
            if (group.length === 0) return false;
            if (distanceSquared(start, target) < successAtDistance ** 2) return false;
            const next = ctx.world.resources.get().pathing.nextPoint(start, target, {
                layer: layerFor(group[0], layer),
                sensitivity,
                smoothing,
                senseDanger,
                dangerDistance,
                dangerThreshold,
            });
            if (preventDuplicate) {
                const closest = byDistanceTo(group, start, false);
                if (duplicateOrSimilarOrder(ctx.world, closest, next, MOVE, distanceCheckSquared)) return false;
            }
            return ctx.order(group, MOVE, next);
        },
    };
}

export function stutterGroupBack({
    group,
    groupPosition,
    target,
    layer,
}: {
    group: Unit[];
    groupPosition: Point2D;
    target: Target;
    layer?: InfluenceLayer | InfluenceGrid;
}): Behavior {
    return {
        name: 'stutterGroupBack',
        execute(ctx) {
            if (group.length === 0) return false;
            const { pathing } = ctx.world.resources.get();
            const grid = layerFor(group[0], layer);
            const targetPosition = toPoint(target);
            const sample = byDistanceTo(group, targetPosition, true);

            if (!groupWeaponsOnCooldown(group, false)) {
                if (!duplicateOrSimilarOrder(ctx.world, sample, target, ATTACK)) {
                    ctx.order(group, ATTACK, targetPosition);
                }
                return true;
            }
            if (group.every((unit) => pathing.isPositionSafe(unit.pos, { layer: grid }))) return true;

            const from =
                group.length > 1 ? retreatPoint(ctx.world, group, groupPosition, targetPosition, grid) : groupPosition;
            const safeSpot = pathing.closestSafeSpot(from, { layer: grid });
            if (!safeSpot) return true;
            const next = pathing.nextPoint(groupPosition, safeSpot, {
                layer: grid,
                sensitivity: Math.min(group.length, 8),
            });
            if (!duplicateOrSimilarOrder(ctx.world, sample, next, MOVE)) ctx.order(group, MOVE, next);
            return true;
        },
    };
}

export function stutterGroupForward({
    group,
    target,
    enemies,
}: {
    group: Unit[];
    groupPosition?: Point2D;
    target: Target;
    enemies: Unit[];
}): Behavior {
    return {
        name: 'stutterGroupForward',
        execute(ctx) {
            if (group.length === 0 || enemies.length === 0) return false;
            const sample = byDistanceTo(group, toPoint(target), false);
            const enemyCenter = center(enemies);
            const allInRange = group.every((unit) => inAttackRange(unit, enemies).length > 0);
            const ability = !allInRange && groupWeaponsOnCooldown(group, true) ? MOVE : ATTACK;
            if (!duplicateOrSimilarOrder(ctx.world, sample, enemyCenter, ability)) {
                ctx.order(group, ability, enemyCenter);
            }
            return true;
        },
    };
}

export function groupUseAbility({
    abilityId,
    group,
    target,
    syncCommand = true,
}: {
    abilityId: number;
    group: Unit[];
    target?: Target;
    syncCommand?: boolean;
}): Behavior {
    return {
        name: 'groupUseAbility',
        execute(ctx) {
            if (group.length === 0) return false;
            const has = (unit: Unit) => unit.abilityAvailable(abilityId);
            if (!(syncCommand ? group.every(has) : group.some(has))) return false;
            return ctx.order(group, abilityId, target);
        },
    };
}
