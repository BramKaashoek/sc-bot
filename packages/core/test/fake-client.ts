import { EventEmitter } from 'node:events';
import { consumeImageData, consumeRawGrids } from '../utils/map/grid.ts';
import { getFootprint } from '../utils/geometry/units.ts';
import { mineralFieldTypes, townhallTypes, vespeneGeyserTypes } from '../constants/groups.ts';
import { Race } from '../constants/enums.ts';
import * as UnitType from '../constants/unit-type.ts';
import type { Footprint, Point2D } from '../types.ts';

export type QueryRecord = { request: SC2APIProtocol.RequestQuery; response: SC2APIProtocol.ResponseQuery };

export type FixtureQueries = Record<number, QueryRecord[]>;

export type FixtureAbilities = Record<number, Record<string, number[]>>;

export type Fixture = {
    gameInfo: SC2APIProtocol.ResponseGameInfo;
    // SC2 only adds neutral rocks and towers to the pathing grid once the game has stepped
    liveGameInfo?: SC2APIProtocol.ResponseGameInfo;
    data: SC2APIProtocol.ResponseData;
    observations: Record<number, SC2APIProtocol.ResponseObservation>;
    abilities?: FixtureAbilities;
    queries?: FixtureQueries;
};

export type SentRequests = {
    createGame: SC2APIProtocol.RequestCreateGame[];
    actions: SC2APIProtocol.RequestAction[];
    debug: SC2APIProtocol.RequestDebug[];
    queries: SC2APIProtocol.RequestQuery[];
    obs: SC2APIProtocol.RequestObserverAction[];
    saveReplay: SC2APIProtocol.RequestSaveReplay[];
    leaveGame: SC2APIProtocol.RequestLeaveGame[];
    quickSave: SC2APIProtocol.RequestQuickSave[];
    quickLoad: SC2APIProtocol.RequestQuickLoad[];
    step: SC2APIProtocol.RequestStep[];
};

export type FakeClientOptions = {
    fixture: Fixture;
    onQuery?: (query: SC2APIProtocol.RequestQuery) => SC2APIProtocol.ResponseQuery | undefined;
    recordedAnswers?: boolean;
};

export type FakeClient = NodeSC2Proto.ProtoClient & {
    sent: SentRequests;
    fixture: Fixture;
    setObservation(observation: SC2APIProtocol.ResponseObservation): void;
    obsAction(request: SC2APIProtocol.RequestObserverAction): Promise<SC2APIProtocol.ResponseObserverAction>;
    saveReplay(request?: SC2APIProtocol.RequestSaveReplay): Promise<SC2APIProtocol.ResponseSaveReplay>;
    leaveGame(request?: SC2APIProtocol.RequestLeaveGame): Promise<SC2APIProtocol.ResponseLeaveGame>;
    quickSave(request?: SC2APIProtocol.RequestQuickSave): Promise<SC2APIProtocol.ResponseQuickSave>;
    quickLoad(request?: SC2APIProtocol.RequestQuickLoad): Promise<SC2APIProtocol.ResponseQuickLoad>;
    close(): void;
};

const SUCCESS = 1 as SC2APIProtocol.ActionResult;
const ERROR = 3 as SC2APIProtocol.ActionResult;
const CANT_BUILD_LOCATION_INVALID = 44 as SC2APIProtocol.ActionResult;
const CANT_BUILD_TOO_CLOSE_TO_RESOURCES = 47 as SC2APIProtocol.ActionResult;
const MUST_BUILD_ON_CREEP = 49 as SC2APIProtocol.ActionResult;
const MUST_BUILD_IN_POWER = 50 as SC2APIProtocol.ActionResult;
const LAUNCHED = 1 as SC2APIProtocol.Status;
const INIT_GAME = 2 as SC2APIProtocol.Status;
const IN_GAME = 3 as SC2APIProtocol.Status;
const RESOURCE_EXCLUSION = 3;
const UNBUILDABLE_PATHABLE_TYPES = [
    UnitType.UNBUILDABLEROCKSDESTRUCTIBLE,
    UnitType.UNBUILDABLEBRICKSDESTRUCTIBLE,
    UnitType.UNBUILDABLEPLATESDESTRUCTIBLE,
];
// the engine's townhall no-build zone is the resource footprint grown by 3 cells, minus the outermost corners
const EXCLUSION_OFFSETS = Array.from({ length: (RESOURCE_EXCLUSION * 2 + 1) ** 2 }, (_unused, index) => [
    (index % (RESOURCE_EXCLUSION * 2 + 1)) - RESOURCE_EXCLUSION,
    Math.floor(index / (RESOURCE_EXCLUSION * 2 + 1)) - RESOURCE_EXCLUSION,
]).filter(([dx, dy]) => Math.abs(dx) !== RESOURCE_EXCLUSION || Math.abs(dy) !== RESOURCE_EXCLUSION);
const CREEP_FREE_ZERG_TYPES = [UnitType.HATCHERY, UnitType.EXTRACTOR, UnitType.EXTRACTORRICH];
const UNPOWERED_PROTOSS_TYPES = [UnitType.NEXUS, UnitType.PYLON, UnitType.ASSIMILATOR, UnitType.ASSIMILATORRICH];

const DIRECTIONS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
];

const cellKey = (x: number, y: number) => `${x},${y}`;

const pointKey = (point?: SC2APIProtocol.Point2D) => (point ? `${point.x},${point.y}` : '');

export const placementKey = ({ abilityId, targetPos }: SC2APIProtocol.RequestQueryBuildingPlacement) =>
    `${abilityId}@${pointKey(targetPos)}`;

export const pathingKey = ({ unitTag, startPos, endPos }: SC2APIProtocol.RequestQueryPathing) =>
    `${unitTag ?? pointKey(startPos)}->${pointKey(endPos)}`;

function footprintCells({ x, y }: Point2D, { w, h }: Footprint): Point2D[] {
    const left = Math.round(x - w / 2);
    const bottom = Math.round(y - h / 2);
    return Array.from({ length: w * h }, (_unused, index) => ({
        x: left + (index % w),
        y: bottom + Math.floor(index / w),
    }));
}

class MinHeap {
    private items: { key: number; priority: number }[] = [];

    get size() {
        return this.items.length;
    }

    push(key: number, priority: number) {
        const { items } = this;
        items.push({ key, priority });
        let index = items.length - 1;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (items[parent].priority <= items[index].priority) break;
            [items[parent], items[index]] = [items[index], items[parent]];
            index = parent;
        }
    }

    pop(): number {
        const { items } = this;
        const top = items[0];
        const last = items.pop()!;
        if (items.length > 0) {
            items[0] = last;
            let index = 0;
            for (;;) {
                const left = index * 2 + 1;
                const right = left + 1;
                let smallest = index;
                if (left < items.length && items[left].priority < items[smallest].priority) smallest = left;
                if (right < items.length && items[right].priority < items[smallest].priority) smallest = right;
                if (smallest === index) break;
                [items[smallest], items[index]] = [items[index], items[smallest]];
                index = smallest;
            }
        }
        return top.key;
    }
}

function createPathfinder(width: number, height: number, walkable: (x: number, y: number) => boolean) {
    const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
    const open = (x: number, y: number) => inBounds(x, y) && walkable(x, y);

    // Amanatides–Woo traversal; a segment through a cell corner must clear both side cells
    const lineOfSight = (from: Point2D, to: Point2D) => {
        let x = Math.floor(from.x);
        let y = Math.floor(from.y);
        const endX = Math.floor(to.x);
        const endY = Math.floor(to.y);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const stepX = Math.sign(dx);
        const stepY = Math.sign(dy);
        const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
        const deltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
        let maxX = stepX === 0 ? Infinity : (stepX > 0 ? x + 1 - from.x : from.x - x) * deltaX;
        let maxY = stepY === 0 ? Infinity : (stepY > 0 ? y + 1 - from.y : from.y - y) * deltaY;
        let remaining = Math.abs(endX - x) + Math.abs(endY - y);
        if (!open(x, y)) return false;
        while (remaining > 0) {
            if (Math.abs(maxX - maxY) < 1e-9) {
                if (!open(x + stepX, y) || !open(x, y + stepY)) return false;
                x += stepX;
                y += stepY;
                maxX += deltaX;
                maxY += deltaY;
                remaining -= 2;
            } else if (maxX < maxY) {
                x += stepX;
                maxX += deltaX;
                remaining -= 1;
            } else {
                y += stepY;
                maxY += deltaY;
                remaining -= 1;
            }
            if (!open(x, y)) return false;
        }
        return true;
    };

    // the engine still answers for an endpoint one cell off the pathable area, measured to that neighbouring cell
    const snap = (point: Point2D): Point2D | undefined => {
        const x = Math.floor(point.x);
        const y = Math.floor(point.y);
        if (open(x, y)) return point;
        const [nearest] = DIRECTIONS.map(([dx, dy]) => ({ x: x + dx + 0.5, y: y + dy + 0.5 }))
            .filter((cell) => open(Math.floor(cell.x), Math.floor(cell.y)))
            .sort(
                (first, second) =>
                    Math.hypot(first.x - point.x, first.y - point.y) -
                    Math.hypot(second.x - point.x, second.y - point.y),
            );
        return nearest;
    };

    // engine paths are any-angle; octile grid paths ran 4-10% long against recorded answers
    return (from: Point2D, to: Point2D): number | undefined => {
        const start = snap(from);
        const end = snap(to);
        if (!start || !end) return undefined;
        const startX = Math.floor(start.x);
        const startY = Math.floor(start.y);
        const endX = Math.floor(end.x);
        const endY = Math.floor(end.y);

        const startKey = startY * width + startX;
        const endKey = endY * width + endX;
        const position = (key: number): Point2D => {
            if (key === startKey) return start;
            if (key === endKey) return end;
            return { x: (key % width) + 0.5, y: Math.floor(key / width) + 0.5 };
        };
        const distance = (first: Point2D, second: Point2D) => Math.hypot(first.x - second.x, first.y - second.y);

        const cost = new Map<number, number>([[startKey, 0]]);
        const parent = new Map<number, number>([[startKey, startKey]]);
        const closed = new Set<number>();
        const heap = new MinHeap();
        heap.push(startKey, distance(start, end));

        while (heap.size > 0) {
            const current = heap.pop();
            if (closed.has(current)) continue;
            const currentPosition = position(current);

            const currentParent = parent.get(current)!;
            if (current !== startKey && !lineOfSight(position(currentParent), currentPosition)) {
                let best = Infinity;
                let bestParent = currentParent;
                const currentX = current % width;
                const currentY = Math.floor(current / width);
                DIRECTIONS.forEach(([dx, dy]) => {
                    const neighbour = (currentY + dy) * width + currentX + dx;
                    if (!closed.has(neighbour) || !open(currentX + dx, currentY + dy)) return;
                    const candidate = cost.get(neighbour)! + distance(position(neighbour), currentPosition);
                    if (candidate < best) {
                        best = candidate;
                        bestParent = neighbour;
                    }
                });
                cost.set(current, best);
                parent.set(current, bestParent);
            }

            closed.add(current);
            if (current === endKey) return cost.get(current)!;

            const x = current % width;
            const y = Math.floor(current / width);
            const parentKey = parent.get(current)!;
            const parentPosition = position(parentKey);
            DIRECTIONS.forEach(([dx, dy]) => {
                const nextX = x + dx;
                const nextY = y + dy;
                if (!open(nextX, nextY) || (dx !== 0 && dy !== 0 && (!open(x + dx, y) || !open(x, y + dy)))) return;
                const neighbour = nextY * width + nextX;
                if (closed.has(neighbour)) return;
                const candidate = cost.get(parentKey)! + distance(parentPosition, position(neighbour));
                if (candidate < (cost.get(neighbour) ?? Infinity)) {
                    cost.set(neighbour, candidate);
                    parent.set(neighbour, parentKey);
                    heap.push(neighbour, candidate + distance(position(neighbour), end));
                }
            });
        }
        return undefined;
    };
}

export function createFakeClient({ fixture, onQuery, recordedAnswers = true }: FakeClientOptions): FakeClient {
    const startRaw = fixture.gameInfo.startRaw!;
    const { x: width, y: height } = startRaw.mapSize! as Required<SC2APIProtocol.Size2DI>;
    const grids = consumeRawGrids(startRaw);
    const [firstLoop] = Object.keys(fixture.observations)
        .map(Number)
        .sort((a, b) => a - b);

    let currentObservation = fixture.observations[firstLoop];

    const sent: SentRequests = {
        createGame: [],
        actions: [],
        debug: [],
        queries: [],
        obs: [],
        saveReplay: [],
        leaveGame: [],
        quickSave: [],
        quickLoad: [],
        step: [],
    };

    const currentLoop = () => currentObservation?.observation?.gameLoop ?? 0;
    const currentUnits = () => currentObservation?.observation?.rawData?.units ?? [];
    const unitData = (unitTypeId: number) => fixture.data.units?.[unitTypeId];

    const recorded = (loop: number) => {
        const placements = new Map<string, SC2APIProtocol.ResponseQueryBuildingPlacement>();
        const pathing = new Map<string, SC2APIProtocol.ResponseQueryPathing>();
        (fixture.queries?.[loop] ?? []).forEach(({ request, response }) => {
            (request.placements ?? []).forEach((placement, index) =>
                placements.set(placementKey(placement), response.placements![index]),
            );
            (request.pathing ?? []).forEach((path, index) => pathing.set(pathingKey(path), response.pathing![index]));
        });
        return { placements, pathing };
    };

    const structureFootprint = (unit: SC2APIProtocol.Unit): Footprint | undefined =>
        unit.isFlying ? undefined : getFootprint(unit.unitType!, fixture.data);

    const blockedCells = (blocks: (unit: SC2APIProtocol.Unit) => boolean = () => true) =>
        new Set(
            currentUnits()
                .filter(blocks)
                .flatMap((unit) => {
                    const footprint = structureFootprint(unit);
                    return footprint ? footprintCells(unit.pos as Point2D, footprint) : [];
                })
                .map(({ x, y }) => cellKey(x, y)),
        );

    const resourceExclusion = () =>
        new Set(
            currentUnits()
                .filter((unit) => [...mineralFieldTypes, ...vespeneGeyserTypes].includes(unit.unitType!))
                .flatMap((unit) =>
                    footprintCells(unit.pos as Point2D, getFootprint(unit.unitType!, fixture.data) ?? { w: 3, h: 3 }),
                )
                .flatMap((cell) => EXCLUSION_OFFSETS.map(([dx, dy]) => cellKey(cell.x + dx, cell.y + dy))),
        );

    const creepGrid = () => {
        const creep = currentObservation?.observation?.rawData?.mapState?.creep;
        return creep ? consumeImageData(creep, width, height) : undefined;
    };

    const powered = (point: Point2D) =>
        (currentObservation?.observation?.rawData?.player?.powerSources ?? []).some(
            (source) => Math.hypot(source.pos!.x! - point.x, source.pos!.y! - point.y) <= source.radius!,
        );

    const placementResult = (request: SC2APIProtocol.RequestQueryBuildingPlacement, blocked: Set<string>) => {
        const built = fixture.data.units!.find((unitType) => unitType?.abilityId === request.abilityId);
        const radius = fixture.data.abilities?.[request.abilityId!]?.footprintRadius;
        const footprint = radius
            ? { w: radius * 2, h: radius * 2 }
            : built && getFootprint(built.unitId!, fixture.data);
        if (!footprint || !request.targetPos) return ERROR;

        const target = request.targetPos as Point2D;
        const race = built?.race;
        if (race === Race.PROTOSS && !UNPOWERED_PROTOSS_TYPES.includes(built!.unitId!) && !powered(target))
            return MUST_BUILD_IN_POWER;

        const cells = footprintCells(target, footprint);
        const placeable = cells.every(
            (cell) => grids.placement![cell.y]?.[cell.x] === 1 && !blocked.has(cellKey(cell.x, cell.y)),
        );
        if (!placeable) return CANT_BUILD_LOCATION_INVALID;

        if (built && townhallTypes.includes(built.unitId!)) {
            const excluded = resourceExclusion();
            if (cells.some((cell) => excluded.has(cellKey(cell.x, cell.y)))) return CANT_BUILD_TOO_CLOSE_TO_RESOURCES;
        }

        const creep = creepGrid();
        const onCreep = (cell: Point2D) => creep?.[cell.y]?.[cell.x] === 1;
        if (race === Race.ZERG && !CREEP_FREE_ZERG_TYPES.includes(built!.unitId!) && !cells.every(onCreep))
            return MUST_BUILD_ON_CREEP;

        return SUCCESS;
    };

    const pathingDistance = (request: SC2APIProtocol.RequestQueryPathing, blocked: Set<string>) => {
        const startUnit = request.unitTag ? currentUnits().find((unit) => unit.tag === request.unitTag) : undefined;
        const start = (startUnit ? startUnit.pos : request.startPos) as Point2D;
        if (!start || !request.endPos) return 0;
        const findPath = createPathfinder(
            width,
            height,
            (x, y) => grids.pathing![y][x] === 0 && !blocked.has(cellKey(x, y)),
        );
        return findPath(start, request.endPos as Point2D) ?? 0;
    };

    const abilitiesAt = (tag: string) => {
        const loop = currentLoop();
        const [recordedLoop] = Object.keys(fixture.abilities ?? {})
            .map(Number)
            .filter((captured) => captured <= loop)
            .sort((a, b) => b - a);
        return recordedLoop === undefined ? [] : (fixture.abilities![recordedLoop][tag] ?? []);
    };

    const answerQuery = (query: SC2APIProtocol.RequestQuery): SC2APIProtocol.ResponseQuery => {
        const known = recordedAnswers ? recorded(currentLoop()) : { placements: new Map(), pathing: new Map() };
        const blocked = blockedCells();
        const pathingBlocked = blockedCells((unit) => !UNBUILDABLE_PATHABLE_TYPES.includes(unit.unitType!));
        return {
            pathing: (query.pathing ?? []).map(
                (request) =>
                    known.pathing.get(pathingKey(request)) ?? { distance: pathingDistance(request, pathingBlocked) },
            ),
            abilities: (query.abilities ?? []).map((request) => ({
                unitTag: request.unitTag,
                unitTypeId: currentUnits().find((unit) => unit.tag === request.unitTag)?.unitType,
                abilities: abilitiesAt(request.unitTag!).map((abilityId) => ({ abilityId })),
            })),
            placements: (query.placements ?? []).map(
                (request) =>
                    known.placements.get(placementKey(request)) ?? { result: placementResult(request, blocked) },
            ),
        };
    };

    const client = {
        _ws: new EventEmitter(),
        _protoApiQueue: new EventEmitter(),
        _request() {},
        status: IN_GAME,
        sent,
        fixture,
        setObservation(observation: SC2APIProtocol.ResponseObservation) {
            currentObservation = observation;
        },
        async connect() {
            return {};
        },
        async ping() {
            return {};
        },
        async createGame(request: SC2APIProtocol.RequestCreateGame) {
            sent.createGame.push(request);
            client.status = INIT_GAME;
            return {};
        },
        async joinGame() {
            client.status = IN_GAME;
            return { playerId: currentObservation.observation?.playerCommon?.playerId ?? 1 };
        },
        async gameInfo() {
            return sent.step.length > 0 ? (fixture.liveGameInfo ?? fixture.gameInfo) : fixture.gameInfo;
        },
        async data() {
            return fixture.data;
        },
        async observation() {
            return currentObservation;
        },
        async step(request: SC2APIProtocol.RequestStep) {
            sent.step.push(request);
            return { simulationLoop: currentObservation.observation?.gameLoop };
        },
        async action(request: SC2APIProtocol.RequestAction) {
            sent.actions.push(request);
            return { result: (request.actions ?? []).map(() => SUCCESS) };
        },
        async debug(request: SC2APIProtocol.RequestDebug) {
            sent.debug.push(request);
            return {};
        },
        async query(request: SC2APIProtocol.RequestQuery) {
            sent.queries.push(request);
            return onQuery?.(request) ?? answerQuery(request);
        },
        async obsAction(request: SC2APIProtocol.RequestObserverAction) {
            sent.obs.push(request);
            return {};
        },
        async saveReplay(request: SC2APIProtocol.RequestSaveReplay = {}) {
            sent.saveReplay.push(request);
            if (client.status === LAUNCHED) throw new Error('Response Error: Not in a game');
            return {};
        },
        async leaveGame(request: SC2APIProtocol.RequestLeaveGame = {}) {
            sent.leaveGame.push(request);
            client.status = LAUNCHED;
            return {};
        },
        async quickSave(request: SC2APIProtocol.RequestQuickSave = {}) {
            sent.quickSave.push(request);
            return {};
        },
        async quickLoad(request: SC2APIProtocol.RequestQuickLoad = {}) {
            sent.quickLoad.push(request);
            return {};
        },
        close() {},
    };

    // TODO(ts): _ws is a ws WebSocket in the proto typings; the engine only subscribes to it
    return client as unknown as FakeClient;
}
