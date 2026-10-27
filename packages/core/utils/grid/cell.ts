import type { Point2D } from '../../types.ts';

export const cellCentre = (index: number, width: number): Point2D => ({
    x: (index % width) + 0.5,
    y: Math.floor(index / width) + 0.5,
});
