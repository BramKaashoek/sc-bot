import { describe, expect, it } from 'bun:test';
import { findAoePosition } from './aoe.ts';
import type { Unit } from '../../types.ts';

const at = (tag: string, x: number, y: number) => ({ tag, pos: { x, y, z: 0 } }) as Unit;

describe('findAoePosition', () => {
    it('covers the most targets, prefers bonus tags, and is undefined below minTargets', () => {
        const pair = [at('a', 0, 0), at('b', 3, 0)];
        const lone = at('c', 20, 0);

        expect(findAoePosition(2, [...pair, lone], 2)).toEqual({ x: 1.5, y: 0 });
        expect(findAoePosition(2, [...pair, lone], 3)).toBeUndefined();
        expect(findAoePosition(2, [], 1)).toBeUndefined();

        const cluster = [at('a', 0, 0), at('b', 1, 0), at('c', 30, 0), at('d', 31, 0)];
        expect(findAoePosition(2, cluster, 2, new Set(['d']))).toEqual({ x: 30, y: 0 });
        expect(findAoePosition(2, cluster, 2)).toEqual({ x: 1, y: 0 });
    });

    it('counts raw targets against minTargets, bonus tags only rank, and the radius is exclusive', () => {
        const apart = [at('a', 0, 0), at('b', 10, 0)];
        expect(findAoePosition(2, apart, 2, new Set(['a', 'b']))).toBeUndefined();

        const line = [at('a', 0, 0), at('b', 1, 0), at('c', 2, 0)];
        expect(findAoePosition(1, line, 2)).toEqual({ x: 0.5, y: 0 });
        expect(findAoePosition(1, line, 3)).toBeUndefined();
    });

    it('breaks ties toward the centroid of the targets, whatever the input order', () => {
        const targets = [at('a', 0, 0), at('b', 10, 0), at('c', 10, 5)];

        expect(findAoePosition(1, targets, 1)).toEqual({ x: 10, y: 0 });
        expect(findAoePosition(1, [...targets].reverse(), 1)).toEqual({ x: 10, y: 0 });
    });
});
