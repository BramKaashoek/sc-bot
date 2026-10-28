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

    it("subsamples findPath by sensitivity at indices s-1, 2s-1 and starts at nextPoint's pick", async () => {
        const { findPath, nextPoint } = await pathing();
        const open = grid(40, 5);
        const start = { x: 0.5, y: 2.5 };
        const goal = { x: 39.5, y: 2.5 };
        const full = findPath(start, goal, { layer: open });
        const sparse = findPath(start, goal, { layer: open, sensitivity: 5 });

        expect(full).toHaveLength(39);
        expect(sparse).toEqual(full.filter((_, i) => i % 5 === 4));
        expect(sparse[0]).toEqual(nextPoint(start, goal, { layer: open, senseDanger: false, sensitivity: 5 }));
    });

    it('returns only the goal for short paths and 8 linspace samples plus the goal for long ones', async () => {
        const { findLowPriorityPath } = await pathing();
        const open = grid(80, 5);
        const start = { x: 0.5, y: 2.5 };
        const goal = { x: 79.5, y: 2.5 };

        expect(findLowPriorityPath(start, { x: 30.5, y: 2.5 }, { layer: open })).toEqual([{ x: 30.5, y: 2.5 }]);
        // 79 cells at sensitivity 4 -> 19 points; floor(i * 18 / 7) -> 0,2,5,7,10,12,15,18
        expect(findLowPriorityPath(start, goal, { layer: open })).toEqual(
            [0, 2, 5, 7, 10, 12, 15, 18].map((i) => ({ x: 4 * i + 4.5, y: 2.5 })).concat([goal]),
        );

        const boundary = grid(41, 5);
        const nine = { x: 36.5, y: 2.5 };
        const ten = { x: 40.5, y: 2.5 };
        expect(findLowPriorityPath(start, nine, { layer: boundary })).toEqual([nine]);
        expect(findLowPriorityPath(start, ten, { layer: boundary })).toHaveLength(9);
    });

    it('finds the minimum-cost finite cells in the disc and the furthest of them, by grid or layer name', async () => {
        const { findLowestCostPoints, findFurthestSafeSpot } = await pathing();
        const flat = grid();
        flat.data.fill(5);
        for (const [x, y] of [
            [10, 10],
            [10, 14],
            [10, 8],
        ])
            flat.data[y * 20 + x] = 2;
        block(flat, [[10, 11]]);
        flat.data[11 * 20 + 11] = 0.5;
        const from = { x: 10.5, y: 10.5 };

        expect(findLowestCostPoints(from, { layer: flat, radius: 3 })).toEqual([{ x: 11.5, y: 11.5 }]);
        flat.data[11 * 20 + 11] = 5;
        expect(findLowestCostPoints(from, { layer: flat, radius: 3 })).toEqual([
            { x: 10.5, y: 8.5 },
            { x: 10.5, y: 10.5 },
        ]);
        expect(findFurthestSafeSpot(from, { layer: flat, radius: 5 })).toEqual({ x: 10.5, y: 14.5 });
        expect(findFurthestSafeSpot(from, { layer: flat, radius: 3 })).toEqual({ x: 10.5, y: 8.5 });

        const ties = grid();
        ties.data.fill(5);
        for (const [x, y] of [
            [12, 8],
            [8, 12],
        ])
            ties.data[y * 20 + x] = 2;
        expect(findFurthestSafeSpot(from, { layer: ties, radius: 5 })).toEqual({ x: 12.5, y: 8.5 });

        const walled = grid();
        block(walled, square(10, 10, 5));
        expect(findLowestCostPoints(from, { layer: walled, radius: 3 })).toEqual([]);
        expect(findFurthestSafeSpot(from, { layer: walled, radius: 3 })).toBeUndefined();
        expect(findLowestCostPoints({ x: 27.5, y: 28.5 }).length).toBeGreaterThan(0);
    });
});
