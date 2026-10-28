import { describe, expect, it } from 'bun:test';
import getRandom, { shuffle } from './get-random.ts';

describe('get-random', () => {
    it('getRandom reaches every index and only picks members', () => {
        const items = ['a', 'b', 'c'];
        const seen = new Set(Array.from({ length: 200 }, () => getRandom(items)));
        expect([...seen].sort()).toEqual(items);
    });

    it('shuffle returns a permuted copy and leaves the input untouched', () => {
        const input = Array.from({ length: 20 }, (_, index) => index);
        const output = shuffle(input);
        expect(output).not.toBe(input);
        expect(input).toEqual(Array.from({ length: 20 }, (_, index) => index));
        expect([...output].sort((a, b) => a - b)).toEqual(input);
        expect(output).not.toEqual(input);
        expect(shuffle([])).toEqual([]);
    });
});
