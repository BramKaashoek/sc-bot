import { describe, expect, it } from 'bun:test';
import * as root from './index.ts';
import * as point from './utils/geometry/point.ts';

describe('package root', () => {
    it('re-exports the point helpers', () => {
        const names = ['avgPoints', 'closestPoint', 'distance', 'distanceSquared', 'towards'] as const;

        expect(names.map((name) => root[name] === point[name])).toEqual(names.map(() => true));
    });
});
