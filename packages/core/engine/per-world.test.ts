import { describe, expect, it } from 'bun:test';
import { perWorld } from './per-world.ts';
import type { World } from '../types.ts';

describe('perWorld', () => {
    it('creates state once per world and recreates it after a clear', () => {
        const [first, second] = [{}, {}] as World[];
        const state = perWorld(() => new Set<string>());

        state.get(first).add('a');

        expect(state.get(first)).toEqual(new Set(['a']));
        expect(state.get(second)).toEqual(new Set());

        state.clear(first);

        expect(state.get(first)).toEqual(new Set());
        expect(state.get(second)).not.toBe(state.get(first));
    });
});
