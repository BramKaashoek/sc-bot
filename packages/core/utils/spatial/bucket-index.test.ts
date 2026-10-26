import { describe, expect, it } from 'bun:test';
import { createBucketIndex } from './bucket-index.ts';
import type { Point2D } from '../../types.ts';

function seededRandom(seed: number) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 2 ** 32;
        return state / 2 ** 32;
    };
}

const distance = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);

function inRange(index: ReturnType<typeof createBucketIndex>, point: Point2D, radius: number) {
    const found: number[] = [];
    index.forEachInRange(point, radius, (i) => void found.push(i));
    return found.sort((a, b) => a - b);
}

describe('bucket index', () => {
    it('matches brute force on random integer points, including the inclusive radius edge and map borders', () => {
        const random = seededRandom(7);
        const points: Point2D[] = Array.from({ length: 300 }, () => ({
            x: Math.floor(random() * 201),
            y: Math.floor(random() * 201),
        }));
        points.push({ x: 0, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 });
        const index = createBucketIndex();
        index.build(points);

        const queries: Point2D[] = [{ x: 0, y: 0 }, { x: 200, y: 100 }, { x: -30, y: 250 }, points[5]];
        for (let q = 0; q < 50; q++) queries.push({ x: random() * 240 - 20, y: random() * 240 - 20 });

        for (const query of queries) {
            for (const radius of [0, 1, 5, 12.5, 40]) {
                const expected = points
                    .map((point, i) => (distance(point, query) <= radius ? i : -1))
                    .filter((i) => i !== -1);
                expect(inRange(index, query, radius)).toEqual(expected);
                expect(index.forEachInRange(query, radius, () => true)).toBe(expected.length > 0);
            }
            for (const maxDistance of [undefined, 3, 30]) {
                const nearest = Math.min(...points.map((point) => distance(point, query)));
                const found = index.closest(query, maxDistance);
                if (nearest > (maxDistance ?? Infinity)) expect(found).toBe(-1);
                else expect(distance(points[found], query)).toBe(nearest);
            }
        }
    });

    it('answers nothing on an empty set', () => {
        const index = createBucketIndex();
        index.build([]);

        expect([index.forEachInRange({ x: 1, y: 1 }, 100, () => true), index.closest({ x: 1, y: 1 })]).toEqual([
            false,
            -1,
        ]);
    });

    it('reuses its buffers across rebuilds of the same size', () => {
        const index = createBucketIndex();
        const points = Array.from({ length: 200 }, (_, i) => ({ x: i % 50, y: Math.floor(i / 50) * 10 }));
        index.build(points);
        const { xs, ys, cellOf, order, starts } = index.buffers;

        index.build(points.map(({ x, y }) => ({ x: x + 1, y })));

        const after = index.buffers;
        expect(
            [after.xs, after.ys, after.cellOf, after.order, after.starts].every(
                (buffer, i) => buffer === [xs, ys, cellOf, order, starts][i],
            ),
        ).toBe(true);
    });
});
