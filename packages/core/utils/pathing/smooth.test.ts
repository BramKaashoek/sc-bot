import { describe, expect, it } from 'bun:test';
import { smoothPath } from './smooth.ts';

function grid(rows: string[]): Float32Array {
    return Float32Array.from(rows.join('').split(''), (cell) => (cell === '#' ? Infinity : 1));
}

const at = (width: number, x: number, y: number) => y * width + x;

describe('smoothPath', () => {
    it('leaves paths under 3 nodes untouched', () => {
        const data = grid(['....', '....']);
        const path = Int32Array.from([1, 2]);
        expect(smoothPath(path, data, 4)).toEqual(path);
    });

    it('absorbs a straight diagonal within the 1.002 tolerance', () => {
        const data = grid(['.....', '.....', '.....', '.....', '.....']);
        const path = Int32Array.from([0, 1, 2, 3, 4].map((i) => at(5, i, i)));
        expect(smoothPath(path, data, 5)).toEqual(Int32Array.from([at(5, 0, 0), at(5, 1, 1), at(5, 4, 4)]));
    });

    it('samples the start cell but not the end cell of a line', () => {
        const data = Float32Array.from([1, 1, 2, 3, 4]);
        const path = Int32Array.from([0, 1, 2, 3, 4]);
        expect(smoothPath(path, data, 5)).toEqual(Int32Array.from([0, 4]));
        expect(smoothPath(path, data, 1)).toEqual(Int32Array.from([0, 4]));
    });

    it('restarts the running weight at the step after a kept node', () => {
        const data = Float32Array.from([1, 1, 2, 1, 1, 1, 1]);
        const path = Int32Array.from([0, 1, 2, 3, 4, 5, 6]);
        expect(smoothPath(path, data, 7)).toEqual(Int32Array.from([0, 2, 3, 6]));
    });

    it('keeps a corner so shortcuts never cross blocked cells', () => {
        const data = grid(['.......', '.#####.', '.#####.', '.#####.', '.......']);
        const path = Int32Array.from([at(7, 0, 1), at(7, 0, 2), at(7, 0, 3), at(7, 0, 4), at(7, 1, 4), at(7, 2, 4)]);
        expect(smoothPath(path, data, 7)).toEqual(
            Int32Array.from([at(7, 0, 1), at(7, 0, 2), at(7, 1, 4), at(7, 2, 4)]),
        );
    });
});
