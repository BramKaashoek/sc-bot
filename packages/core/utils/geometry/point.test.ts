import { describe, expect, it } from 'bun:test';
import {
    add,
    areEqual,
    avgPoints,
    closestPoint,
    createPoint,
    createPoint2D,
    distance,
    distanceSquared,
    distanceX,
    distanceY,
    divide,
    dotProduct,
    getNeighbors,
    multiply,
    nClosestPoint,
    normalize,
    subtract,
} from './point.ts';

describe('point arithmetic', () => {
    it('applies a scalar to both axes and a point per axis', () => {
        const point = { x: 6, y: 8 };

        expect(add(point, 2)).toEqual({ x: 8, y: 10 });
        expect(add(point, { x: 1, y: 2 })).toEqual({ x: 7, y: 10 });
        expect(subtract(point, 2)).toEqual({ x: 4, y: 6 });
        expect(subtract(point, { x: 1, y: 2 })).toEqual({ x: 5, y: 6 });
        expect(multiply(point, 2)).toEqual({ x: 12, y: 16 });
        expect(multiply(point, { x: 2, y: 3 })).toEqual({ x: 12, y: 24 });
        expect(divide(point, 2)).toEqual({ x: 3, y: 4 });
        expect(divide(point, { x: 3, y: 4 })).toEqual({ x: 2, y: 2 });
    });
});

describe('point measures', () => {
    it('computes distances along a 3-4-5 triangle and per axis', () => {
        const origin = { x: 1, y: 2 };
        const target = { x: 4, y: 6 };

        expect(distance(origin, target)).toBe(5);
        expect(distanceSquared(origin, target)).toBe(25);
        expect(distanceX(origin, target)).toBe(3);
        expect(distanceY(target, origin)).toBe(4);
        expect(dotProduct({ x: 2, y: 3 }, { x: 4, y: -1 })).toBe(5);
    });

    it('normalizes to unit length and averages points', () => {
        expect(normalize({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
        expect(
            avgPoints([
                { x: 0, y: 0 },
                { x: 4, y: 2 },
                { x: 2, y: 7 },
            ]),
        ).toEqual({ x: 2, y: 3 });
    });

    it('compares points by both coordinates', () => {
        expect(areEqual({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
        expect(areEqual({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(false);
    });
});

describe('closest points', () => {
    const points = [
        { x: 10, y: 0 },
        { x: 1, y: 1 },
        { x: 5, y: 0 },
    ];

    it('returns the nearest point, and the n nearest ordered by distance', () => {
        expect(closestPoint({ x: 0, y: 0 }, points)).toEqual({ x: 1, y: 1 });
        expect(nClosestPoint({ x: 0, y: 0 }, points)).toEqual([{ x: 1, y: 1 }]);
        expect(nClosestPoint({ x: 0, y: 0 }, points, 2)).toEqual([
            { x: 1, y: 1 },
            { x: 5, y: 0 },
        ]);
    });

    it('does not reorder the input array', () => {
        closestPoint({ x: 0, y: 0 }, points);

        expect(points[0]).toEqual({ x: 10, y: 0 });
    });
});

describe('point flooring', () => {
    it('floors toward negative infinity', () => {
        expect(createPoint2D({ x: 1.9, y: -0.1 })).toEqual({ x: 1, y: -1 });
        expect(createPoint({ x: 1.9, y: -0.1, z: 2.5 })).toEqual({ x: 1, y: -1, z: 2 });
    });
});

describe('getNeighbors', () => {
    const adjacents = [
        { x: 5, y: 4 },
        { x: 4, y: 5 },
        { x: 6, y: 5 },
        { x: 5, y: 6 },
    ];
    const diagonals = [
        { x: 4, y: 4 },
        { x: 6, y: 4 },
        { x: 4, y: 6 },
        { x: 6, y: 6 },
    ];

    it('returns adjacents plus diagonals by default, around the floored point', () => {
        expect(getNeighbors({ x: 5.7, y: 5.2 })).toEqual([...adjacents, ...diagonals]);
    });

    it('returns only adjacents without diagonals', () => {
        expect(getNeighbors({ x: 5, y: 5 }, false)).toEqual(adjacents);
    });

    it('returns only diagonals when diagonalsOnly is set', () => {
        expect(getNeighbors({ x: 5, y: 5 }, true, true)).toEqual(diagonals);
    });
});
