import { describe, expect, it } from 'bun:test';
import * as UnitType from '../../constants/unit-type.ts';
import { loadFixture } from '../../test/create-test-world.ts';
import type { World } from '../../types.ts';
import { MineralField, Townhall, VespeneGeyser, footprintCells, getFootprint, pathingCells } from './units.ts';

describe('shape factories', () => {
    it('attach the fixed dimensions to the position', () => {
        const pos = { x: 3, y: 4 };

        expect(MineralField(pos)).toEqual({ pos, w: 2, h: 1 });
        expect(VespeneGeyser(pos)).toEqual({ pos, w: 3, h: 3 });
        expect(Townhall(pos)).toEqual({ pos, w: 5, h: 5 });
    });
});

describe('getFootprint', () => {
    it('maps each unit category to its footprint', () => {
        expect(getFootprint(UnitType.NEXUS)).toEqual({ w: 5, h: 5 });
        expect(getFootprint(UnitType.MINERALFIELD)).toEqual({ w: 2, h: 1 });
        expect(getFootprint(UnitType.PYLON)).toEqual({ w: 2, h: 2 });
        expect(getFootprint(UnitType.GATEWAY)).toEqual({ w: 3, h: 3 });
    });

    it('reads the build ability footprint from game data, through morph aliases, keeping add-ons and resources static, and destructible sizes from their names', () => {
        const { data } = loadFixture('simple64');
        const footprints = [
            UnitType.SPAWNINGPOOL,
            UnitType.MISSILETURRET,
            UnitType.SENSORTOWER,
            UnitType.SPINECRAWLER,
            UnitType.LAIR,
            UnitType.SUPPLYDEPOTLOWERED,
            UnitType.BARRACKSTECHLAB,
            UnitType.MINERALFIELD,
            UnitType.COMMANDCENTERFLYING,
            UnitType.DESTRUCTIBLEROCKEX16X6,
            UnitType.DESTRUCTIBLEROCK2X4VERTICAL,
            UnitType.DESTRUCTIBLEROCK2X4HORIZONTAL,
            UnitType.UNBUILDABLEROCKSDESTRUCTIBLE,
            UnitType.XELNAGATOWER,
            UnitType.DESTRUCTIBLEROCKEX1DIAGONALHUGEBLUR,
        ].map((unitType) => getFootprint(unitType, data));

        expect(footprints).toEqual([
            { w: 3, h: 3 },
            { w: 2, h: 2 },
            { w: 1, h: 1 },
            { w: 2, h: 2 },
            { w: 5, h: 5 },
            { w: 2, h: 2 },
            { w: 2, h: 2 },
            { w: 2, h: 1 },
            { w: 0, h: 0 },
            { w: 6, h: 6 },
            { w: 2, h: 4 },
            { w: 4, h: 2 },
            { w: 2, h: 2 },
            { w: 2, h: 2 },
            undefined,
        ]);
    });

    it('gives flying structures an empty footprint even when they are also townhalls', () => {
        expect(getFootprint(UnitType.COMMANDCENTERFLYING)).toEqual({ w: 0, h: 0 });
    });

    it('returns undefined for non-structure units', () => {
        expect(getFootprint(UnitType.PROBE)).toBeUndefined();
    });
});

describe('footprintCells and pathingCells', () => {
    const { data } = loadFixture('simple64');
    const world = { data: { get: (key: 'units' | 'abilities') => data[key] } } as unknown as World;
    const key = ({ x, y }: { x: number; y: number }) => `${x},${y}`;
    const span = (x0: number, x1: number, y0: number, y1: number) =>
        Array.from({ length: (x1 - x0 + 1) * (y1 - y0 + 1) }, (_, i) => ({
            x: x0 + (i % (x1 - x0 + 1)),
            y: y0 + Math.floor(i / (x1 - x0 + 1)),
        }));
    const sorted = (cells: { x: number; y: number }[]) => cells.map(key).sort();

    it('covers the whole footprint around the centre point for 2x2, 3x3 and 5x5 buildings', () => {
        expect(sorted(footprintCells(world, UnitType.PYLON, { x: 10, y: 20 }))).toEqual(sorted(span(9, 10, 19, 20)));
        expect(sorted(footprintCells(world, UnitType.GATEWAY, { x: 10.5, y: 20.5 }))).toEqual(
            sorted(span(9, 11, 19, 21)),
        );
        expect(sorted(footprintCells(world, UnitType.NEXUS, { x: 10.5, y: 20.5 }))).toEqual(
            sorted(span(8, 12, 18, 22)),
        );
    });

    it('floors a half-integer position to its cell', () => {
        expect(sorted(footprintCells(world, UnitType.PYLON, { x: 10.5, y: 20.5 }))).toEqual(
            sorted(footprintCells(world, UnitType.PYLON, { x: 10, y: 20 })),
        );
    });

    it("drops only a townhall's four corner cells from the pathing cells", () => {
        const pos = { x: 10.5, y: 20.5 };
        const corners = [
            { x: 8, y: 18 },
            { x: 12, y: 18 },
            { x: 8, y: 22 },
            { x: 12, y: 22 },
        ];
        const footprint = sorted(footprintCells(world, UnitType.NEXUS, pos));

        expect(sorted(pathingCells(world, UnitType.NEXUS, pos))).toEqual(
            footprint.filter((cell) => !corners.map(key).includes(cell)),
        );
        expect(pathingCells(world, UnitType.NEXUS, pos)).toHaveLength(21);
        expect(sorted(pathingCells(world, UnitType.GATEWAY, pos))).toEqual(
            sorted(footprintCells(world, UnitType.GATEWAY, pos)),
        );
    });

    it('leaves a lowered depot with no pathing cells while its footprint stays', () => {
        const pos = { x: 10, y: 20 };

        expect(pathingCells(world, UnitType.SUPPLYDEPOTLOWERED, pos)).toEqual([]);
        expect(sorted(footprintCells(world, UnitType.SUPPLYDEPOTLOWERED, pos))).toEqual(sorted(span(9, 10, 19, 20)));
        expect(sorted(pathingCells(world, UnitType.SUPPLYDEPOT, pos))).toEqual(sorted(span(9, 10, 19, 20)));
    });

    it('leaves only the four corners of a nydus canal pathable and nothing of a burrowed creep tumor blocked', () => {
        const pos = { x: 10.5, y: 20.5 };

        expect(sorted(pathingCells(world, UnitType.NYDUSCANAL, pos))).toEqual(
            sorted(span(9, 11, 19, 21).filter(({ x, y }) => x === 10 || y === 20)),
        );
        expect(pathingCells(world, UnitType.CREEPTUMORBURROWED, pos)).toEqual([]);
    });
});
