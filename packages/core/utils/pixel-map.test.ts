import { describe, expect, it } from 'bun:test';
import { PixelMap } from './pixel-map.ts';
import { loadFixture } from '../test/create-test-world.ts';
import type { Point2D } from '../types.ts';

const byPosition = (left: Point2D, right: Point2D) => left.y - right.y || left.x - right.x;

describe('PixelMap', () => {
    it('decodes MSB-first 1-bit and raw 8-bit image data row by row', () => {
        const bits = new PixelMap({ bitsPerPixel: 1, size: { x: 4, y: 2 }, data: Uint8Array.of(0b10010110) });
        const bytes = new PixelMap({ bitsPerPixel: 8, size: { x: 3, y: 2 }, data: Uint8Array.of(0, 5, 255, 7, 0, 1) });

        expect([bits.width, bits.height]).toEqual([4, 2]);
        expect([0, 1, 2, 3].map((x) => bits.get({ x, y: 0 }))).toEqual([1, 0, 0, 1]);
        expect([0, 1, 2, 3].map((x) => bits.get({ x, y: 1 }))).toEqual([0, 1, 1, 0]);
        expect([bits.isSet({ x: 3, y: 0 }), bits.isEmpty({ x: 3, y: 0 }), bits.isEmpty({ x: 0, y: 1 })]).toEqual([
            true,
            false,
            true,
        ]);
        expect([bytes.get({ x: 2, y: 0 }), bytes.get({ x: 0, y: 1 }), bytes.get({ x: 1, y: 1 })]).toEqual([255, 7, 0]);
        expect(() => bits.get({ x: 4, y: 0 })).toThrow();
        expect(() => bytes.get({ x: 0, y: -1 })).toThrow();
        expect(() => bytes.isSet({ x: 0.5, y: 0 })).toThrow(TypeError);
    });

    it('builds from SC2 image data directly and rejects image data with a missing field', () => {
        const { pathingGrid } = loadFixture('simple64').gameInfo.startRaw!;
        const { bitsPerPixel, size, data } = pathingGrid!;

        const direct = new PixelMap(pathingGrid!);
        const explicit = new PixelMap({ bitsPerPixel: bitsPerPixel!, size: { x: size!.x!, y: size!.y! }, data: data! });

        expect(direct).toEqual(explicit);
        expect(() => new PixelMap({ ...pathingGrid, data: undefined })).toThrow(TypeError);
        expect(() => new PixelMap({ ...pathingGrid, size: { x: 64 } })).toThrow(TypeError);
        expect(() => new PixelMap({ ...pathingGrid, bitsPerPixel: undefined })).toThrow(TypeError);
    });

    it('sets values on a copy without touching the original', () => {
        const original = new PixelMap({ bitsPerPixel: 8, size: { x: 2, y: 2 }, data: Uint8Array.of(0, 0, 0, 0) });
        const copy = original.copy();

        copy.set({ x: 1, y: 1 }, 200);

        expect(copy.get({ x: 1, y: 1 })).toBe(200);
        expect(original.get({ x: 1, y: 1 })).toBe(0);
    });

    it('flood fills 8-connected regions matching a predicate', () => {
        const grid = new PixelMap({
            bitsPerPixel: 8,
            size: { x: 5, y: 4 },
            data: Uint8Array.of(1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1),
        });
        const isOne = (value: number) => value === 1;

        expect(grid.floodFill({ x: 0, y: 0 }, isOne).sort(byPosition)).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 1 },
        ]);
        expect(grid.floodFill({ x: 4, y: 0 }, isOne)).toEqual([]);
        expect(
            grid
                .floodFillAll(isOne)
                .map((group) => group.sort(byPosition))
                .sort((left, right) => byPosition(left[0], right[0])),
        ).toEqual([
            [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 2, y: 1 },
            ],
            [
                { x: 4, y: 2 },
                { x: 3, y: 3 },
                { x: 4, y: 3 },
            ],
        ]);
    });
});
