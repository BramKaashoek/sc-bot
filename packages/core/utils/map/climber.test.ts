import { describe, expect, it } from 'bun:test';
import { loadFixture } from '../../test/create-test-world.ts';
import { computeClimberMask } from './climber.ts';
import { consumeRawGrids } from './grid.ts';

const LOW = 80;
const HIGH = 100;

const layout = (
    rows: string[],
    options: { maxGap?: number; minStep?: number; playable?: { x0: number; y0: number; x1: number; y1: number } } = {},
) => {
    const height = rows.length;
    const width = rows[0].length;
    const heightOf = (char: string) =>
        char === '0' ? 0 : char === '^' ? HIGH : char === '~' ? LOW + 40 : char === 'v' ? LOW + 15 : LOW;
    const mask = computeClimberMask({
        width,
        height,
        pathing: rows.map((row) =>
            [...row].map((char) => (char === '.' || char === '^' || char === '~' || char === 'v' ? 0 : 1)),
        ),
        terrainHeight: rows.map((row) => [...row].map(heightOf)),
        playable: options.playable ?? { x0: 0, y0: 0, x1: width, y1: height },
        maxGap: options.maxGap,
        minStep: options.minStep,
    });
    return rows.map((_row, y) => [...Array(width).keys()].map((x) => (mask[y * width + x] ? 'X' : '-')).join(''));
};

describe('computeClimberMask', () => {
    it('marks a cliff of up to 3 cells between one-level-apart ground, in the four line directions, and never pathable cells', () => {
        expect(layout(['.###^', '.###^', '.###^'])).toEqual(['-XXX-', '-XXX-', '-XXX-']);
        expect(layout(['.', '#', '#', '^'])).toEqual(['-', 'X', 'X', '-']);
        expect(layout(['.###', '####', '####', '###^'])).toEqual(['----', '-X--', '--X-', '----']);
        expect(layout(['###.', '####', '####', '^###'])).toEqual(['----', '--X-', '-X--', '----']);
    });

    it('leaves gaps wider than maxGap, flat gaps and double-level gaps unmarked', () => {
        expect(layout(['.####^'])).toEqual(['------']);
        expect(layout(['.###.'])).toEqual(['-----']);
        expect(layout(['.###~'])).toEqual(['-----']);
        expect(layout(['.####^'], { maxGap: 4 })).toEqual(['-XXXX-']);
    });

    it('marks a step of exactly minStep and leaves a step just below it unmarked', () => {
        expect(layout(['.###^'])).toEqual(['-XXX-']);
        expect(layout(['.###v'])).toEqual(['-----']);
        expect(layout(['.###v'], { minStep: 15 })).toEqual(['-XXX-']);
        expect(layout(['.###^'], { minStep: 25 })).toEqual(['-----']);
    });

    it('leaves void, out-of-bounds and outside-playable cells and runs ending in them unmarked', () => {
        expect(layout(['.##0##^'])).toEqual(['-------']);
        expect(layout(['.#0#^'])).toEqual(['-----']);
        expect(layout(['###^', '000^'])).toEqual(['----', '----']);
        expect(layout(['.##^'], { playable: { x0: 0, y0: 0, x1: 3, y1: 1 } })).toEqual(['----']);
        expect(layout(['.##^'], { playable: { x0: 1, y0: 0, x1: 4, y1: 1 } })).toEqual(['----']);
        expect(layout(['.', '#', '#', '^'], { playable: { x0: 0, y0: 0, x1: 1, y1: 3 } })).toEqual([
            '-',
            '-',
            '-',
            '-',
        ]);
        expect(layout(['.', '#', '#', '^'], { playable: { x0: 0, y0: 1, x1: 1, y1: 4 } })).toEqual([
            '-',
            '-',
            '-',
            '-',
        ]);
    });
});

const fixtureInput = (map: string, maxStep?: number) => {
    const raw = loadFixture(map).gameInfo.startRaw!;
    const { pathing, height: terrainHeight } = consumeRawGrids(raw);
    const width = raw.mapSize!.x!;
    const height = raw.mapSize!.y!;
    return {
        width,
        height,
        pathing: pathing!,
        terrainHeight: terrainHeight!,
        playable: { x0: 0, y0: 0, x1: width, y1: height },
        maxStep,
    };
};

describe('computeClimberMask spot checks', () => {
    const marked = (map: string, cells: Array<[number, number]>, maxStep?: number) => {
        const input = fixtureInput(map, maxStep);
        const mask = computeClimberMask(input);
        return cells.map(([x, y]) => mask[y * input.width + x]);
    };

    it('leaves the simple64 map edge and the blueshift double-level cliff unmarked, the latter until maxStep allows it', () => {
        expect(
            marked('simple64', [
                [0, 10],
                [3, 0],
                [63, 40],
            ]),
        ).toEqual([0, 0, 0]);
        const doubleLevel: Array<[number, number]> = [
            [80, 110],
            [79, 111],
        ];
        expect(marked('blueshift', doubleLevel)).toEqual([0, 0]);
        expect(marked('blueshift', doubleLevel, 40)).toEqual([1, 1]);
    });

    it('marks main-edge cliff cells and leaves a ramp-flank slope cell unmarked', () => {
        expect(
            marked('simple64', [
                [17, 36],
                [18, 36],
            ]),
        ).toEqual([1, 1]);
        expect(marked('acropolis', [[10, 106]])).toEqual([1]);
        expect(marked('acropolis', [[20, 100]])).toEqual([0]);
    });
});
