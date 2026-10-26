import { describe, expect, it } from 'bun:test';
import { circleIntersections, mineralTargets, townhallTarget } from './targets.ts';

describe('circleIntersections', () => {
    it.each([
        ['disjoint', { x: 0, y: 0 }, 1, { x: 5, y: 0 }, 1],
        ['nested', { x: 0, y: 0 }, 5, { x: 1, y: 0 }, 1],
        ['concentric', { x: 2, y: 2 }, 1.35, { x: 2, y: 2 }, 1.35],
    ])('returns no points for %s circles', (_, c0, r0, c1, r1) => {
        expect(circleIntersections(c0, r0, c1, r1)).toEqual([]);
    });

    it('returns both crossing points', () => {
        expect(circleIntersections({ x: 0, y: 0 }, 5, { x: 8, y: 0 }, 5)).toEqual([
            { x: 4, y: -3 },
            { x: 4, y: 3 },
        ]);
    });
});

describe('mineralTargets', () => {
    it('matches ares on the acropolis start mineral line', () => {
        const minerals = [
            { tag: '4316725249', pos: { x: 9, y: 122.5 } },
            { tag: '4332453889', pos: { x: 13, y: 126.5 } },
            { tag: '4324327425', pos: { x: 16, y: 126.5 } },
            { tag: '4319084545', pos: { x: 15, y: 127.5 } },
            { tag: '4315152385', pos: { x: 8, y: 121.5 } },
            { tag: '4304666625', pos: { x: 9, y: 120.5 } },
            { tag: '4304404481', pos: { x: 9, y: 124.5 } },
            { tag: '4302307329', pos: { x: 10, y: 125.5 } },
        ];
        const expected: [string, number, number][] = [
            ['4316725249', 10.290301661774633, 122.10298410406935],
            ['4332453889', 13.51923076923077, 125.25384615384615],
            ['4324327425', 15.887888602197451, 125.15466322636941],
            ['4319084545', 14.68682720163547, 126.18682720163547],
            ['4315152385', 9.31317279836453, 121.81317279836453],
            ['4304666625', 10.35, 120.5],
            ['4304404481', 10.149738727551135, 123.79246847535315],
            ['4302307329', 10.998919099084524, 124.59189172810498],
        ];
        const targets = mineralTargets(minerals, [
            { x: 150.5, y: 40.5 },
            { x: 15.5, y: 120.5 },
        ]);
        for (const [tag, x, y] of expected) {
            expect(targets.get(tag)?.x).toBeCloseTo(x, 9);
            expect(targets.get(tag)?.y).toBeCloseTo(y, 9);
        }
    });
});

describe('townhallTarget', () => {
    it('is 2.75 x factor from the townhall towards the worker', () => {
        expect(townhallTarget({ x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 2.75 * 1.08, y: 0 });
        expect(townhallTarget({ x: 0, y: 0 }, { x: 0, y: 10 }, 1)).toEqual({ x: 0, y: 2.75 });
    });
});
