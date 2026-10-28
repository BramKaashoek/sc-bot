import { describe, expect, it } from 'bun:test';
import { loadFixture } from '../../test/create-test-world.ts';
import { consumeImageData } from './grid.ts';
import { computeOverlordSpots } from './overlord-spots.ts';

const HEIGHTS: Record<string, number> = { g: 100, p: 140, H: 160, v: 0 };

const layout = (rows: string[], playable?: { x0: number; y0: number; x1: number; y1: number }) =>
    computeOverlordSpots({
        walkable: rows.map((row) => [...row].map((char) => (char === 'g' || char === 'v' ? 1 : 0))),
        terrainHeight: rows.map((row) => [...row].map((char) => HEIGHTS[char])),
        playable: playable ?? { x0: 0, y0: 0, x1: rows[0].length, y1: rows.length },
    });

describe('computeOverlordSpots', () => {
    it('accepts an unwalkable plateau ringed by lower ground and emits its centroid', () => {
        expect(layout(['ggggggg', 'ggggggg', 'ggpppgg', 'ggpppgg', 'ggpppgg', 'ggggggg', 'ggggggg'])).toEqual([
            { x: 3, y: 3 },
        ]);
    });

    it('rejects a plateau that touches a higher neighbour', () => {
        expect(layout(['ggggggg', 'ggggggg', 'ggpppHg', 'ggpppgg', 'ggpppgg', 'ggggggg', 'ggggggg'])).toEqual([]);
    });

    it('does not seed from cells in the 2-cell border margin', () => {
        const column = (x: number) => Array.from({ length: 8 }, () => 'g'.repeat(x) + 'p' + 'g'.repeat(7 - x));
        expect(layout(column(1))).toEqual([]);
        expect(layout(column(2))).toEqual([{ x: 2, y: 3.5 }]);
    });

    it('requires the lower neighbour to be above height 0', () => {
        expect(layout(['vvvvvvv', 'vvvvvvv', 'vvpppvv', 'vvpppvv', 'vvpppvv', 'vvvvvvv', 'vvvvvvv'])).toEqual([]);
    });

    it('only seeds inside the playable area, with x1 and y1 exclusive', () => {
        const rows = Array.from({ length: 8 }, () => 'ggggg' + 'p' + 'ggg');
        const bounds = { x0: 0, y0: 0, x1: 5, y1: 8 };
        expect(layout(rows, bounds)).toEqual([]);
        expect(layout(rows, { ...bounds, x1: 6 })).toEqual([{ x: 5, y: 3.5 }]);
        expect(layout(rows, { ...bounds, x1: 6, y1: 2 })).toEqual([]);
        expect(layout(rows, { x0: 5, y0: 0, x1: 6, y1: 8 })).toEqual([{ x: 5, y: 3.5 }]);
        expect(layout(rows, { x0: 6, y0: 0, x1: 8, y1: 8 })).toEqual([]);
    });
});

const fixtureSpots = (map: string) => {
    const raw = loadFixture(map).gameInfo.startRaw!;
    const { x, y } = raw.mapSize!;
    const placement = consumeImageData(raw.placementGrid!, x!, y);
    const pathing = consumeImageData(raw.pathingGrid!, x!, y);
    const { p0, p1 } = raw.playableArea!;
    return computeOverlordSpots({
        walkable: pathing.map((row, i) => row.map((cell, j) => Math.max(cell === 0 ? 0 : 1, placement[i][j]))),
        terrainHeight: consumeImageData(raw.terrainHeight!, x!, y),
        playable: { x0: p0!.x!, y0: p0!.y!, x1: p1!.x!, y1: p1!.y! },
    });
};

describe('computeOverlordSpots on fixtures', () => {
    it('finds the ares-parity spot lists', () => {
        const blueshift = fixtureSpots('blueshift');
        expect(fixtureSpots('simple64')).toEqual([]);
        expect(fixtureSpots('acropolis')).toEqual([
            { x: 57.87719298245614, y: 32.12280701754386 },
            { x: 116, y: 48 },
            { x: 129, y: 53 },
            { x: 16.2, y: 55.8 },
            { x: 64, y: 59 },
            { x: 29.98148148148148, y: 63.925925925925924 },
            { x: 66, y: 62 },
            { x: 110.01851851851852, y: 72.07407407407408 },
            { x: 74, y: 74 },
            { x: 76, y: 77 },
            { x: 123.8, y: 80.2 },
            { x: 10.871794871794872, y: 83.12820512820512 },
            { x: 24, y: 88 },
            { x: 82.12280701754386, y: 103.87719298245614 },
        ]);
        expect(blueshift).toHaveLength(50);
        expect(blueshift.slice(0, 5)).toEqual([
            { x: 94, y: 2 },
            { x: 52, y: 4 },
            { x: 46, y: 6 },
            { x: 110, y: 6 },
            { x: 83.8, y: 9.8 },
        ]);
    });
});
