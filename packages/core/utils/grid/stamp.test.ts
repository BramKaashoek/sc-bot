import { describe, expect, it } from 'bun:test';
import { addCircle } from './stamp.ts';

const stampedCells = (width: number, height: number, cx: number, cy: number, radius: number) => {
    const data = new Float32Array(width * height);
    addCircle(data, width, height, cx, cy, radius, 1);
    const cells: string[] = [];
    data.forEach((value, index) => {
        if (value !== 0) cells.push(`${index % width},${Math.floor(index / width)}`);
    });
    return { data, cells };
};

const bruteForce = (width: number, height: number, cx: number, cy: number, radius: number) => {
    const cells: string[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = x - Math.floor(cx);
            const dy = y - Math.floor(cy);
            if (dx * dx + dy * dy <= radius * radius) cells.push(`${x},${y}`);
        }
    }
    return cells;
};

describe('addCircle', () => {
    it.each([
        [0, 1],
        [1, 5],
        [1.5, 9],
        [2, 13],
        [3.5, 37],
    ])('radius %p stamps the exact disk (%p cells)', (radius, count) => {
        const { cells } = stampedCells(11, 11, 5.7, 5.2, radius);
        expect(cells).toHaveLength(count);
        expect(cells).toEqual(bruteForce(11, 11, 5.7, 5.2, radius));
    });

    it.each([
        [0, 2],
        [4, 2],
        [2, 0],
        [2, 4],
        [-1, 2],
    ])('clips at the edge without wrapping rows (centre %p,%p)', (cx, cy) => {
        expect(stampedCells(5, 5, cx, cy, 2).cells).toEqual(bruteForce(5, 5, cx, cy, 2));
    });

    it('adds in place and keeps Infinity cells Infinity', () => {
        const data = new Float32Array(9).fill(1);
        data[4] = Infinity;
        const before = data;
        addCircle(data, 3, 3, 1, 1, 1, 2.5);
        expect(data).toBe(before);
        expect(Array.from(data)).toEqual([1, 3.5, 1, 3.5, Infinity, 3.5, 1, 3.5, 1]);
    });
});
