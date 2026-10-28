import { Ability, UnitType } from '../constants/index.ts';
import { Race } from '../constants/enums.ts';
import { cellCentre } from '../utils/grid/cell.ts';
import { distance, distanceSquared, towards } from '../utils/geometry/point.ts';
import { smoothPath } from '../utils/pathing/smooth.ts';
import type {
    InfluenceGrid,
    NydusResource,
    NydusTraveller,
    PathOptions,
    Point2D,
    ResourceDefinition,
    Unit,
    World,
} from '../types.ts';

const TRAVEL_BAN_SECONDS = 5;
const LOOPS_PER_SECOND = 22.4;
const PATH_CACHE_LOOPS = 44;
const DEFAULT_SENSITIVITY = 5;
const ELIGIBLE_POINT_RADIUS = 10;
const SAME_HEIGHT_DELTA = 8;
const TOWNHALL_AVOID = 15;
const GEYSER_AVOID = 11;
const GEYSER_SEARCH_RADIUS = 12;
const RAMP_AVOID = 13;
const ENEMY_AVOID_RADIUS = 12;
const FALLBACK_STEP = 10;
const SQRT2 = 1.41421;
const NYDUS_STEP_FACTOR = 4;
const FIT_EPSILON = 0.03;

const nydusTypes = [UnitType.NYDUSNETWORK, UnitType.NYDUSCANAL];

type PathCacheEntry = { loop: number; result: ReturnType<NydusResource['nextPoint']> };

type State = {
    mainPoints: { enemy?: Point2D[]; own?: Point2D[] };
    travellers: Map<string, NydusTraveller>;
    bans: Map<string, number>;
    knownTags: Set<string>;
    pathCache: Map<string, PathCacheEntry>;
    syncedLoop?: number;
};

const freshState = (): State => ({
    mainPoints: {},
    travellers: new Map(),
    bans: new Map(),
    knownTags: new Set(),
    pathCache: new Map(),
});

export const stateByNydus = new WeakMap<NydusResource, State>();
const stepHandlers = new WeakMap<NydusResource, () => void>();

type NydusInfo = { distance: number; closest: number; canEnter: boolean };

class MinHeap {
    private keys = new Float64Array(64);
    private nodes = new Int32Array(64);
    size = 0;

    push(node: number, key: number) {
        if (this.size === this.nodes.length) {
            const keys = new Float64Array(this.size * 2);
            const nodes = new Int32Array(this.size * 2);
            keys.set(this.keys);
            nodes.set(this.nodes);
            this.keys = keys;
            this.nodes = nodes;
        }
        let index = this.size++;
        while (index > 0) {
            const up = (index - 1) >> 1;
            if (this.keys[up] <= key) break;
            this.keys[index] = this.keys[up];
            this.nodes[index] = this.nodes[up];
            index = up;
        }
        this.keys[index] = key;
        this.nodes[index] = node;
    }

    pop(): { node: number; key: number } {
        const top = { node: this.nodes[0], key: this.keys[0] };
        this.size -= 1;
        const node = this.nodes[this.size];
        const key = this.keys[this.size];
        let index = 0;
        for (;;) {
            let child = 2 * index + 1;
            if (child >= this.size) break;
            if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) child += 1;
            if (this.keys[child] >= key) break;
            this.keys[index] = this.keys[child];
            this.nodes[index] = this.nodes[child];
            index = child;
        }
        this.keys[index] = key;
        this.nodes[index] = node;
        return top;
    }
}

// Tie-breaking between equal-cost nodes can differ from the C heap.
function astarWithNydus(
    weights: Float32Array,
    width: number,
    height: number,
    start: number,
    goal: number,
    large: boolean,
    nydusNodes: number[],
): number[] | null {
    const count = nydusNodes.length;
    let baseline = Infinity;
    for (const weight of weights) if (weight < baseline) baseline = weight;

    const h = (a: number, b: number) => {
        const dx = Math.abs((a % width) - (b % width));
        const dy = Math.abs(Math.floor(a / width) - Math.floor(b / width));
        return baseline * (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy));
    };
    // fields are never reset between nyduses, as in the C
    const nydusInfo = (node: number): NydusInfo => {
        const info: NydusInfo = { distance: 0, closest: 0, canEnter: false };
        let minDist = Infinity;
        const nx = node % width;
        const ny = Math.floor(node / width);
        for (const nydus of nydusNodes) {
            const dist = h(node, nydus);
            if (dist >= minDist) continue;
            minDist = dist;
            info.distance = dist;
            info.closest = nydus;
            const dx = Math.abs(nx - (nydus % width));
            const dy = Math.abs(ny - Math.floor(nydus / width));
            if (dx <= 1 && dy <= 1) {
                info.canEnter = true;
                break;
            }
            if (dx <= 2 && dy <= 2) info.canEnter = true;
        }
        return info;
    };
    const goalNydus = nydusInfo(goal);

    const costs = new Float64Array(width * height).fill(Infinity);
    const parent = new Int32Array(width * height).fill(-1);
    const queuedKey = new Float64Array(width * height).fill(Infinity);
    const queuedNydus = new Uint8Array(width * height);
    const heap = new MinHeap();
    const push = (node: number, key: number, isNydus: boolean) => {
        queuedKey[node] = key;
        queuedNydus[node] = isNydus ? 1 : 0;
        heap.push(node, key);
    };

    costs[start] = 0;
    push(start, 0, false);

    const stepCosts = [SQRT2, 1, SQRT2, 1, 1, SQRT2, 1, SQRT2];
    const nbrs = new Array<number>(8);
    const fits = new Array<boolean>(8);
    const finite = (cell: number) => cell !== -1 && weights[cell] !== Infinity;

    while (heap.size > 0) {
        const { node: cur, key } = heap.pop();
        if (key !== queuedKey[cur]) continue;
        queuedKey[cur] = Infinity;
        const curIsNydus = queuedNydus[cur] === 1;
        if (cur === goal) {
            const path = [goal];
            for (let node = goal; node !== start; ) {
                node = parent[node];
                path.push(node);
            }
            return path.reverse();
        }

        const row = Math.floor(cur / width);
        const col = cur % width;
        const gap = curIsNydus ? 2 : 1;
        const [UL, U, UR, L, R, DL, D, DR] = [0, 1, 2, 3, 4, 5, 6, 7];
        nbrs[UL] = row >= gap && col >= gap ? cur - gap * width - gap : -1;
        nbrs[U] = row >= gap ? cur - gap * width : -1;
        nbrs[UR] = row >= gap && col + gap < width ? cur - gap * width + gap : -1;
        nbrs[L] = col >= gap ? cur - gap : -1;
        nbrs[R] = col + gap < width ? cur + gap : -1;
        nbrs[DL] = row + gap < height && col >= gap ? cur + gap * width - gap : -1;
        nbrs[D] = row + gap < height ? cur + gap * width : -1;
        nbrs[DR] = row + gap < height && col + gap < width ? cur + gap * width + gap : -1;
        for (let i = 0; i < 8; i++) fits[i] = finite(nbrs[i]);

        if (!curIsNydus) {
            const ok = (cell: number) => finite(cell);
            if (large) {
                if (fits[U]) fits[U] = ok(nbrs[UL]) || ok(nbrs[UR]);
                if (fits[L]) fits[L] = ok(nbrs[UL]) || ok(nbrs[DL]);
                if (fits[R]) fits[R] = ok(nbrs[DR]) || ok(nbrs[UR]);
                if (fits[D]) fits[D] = ok(nbrs[DL]) || ok(nbrs[DR]);
            }
            if (fits[UL]) fits[UL] = ok(nbrs[U]) && ok(nbrs[L]);
            if (fits[UR]) fits[UR] = ok(nbrs[U]) && ok(nbrs[R]);
            if (fits[DL]) fits[DL] = ok(nbrs[D]) && ok(nbrs[L]);
            if (fits[DR]) fits[DR] = ok(nbrs[D]) && ok(nbrs[R]);
        }

        const curCost = costs[cur];
        for (let i = 0; i < 8; i++) {
            if (!fits[i]) continue;
            const next = nbrs[i];
            const factor = curIsNydus ? NYDUS_STEP_FACTOR : 1;
            const newCost = curCost + factor * weights[next] * stepCosts[i];
            if (newCost + FIT_EPSILON >= costs[next]) continue;
            let heuristic = h(next, goal);
            if (count > 0) {
                const viaNydus = NYDUS_STEP_FACTOR * baseline + nydusInfo(next).distance + goalNydus.distance;
                heuristic = Math.min(heuristic, viaNydus);
            }
            push(next, newCost + heuristic, false);
            costs[next] = newCost;
            parent[next] = cur;
        }

        if (curIsNydus) {
            for (const other of nydusNodes) {
                if (other === cur) continue;
                const newCost = curCost + NYDUS_STEP_FACTOR * baseline;
                if (newCost + FIT_EPSILON >= costs[other]) continue;
                const heuristic = Math.min(h(other, goal), NYDUS_STEP_FACTOR * baseline + goalNydus.distance);
                push(other, newCost + heuristic, true);
                costs[other] = newCost;
                parent[other] = cur;
            }
        } else if (count > 0) {
            const info = nydusInfo(cur);
            if (!info.canEnter) continue;
            const newCost = curCost + NYDUS_STEP_FACTOR * weights[cur];
            if (newCost + FIT_EPSILON >= costs[info.closest]) continue;
            push(info.closest, newCost + NYDUS_STEP_FACTOR * baseline + goalNydus.distance, true);
            costs[info.closest] = newCost;
            parent[info.closest] = cur;
        }
    }
    return null;
}

const slice = (path: number[], sensitivity: number, dropFirst: boolean): number[] => {
    const picked: number[] = [];
    for (let i = 0; i < path.length - 1; i += sensitivity) picked.push(path[i]);
    if (dropFirst) picked.shift();
    picked.push(path[path.length - 1]);
    return picked;
};

export function createNydusResource(world: World): NydusResource {
    const res = () => world.resources.get();
    const loop = () => res().frame.getGameLoop();
    const now = () => loop() / LOOPS_PER_SECOND;
    const state = freshState();

    const ownNyduses = (): Unit[] => {
        const { units } = res();
        return [...units.getById(UnitType.NYDUSNETWORK), ...units.getById(UnitType.NYDUSCANAL)];
    };

    const ownNatural = (): Point2D => {
        const { map } = res();
        return map.getNatural()?.townhallPosition ?? map.getLocations().self ?? map.getCenter();
    };

    const closestToNatural = (nyduses: Unit[]): Unit => {
        const natural = ownNatural();
        return nyduses.reduce((best, unit) =>
            distanceSquared(unit.pos!, natural) < distanceSquared(best.pos!, natural) ? unit : best,
        );
    };

    // ares repoints from the destroyed-unit callback; core has no such hook for resources, so it diffs the tags
    const repointDestroyed = (nyduses: Unit[], destroyed: string[]) => {
        state.pathCache.clear();
        if (nyduses.length === 0) return;
        const fallback = closestToNatural(nyduses).tag!;
        for (const traveller of state.travellers.values()) {
            if (destroyed.includes(traveller.entry)) traveller.entry = fallback;
            if (destroyed.includes(traveller.exit)) traveller.exit = fallback;
        }
    };

    const sync = () => {
        const current = loop();
        if (state.syncedLoop === current) return;
        state.syncedLoop = current;
        for (const [key, { loop: cachedAt }] of state.pathCache) {
            if (current - cachedAt > PATH_CACHE_LOOPS) state.pathCache.delete(key);
        }
        const nyduses = ownNyduses();
        const tags = new Set(nyduses.map((unit) => unit.tag!));
        const destroyed = [...state.knownTags].filter((tag) => !tags.has(tag));
        state.knownTags = tags;
        if (destroyed.length > 0) repointDestroyed(nyduses, destroyed);
    };

    const mainPoints = (main: Point2D, ramp: Point2D | undefined): Point2D[] => {
        const { mapAnalysis, map, units } = res();
        const region = mapAnalysis.getRegion(main);
        if (!region) return [main];
        const pathable = mapAnalysis.getPerimeter(region).filter((point) => map.inPathingGrid(point));
        const within = (centre: Point2D, radius: number) =>
            pathable.filter((point) => distance(point, centre) <= radius);

        const geysers = units
            .getGasGeysers()
            .filter((geyser) => distance(geyser.pos!, main) < GEYSER_SEARCH_RADIUS)
            .slice(0, 2);
        const excluded = new Set<Point2D>([
            ...within(main, TOWNHALL_AVOID),
            ...geysers.flatMap((geyser) => within(geyser.pos!, GEYSER_AVOID)),
            ...(ramp ? within(ramp, RAMP_AVOID) : []),
        ]);
        const score = (point: Point2D) => distanceSquared(point, main) + (ramp ? distanceSquared(point, ramp) : 0);
        return pathable.filter((point) => !excluded.has(point)).sort((a, b) => score(b) - score(a));
    };

    const enemyStart = () => res().map.getLocations().enemy[0];
    const ownStart = () => res().map.getLocations().self;

    const enemyPoints = (): Point2D[] => {
        const { map } = res();
        if (map.isArcade()) return [map.getCenter()];
        const start = enemyStart();
        if (!start) return [];
        state.mainPoints.enemy ??= mainPoints(start, res().mapAnalysis.getEnemyMainRamp()?.topCenter);
        return state.mainPoints.enemy;
    };

    const ownPoints = (): Point2D[] => {
        const start = ownStart();
        if (!start) return [];
        if (res().map.isArcade()) return [start];
        state.mainPoints.own ??= mainPoints(start, res().map.getMainBaseRamp()?.topCenter);
        return state.mainPoints.own;
    };

    const primary = (points: Point2D[], start: Point2D): Point2D =>
        points[0] ?? towards(start, res().map.getCenter(), FALLBACK_STEP);

    const eligibleCell = (grid: InfluenceGrid, point: Point2D): number => {
        const { width, height, data } = grid;
        const cx = Math.min(width - 1, Math.max(0, Math.floor(point.x)));
        const cy = Math.min(height - 1, Math.max(0, Math.floor(point.y)));
        if (data[cy * width + cx] !== Infinity) return cy * width + cx;
        const { map } = res();
        const targetHeight = map.getTerrainHeight({ x: cx, y: cy });
        let sameBest = -1;
        let sameD2 = Infinity;
        let anyBest = -1;
        let anyD2 = Infinity;
        for (
            let y = Math.max(0, cy - ELIGIBLE_POINT_RADIUS);
            y <= Math.min(height - 1, cy + ELIGIBLE_POINT_RADIUS);
            y++
        ) {
            for (
                let x = Math.max(0, cx - ELIGIBLE_POINT_RADIUS);
                x <= Math.min(width - 1, cx + ELIGIBLE_POINT_RADIUS);
                x++
            ) {
                const d2 = (x - cx) ** 2 + (y - cy) ** 2;
                if (d2 > ELIGIBLE_POINT_RADIUS ** 2 || data[y * width + x] === Infinity) continue;
                if (d2 < anyD2) {
                    anyBest = y * width + x;
                    anyD2 = d2;
                }
                if (d2 < sameD2 && Math.abs(map.getTerrainHeight({ x, y }) - targetHeight) < SAME_HEIGHT_DELTA) {
                    sameBest = y * width + x;
                    sameD2 = d2;
                }
            }
        }
        return sameBest !== -1 ? sameBest : anyBest;
    };

    const pathWithNyduses = (
        start: Point2D,
        target: Point2D,
        {
            layer = 'ground',
            sensitivity = DEFAULT_SENSITIVITY,
            smoothing = false,
            large = false,
        }: PathOptions & { large?: boolean },
    ): ReturnType<NydusResource['nextPoint']> | undefined => {
        const grid = typeof layer === 'string' ? res().influence.getGrid(layer) : layer;
        if (grid.width === 0 || grid.height === 0) return undefined;
        const startCell = eligibleCell(grid, start);
        const goalCell = eligibleCell(grid, target);
        if (startCell === -1 || goalCell === -1) return undefined;

        const nyduses = ownNyduses().filter((unit) => unit.isFinished());
        const cellOf = (point: Point2D) =>
            Math.min(grid.height - 1, Math.max(0, Math.floor(point.y))) * grid.width +
            Math.min(grid.width - 1, Math.max(0, Math.floor(point.x)));
        const nydusCells = nyduses.map((unit) => cellOf(unit.pos!));
        const path = astarWithNydus(
            grid.data,
            grid.width,
            grid.height,
            startCell,
            goalCell,
            large,
            nydusCells.length > 1 ? nydusCells : [],
        );
        if (!path) return undefined;

        const step = Math.max(1, Math.floor(sensitivity));
        const smooth = (cells: number[]) =>
            smoothing && cells.length >= 3
                ? Array.from(smoothPath(Int32Array.from(cells), grid.data, grid.width))
                : cells;
        const points = (cells: number[]) => cells.map((cell) => cellCentre(cell, grid.width));

        const entryIndex = path.findIndex((cell) => nydusCells.includes(cell));
        if (entryIndex === -1) {
            return { point: points(slice(smooth(path), step, true))[0] ?? target };
        }

        // ma_ext.c repeats the nydus node when the path touches only one, so entry and exit are the same network
        const touched = path.filter((cell) => nydusCells.includes(cell)).length;
        const full =
            touched === 1 ? [...path.slice(0, entryIndex + 1), path[entryIndex], ...path.slice(entryIndex + 1)] : path;
        const first = full.slice(0, entryIndex + 1);
        const second = full.slice(entryIndex + 1);
        const entry = nyduses[nydusCells.indexOf(first[first.length - 1])];
        const exit = nyduses[nydusCells.indexOf(second[0])];
        if (!entry || !exit) return undefined;

        const entryPoints = points(slice(smooth(first), step, true));
        const exitPoints = points(slice(smooth(second), step, false));
        return {
            point: entryPoints[0],
            exitTowards: exitPoints[1] ?? exitPoints[0],
            nydusTags: [entry.tag!, exit.tag!],
        };
    };

    const handleTravellers = () => {
        const nyduses = ownNyduses();
        if (nyduses.length === 0) {
            state.travellers.clear();
            return;
        }
        if (nyduses.length === 1) {
            if (state.travellers.size === 0) return;
            for (const traveller of state.travellers.values()) traveller.exit = nyduses[0].tag!;
        }

        const passengers = [...new Set(nyduses.flatMap((nydus) => (nydus.passengers ?? []).map(({ tag }) => tag!)))];
        const queues = new Map<string, string[]>();
        for (const tag of passengers) {
            const traveller = state.travellers.get(tag);
            if (!traveller) continue;
            const queue = queues.get(traveller.exit) ?? [];
            if (traveller.unitType === UnitType.QUEEN) queue.unshift(tag);
            else queue.push(tag);
            queues.set(traveller.exit, queue);
        }

        const { actions } = res();
        const byTag = new Map(nyduses.map((nydus) => [nydus.tag!, nydus]));
        for (const [exitTag, queue] of queues) {
            const nydus = byTag.get(exitTag);
            if (!nydus || !nydus.isFinished() || queue.length === 0) continue;
            const unitTag = queue[0];
            void actions.do(nydus, Ability.RALLY_BUILDING, { target: state.travellers.get(unitTag)!.exitTowards });
            actions.unloadByTag(nydus, unitTag);
            state.bans.set(unitTag, now());
        }

        const exit = closestToNatural(nyduses).tag!;
        for (const tag of passengers) {
            if (state.travellers.has(tag)) continue;
            // stuck in a nydus, which only happens when it dies during an unload
            state.travellers.set(tag, { entry: exit, exit, exitTowards: res().map.getCenter() });
        }
    };

    const reviewBans = () => {
        const time = now();
        for (const [tag, bannedAt] of state.bans) if (time > bannedAt + TRAVEL_BAN_SECONDS) state.bans.delete(tag);
    };

    const resource: NydusResource = {
        findNydusAtLocation(base, { minBaseDistance = 15, maxNydusDistance = 25, maxCost = 20 } = {}) {
            const enemy = enemyStart();
            if (enemy && distance(base, enemy) === 0) return primary(enemyPoints(), enemy);
            const own = ownStart();
            if (own && distance(base, own) === 0) return primary(ownPoints(), own);

            const { mapAnalysis, influence, spatial, map } = res();
            const region = mapAnalysis.getRegion(base);
            if (!region || region.expansions.length === 0) return undefined;

            const grid = influence.getGrid('ground');
            const bases = region.expansions.map((expansion) => expansion.townhallPosition);
            const costs = mapAnalysis
                .getRegionCells(region)
                .filter(
                    (cell) =>
                        distance(cell, base) <= maxNydusDistance &&
                        Math.min(...bases.map((b) => distance(cell, b))) >= minBaseDistance,
                )
                .map((cell) => ({ cell, cost: grid.get(cell) }));
            if (costs.length === 0) return undefined;

            const minCost = Math.min(...costs.map(({ cost }) => cost));
            if (minCost >= maxCost) return undefined;

            const lowest = costs.filter(({ cost }) => cost === minCost).map(({ cell }) => cell);
            const enemyNear = spatial.anyInRangeBatch(lowest, ENEMY_AVOID_RADIUS, 'enemy');
            const distanced = lowest.filter((_cell, index) => !enemyNear[index]);
            if (distanced.length === 0) return undefined;

            const visible = distanced.filter((cell) => map.isVisible(cell));
            const candidates = visible.length > 0 ? visible : distanced;
            return candidates.reduce((best, cell) => (distance(cell, base) < distance(best, base) ? cell : best));
        },
        getEnemyMainNydusPoints: () => enemyPoints().slice(),
        getOwnMainNydusPoints: () => ownPoints().slice(),
        nextPoint(start, target, opts = {}) {
            sync();
            const key = `${start.x},${start.y},${target.x},${target.y}`;
            const cached = state.pathCache.get(key);
            if (cached && loop() - cached.loop <= PATH_CACHE_LOOPS) return cached.result;

            const result = pathWithNyduses(start, target, opts);
            if (!result) return { point: target };
            state.pathCache.set(key, { loop: loop(), result });
            return result;
        },
        addTraveller(unit, entryTag, exitTag, exitTowards) {
            state.travellers.set(unit.tag!, { entry: entryTag, exit: exitTag, exitTowards, unitType: unit.unitType });
        },
        removeTraveller(tag) {
            state.travellers.delete(tag);
        },
        getTravellers: () => state.travellers,
        isBanned: (tag) => state.bans.has(tag),
    };

    stateByNydus.set(resource, state);
    stepHandlers.set(resource, () => {
        sync();
        if (world.agent.race !== Race.ZERG || res().map.isArcade()) return;
        handleTravellers();
        reviewBans();
    });
    return resource;
}

export const nydusResource: ResourceDefinition<'nydus'> = {
    name: 'nydus',
    create: (world) => createNydusResource(world),
    reset(resource) {
        const state = stateByNydus.get(resource)!;
        Object.assign(state, freshState());
        delete state.syncedLoop;
    },
    onStep(resource) {
        stepHandlers.get(resource)!();
    },
};
