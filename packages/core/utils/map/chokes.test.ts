import { describe, expect, it } from 'bun:test';
import { analyzeChokes } from './chokes.ts';

const SETTINGS = { maxChokeWidth: 14, peakRatio: 2.2, minRegionArea: 150 };

const grid = (width: number, height: number, walkable: (x: number, y: number) => boolean) => {
    const cells = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells[y * width + x] = walkable(x, y) ? 1 : 0;
    return cells;
};

const analyze = (width: number, height: number, walkable: (x: number, y: number) => boolean) =>
    analyzeChokes(grid(width, height, walkable), width, height, SETTINGS);

const xy = (cell: number, width: number) => ({ x: cell % width, y: Math.floor(cell / width) });

describe('analyzeChokes', () => {
    it('finds one region and no choke in an open room', () => {
        const { regions, chokes } = analyze(30, 30, () => true);

        expect(regions).toHaveLength(1);
        expect(chokes).toEqual([]);
    });

    it('splits two rooms joined by a 3-wide corridor at one choke inside the corridor, labelling by smallest cell, deterministically', () => {
        const corridor = (x: number, y: number) => x < 20 || x >= 25 || (y >= 8 && y <= 10);
        const analysis = analyze(45, 20, corridor);
        const { labels, regions, chokes } = analysis;

        expect(regions).toHaveLength(2);
        expect([labels[0], labels[44]]).toEqual([0, 1]);
        expect(chokes).toHaveLength(1);
        const [choke] = chokes;
        expect(choke.regions).toEqual([0, 1]);
        expect(choke.width).toBeGreaterThanOrEqual(2);
        expect(choke.width).toBeLessThanOrEqual(4);
        const center = xy(choke.center, 45);
        expect(center.x).toBeGreaterThanOrEqual(20);
        expect(center.x).toBeLessThan(25);
        expect(center.y).toBeGreaterThanOrEqual(8);
        expect(center.y).toBeLessThanOrEqual(10);
        expect(analyze(45, 20, corridor)).toEqual(analysis);
    });

    it('reports two doors between the same rooms as two chokes, ordered by center', () => {
        const { regions, chokes } = analyze(
            43,
            20,
            (x, y) => x < 20 || x >= 23 || (y >= 4 && y <= 6) || (y >= 13 && y <= 15),
        );

        expect(regions).toHaveLength(2);
        expect(chokes.map(({ regions: pair }) => pair)).toEqual([
            [0, 1],
            [0, 1],
        ]);
        expect(chokes[0].center).toBeLessThan(chokes[1].center);
    });

    it('keeps rooms joined by an opening wider than maxChokeWidth as one region', () => {
        const { regions, chokes } = analyze(41, 20, (x, y) => x !== 20 || (y >= 2 && y <= 17));

        expect(regions).toHaveLength(1);
        expect(chokes).toEqual([]);
    });

    it('merges a pocket smaller than minRegionArea behind a 2-wide gap without a choke', () => {
        const { regions, chokes } = analyze(
            39,
            30,
            (x, y) => x < 30 || (x === 30 && (y === 3 || y === 4)) || (x > 30 && y < 8),
        );

        expect(regions).toEqual([{ area: 900 + 2 + 64, peak: expect.any(Number) }]);
        expect(chokes).toEqual([]);
    });

    it('does not leak through a diagonal 1-cell wall', () => {
        const { regions, chokes } = analyze(30, 30, (x, y) => x !== y);

        expect(regions.map(({ area }) => area)).toEqual([435, 435]);
        expect(chokes).toEqual([]);
    });
});
