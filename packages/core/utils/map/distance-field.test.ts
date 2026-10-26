import { describe, expect, it } from 'bun:test';
import { createDistanceField } from './distance-field.ts';

const grid = (width: number, height: number, walkable: (x: number, y: number) => boolean) => {
    const cells = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells[y * width + x] = walkable(x, y) ? 1 : 0;
    return cells;
};

const walled = grid(10, 10, (x, y) => !(x === 5 && y < 9) && !(x >= 7 && y >= 7 && x <= 9 && y <= 9 && x !== 8));

describe('createDistanceField', () => {
    it('gives octile distances in the open, detours around a wall and is Infinity where unreachable or from an unwalkable or out-of-range start', () => {
        const out = new Float32Array(100);

        createDistanceField(10, 10).compute(
            grid(10, 10, () => true),
            0,
            out,
        );
        expect(out[5 * 10 + 3]).toBeCloseTo(2 + 3 * Math.SQRT2, 4);
        expect(out[9 * 10 + 9]).toBeCloseTo(9 * Math.SQRT2, 4);

        const enclosed = grid(10, 10, (x, y) => !(x === 5 && y < 9) && !(x >= 7 && y >= 7 && !(x === 8 && y === 8)));
        createDistanceField(10, 10).compute(enclosed, 0, out);
        expect(out[6]).toBeCloseTo(5 + 4 * Math.SQRT2 + 11, 4);
        expect(out[8 * 10 + 8]).toBe(Infinity);

        createDistanceField(10, 10).compute(enclosed, 5, out);
        expect(out.every((distance) => distance === Infinity)).toBe(true);
        createDistanceField(10, 10).compute(enclosed, 100, out);
        expect(out.every((distance) => distance === Infinity)).toBe(true);
    });

    it('never cuts a corner between two walls', () => {
        const out = new Float32Array(9);

        createDistanceField(3, 3).compute(
            grid(3, 3, (x, y) => !((x === 1 && y === 0) || (x === 0 && y === 1))),
            0,
            out,
        );

        expect(out[4]).toBe(Infinity);
    });

    it('gives the same fields over 100 reused calls as a fresh instance', () => {
        const reused = createDistanceField(10, 10);
        const out = new Float32Array(100);
        const expected = new Float32Array(100);

        for (let call = 0; call < 100; call++) {
            const start = (call * 7) % 100;
            reused.compute(walled, start, out);
            createDistanceField(10, 10).compute(walled, start, expected);
            expect(out).toEqual(expected);
        }
    });
});
