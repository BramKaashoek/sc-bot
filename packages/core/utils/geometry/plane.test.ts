import { describe, expect, it } from 'bun:test';
import { cellsInFootprint, circleCenterFromPoints, distanceAAShapeAndPoint, distanceAAShapes } from './plane.ts';

describe('circleCenterFromPoints', () => {
    it('finds the center of the circle through three points', () => {
        expect(circleCenterFromPoints({ x: 8, y: 2 }, { x: 3, y: 7 }, { x: -2, y: 2 })).toEqual({ x: 3, y: 2 });
    });
});

describe('distanceAAShapes', () => {
    const shape = { pos: { x: 0, y: 0 }, w: 2, h: 2 };

    it('measures the gap between box edges, zero when overlapping', () => {
        expect(distanceAAShapes(shape, { pos: { x: 5, y: 0 }, w: 2, h: 2 })).toBe(3);
        expect(distanceAAShapes(shape, { pos: { x: 5, y: 6 }, w: 2, h: 2 })).toBe(5);
        expect(distanceAAShapes(shape, { pos: { x: 1, y: 1 }, w: 2, h: 2 })).toBe(0);
    });
});

describe('distanceAAShapeAndPoint', () => {
    const shape = { pos: { x: 0, y: 0 }, w: 4, h: 2 };

    it('measures the distance to the box edge, zero when inside', () => {
        expect(distanceAAShapeAndPoint(shape, { x: 5, y: 0 })).toBe(3);
        expect(distanceAAShapeAndPoint(shape, { x: 5, y: 3 })).toBe(Math.sqrt(13));
        expect(distanceAAShapeAndPoint(shape, { x: 1, y: 0.5 })).toBe(0);
    });
});

describe('cellsInFootprint', () => {
    const center = { x: 10, y: 10 };

    it('lists the 2x2 cells to the left and below the center', () => {
        expect(cellsInFootprint(center, { w: 2, h: 2 })).toEqual([
            { x: 10, y: 10 },
            { x: 9, y: 10 },
            { x: 10, y: 9 },
            { x: 9, y: 9 },
        ]);
    });

    it('lists every cell of a 3x3 footprint and omits the center when includeSelf is false', () => {
        const withoutSelf = cellsInFootprint(center, { w: 3, h: 3 }, false);

        expect(cellsInFootprint(center, { w: 3, h: 3 })).toEqual([
            { x: 10, y: 10 },
            { x: 9, y: 10 },
            { x: 10, y: 9 },
            { x: 9, y: 9 },
            { x: 11, y: 10 },
            { x: 11, y: 9 },
            { x: 9, y: 11 },
            { x: 10, y: 11 },
            { x: 11, y: 11 },
        ]);
        expect(withoutSelf).toHaveLength(8);
        expect(withoutSelf).not.toContainEqual(center);
    });

    it('covers a full 5x5 square exactly once for a 5x5 footprint', () => {
        const expected = Array.from({ length: 5 }, (_, row) =>
            Array.from({ length: 5 }, (_, col) => ({ x: 8 + col, y: 8 + row })),
        ).flat();
        const byPosition = (left: { x: number; y: number }, right: { x: number; y: number }) =>
            left.y - right.y || left.x - right.x;

        expect(cellsInFootprint(center, { w: 5, h: 5 }).sort(byPosition)).toEqual(expected);
    });
});
