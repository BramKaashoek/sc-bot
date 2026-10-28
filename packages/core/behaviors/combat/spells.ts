import { EFFECT_AUTOTURRET, EFFECT_GHOSTSNIPE, EFFECT_KD8CHARGE } from '../../constants/ability.ts';
import { Race } from '../../constants/enums.ts';
import { GHOST } from '../../constants/unit-type.ts';
import { isFlying } from '../../utils/geometry/units.ts';
import { distance, distanceSquared, towards } from '../../utils/geometry/point.ts';
import { totalSupply } from '../../utils/units/supply.ts';
import { useAOEAbility } from './aoe.ts';
import { layerFor } from './helpers.ts';
import type { Behavior, InfluenceGrid, InfluenceLayer, Point2D, Unit, World } from '../../types.ts';

const GAME_STEPS_PER_SECOND = 22.4;
const SIMULATION_STEPS = 100;
const GRENADE_DELAY_LOOPS = 34;
const GRENADE_PATH_POINTS = 30;
const GHOST_SNIPE_RANGE_SQUARED = 125;
const SNIPE_MIN_VALUE = 100;

const distancePerStep = (unit: Unit, world: World) =>
    (unit.realSpeed() / GAME_STEPS_PER_SECOND) * world.config.gameStep;

function nextPosition(
    from: Point2D,
    to: Point2D,
    step: number,
    next?: Point2D,
): { pos: Point2D; reachedTarget: boolean } {
    const toTarget = distance(from, to);
    if (toTarget >= step) return { pos: towards(from, to, step), reachedTarget: false };
    if (!next) return { pos: to, reachedTarget: true };
    return { pos: towards(to, next, step - toTarget), reachedTarget: true };
}

function ownPathByStep(path: Point2D[], step: number): Point2D[] {
    const real = [path[0]];
    let targetIndex = 1;
    for (let i = 0; i < SIMULATION_STEPS && targetIndex < path.length; i++) {
        const { pos, reachedTarget } = nextPosition(real.at(-1)!, path[targetIndex], step, path[targetIndex + 1]);
        real.push(pos);
        if (reachedTarget) targetIndex++;
    }
    return real;
}

function chasingPath(targetPath: Point2D[], start: Point2D, step: number): Point2D[] {
    const chase = [start];
    let targetIndex = 0;
    for (let i = 0; i < SIMULATION_STEPS; i++) {
        const { pos, reachedTarget } = nextPosition(chase.at(-1)!, targetPath[targetIndex], step);
        chase.push(pos);
        targetIndex = Math.min(targetPath.length - 1, targetIndex + 1);
        if (reachedTarget) break;
    }
    return chase;
}

export function placePredictiveAoE({
    unit,
    path,
    enemyCenterUnit,
    aoeAbility,
    abilityDelay,
    reaperGrenadeRange = 5,
}: {
    unit: Unit;
    path: Point2D[];
    enemyCenterUnit: Unit;
    aoeAbility: number;
    abilityDelay: number;
    reaperGrenadeRange?: number;
}): Behavior {
    return {
        name: 'placePredictiveAoE',
        execute(ctx) {
            if (path.length === 0 || !unit.abilityAvailable(aoeAbility)) return false;

            const own = ownPathByStep(path, distancePerStep(unit, ctx.world));
            const chase = chasingPath(own, enemyCenterUnit.pos, distancePerStep(enemyCenterUnit, ctx.world));
            const delayedIndex = Math.ceil(abilityDelay / ctx.world.config.gameStep);
            const position = chase[Math.min(delayedIndex, chase.length - 1)];

            if (
                !ctx.world.resources.get().map.isVisible(position) ||
                distance(position, unit.pos) >= reaperGrenadeRange
            )
                return false;
            return ctx.order(unit, aoeAbility, position);
        },
    };
}

export function reaperGrenade({
    unit,
    enemyUnits,
    layer,
    placePredictive = true,
    reaperGrenadeRange = 5,
}: {
    unit: Unit;
    enemyUnits: Unit[];
    layer?: InfluenceLayer | InfluenceGrid;
    placePredictive?: boolean;
    reaperGrenadeRange?: number;
}): Behavior {
    return {
        name: 'reaperGrenade',
        execute(ctx) {
            if (enemyUnits.length === 0 || !unit.abilityAvailable(EFFECT_KD8CHARGE)) return false;

            const targets = enemyUnits.filter((enemy) => !enemy.isSnapshot() && !isFlying(enemy));
            if (targets.length === 0) return false;
            const closest = targets.reduce((best, enemy) =>
                distanceSquared(enemy.pos, unit.pos) < distanceSquared(best.pos, unit.pos) ? enemy : best,
            );

            if (placePredictive && !closest.isWorker() && unit.isFacing(closest, 0.1)) {
                const path = ctx.world.resources
                    .get()
                    .pathing.findPath(unit.pos, closest.pos, { layer: layerFor(unit, layer), sensitivity: 1 });
                if (
                    path.length > 0 &&
                    placePredictiveAoE({
                        unit,
                        path: path.slice(0, GRENADE_PATH_POINTS),
                        enemyCenterUnit: closest,
                        aoeAbility: EFFECT_KD8CHARGE,
                        abilityDelay: GRENADE_DELAY_LOOPS,
                        reaperGrenadeRange,
                    }).execute(ctx)
                )
                    return true;
            }

            const closeTargets = enemyUnits.filter((enemy) => distanceSquared(enemy.pos, closest.pos) < 20);
            if (
                distance(closest.pos, unit.pos) >= reaperGrenadeRange + (closest.radius ?? 0) ||
                closeTargets.length < 2
            )
                return false;
            return useAOEAbility({
                unit,
                abilityId: EFFECT_KD8CHARGE,
                targets: closeTargets,
                minTargets: 2,
            }).execute(ctx);
        },
    };
}

export function ghostSnipe({ unit, closeEnemy }: { unit: Unit; closeEnemy: Unit[] }): Behavior {
    return {
        name: 'ghostSnipe',
        execute(ctx) {
            const { agent, resources } = ctx.world;
            if (
                agent.opponent?.race !== Race.ZERG ||
                closeEnemy.length === 0 ||
                unit.unitType !== GHOST ||
                !unit.abilityAvailable(EFFECT_GHOSTSNIPE)
            )
                return false;

            const { map, units } = resources.get();
            const sniped = new Set(units.getById(GHOST).flatMap((ghost) => ghost.orders?.[0]?.targetUnitTag ?? []));
            const ownHeight = map.getTerrainHeight(unit.pos);

            let target: Unit | undefined;
            let best = 0;
            for (const enemy of closeEnemy) {
                if (
                    enemy.isMemory() ||
                    enemy.isStructure() ||
                    distanceSquared(unit.pos, enemy.pos) > GHOST_SNIPE_RANGE_SQUARED ||
                    map.getTerrainHeight(enemy.pos) > ownHeight ||
                    sniped.has(enemy.tag)
                )
                    continue;
                const { mineralCost = 0, vespeneCost = 0 } = enemy.data();
                const value = mineralCost + vespeneCost;
                if (value >= SNIPE_MIN_VALUE && value > best) {
                    best = value;
                    target = enemy;
                }
            }
            if (!target) return false;
            return ctx.order(unit, EFFECT_GHOSTSNIPE, target);
        },
    };
}

export function ravenAutoTurret({ unit, allCloseEnemy }: { unit: Unit; allCloseEnemy: Unit[] }): Behavior {
    return {
        name: 'ravenAutoTurret',
        execute(ctx) {
            if (!unit.abilityAvailable(EFFECT_AUTOTURRET)) return false;

            const enemies = allCloseEnemy.filter((enemy) => !enemy.isStructure());
            if (enemies.length <= 1) return false;
            if (totalSupply(enemies) <= 3) return unit.isUsingAbility(EFFECT_AUTOTURRET);

            const closest = enemies.reduce((best, enemy) =>
                distanceSquared(enemy.pos, unit.pos) < distanceSquared(best.pos, unit.pos) ? enemy : best,
            );
            const target = towards(closest.pos, unit.pos, 3);
            if (!ctx.world.resources.get().map.inPlacementGrid(target)) return false;
            return ctx.order(unit, EFFECT_AUTOTURRET, target);
        },
    };
}
