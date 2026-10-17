import { EventEmitter } from 'node:events';
import PF from 'pathfinding';
import { consumeRawGrids } from '../utils/map/grid.ts';
import { cellsInFootprint } from '../utils/geometry/plane.ts';
import { createPoint2D } from '../utils/geometry/point.ts';
import { getFootprint } from '../utils/geometry/units.ts';
import type { Grid2D, Point2D } from '../types.ts';

export type Fixture = {
    gameInfo: SC2APIProtocol.ResponseGameInfo;
    data: SC2APIProtocol.ResponseData;
    observations: Record<number, SC2APIProtocol.ResponseObservation>;
    abilities?: Record<string, number[]>;
};

export type SentRequests = {
    actions: SC2APIProtocol.RequestAction[];
    debug: SC2APIProtocol.RequestDebug[];
    queries: SC2APIProtocol.RequestQuery[];
    obs: SC2APIProtocol.RequestObserverAction[];
    saveReplay: SC2APIProtocol.RequestSaveReplay[];
    leaveGame: SC2APIProtocol.RequestLeaveGame[];
};

export type FakeClientOptions = {
    fixture: Fixture;
    onQuery?: (query: SC2APIProtocol.RequestQuery) => SC2APIProtocol.ResponseQuery | undefined;
};

export type FakeClient = NodeSC2Proto.ProtoClient & {
    sent: SentRequests;
    fixture: Fixture;
    setObservation(observation: SC2APIProtocol.ResponseObservation): void;
    obsAction(request: SC2APIProtocol.RequestObserverAction): Promise<SC2APIProtocol.ResponseObserverAction>;
    saveReplay(request?: SC2APIProtocol.RequestSaveReplay): Promise<SC2APIProtocol.ResponseSaveReplay>;
    leaveGame(request?: SC2APIProtocol.RequestLeaveGame): Promise<SC2APIProtocol.ResponseLeaveGame>;
    close(): void;
};

const SUCCESS = 1 as SC2APIProtocol.ActionResult;
const ERROR = 3 as SC2APIProtocol.ActionResult;
const CANT_BUILD_LOCATION_INVALID = 44 as SC2APIProtocol.ActionResult;
const IN_GAME = 3 as SC2APIProtocol.Status;

type PFGrid = PF.Grid;
// TODO(ts): @types/pathfinding lacks the (width, height, matrix) constructor overload
const PFGridCtor = PF.Grid as unknown as new (width: number, height: number, matrix?: Grid2D | number[][]) => PFGrid;

const cellKey = ({ x, y }: Point2D) => `${x},${y}`;

function pathLength(path: number[][]): number {
    return path.slice(1).reduce((total, [x, y], index) => {
        const [previousX, previousY] = path[index];
        return total + Math.hypot(x - previousX, y - previousY);
    }, 0);
}

export function createFakeClient({ fixture, onQuery }: FakeClientOptions): FakeClient {
    const startRaw = fixture.gameInfo.startRaw!;
    const { x: width, y: height } = startRaw.mapSize! as Required<SC2APIProtocol.Size2DI>;
    const grids = consumeRawGrids(startRaw);
    const pathingGraph = new PFGridCtor(width, height, grids.pathing);
    const [firstLoop] = Object.keys(fixture.observations).map(Number).sort((a, b) => a - b);

    let currentObservation = fixture.observations[firstLoop];

    const sent: SentRequests = {
        actions: [],
        debug: [],
        queries: [],
        obs: [],
        saveReplay: [],
        leaveGame: [],
    };

    const currentUnits = () => currentObservation?.observation?.rawData?.units ?? [];

    const blockedCells = () => new Set(
        currentUnits()
            .filter(unit => !unit.isFlying)
            .flatMap((unit) => {
                const footprint = getFootprint(unit.unitType!);
                return footprint ? cellsInFootprint(createPoint2D(unit.pos as Point2D), footprint) : [];
            })
            .map(cellKey)
    );

    const placementResult = (request: SC2APIProtocol.RequestQueryBuildingPlacement, blocked: Set<string>) => {
        const unitData = fixture.data.units!.find(unitType => unitType?.abilityId === request.abilityId);
        const footprint = unitData && getFootprint(unitData.unitId!);
        if (!footprint || !request.targetPos) return ERROR;

        const cells = cellsInFootprint(createPoint2D(request.targetPos as Point2D), footprint);
        const placeable = cells.every(cell => (
            grids.placement![cell.y]?.[cell.x] === 1 && !blocked.has(cellKey(cell))
        ));
        return placeable ? SUCCESS : CANT_BUILD_LOCATION_INVALID;
    };

    const pathingDistance = (request: SC2APIProtocol.RequestQueryPathing) => {
        const startUnit = request.unitTag ? currentUnits().find(unit => unit.tag === request.unitTag) : undefined;
        const start = createPoint2D((startUnit ? startUnit.pos : request.startPos) as Point2D);
        const end = createPoint2D(request.endPos as Point2D);
        const finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: true, heuristic: PF.Heuristic.octile });
        return pathLength(finder.findPath(start.x, start.y, end.x, end.y, pathingGraph.clone()));
    };

    const answerQuery = (query: SC2APIProtocol.RequestQuery): SC2APIProtocol.ResponseQuery => {
        const blocked = blockedCells();
        return {
            pathing: (query.pathing ?? []).map(request => ({ distance: pathingDistance(request) })),
            abilities: (query.abilities ?? []).map(request => ({
                unitTag: request.unitTag,
                unitTypeId: currentUnits().find(unit => unit.tag === request.unitTag)?.unitType,
                abilities: (fixture.abilities?.[request.unitTag!] ?? []).map(abilityId => ({ abilityId })),
            })),
            placements: (query.placements ?? []).map(request => ({ result: placementResult(request, blocked) })),
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
        async connect() { return {}; },
        async ping() { return {}; },
        async createGame() { return {}; },
        async joinGame() { return { playerId: currentObservation.observation?.playerCommon?.playerId ?? 1 }; },
        async gameInfo() { return fixture.gameInfo; },
        async data() { return fixture.data; },
        async observation() { return currentObservation; },
        async step() { return { simulationLoop: currentObservation.observation?.gameLoop }; },
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
            return {};
        },
        async leaveGame(request: SC2APIProtocol.RequestLeaveGame = {}) {
            sent.leaveGame.push(request);
            return {};
        },
        close() {},
    };

    // TODO(ts): _ws is a ws WebSocket in the proto typings; the engine only subscribes to it
    return client as unknown as FakeClient;
}
