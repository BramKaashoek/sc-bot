import { describe, expect, it } from 'bun:test';
import { type FormationGrids, findBuildingLocations, floodArea, markAvoid, unmarkAvoid } from './formation.ts';

function grids(rows: string[]): FormationGrids {
    const cells = rows.join('').split('');
    const is = (chars: string) => Uint8Array.from(cells, (cell) => (chars.includes(cell) ? 1 : 0));
    return {
        width: rows[0].length,
        height: rows.length,
        placeable: is('.hpca'),
        pathable: is('.hca#'),
        terrainHeight: is('h'),
        creep: is('c'),
        avoid: is('a'),
    };
}

const open = (width: number, height: number) => grids(Array.from({ length: height }, () => '.'.repeat(width)));

const cellSet = (g: FormationGrids, area: Int32Array) =>
    Array.from(area, (i) => `${i % g.width},${Math.floor(i / g.width)}`).sort();

const scan3x3 = {
    xStride: 5,
    yStride: 3,
    buildingWidth: 3,
    buildingHeight: 3,
    kernelWidth: 5,
    kernelHeight: 3,
    avoidCreep: true,
};

describe('floodArea', () => {
    it('returns connected cells of the start height that are placeable and within maxDist', () => {
        const g = grids(['..#....', '..#....', '.h.....', '.......', '.......']);
        expect(cellSet(g, floodArea(g, { x: 0.5, y: 0.5 }, 3))).toEqual(['0,0', '0,1', '0,2', '0,3', '1,0', '1,1']);
    });

    it('is empty when the start cell is unplaceable', () => {
        expect(floodArea(grids(['.#.']), { x: 1, y: 0 }, 5)).toHaveLength(0);
    });

    it('floods over startPlaceable instead of the live grid', () => {
        const g = grids(['.#.']);
        g.startPlaceable = Uint8Array.of(1, 1, 1);
        expect(floodArea(g, { x: 1, y: 0 }, 5)).toHaveLength(3);
    });

    it('fills a 256² open grid iteratively, and a second call starts from a fresh generation', () => {
        const g = open(256, 256);
        const first = floodArea(g, { x: 128, y: 128 }, 400);
        expect(first).toHaveLength(256 * 256);
        expect(floodArea(g, { x: 0, y: 0 }, 1)).toHaveLength(3);
    });
});

describe('findBuildingLocations', () => {
    it('returns centres of fully valid kernels only, keeps the addon inside the kernel and never overlaps a second pass', () => {
        const g = grids([
            '...............',
            '.......h....#..',
            '...............',
            '...............',
            '..p....c....a..',
            '...............',
        ]);
        g.startPlaceable = new Uint8Array(g.width * g.height).fill(1);
        const area = floodArea(g, { x: 0, y: 0 }, 20);
        const centres = findBuildingLocations(g, area, scan3x3);
        expect(centres).toEqual([{ x: 1.5, y: 1.5 }]);
        const addon = { x: centres[0].x + 2.5, y: centres[0].y - 0.5 };
        for (const [dx, dy] of [
            [-1, -1],
            [0, -1],
            [-1, 0],
            [0, 0],
        ]) {
            expect(g.avoid[(addon.y + dy) * g.width + addon.x + dx]).toBe(1);
        }
        expect(g.avoid.reduce((sum, v) => sum + v, 0)).toBe(5 * 3 + 1);
        expect(findBuildingLocations(g, area, scan3x3)).toEqual([]);
    });

    it.each([
        [16, 18, 5],
        [20, 20, 7],
    ])('with reduceXStride, a %px%p area scans at x stride %p', (width, height, stride) => {
        const g = open(width, height);
        const [first, second] = findBuildingLocations(g, floodArea(g, { x: 0, y: 0 }, 99), {
            ...scan3x3,
            xStride: 7,
            kernelWidth: 3,
            reduceXStride: true,
        });
        expect(second.x - first.x).toBe(stride);
    });

    it('drops every dropInterval-th candidate and leaves its cells free', () => {
        const g = open(16, 2);
        const scan = {
            xStride: 2,
            yStride: 2,
            buildingWidth: 2,
            buildingHeight: 2,
            kernelWidth: 2,
            kernelHeight: 2,
            avoidCreep: false,
        };
        const centres = findBuildingLocations(g, floodArea(g, { x: 0, y: 0 }, 99), { ...scan, dropInterval: 3 });
        expect(centres.map((c) => c.x)).toEqual([3, 5, 9, 11, 15]);
        expect(g.avoid[0]).toBe(0);
    });
});

describe('markAvoid / unmarkAvoid', () => {
    it('marks and unmarks the rectangle clipped to the grid', () => {
        const g = open(3, 3);
        markAvoid(g, 1, 1, 5, 5);
        expect(Array.from(g.avoid)).toEqual([0, 0, 0, 0, 1, 1, 0, 1, 1]);
        unmarkAvoid(g, 2, -1, 5, 3);
        expect(Array.from(g.avoid)).toEqual([0, 0, 0, 0, 1, 0, 0, 1, 1]);
    });
});
