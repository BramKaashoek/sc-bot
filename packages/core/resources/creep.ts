import { Ability, UnitType } from '../constants/index.ts';
import { creepTumorTypes, townhallTypes } from '../constants/groups.ts';
import {
    creepCoverage,
    creepEdges,
    expansionMask,
    isExpansionBlocked,
    isValidTumorSpot,
    nearestCreepTile,
    overlordSpotterPositions,
} from '../utils/map/creep.ts';
import type { CreepResource, Grid2D, InfluenceGrid, Point2D, ResourceDefinition, Unit, World } from '../types.ts';

const EDGE_REFRESH_LOOPS = 16;
const COVERAGE_REFRESH_LOOPS = 112;
const QUEEN_EDGE_CACHE_LOOPS = 64;
const SPREAD_ALWAYS_BELOW_COVERAGE = 40;
const ENEMY_TOWNHALL_AVOID = 15;
const OWN_TOWNHALL_AVOID = 3.5;
const PATH_SENSITIVITY = 12;
const TUMOR_ORDERS = [Ability.BUILD_CREEPTUMOR, Ability.BUILD_CREEPTUMOR_QUEEN];

type State = {
    tiles?: { loop: number; points: Point2D[] };
    edges?: { loop: number; points: Point2D[] };
    coverage?: { loop: number; value: number };
    spreadFiredLoop?: number;
    mask?: { width: number; height: number; data: Uint8Array };
    occupied?: { loop: number; points: Point2D[] };
    tumorGrid?: { loop: number; grid: InfluenceGrid };
    queenEdges: Map<string, { position: Point2D; loop: number }>;
};

const freshState = (): State => ({ queenEdges: new Map() });

const stateByCreep = new WeakMap<CreepResource, State>();

const isDue = (lastLoop: number | undefined, loop: number, interval: number) =>
    lastLoop === undefined || loop - lastLoop >= interval;

const distance2 = (a: Point2D, b: Point2D) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function createCreepResource(world: World, random: () => number = Math.random): CreepResource {
    const state = freshState();
    const res = () => world.resources.get();
    const loop = () => res().frame.getGameLoop();
    const creepGrid = (): Grid2D => res().map._mapState.creep ?? [];

    const ownTownhalls = (): Point2D[] =>
        res()
            .units.getById(townhallTypes)
            .map((unit) => unit.pos);

    // queens' pending tumor targets count as tumors so two queens don't pick the same spot
    const occupied = (): Point2D[] => {
        const now = loop();
        if (state.occupied?.loop !== now) {
            const { units } = res();
            const targets = units
                .getById(UnitType.QUEEN)
                .map((queen) => queen.orders?.[0])
                .filter((order) => order && TUMOR_ORDERS.includes(order.abilityId!) && order.targetWorldSpacePos)
                .map((order) => order!.targetWorldSpacePos as Point2D);
            state.occupied = {
                loop: now,
                points: [...units.getById(creepTumorTypes).map((unit) => unit.pos), ...targets],
            };
        }
        return state.occupied.points;
    };

    const mask = () => {
        const { x: width = 0, y: height = 0 } = res().map.getSize();
        if (state.mask?.width !== width || state.mask.height !== height) {
            const townhalls = res()
                .map.getExpansions()
                .map((expansion) => expansion.townhallPosition);
            state.mask = { width, height, data: expansionMask(width, height, townhalls) };
        }
        return state.mask;
    };

    const isValid = (point: Point2D, ground: InfluenceGrid) =>
        isValidTumorSpot(point, { creep: creepGrid(), mask: mask().data, ground });

    const tiles = (): Point2D[] => {
        const now = loop();
        if (state.tiles?.loop !== now) {
            const points: Point2D[] = [];
            creepGrid().forEach((row, y) =>
                row.forEach((cell, x) => {
                    if (cell) points.push({ x, y });
                }),
            );
            state.tiles = { loop: now, points };
        }
        return state.tiles.points;
    };

    const edges = (): Point2D[] => {
        const now = loop();
        if (isDue(state.edges?.loop, now, EDGE_REFRESH_LOOPS)) {
            const { map } = res();
            state.edges = {
                loop: now,
                points: creepEdges(creepGrid(), map.getGrids().pathing ?? [], ownTownhalls()),
            };
        }
        return state.edges!.points;
    };

    const coverage = (): number => {
        const now = loop();
        if (isDue(state.coverage?.loop, now, COVERAGE_REFRESH_LOOPS)) {
            state.coverage = { loop: now, value: creepCoverage(creepGrid(), res().influence.getGrid('ground')) };
        }
        return state.coverage!.value;
    };

    const tumorGrid = (): InfluenceGrid => {
        const now = loop();
        if (state.tumorGrid?.loop !== now) {
            const { influence } = res();
            const grid = influence.getCleanGrid('ground');
            for (const tumor of occupied()) influence.addCost(grid, tumor, 5, 50);
            state.tumorGrid = { loop: now, grid };
        }
        return state.tumorGrid.grid;
    };

    const resource: CreepResource = {
        getTiles: tiles,
        getEdges: edges,
        getCoverage: coverage,
        closestTile: (near) => nearestCreepTile(creepGrid(), near),
        findEdgePosition(near, { radius = 15, closest = true, spreadDistance = 3, unitTag, cache = false } = {}) {
            const now = loop();
            const cached = unitTag === undefined ? undefined : state.queenEdges.get(unitTag);
            // a caller that stops asking for the cached spot (ability ready again) wants a fresh one
            if (cached && (!cache || now - cached.loop >= QUEEN_EDGE_CACHE_LOOPS)) state.queenEdges.delete(unitTag!);
            else if (cached) return cached.position;

            const ground = res().influence.getGrid('ground');
            const taken = occupied();
            const spread2 = spreadDistance ** 2;
            const candidates = edges()
                .map((edge) => ({ edge, d2: distance2(edge, near) }))
                .filter(({ d2 }) => d2 <= radius ** 2)
                .sort((a, b) => (closest ? a.d2 - b.d2 : b.d2 - a.d2));
            const found = candidates.find(
                ({ edge }) => isValid(edge, ground) && taken.every((tumor) => distance2(edge, tumor) >= spread2),
            )?.edge;

            if (found && cache && unitTag !== undefined) state.queenEdges.set(unitTag, { position: found, loop: now });
            return found;
        },
        nextTumorOnPath(
            from,
            to,
            { layer, maxDistance = 999.9, minDistance = 0, minSeparation = 5, findAlternative = true } = {},
        ) {
            const { pathing, influence, units } = res();
            const ground = influence.getGrid('ground');
            const creep = creepGrid();
            for (const point of pathing.findPath(from, to, { layer, sensitivity: PATH_SENSITIVITY })) {
                if (creep[Math.floor(point.y)]?.[Math.floor(point.x)]) continue;
                const tile = nearestCreepTile(creep, point);
                if (!tile) continue;
                const distance = Math.hypot(tile.x - from.x, tile.y - from.y);
                if (!(maxDistance > distance && distance > minDistance && isValid(tile, ground))) continue;
                if (!findAlternative) return tile;

                const tooClose =
                    units
                        .getEnemyStructures()
                        .some(
                            (structure) =>
                                townhallTypes.includes(structure.unitType) &&
                                distance2(tile, structure.pos) < ENEMY_TOWNHALL_AVOID ** 2,
                        ) ||
                    ownTownhalls().some((townhall) => distance2(tile, townhall) < OWN_TOWNHALL_AVOID ** 2) ||
                    occupied().some((tumor) => distance2(tile, tumor) < minSeparation ** 2);
                if (!tooClose) return tile;
                // ares passes minSeparation as the search radius here
                return resource.findEdgePosition(tile, { radius: minSeparation });
            }
            return undefined;
        },
        randomPosition(near, attempts = 20) {
            const ground = res().influence.getGrid('ground');
            const { width, height } = mask();
            for (let attempt = 0; attempt < attempts; attempt++) {
                const angle = random() * 2 * Math.PI;
                const distance = 6 + random() * 3;
                const candidate = { x: near.x + distance * Math.cos(angle), y: near.y + distance * Math.sin(angle) };
                if (candidate.x < 1 || candidate.x >= width - 1 || candidate.y < 1 || candidate.y >= height - 1) {
                    continue;
                }
                if (isValid(candidate, ground)) return candidate;
            }
            return undefined;
        },
        tumorLowestCostPosition(near) {
            const ground = res().influence.getGrid('ground');
            const candidates = res()
                .pathing.findLowestCostPoints(near, { layer: tumorGrid(), radius: 9 })
                .sort((a, b) => distance2(a, near) - distance2(b, near));
            for (let i = candidates.length - 1; i >= 0; i--) {
                if (distance2(candidates[i], near) < 9) continue;
                if (isValid(candidates[i], ground)) return candidates[i];
            }
            return undefined;
        },
        shouldSpreadTumors() {
            const value = coverage();
            if (value < SPREAD_ALWAYS_BELOW_COVERAGE) return true;
            const now = loop();
            // every caller in a firing loop gets true, as with ares' per-frame cached gate
            if (state.spreadFiredLoop === now) return true;
            if (!isDue(state.spreadFiredLoop, now, Math.floor(value / 2))) return false;
            state.spreadFiredLoop = now;
            return true;
        },
        overlordSpotterPositions(overlords, target) {
            const { map } = res();
            const { x = 0, y = 0 } = map.getSize();
            return overlordSpotterPositions(
                edges(),
                Array.from(overlords, (overlord: Unit) => ({
                    tag: overlord.tag,
                    position: overlord.pos,
                    isMoving: overlord.orders?.[0]?.abilityId === Ability.MOVE,
                })),
                target,
                { mapSize: { x, y }, enemyStart: map.getLocations().enemy[0] },
            );
        },
        blocksExpansion: (point) => isExpansionBlocked(mask().data, mask().width, point),
    };

    stateByCreep.set(resource, state);
    return resource;
}

export const creepResource: ResourceDefinition<'creep'> = {
    name: 'creep',
    create: (world) => createCreepResource(world),
    reset(resource) {
        const state = stateByCreep.get(resource)!;
        Object.keys(state).forEach((key) => delete state[key as keyof State]);
        state.queenEdges = new Map();
    },
};
