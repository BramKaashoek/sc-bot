import { describe, expect, it } from 'bun:test';
import { createTestWorld } from '../test/create-test-world.ts';
import { addCircle } from '../utils/grid/stamp.ts';
import type { InfluenceGrid, Point2D } from '../types.ts';

function grid(width = 20, height = 20): InfluenceGrid {
    const data = new Float32Array(width * height).fill(1);
    return {
        layer: 'ground',
        width,
        height,
        data,
        get: ({ x, y }) => data[Math.floor(y) * width + Math.floor(x)] ?? Infinity,
    };
}

const block = (layer: InfluenceGrid, cells: Array<[number, number]>) =>
    cells.forEach(([x, y]) => {
        layer.data[y * layer.width + x] = Infinity;
    });

const square = (cx: number, cy: number, r: number): Array<[number, number]> =>
    Array.from({ length: (2 * r + 1) ** 2 }, (_, i) => [
        cx - r + (i % (2 * r + 1)),
        cy - r + Math.floor(i / (2 * r + 1)),
    ]);

async function pathing() {
    const world = await createTestWorld('blueshift', { loop: 896 });
    return world.resources.get().pathing;
}

describe('PathingResource', () => {
    it('finds cell-centre paths around costs, retargets a blocked goal within 3 cells and clamps endpoints', async () => {
        const { findPath } = await pathing();
        const costly = grid();
        addCircle(costly.data, 20, 20, 10, 10, 2, 100);
        const blockedGoal = grid();
        block(blockedGoal, [[17, 10]]);
        const walledGoal = grid();
        block(walledGoal, square(17, 10, 3));

        const around = findPath({ x: 2.5, y: 10.5 }, { x: 17.5, y: 10.5 }, { layer: costly });
        expect(around.at(-1)).toEqual({ x: 17.5, y: 10.5 });
        expect(around.every((point) => costly.get(point) === 1)).toBe(true);

        const retargeted = findPath({ x: 2.5, y: 10.5 }, { x: 17.5, y: 10.5 }, { layer: blockedGoal }).at(-1)!;
        expect(Math.hypot(retargeted.x - 17.5, retargeted.y - 10.5)).toBeLessThanOrEqual(3);
        expect(findPath({ x: 2.5, y: 10.5 }, { x: 17.5, y: 10.5 }, { layer: walledGoal })).toEqual([]);

        const clamped = findPath({ x: -5, y: 10.5 }, { x: 99, y: 10.5 }, { layer: grid() });
        expect([clamped[0], clamped.at(-1), clamped.length]).toEqual([{ x: 1.5, y: 10.5 }, { x: 19.5, y: 10.5 }, 19]);
    });

    it('returns the goal untouched without danger near the start, otherwise the sensitivity-th path point', async () => {
        const { nextPoint } = await pathing();
        const goal = { x: 17.5, y: 10.5 };
        const farDanger = grid(60, 20);
        addCircle(farDanger.data, 60, 20, 50, 10, 1, 10);
        farDanger.data[10 * 60 + 10] = Infinity;
        const nearDanger = grid();
        addCircle(nearDanger.data, 20, 20, 6, 15, 1, 10);
        const unreachable = grid();
        addCircle(unreachable.data, 20, 20, 6, 15, 1, 10);
        block(unreachable, square(17, 10, 4));

        expect(nextPoint({ x: 2.5, y: 10.5 }, goal, { layer: farDanger })).toBe(goal);
        expect(nextPoint({ x: 2.5, y: 10.5 }, goal, { layer: nearDanger })).toEqual({ x: 7.5, y: 10.5 });
        expect(nextPoint({ x: 2.5, y: 10.5 }, goal, { layer: nearDanger, sensitivity: 50 })).toEqual(goal);
        expect(nextPoint({ x: 2.5, y: 10.5 }, goal, { layer: unreachable })).toBe(goal);
    });

    it('finds the cheapest closest spot outside a stamped circle and checks safety against a limit', async () => {
        const { closestSafeSpot, isPositionSafe } = await pathing();
        const threatened = grid();
        addCircle(threatened.data, 20, 20, 10, 10, 3, 10);
        const from: Point2D = { x: 10.5, y: 10.5 };

        const spot = closestSafeSpot(from, { layer: threatened })!;
        expect([threatened.get(spot), Math.hypot(spot.x - from.x, spot.y - from.y)]).toEqual([1, Math.sqrt(10)]);
        expect([
            isPositionSafe(from, { layer: threatened }),
            isPositionSafe(from, { layer: threatened, limit: 11 }),
            closestSafeSpot(from, { layer: threatened, radius: 2 }),
        ]).toEqual([false, true, { x: 10.5, y: 10.5 }]);
    });

    it('reads influence layers by name and switches A* buffers between grid sizes', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { pathing: resource, influence } = world.resources.get();
        const start = { x: 27.5, y: 28.5 };
        influence.addCost('ground', start, 0, 50);

        expect(resource.isPositionSafe(start)).toBe(false);
        expect(resource.findPath(start, { x: 30.5, y: 28.5 }).at(-1)).toEqual({ x: 30.5, y: 28.5 });
        expect(resource.findPath({ x: 2.5, y: 2.5 }, { x: 5.5, y: 2.5 }, { layer: grid() })).toHaveLength(3);
        expect(resource.findPath(start, { x: 30.5, y: 28.5 })).toHaveLength(3);
    });
});
