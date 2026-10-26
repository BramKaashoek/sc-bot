import createDebug from 'debug';
import { MapDecompositionError } from '../engine/errors.ts';
import { analyzeChokes } from '../utils/map/chokes.ts';
import { createDistanceField } from '../utils/map/distance-field.ts';
import type {
    BaseChoke,
    Choke,
    Expansion,
    MapAnalysisResource,
    MapAnalysisSettings,
    Point2D,
    Region,
    ResourceDefinition,
    World,
} from '../types.ts';

const debug = createDebug('sc2:debug:mapAnalysis');

const DEFAULT_SETTINGS: MapAnalysisSettings = {
    maxChokeWidth: 14,
    peakRatio: 2.2,
    minRegionArea: 150,
    defenseOffset: 4,
};
const START_TOWNHALL_HALF_SIZE = 2;
const BASE_RESOLVE_RADIUS = 4;
const MAX_DISTANCE_FIELDS = 32;
const UNREACHABLE_PATH_LENGTH = 999;
const NEIGHBOURS = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
];

type Analysis = {
    width: number;
    height: number;
    walkable: Uint8Array;
    labels: Int32Array;
    chokes: Choke[];
    chokeCenters: Int32Array;
    regions: Region[];
    chokeMask: Uint8Array;
    perimeters: Map<number, Point2D[]>;
};

type State = {
    settings: MapAnalysisSettings;
    analysis?: Analysis;
    fields: Map<number, Float32Array>;
    distanceField?: { width: number; height: number; compute: ReturnType<typeof createDistanceField>['compute'] };
    loggedStepError: boolean;
};

const states = new WeakMap<MapAnalysisResource, State>();

const cellCentre = (cell: number, width: number): Point2D => ({
    x: (cell % width) + 0.5,
    y: Math.floor(cell / width) + 0.5,
});

const cellPoint = (cell: number, width: number): Point2D => ({ x: cell % width, y: Math.floor(cell / width) });

function buildWalkable(world: World, width: number, height: number): Uint8Array {
    const { map } = world.resources.get();
    const walkable = new Uint8Array(width * height);
    try {
        map.inPathingGrid({ x: 0, y: 0 });
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) walkable[y * width + x] = map.inPathingGrid({ x, y }) ? 1 : 0;
        }
    } catch (err) {
        throw new MapDecompositionError(`Map analysis needs the start grids: ${(err as Error).message}`);
    }

    const self = map.getLocations()?.self;
    if (self) {
        const cx = Math.floor(self.x);
        const cy = Math.floor(self.y);
        for (let y = cy - START_TOWNHALL_HALF_SIZE; y <= cy + START_TOWNHALL_HALF_SIZE; y++) {
            for (let x = cx - START_TOWNHALL_HALF_SIZE; x <= cx + START_TOWNHALL_HALF_SIZE; x++) {
                if (x >= 0 && y >= 0 && x < width && y < height) walkable[y * width + x] = 1;
            }
        }
    }
    return walkable;
}

function resolveCell({ walkable, width, height }: Analysis, point: Point2D): number {
    const cx = Math.floor(point.x);
    const cy = Math.floor(point.y);
    if (cx >= 0 && cy >= 0 && cx < width && cy < height && walkable[cy * width + cx]) return cy * width + cx;

    let best = -1;
    let bestDistance = Infinity;
    for (let dy = -BASE_RESOLVE_RADIUS; dy <= BASE_RESOLVE_RADIUS; dy++) {
        for (let dx = -BASE_RESOLVE_RADIUS; dx <= BASE_RESOLVE_RADIUS; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            const squared = dx * dx + dy * dy;
            if (squared > BASE_RESOLVE_RADIUS ** 2 || x < 0 || y < 0 || x >= width || y >= height) continue;
            const cell = y * width + x;
            if (!walkable[cell]) continue;
            if (squared < bestDistance || (squared === bestDistance && cell < best)) {
                best = cell;
                bestDistance = squared;
            }
        }
    }
    return best;
}

function analyze(world: World, settings: MapAnalysisSettings): Analysis {
    const { map } = world.resources.get();
    const { x: width = 0, y: height = 0 } = map.getSize();
    const walkable = buildWalkable(world, width, height);
    const result = analyzeChokes(walkable, width, height, settings);
    const ramps = map.getRamps();

    const chokeMask = new Uint8Array(width * height);
    const chokes: Choke[] = result.chokes.map((raw, id) => {
        raw.cells.forEach((cell) => {
            chokeMask[cell] = 1;
        });
        const cells = Array.from(raw.cells);
        const ramp = ramps.find((candidate) =>
            candidate.points.some((point) =>
                cells.some((cell) => {
                    const { x, y } = cellPoint(cell, width);
                    return Math.max(Math.abs(point.x - x), Math.abs(point.y - y)) <= 1;
                }),
            ),
        );
        return {
            id,
            center: cellCentre(raw.center, width),
            sides: [cellCentre(raw.sides[0], width), cellCentre(raw.sides[1], width)],
            points: cells.map((cell) => cellPoint(cell, width)),
            width: raw.width,
            regions: raw.regions,
            ...(ramp ? { ramp } : {}),
        };
    });

    const analysis: Analysis = {
        width,
        height,
        walkable,
        labels: result.labels,
        chokes,
        chokeCenters: Int32Array.from(result.chokes, ({ center }) => center),
        regions: [],
        chokeMask,
        perimeters: new Map(),
    };
    analysis.regions = result.regions.map(({ area, peak }, id) => ({
        id,
        area,
        center: cellCentre(peak, width),
        chokes: chokes.filter(({ regions }) => regions.includes(id)),
        expansions: [],
    }));
    map.getExpansions().forEach((expansion) => {
        const cell = resolveCell(analysis, expansion.townhallPosition);
        if (cell >= 0) analysis.regions[result.labels[cell]]?.expansions.push(expansion);
    });
    return analysis;
}

function createMapAnalysis(world: World): MapAnalysisResource {
    const state: State = { settings: { ...DEFAULT_SETTINGS }, fields: new Map(), loggedStepError: false };

    const getAnalysis = () => {
        state.analysis ??= analyze(world, state.settings);
        return state.analysis;
    };

    const fieldFrom = (start: number) => {
        const analysis = getAnalysis();
        const cached = state.fields.get(start);
        if (cached) return cached;

        const { width, height } = analysis;
        if (!state.distanceField || state.distanceField.width !== width || state.distanceField.height !== height) {
            state.distanceField = { width, height, compute: createDistanceField(width, height).compute };
        }
        if (state.fields.size >= MAX_DISTANCE_FIELDS) state.fields.delete(state.fields.keys().next().value!);
        const field = state.distanceField.compute(analysis.walkable, start, new Float32Array(width * height));
        state.fields.set(start, field);
        return field;
    };

    const pointOf = (base: Expansion | Point2D): Point2D => ('townhallPosition' in base ? base.townhallPosition : base);

    const resource: MapAnalysisResource = {
        getChokes() {
            return getAnalysis().chokes.slice();
        },
        getRegions() {
            return getAnalysis().regions.slice();
        },
        getRegion(point) {
            const { width, height, labels, regions } = getAnalysis();
            const x = Math.floor(point.x);
            const y = Math.floor(point.y);
            if (x < 0 || y < 0 || x >= width || y >= height) return undefined;
            return regions[labels[y * width + x]];
        },
        isInChoke(point) {
            const { width, height, chokeMask } = getAnalysis();
            const x = Math.floor(point.x);
            const y = Math.floor(point.y);
            return x >= 0 && y >= 0 && x < width && y < height && chokeMask[y * width + x] === 1;
        },
        getBaseChokes(base) {
            const analysis = getAnalysis();
            const start = resolveCell(analysis, pointOf(base));
            if (start < 0) return [];
            const region = analysis.regions[analysis.labels[start]];
            const field = fieldFrom(start);
            return region.chokes
                .map((choke): BaseChoke => ({ choke, pathDistance: field[analysis.chokeCenters[choke.id]] }))
                .filter(({ pathDistance }) => pathDistance !== Infinity)
                .sort((a, b) => a.pathDistance - b.pathDistance || a.choke.id - b.choke.id);
        },
        getDefensivePosition(base, { towards, offset = state.settings.defenseOffset } = {}) {
            const baseChokes = resource.getBaseChokes(base);
            if (baseChokes.length === 0) return undefined;

            const analysis = getAnalysis();
            const { map } = world.resources.get();
            const baseField = fieldFrom(resolveCell(analysis, pointOf(base)));
            const target = towards ?? map.getLocations()?.enemy?.[0] ?? map.getCenter(true);
            const targetCell = resolveCell(analysis, target);
            const targetField = targetCell >= 0 ? fieldFrom(targetCell) : undefined;
            const towardsTarget = ({ choke }: BaseChoke) => targetField?.[analysis.chokeCenters[choke.id]] ?? 0;

            const best = baseChokes.reduce((top, candidate) => {
                const score = candidate.pathDistance + towardsTarget(candidate);
                const topScore = top.pathDistance + towardsTarget(top);
                if (score !== topScore) return score < topScore ? candidate : top;
                if (candidate.pathDistance !== top.pathDistance) {
                    return candidate.pathDistance < top.pathDistance ? candidate : top;
                }
                return candidate.choke.id < top.choke.id ? candidate : top;
            });

            const { width, height, walkable } = analysis;
            let cell = analysis.chokeCenters[best.choke.id];
            let travelled = 0;
            for (;;) {
                const x = cell % width;
                const y = Math.floor(cell / width);
                let next = -1;
                let nextStep = 0;
                NEIGHBOURS.forEach(([dx, dy]) => {
                    const step = dx && dy ? Math.SQRT2 : 1;
                    if (travelled + step > offset + 1e-9) return;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
                    const candidate = ny * width + nx;
                    if (!walkable[candidate]) return;
                    if (dx && dy && (!walkable[y * width + nx] || !walkable[ny * width + x])) return;
                    const bestSoFar = next < 0 ? baseField[cell] : baseField[next];
                    if (baseField[candidate] < bestSoFar) {
                        next = candidate;
                        nextStep = step;
                    }
                });
                if (next < 0) break;
                cell = next;
                travelled += nextStep;
            }
            return { ...best, position: cellCentre(cell, width) };
        },
        getDefensiveThird() {
            const pathLength = (expansion: Expansion) => expansion.pathFromEnemy?.length ?? UNREACHABLE_PATH_LENGTH;
            return world.resources
                .get()
                .map.getThirds()
                .reduce<Expansion | undefined>(
                    (best, third) => (!best || pathLength(third) > pathLength(best) ? third : best),
                    undefined,
                );
        },
        getPerimeter(region) {
            const analysis = getAnalysis();
            const cached = analysis.perimeters.get(region.id);
            if (cached) return cached.slice();

            const { width, height, labels, walkable } = analysis;
            const open = (x: number, y: number) =>
                x >= 0 && y >= 0 && x < width && y < height && walkable[y * width + x];
            const edge: { cell: number; angle: number }[] = [];
            labels.forEach((label, cell) => {
                if (label !== region.id) return;
                const x = cell % width;
                const y = Math.floor(cell / width);
                if (open(x - 1, y) && open(x + 1, y) && open(x, y - 1) && open(x, y + 1)) return;
                edge.push({ cell, angle: Math.atan2(y + 0.5 - region.center.y, x + 0.5 - region.center.x) });
            });
            const perimeter = edge
                .sort((a, b) => a.angle - b.angle || a.cell - b.cell)
                .map(({ cell }) => cellCentre(cell, width));
            analysis.perimeters.set(region.id, perimeter);
            return perimeter.slice();
        },
        getEnemyMainRamp() {
            const { map } = world.resources.get();
            const enemyMain = map.getEnemyMain();
            const self = map.getLocations()?.self;
            if (!enemyMain || !self) return undefined;
            return resource.getDefensivePosition(enemyMain, { towards: self })?.choke.ramp;
        },
        configure(settings) {
            Object.assign(state.settings, settings);
            state.analysis = undefined;
            state.fields.clear();
        },
        drawDebug() {
            const { debug: drawer } = world.resources.get();
            if (!drawer) return;
            const { chokes, regions } = getAnalysis();
            drawer.setDrawCells('mapAnalysisChokes', [
                ...chokes.flatMap(({ id, points }) =>
                    points.map(({ x, y }) => ({ pos: { x: x + 0.5, y: y + 0.5 }, text: `C${id}` })),
                ),
                ...regions.map(({ id, center }) => ({ pos: { ...center }, text: `R${id}` })),
            ]);
        },
    };
    states.set(resource, state);
    return resource;
}

export const mapAnalysisResource: ResourceDefinition<'mapAnalysis'> = {
    name: 'mapAnalysis',
    create: (world) => createMapAnalysis(world),
    reset: (resource) => {
        const state = states.get(resource)!;
        state.analysis = undefined;
        state.fields.clear();
        state.loggedStepError = false;
    },
    onStep: (resource, world) => {
        if (!world.config.features.eagerMapAnalysis) return;
        const state = states.get(resource)!;
        try {
            resource.getRegions();
        } catch (err) {
            if (state.loggedStepError) return;
            state.loggedStepError = true;
            debug(`Map analysis failed: ${(err as Error).message}`);
        }
    },
};
