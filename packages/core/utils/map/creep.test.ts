import { describe, expect, it } from 'bun:test';
import { loadFixture } from '../../test/create-test-world.ts';
import {
    type CostGrid,
    creepCoverage,
    creepEdges,
    expansionMask,
    isExpansionBlocked,
    isValidTumorSpot,
    nearestCreepTile,
    overlordSpotterPositions,
} from './creep.ts';
import { consumeImageData, consumeRawGrids } from './grid.ts';

const parse = (rows: string[]) => rows.map((row) => [...row].map((char) => (char === '#' ? 1 : 0)));
const costGrid = (width: number, height: number, fill = 1): CostGrid => ({
    width,
    height,
    data: new Float32Array(width * height).fill(fill),
});
const open = (width: number, height: number) => parse(Array(height).fill('.'.repeat(width)));

describe('creepEdges', () => {
    it('marks creep cells with at least 2 bare neighbours, so a solid block loses only its interior and a lone corner cell counts', () => {
        const creep = parse(['.......', '.#####.', '.#####.', '.#####.', '.#####.', '.#####.', '.......']);
        const edges = creepEdges(creep, open(7, 7));
        expect(edges.some((e) => e.x === 3 && e.y === 3)).toBe(false);
        expect(edges).toHaveLength(16);
        expect(edges).toContainEqual({ x: 1, y: 1 });
        expect(edges).toContainEqual({ x: 3, y: 1 });
    });

    it('treats the map border as bare, and a cell with exactly 1 bare neighbour as interior', () => {
        const border = creepEdges(parse(['###', '###', '###']), open(3, 3));
        expect(border).toHaveLength(8);
        const oneBare = creepEdges(parse(['####', '####', '###.', '####']), open(4, 4));
        expect(oneBare).not.toContainEqual({ x: 1, y: 1 });
        expect(oneBare).not.toContainEqual({ x: 2, y: 1 });
        expect(oneBare).toContainEqual({ x: 3, y: 1 });
    });

    it('drops edges whose 3x3 box touches static unpathable terrain, counting the map border as pathable', () => {
        const creep = parse(['.....', '.###.', '.###.', '.###.', '.....']);
        const pathing = parse(['.....', '.....', '.....', '.....', '....#']);
        const edges = creepEdges(creep, pathing);
        expect(edges).not.toContainEqual({ x: 3, y: 3 });
        expect(edges).toContainEqual({ x: 1, y: 1 });
        expect(creepEdges(creep, open(5, 5))).toContainEqual({ x: 3, y: 3 });
    });

    it('drops edges closer than 2.5 to any townhall using integer corners, keeping those at exactly 2.5', () => {
        const creep = open(9, 9).map((row) => row.map(() => 1));
        const edges = creepEdges(creep, open(9, 9), [
            { x: 0, y: 4.5 },
            { x: 8, y: 7.2 },
        ]);
        expect(edges).not.toContainEqual({ x: 8, y: 5 });
        expect(edges).toContainEqual({ x: 0, y: 1 });
        expect(edges).toContainEqual({ x: 0, y: 2 });
        expect(edges).not.toContainEqual({ x: 0, y: 3 });
        expect(edges).not.toContainEqual({ x: 0, y: 6 });
        expect(edges).toContainEqual({ x: 0, y: 7 });
        expect(edges).toContainEqual({ x: 8, y: 4 });
    });

    it('drops a creep cell whose own cell is unpathable even when all 8 neighbours are pathable', () => {
        const pathing = open(3, 3);
        pathing[1][1] = 1;
        expect(creepEdges(parse(['...', '.#.', '...']), pathing)).toEqual([]);
    });
});

describe('creepCoverage', () => {
    it('is creep-and-pathable over pathable, with Infinity cells out of both', () => {
        const ground = costGrid(4, 1);
        ground.data[3] = Infinity;
        expect(creepCoverage([[1, 0, 0, 1]], ground)).toBeCloseTo((1 / 3) * 100);
        expect(creepCoverage([[1, 1, 0, 0]], ground)).toBeCloseTo((2 / 3) * 100);
    });

    it('is 0 when nothing is pathable', () => {
        expect(creepCoverage([[1]], costGrid(1, 1, Infinity))).toBe(0);
    });
});

describe('expansionMask', () => {
    it('blocks cells whose centre is strictly inside radius 5, so a centre exactly 5 away stays free', () => {
        const mask = expansionMask(20, 20, [{ x: 10.5, y: 10.5 }]);
        const at = (x: number, y: number) => isExpansionBlocked(mask, 20, { x, y });
        expect(at(10, 10)).toBe(true);
        expect(at(14, 10)).toBe(true);
        expect(at(15, 10)).toBe(false);
        expect(at(5, 10)).toBe(false);
        expect(at(13, 13)).toBe(true);
        expect(at(14, 13)).toBe(false);
    });

    it('unions every expansion and clips at the map border', () => {
        const mask = expansionMask(10, 10, [
            { x: 0.5, y: 0.5 },
            { x: 9.5, y: 9.5 },
        ]);
        expect(isExpansionBlocked(mask, 10, { x: 0, y: 0 })).toBe(true);
        expect(isExpansionBlocked(mask, 10, { x: 9, y: 9 })).toBe(true);
        expect(isExpansionBlocked(mask, 10, { x: 5, y: 5 })).toBe(false);
    });

    it('looks points up by floor and is false out of bounds', () => {
        const mask = expansionMask(10, 10, [{ x: 0.5, y: 0.5 }]);
        expect(isExpansionBlocked(mask, 10, { x: 0.9, y: 0.9 })).toBe(true);
        expect(isExpansionBlocked(mask, 10, { x: 0, y: 10 })).toBe(false);
        expect(isExpansionBlocked(mask, 10, { x: 10, y: 0 })).toBe(false);
    });
});

describe('isValidTumorSpot', () => {
    const creep = open(10, 10).map((row) => row.map(() => 1));
    creep[0][9] = 0;
    const base = () => ({ creep, mask: expansionMask(10, 10, []), ground: costGrid(10, 10) });

    it('rejects off-creep, expansion-blocked, unpathable and unsafe cells', () => {
        expect(isValidTumorSpot({ x: 9, y: 0 }, base())).toBe(false);
        expect(isValidTumorSpot({ x: 5, y: 5 }, { ...base(), mask: expansionMask(10, 10, [{ x: 5.5, y: 5.5 }]) })).toBe(
            false,
        );
        const ground = base().ground;
        ground.data[5 * 10 + 5] = Infinity;
        ground.data[5 * 10 + 6] = 1.5;
        expect(isValidTumorSpot({ x: 5, y: 5 }, { ...base(), ground })).toBe(false);
        expect(isValidTumorSpot({ x: 6, y: 5 }, { ...base(), ground })).toBe(false);
    });

    it('treats a cost of exactly 1 as safe and honours a custom limit', () => {
        const ground = base().ground;
        ground.data[5 * 10 + 5] = 1;
        ground.data[5 * 10 + 6] = 3;
        expect(isValidTumorSpot({ x: 5, y: 5 }, { ...base(), ground })).toBe(true);
        expect(isValidTumorSpot({ x: 6, y: 5 }, { ...base(), ground })).toBe(false);
        expect(isValidTumorSpot({ x: 6, y: 5 }, { ...base(), ground, limit: 3 })).toBe(true);
    });

    it('decides bounds by the cell the point is in: the outer half of the last cell is valid, below 0 is not', () => {
        expect(isValidTumorSpot({ x: 8.6, y: 9.6 }, base())).toBe(true);
        expect(isValidTumorSpot({ x: -0.5, y: 5 }, base())).toBe(false);
        expect(isValidTumorSpot({ x: 10, y: 5 }, base())).toBe(false);
        expect(isValidTumorSpot({ x: 5, y: 10 }, base())).toBe(false);
    });
});

describe('nearestCreepTile', () => {
    it('returns the integer corner of the closest creep cell', () => {
        const creep = parse(['#....', '.....', '....#']);
        expect(nearestCreepTile(creep, { x: 3.4, y: 1.9 })).toEqual({ x: 4, y: 2 });
        expect(nearestCreepTile(creep, { x: 0.2, y: 0.4 })).toEqual({ x: 0, y: 0 });
    });

    it('takes the first cell in row-major order on a tie', () => {
        const creep = parse(['.#.', '...', '.#.']);
        expect(nearestCreepTile(creep, { x: 1, y: 1 })).toEqual({ x: 1, y: 0 });
    });

    it('is undefined without creep', () => {
        expect(nearestCreepTile(open(3, 3), { x: 1, y: 1 })).toBeUndefined();
    });
});

describe('overlordSpotterPositions', () => {
    const mapSize = { x: 100, y: 100 };
    const overlord = (tag: string, x: number, y: number, isMoving = false) => ({ tag, position: { x, y }, isMoving });

    it('spaces spots at least 18 apart, nearest the target first, one per overlord', () => {
        const edges = [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 28, y: 10 },
            { x: 50, y: 10 },
        ];
        const result = overlordSpotterPositions(
            edges,
            [overlord('a', 80, 80, true), overlord('b', 80, 90, true)],
            { x: 0, y: 10 },
            { mapSize },
        );
        expect([...result.values()].sort((p, q) => p.x - q.x)).toEqual([
            { x: 10, y: 10 },
            { x: 28, y: 10 },
        ]);
    });

    it('stops at the overlord count and returns nothing for no overlords', () => {
        const edges = [
            { x: 10, y: 10 },
            { x: 40, y: 10 },
        ];
        expect(overlordSpotterPositions(edges, [overlord('a', 0, 0, true)], { x: 0, y: 0 }, { mapSize }).size).toBe(1);
        expect(overlordSpotterPositions(edges, [], { x: 0, y: 0 }, { mapSize }).size).toBe(0);
    });

    it('assigns each spot the closest unassigned overlord', () => {
        const edges = [
            { x: 10, y: 10 },
            { x: 40, y: 10 },
        ];
        const result = overlordSpotterPositions(
            edges,
            [overlord('far', 90, 10, true), overlord('near', 35, 10, true)],
            { x: 0, y: 10 },
            { mapSize },
        );
        expect(result.get('near')).toEqual({ x: 10, y: 10 });
        expect(result.get('far')).toEqual({ x: 40, y: 10 });
    });

    it('leaves an idle overlord in place within 9 of its spot, but moves a moving or further one', () => {
        const edges = [{ x: 30, y: 30 }];
        const target = { x: 0, y: 0 };
        const go = (o: ReturnType<typeof overlord>) =>
            overlordSpotterPositions(edges, [o], target, { mapSize }).get('o');
        expect(go(overlord('o', 35, 30))).toEqual({ x: 35, y: 30 });
        expect(go(overlord('o', 35, 30, true))).toEqual({ x: 30, y: 30 });
        expect(go(overlord('o', 39, 30))).toEqual({ x: 30, y: 30 });
    });

    it('skips edges within 50 of the enemy start', () => {
        const edges = [
            { x: 10, y: 10 },
            { x: 80, y: 10 },
        ];
        const result = overlordSpotterPositions(
            edges,
            [overlord('o', 0, 0, true)],
            { x: 0, y: 10 },
            { mapSize, enemyStart: { x: 20, y: 10 } },
        );
        expect(result.get('o')).toEqual({ x: 80, y: 10 });
        const edge50 = overlordSpotterPositions(
            [{ x: 50, y: 10 }],
            [overlord('o', 0, 0, true)],
            { x: 0, y: 0 },
            { mapSize, enemyStart: { x: 0, y: 10 } },
        );
        expect(edge50.size).toBe(1);
        expect(
            overlordSpotterPositions(
                [{ x: 49.9, y: 10 }],
                [overlord('o', 0, 0, true)],
                { x: 0, y: 0 },
                { mapSize, enemyStart: { x: 0, y: 10 } },
            ).size,
        ).toBe(0);
    });

    it('clamps spots and idle overlord positions into [1, size - 1]', () => {
        const result = overlordSpotterPositions(
            [{ x: 0, y: 99 }],
            [overlord('o', 99.9, 0.2, true)],
            { x: 0, y: 0 },
            { mapSize },
        );
        expect(result.get('o')).toEqual({ x: 1, y: 99 });
        const idle = overlordSpotterPositions(
            [{ x: 98, y: 2 }],
            [overlord('o', 99.9, 0.2)],
            { x: 0, y: 0 },
            { mapSize },
        );
        expect(idle.get('o')).toEqual({ x: 99, y: 1 });
        const wide = overlordSpotterPositions(
            [{ x: 10, y: 60 }],
            [overlord('o', 0, 0, true)],
            { x: 0, y: 0 },
            { mapSize: { x: 100, y: 50 } },
        );
        expect(wide.get('o')).toEqual({ x: 10, y: 49 });
    });

    it('checks spacing against every accepted spot, not just the latest', () => {
        const result = overlordSpotterPositions(
            [
                { x: 50, y: 50 },
                { x: 68, y: 50 },
                { x: 45, y: 64 },
            ],
            [overlord('a', 90, 90, true), overlord('b', 90, 80, true), overlord('c', 90, 70, true)],
            { x: 58, y: 0 },
            { mapSize },
        );
        expect([...result.values()].sort((p, q) => p.x - q.x)).toEqual([
            { x: 50, y: 50 },
            { x: 68, y: 50 },
        ]);
    });
});

describe('creep fixture spot-check (blueshift-zerg, loop 896)', () => {
    const fixture = loadFixture('blueshift-zerg');
    const raw = fixture.gameInfo.startRaw!;
    const width = raw.mapSize!.x!;
    const height = raw.mapSize!.y!;
    const creep = consumeImageData(fixture.observations[896].observation!.rawData!.mapState!.creep!, width);
    const pathing = consumeRawGrids(raw).pathing!;

    it('drops 15 of the 71 creep edges to static terrain, the first being (13, 3)', () => {
        expect(creepEdges(creep, pathing)).toHaveLength(56);
        expect(creepEdges(creep, pathing)[0]).toEqual({ x: 13, y: 3 });
        expect(
            creepEdges(
                creep,
                pathing.map((row) => row.map(() => 0)),
            ),
        ).toHaveLength(71);
    });

    it('reports 3.55 percent coverage of the pathable ground', () => {
        const ground = costGrid(width, height);
        pathing.forEach((row, y) => row.forEach((blocked, x) => blocked && (ground.data[y * width + x] = Infinity)));
        expect(creepCoverage(creep, ground)).toBeCloseTo(3.5466, 3);
    });
});
