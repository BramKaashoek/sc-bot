import { PixelMap } from '../pixel-map.ts';
import { ConnectionClosedError, GameEndedError } from '../../engine/errors.ts';
import type { Point2D, Unit, World } from '../../types.ts';

type Blocker = Pick<Unit, 'pos' | 'radius'>;

function blockerBox(world: World, { pos, radius = 0 }: Blocker): Point2D[] {
    const { x: width = 0, y: height = 0 } = world.resources.get().map._mapSize;
    const cells: Point2D[] = [];
    for (let x = Math.max(0, Math.floor(pos.x - radius)); x < Math.min(width, pos.x + radius); x++) {
        for (let y = Math.max(0, Math.floor(pos.y - radius)); y < Math.min(height, pos.y + radius); y++) {
            if (Math.abs(x + 0.5 - pos.x) < radius && Math.abs(y + 0.5 - pos.y) < radius) cells.push({ x, y });
        }
    }
    return cells;
}

const liveGrids = new WeakMap<
    World,
    { game: SC2APIProtocol.ResponseGameInfo; gameLoop: number; grid: Promise<PixelMap | undefined> }
>();

async function requestLivePathing(world: World): Promise<PixelMap | undefined> {
    try {
        const { pathingGrid } = (await world.resources.get().actions._client.gameInfo()).startRaw!;
        return new PixelMap(pathingGrid as ConstructorParameters<typeof PixelMap>[0]);
    } catch (e) {
        if (e instanceof GameEndedError || e instanceof ConnectionClosedError) throw e;
        console.warn('Could not read the live pathing grid, so rocks keep their footprints', e);
        return undefined;
    }
}

// the game info requested at game start has no flat rocks or towers in its pathing grid; it does once the game has stepped
function livePathing(world: World): Promise<PixelMap | undefined> {
    const { frame } = world.resources.get();
    const game = frame.getGameInfo();
    const gameLoop = frame.getGameLoop();
    const cached = liveGrids.get(world);
    if (cached?.game === game && cached.gameLoop === gameLoop) return cached.grid;

    const grid = requestLivePathing(world);
    liveGrids.set(world, { game, gameLoop, grid });
    return grid;
}

function claimableCells(world: World, blocker: Blocker, live: PixelMap): Point2D[] {
    return blockerBox(world, blocker).filter((cell) => live.isEmpty(cell));
}

// a cell still blocked after the rock died belongs to a cliff, a resource or another blocker
function releasableCells(world: World, blocker: Blocker, rockCells: Point2D[], live: PixelMap) {
    const { map } = world.resources.get();
    return {
        pathing: [...blockerBox(world, blocker), ...rockCells].filter((cell) => live.isSet(cell)),
        placement: rockCells.filter((cell) => live.isSet(cell) && map.inPlacementGrid(cell)),
    };
}

export { claimableCells, livePathing, releasableCells };
