import { describe, expect, it } from 'bun:test';
import { asArray, toTag, toTags } from './collections.ts';
import type { Unit } from '../types.ts';

const unit = (tag: string) => ({ tag }) as Unit;

describe('collections', () => {
    it('asArray wraps a single value and returns an array as-is', () => {
        const list = [1, 2];
        expect(asArray(3)).toEqual([3]);
        expect(asArray(list)).toBe(list);
    });

    it('toTag / toTags accept units, tags and mixed arrays', () => {
        expect(toTag(unit('a'))).toBe('a');
        expect(toTag('b')).toBe('b');
        expect(toTags(unit('a'))).toEqual(['a']);
        expect(toTags('b')).toEqual(['b']);
        expect(toTags([unit('a'), 'b'])).toEqual(['a', 'b']);
        expect(toTags([])).toEqual([]);
    });
});
