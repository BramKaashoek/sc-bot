import type { Point2D } from '../types.ts';

export type SpawnClient = {
    debug(request: SC2APIProtocol.RequestDebug): Promise<unknown>;
    observation(request?: SC2APIProtocol.RequestObservation): Promise<SC2APIProtocol.ResponseObservation>;
    step(request: SC2APIProtocol.RequestStep): Promise<unknown>;
};

export type SpawnRequest = {
    unitType: number;
    owner: number;
    pos: Point2D;
    quantity?: number;
};

export type SpawnOptions = {
    attempts?: number;
    stepCount?: number;
    retryDistance?: number;
};

const RETRY_DIRECTIONS = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
];

const retryPosition = ({ x, y }: Point2D, attempt: number, retryDistance: number): Point2D => {
    if (attempt === 0) return { x, y };
    const [dx, dy] = RETRY_DIRECTIONS[(attempt - 1) % RETRY_DIRECTIONS.length];
    const ring = Math.ceil(attempt / RETRY_DIRECTIONS.length);
    return { x: x + dx * retryDistance * ring, y: y + dy * retryDistance * ring };
};

// 4.10 sometimes silently drops a debug createUnit at a spot that passed a placement query
export async function spawnUnits(
    client: SpawnClient,
    request: SpawnRequest,
    { attempts = 9, stepCount = 4, retryDistance = 1 }: SpawnOptions = {},
): Promise<SC2APIProtocol.Unit[]> {
    const quantity = request.quantity ?? 1;
    const ownedOfType = async () =>
        ((await client.observation()).observation?.rawData?.units ?? []).filter(
            (unit) => unit.unitType === request.unitType && unit.owner === request.owner,
        );
    const existing = new Set((await ownedOfType()).map((unit) => unit.tag));
    let spawned: SC2APIProtocol.Unit[] = [];

    for (let attempt = 0; attempt < attempts && spawned.length < quantity; attempt += 1) {
        await client.debug({
            debug: [
                {
                    createUnit: {
                        unitType: request.unitType,
                        owner: request.owner,
                        pos: retryPosition(request.pos, attempt, retryDistance),
                        quantity: quantity - spawned.length,
                    },
                },
            ],
        });
        await client.step({ count: stepCount });
        spawned = (await ownedOfType()).filter((unit) => !existing.has(unit.tag));
    }

    if (spawned.length < quantity) {
        throw new Error(
            `spawned ${spawned.length}/${quantity} of unit type ${request.unitType} near ${JSON.stringify(request.pos)}`,
        );
    }
    return spawned;
}
