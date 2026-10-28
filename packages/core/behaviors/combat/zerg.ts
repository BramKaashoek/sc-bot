import {
    BUILD_CREEPTUMOR,
    BUILD_CREEPTUMOR_QUEEN,
    BUILD_CREEPTUMOR_TUMOR,
    EFFECT_TRANSFUSION,
    MOVE,
    SMART,
} from '../../constants/ability.ts';
import { CREEPTUMORQUEEN } from '../../constants/unit-type.ts';
import { distance, distanceSquared } from '../../utils/geometry/point.ts';
import { layerFor } from './helpers.ts';
import { keepUnitSafe } from './individual.ts';
import type { Units } from '../../resources/units-collection.ts';
import type { Behavior, InfluenceGrid, InfluenceLayer, Point2D, Unit, World } from '../../types.ts';

const TUMOR_EDGE_RADIUS = 10.2;
const QUEEN_EDGE_SEARCH_RADIUS = 200;
const QUEEN_COVERAGE_FOR_EDGE = 20;
const QUEEN_TUMOR_DONE_DISTANCE2 = 3;
const QUEEN_PREMOVE_DISTANCE2 = 9;
const QUEEN_PLACE_DISTANCE2 = 25;
const TRANSFUSE_RANGE = 7;
const TRANSFUSE_HEALTH_FRACTION = 0.4;
const TRANSFUSE_MIN_HEALTH_MAX = 50;

// ctx.order only dedupes the commanded unit, not the target, so the per-loop target set lives here
const transfusedByWorld = new WeakMap<World, { loop: number; tags: Set<string> }>();

export function tumorSpreadCreep({ unit }: { unit: Unit }): Behavior {
    return {
        name: 'tumorSpreadCreep',
        execute(ctx) {
            const { creep } = ctx.world.resources.get();
            if (!creep.shouldSpreadTumors() || !unit.abilityAvailable(BUILD_CREEPTUMOR_TUMOR)) return false;

            const spot =
                creep.findEdgePosition(unit.pos, { radius: TUMOR_EDGE_RADIUS, closest: false, spreadDistance: 1 }) ??
                creep.randomPosition(unit.pos);
            if (!spot) return false;
            ctx.order(unit, BUILD_CREEPTUMOR, spot);
            return true;
        },
    };
}

export function queenSpreadCreep({
    unit,
    cancelIfCloseEnemy = true,
    preMove = true,
}: {
    unit: Unit;
    cancelIfCloseEnemy?: boolean;
    preMove?: boolean;
}): Behavior {
    return {
        name: 'queenSpreadCreep',
        execute(ctx) {
            const { creep, map, units } = ctx.world.resources.get();
            const spreading = unit.isUsingAbility(BUILD_CREEPTUMOR);

            if (spreading && (cancelIfCloseEnemy || preMove) && keepUnitSafe({ unit, layer: 'ground' }).execute(ctx)) {
                return true;
            }

            if (spreading) {
                const target = unit.orders?.[0]?.targetWorldSpacePos as Point2D | undefined;
                const placed =
                    target &&
                    units
                        .getById(CREEPTUMORQUEEN)
                        .some((tumor) => distanceSquared(target, tumor.pos) < QUEEN_TUMOR_DONE_DISTANCE2);
                if (!placed) return true;
            }

            const abilityAvailable = unit.abilityAvailable(BUILD_CREEPTUMOR_QUEEN);
            const edge = creep.findEdgePosition(unit.pos, {
                radius: QUEEN_EDGE_SEARCH_RADIUS,
                unitTag: unit.tag,
                cache: !abilityAvailable,
            });
            if (!abilityAvailable && preMove) {
                if (edge && distanceSquared(unit.pos, edge) > QUEEN_PREMOVE_DISTANCE2) ctx.order(unit, MOVE, edge);
                return true;
            }

            const center = map.getCenter();
            const target = map.hasCreep(unit.pos) ? (map.getEnemyNatural()?.townhallPosition ?? center) : center;
            const spot =
                edge && creep.getCoverage() > QUEEN_COVERAGE_FOR_EDGE
                    ? edge
                    : creep.nextTumorOnPath(unit.pos, target, { layer: 'ground', findAlternative: true });
            if (!spot) return false;

            if (distanceSquared(unit.pos, spot) > QUEEN_PLACE_DISTANCE2) ctx.order(unit, MOVE, spot);
            else ctx.order(unit, BUILD_CREEPTUMOR_QUEEN, spot);
            return true;
        },
    };
}

export function useTransfuse({
    unit,
    targets,
    extraRange = 0,
}: {
    unit: Unit;
    targets: Unit[] | Units;
    extraRange?: number;
}): Behavior {
    return {
        name: 'useTransfuse',
        execute(ctx) {
            if (unit.isUsingAbility(EFFECT_TRANSFUSION)) return true;
            if (!unit.abilityAvailable(EFFECT_TRANSFUSION)) return false;

            const now = ctx.world.resources.get().frame.getGameLoop();
            let done = transfusedByWorld.get(ctx.world);
            if (done?.loop !== now) transfusedByWorld.set(ctx.world, (done = { loop: now, tags: new Set() }));

            const target = Array.from(targets).find(
                (candidate) =>
                    candidate.health! / candidate.healthMax! < TRANSFUSE_HEALTH_FRACTION &&
                    distance(unit.pos, candidate.pos) <
                        TRANSFUSE_RANGE + unit.radius! + candidate.radius! + extraRange &&
                    candidate.healthMax! >= TRANSFUSE_MIN_HEALTH_MAX &&
                    candidate.tag !== unit.tag &&
                    !done!.tags.has(candidate.tag),
            );
            if (!target) return false;
            done.tags.add(target.tag);
            ctx.order(unit, EFFECT_TRANSFUSION, target);
            return true;
        },
    };
}

export function nydusPathUnitToTarget({
    unit,
    target,
    layer,
    successAtDistance = 0,
    sensitivity = 5,
    smoothing = false,
    exitMaxInfluence = 10,
}: {
    unit: Unit;
    target: Point2D;
    layer?: InfluenceLayer | InfluenceGrid;
    successAtDistance?: number;
    sensitivity?: number;
    smoothing?: boolean;
    exitMaxInfluence?: number;
}): Behavior {
    return {
        name: 'nydusPathUnitToTarget',
        execute(ctx) {
            if (distance(unit.pos, target) < successAtDistance) return false;
            const { nydus, pathing, units } = ctx.world.resources.get();
            const grid = layerFor(unit, layer);
            const { point, exitTowards, nydusTags } = nydus.nextPoint(unit.pos, target, {
                layer: grid,
                sensitivity,
                smoothing,
            });

            // nextPoint falls back to the target without a path, so only the tags say whether a nydus is involved
            const entry = nydusTags && exitTowards ? units.getByTag(nydusTags[0]) : undefined;
            if (
                nydusTags &&
                exitTowards &&
                pathing.isPositionSafe(exitTowards, { layer: grid, limit: exitMaxInfluence }) &&
                !nydus.isBanned(unit.tag!)
            ) {
                nydus.addTraveller(unit, nydusTags[0], nydusTags[1], exitTowards);
                if (
                    entry &&
                    Math.floor(point.x) === Math.floor(entry.pos.x) &&
                    Math.floor(point.y) === Math.floor(entry.pos.y)
                ) {
                    ctx.order(unit, SMART, entry);
                } else {
                    ctx.order(unit, MOVE, point);
                }
            } else {
                ctx.order(unit, MOVE, point);
            }
            return true;
        },
    };
}
