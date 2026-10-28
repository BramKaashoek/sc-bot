import * as BuildTargets from '../../constants/build-target.ts';
import { Alliance } from '../../constants/enums.ts';
import { gasMineTypes, townhallTypes } from '../../constants/groups.ts';
import { distance, towards } from '../geometry/point.ts';
import type { BuildTarget, Expansion, PlacementFlag, PlacementRequest, Point2D, World } from '../../types.ts';

const OWN_BASE_INDEX: Partial<Record<BuildTarget, number>> = {
    [BuildTargets.SPAWN]: 0,
    [BuildTargets.NAT]: 1,
    [BuildTargets.THIRD]: 2,
    [BuildTargets.FOURTH]: 3,
    [BuildTargets.FIFTH]: 4,
    [BuildTargets.SIXTH]: 5,
};

const ENEMY_BASE_INDEX: Partial<Record<BuildTarget, number>> = {
    [BuildTargets.ENEMY_SPAWN]: 0,
    [BuildTargets.ENEMY_NAT]: 1,
    [BuildTargets.ENEMY_THIRD]: 2,
    [BuildTargets.ENEMY_FOURTH]: 3,
};

const FLAG_TARGETS: Partial<Record<BuildTarget, PlacementFlag>> = {
    [BuildTargets.REAPER_WALL]: 'reaperWall',
    [BuildTargets.SUPPLY]: 'supplyDepot',
    [BuildTargets.PRODUCTION]: 'production',
    [BuildTargets.UPGRADE]: 'upgradeStructure',
    [BuildTargets.BUNKER]: 'bunker',
};

const PROXY_TARGETS: BuildTarget[] = [
    BuildTargets.ENEMY_SPAWN,
    BuildTargets.ENEMY_NAT,
    BuildTargets.ENEMY_THIRD,
    BuildTargets.ENEMY_FOURTH,
    BuildTargets.ENEMY_RAMP,
    BuildTargets.ENEMY_NAT_VISION,
    BuildTargets.MAP_CENTER,
];

const RAMP_ENEMY_DISTANCE = 10;
const ENEMY_NAT_VISION_DISTANCE = 10;
const ENEMY_NAT_HG_DISTANCE = 10;
const SCOUT_POINT_SPACING = 4;
const SCOUT_POINT_INSET = 2;
const SCOUT_RAMP_CLEARANCE = 8;

const ownBase = (world: World, target: BuildTarget): Expansion | undefined => {
    const index = OWN_BASE_INDEX[target];
    return index === undefined ? undefined : world.resources.get().map.getExpansions()[index];
};

export function resolveTarget(world: World, target: BuildTarget): Point2D {
    const { map, mapAnalysis } = world.resources.get();
    // own main exists once the game has started
    const start = map.getLocations().self!;

    const own = ownBase(world, target);
    if (own) return own.townhallPosition;
    const enemyIndex = ENEMY_BASE_INDEX[target];
    if (enemyIndex !== undefined) {
        return map.getExpansions(Alliance.ENEMY)[enemyIndex]?.townhallPosition ?? start;
    }

    switch (target) {
        case BuildTargets.RAMP:
            return map.getMainBaseRamp()?.topCenter ?? start;
        case BuildTargets.ENEMY_RAMP:
            return mapAnalysis.getEnemyMainRamp()?.topCenter ?? resolveTarget(world, BuildTargets.ENEMY_SPAWN);
        case BuildTargets.MAP_CENTER:
            return map.getCenter(true);
        case BuildTargets.ENEMY_NAT_VISION:
            return towards(
                resolveTarget(world, BuildTargets.ENEMY_NAT),
                map.getCenter(true),
                ENEMY_NAT_VISION_DISTANCE,
            );
        case BuildTargets.NAT_WALL:
            return resolveTarget(world, BuildTargets.NAT);
        case BuildTargets.ENEMY_NAT_HG_SPOT:
            return mapAnalysis.takeOverlordSpot(
                towards(resolveTarget(world, BuildTargets.ENEMY_NAT), map.getCenter(true), ENEMY_NAT_HG_DISTANCE),
            );
        default:
            return start;
    }
}

export function structurePlacement(
    world: World,
    unitType: number,
    target?: BuildTarget,
): { at: Point2D } | { placement: PlacementRequest } | { near: Point2D } | undefined {
    if (gasMineTypes.includes(unitType)) return undefined;
    if (target === undefined) return undefined;
    if (townhallTypes.includes(unitType)) {
        const base = ownBase(world, target);
        if (base) return { at: base.townhallPosition };
        if (!PROXY_TARGETS.includes(target)) return undefined;
    }

    if (target === BuildTargets.RAMP) {
        const { map, units } = world.resources.get();
        const top = map.getMainBaseRamp()?.topCenter;
        const contested =
            top !== undefined && units.getEnemyUnits().some((enemy) => distance(enemy.pos, top) < RAMP_ENEMY_DISTANCE);
        return { placement: contested ? {} : { flags: ['wall'] } };
    }
    if (target === BuildTargets.NAT_WALL) {
        return { placement: { base: resolveTarget(world, BuildTargets.NAT), flags: ['wall'] } };
    }
    const flag = FLAG_TARGETS[target];
    if (flag) return { placement: { flags: [flag] } };
    const base = ownBase(world, target);
    if (base) return { placement: { base: base.townhallPosition } };
    if (PROXY_TARGETS.includes(target)) return { near: resolveTarget(world, target) };
    return undefined;
}

function mainScoutingPoints(world: World, base: Point2D, rampTop?: Point2D, startAtRamp = false): Point2D[] {
    const { mapAnalysis } = world.resources.get();
    const region = mapAnalysis.getRegion(base);
    if (!region) return [base];
    const perimeter = mapAnalysis
        .getPerimeter(region)
        .filter((point) => !rampTop || distance(point, rampTop) > SCOUT_RAMP_CLEARANCE);
    if (perimeter.length === 0) return [base];

    let candidates = perimeter.map((point, index) => ({ point, index }));
    if (startAtRamp && rampTop) {
        const closest = Math.min(...perimeter.map((point) => distance(point, rampTop)));
        candidates = candidates.filter(({ point }) => distance(point, rampTop) <= closest + 0.5);
    }
    const start = candidates.reduce((best, candidate) =>
        distance(candidate.point, base) < distance(best.point, base) ? candidate : best,
    ).index;

    const rotated = [...perimeter.slice(start), ...perimeter.slice(0, start)];
    const kept: Point2D[] = [];
    rotated.forEach((point) => {
        const previous = kept.at(-1);
        if (!previous || distance(previous, point) >= SCOUT_POINT_SPACING) kept.push(point);
    });
    const waypoints = kept
        .map((point) => towards(point, base, SCOUT_POINT_INSET))
        .filter((point) => mapAnalysis.getRegion(point)?.id === region.id);
    return waypoints.length > 0 ? waypoints : [base];
}

export function scoutWaypoints(world: World, targets: BuildTarget[]): Point2D[] {
    const { map, mapAnalysis } = world.resources.get();
    return targets.flatMap((target) => {
        switch (target) {
            case BuildTargets.SPAWN:
                return mainScoutingPoints(world, resolveTarget(world, target), map.getMainBaseRamp()?.topCenter);
            case BuildTargets.ENEMY_SPAWN:
                return mainScoutingPoints(
                    world,
                    resolveTarget(world, target),
                    mapAnalysis.getEnemyMainRamp()?.topCenter,
                    true,
                );
            case BuildTargets.NAT:
                return map.getNatural()?.areas?.behindMineralLine.slice() ?? [resolveTarget(world, target)];
            default:
                return [resolveTarget(world, target)];
        }
    });
}
