import { describe, expect, it } from 'bun:test';
import type { Grid2D } from '../../types.ts';
import floodFill from './flood.ts';

describe('floodFill', () => {
    it('recolors the 4-connected region of the start cell and returns it in visit order', () => {
        const grid = [
            [1, 1, 0],
            [1, 0, 0],
            [0, 0, 1],
        ] as unknown as Grid2D;

        const filled = floodFill(grid, 0, 0, null, 7);

        expect(filled).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
        ]);
        expect(grid).toEqual([
            [7, 7, 0],
            [7, 0, 0],
            [0, 0, 1],
        ] as unknown as Grid2D);
    });

    it('stops at maxReach measured from the start cell', () => {
        const grid = [[1, 1, 1, 1, 1]] as unknown as Grid2D;

        const filled = floodFill(grid, 0, 0, null, 7, 2);

        expect(filled).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
        ]);
        expect(grid).toEqual([[7, 7, 7, 1, 1]] as unknown as Grid2D);
    });

    it('fills nothing when the start cell does not hold the expected old value', () => {
        const grid = [[0, 1]] as unknown as Grid2D;

        expect(floodFill(grid, 0, 0, 1, 7)).toEqual([]);
        expect(grid).toEqual([[0, 1]] as unknown as Grid2D);
    });
});
