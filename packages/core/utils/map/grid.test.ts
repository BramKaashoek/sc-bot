import { describe, expect, it } from 'bun:test';
import { consumeImageData, consumeRawGrids } from './grid.ts';

const imageData = (bitsPerPixel: number, bytes: number[]): SC2APIProtocol.ImageData => (
    { bitsPerPixel, data: new Uint8Array(bytes) }
);

describe('consumeImageData', () => {
    it('splits 8-bit data into rows of the given width', () => {
        expect(consumeImageData(imageData(8, [1, 2, 3, 4, 5, 6]), 3)).toEqual([[1, 2, 3], [4, 5, 6]] as never);
    });

    it('stops after the given height', () => {
        expect(consumeImageData(imageData(8, [1, 2, 3, 4, 5, 6]), 2, 1)).toEqual([[1, 2]] as never);
    });

    it('unpacks 1-bit data most-significant-bit first, and rows may span bytes', () => {
        expect(consumeImageData(imageData(1, [0b10100101]), 4)).toEqual([[1, 0, 1, 0], [0, 1, 0, 1]] as never);
    });

    it('throws without a width', () => {
        expect(() => consumeImageData(imageData(8, [1]), 0)).toThrow('Map width needed to digest raw grids!');
    });
});

describe('consumeRawGrids', () => {
    it('derives pathing, quantized height and miniMap grids from the raw images', () => {
        const raw = {
            mapSize: { x: 2, y: 2 },
            placementGrid: imageData(8, [1, 0, 1, 0]),
            pathingGrid: imageData(8, [0, 1, 1, 0]),
            terrainHeight: imageData(8, [127, 135, 131, 100]),
        } as SC2APIProtocol.StartRaw;

        expect(consumeRawGrids(raw)).toEqual({
            placement: [[1, 0], [1, 0]],
            pathing: [[1, 0], [0, 1]],
            height: [[0, 10], [5, 0]],
            miniMap: [[1, 114], [66, 0]],
        } as never);
    });
});
