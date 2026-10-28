import { describe, expect, it, spyOn } from 'bun:test';
import createWorld from '../engine/create-world.ts';
import { MapDecompositionError } from '../engine/errors.ts';
import * as chokesModule from '../utils/map/chokes.ts';
import { distance } from '../utils/geometry/point.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { mapAnalysisResource } from './map-analysis.ts';
import type { Expansion } from '../types.ts';

const MAPS = ['simple64', 'acropolis', 'blueshift'];

describe.each(MAPS)('mapAnalysis on %s', (mapName) => {
    it('separates the main from the natural and defends both at their own chokes', async () => {
        const world = await createTestWorld(mapName, { loop: 896 });
        const { map, mapAnalysis } = world.resources.get();
        const main = map.getMain()!;
        const natural = map.getNatural()!;
        const mainRegion = mapAnalysis.getRegion(main.townhallPosition)!;
        const naturalRegion = mapAnalysis.getRegion(natural.townhallPosition)!;

        const mainDefence = mapAnalysis.getDefensivePosition(main)!;
        const naturalDefence = mapAnalysis.getDefensivePosition(natural)!;

        expect(mainRegion.id).not.toBe(naturalRegion.id);
        expect(mainDefence.choke.ramp).toBe(map.getMainBaseRamp()!);
        expect(map.inPathingGrid(mainDefence.position)).toBe(true);
        expect(mapAnalysis.getRegion(mainDefence.position)?.id).toBe(mainRegion.id);
        expect(distance(mainDefence.position, mainDefence.choke.center)).toBeLessThanOrEqual(4 + 1.5);
        expect(naturalDefence.choke.id).not.toBe(mainDefence.choke.id);
        expect(mapAnalysis.getRegion(naturalDefence.position)?.id).toBe(naturalRegion.id);
        expect(mapAnalysis.getEnemyMainRamp()).toBeDefined();
        expect(mapAnalysis.getEnemyMainRamp()).not.toBe(map.getMainBaseRamp()!);
    });

    it('links chokes, regions and expansions, picks the defensive third and traces region perimeters', async () => {
        const world = await createTestWorld(mapName, { loop: 896 });
        const { map, mapAnalysis } = world.resources.get();
        const { x: width = 0, y: height = 0 } = map.getSize();
        const pathLength = (expansion: Expansion) => expansion.pathFromEnemy?.length ?? 999;
        const unwalkable = { x: 0, y: 0 };
        const mainRegion = mapAnalysis.getRegion(map.getMain()!.townhallPosition)!;
        const perimeter = mapAnalysis.getPerimeter(mainRegion);
        const cells = mapAnalysis.getRegionCells(mainRegion);
        const angles = perimeter.map(({ x, y }) => Math.atan2(y - mainRegion.center.y, x - mainRegion.center.x));
        const isEdge = ({ x, y }: { x: number; y: number }) =>
            [
                [-1, 0],
                [1, 0],
                [0, -1],
                [0, 1],
            ].some(([dx, dy]) => mapAnalysis.getRegion({ x: x + dx, y: y + dy }) === undefined);

        expect(map.inPathingGrid(unwalkable)).toBe(false);
        expect(mapAnalysis.getRegion(unwalkable)).toBeUndefined();
        expect(mapAnalysis.getRegion({ x: width + 5, y: height + 5 })).toBeUndefined();
        expect(
            mapAnalysis.getChokes().every(({ points }) => points.every((point) => mapAnalysis.isInChoke(point))),
        ).toBe(true);
        expect(
            map
                .getExpansions()
                .every((expansion) => mapAnalysis.getRegion(expansion.townhallPosition)!.chokes.length > 0),
        ).toBe(true);
        expect(map.getThirds()).toContain(mapAnalysis.getDefensiveThird()!);
        expect(pathLength(mapAnalysis.getDefensiveThird()!)).toBe(Math.max(...map.getThirds().map(pathLength)));
        expect(cells).toHaveLength(mainRegion.area);
        expect(cells.every((point) => mapAnalysis.getRegion(point)?.id === mainRegion.id)).toBe(true);
        expect(cells).toContainEqual({
            x: Math.floor(map.getMain()!.townhallPosition.x) + 0.5,
            y: Math.floor(map.getMain()!.townhallPosition.y) + 0.5,
        });
        expect(perimeter.every((point) => cells.some(({ x, y }) => x === point.x && y === point.y))).toBe(true);
        expect(perimeter.length).toBeGreaterThan(0);
        expect(perimeter.every((point) => mapAnalysis.getRegion(point)?.id === mainRegion.id && isEdge(point))).toBe(
            true,
        );
        expect(angles.every((angle, index) => index === 0 || angle >= angles[index - 1])).toBe(true);
    });
});

describe('overlord spots', () => {
    it('hands out each spot once, nearest first, and falls back to the map centre when none exist', async () => {
        const world = await createTestWorld('acropolis', { loop: 896 });
        const { mapAnalysis } = world.resources.get();
        const spots = mapAnalysis.getOverlordSpots();
        expect(spots).toHaveLength(14);

        const near = { x: 57, y: 33 };
        expect(mapAnalysis.takeOverlordSpot(near)).toEqual({ x: 57.87719298245614, y: 32.12280701754386 });
        expect(mapAnalysis.getOverlordSpots()).toEqual(spots.slice(1));
        expect(mapAnalysis.takeOverlordSpot(near)).not.toEqual(spots[0]);

        mapAnalysisResource.reset!(mapAnalysis, world);
        expect(mapAnalysis.getOverlordSpots()).toEqual(spots);

        const empty = await createTestWorld('simple64', { loop: 896 });
        const { map, mapAnalysis: none } = empty.resources.get();
        expect(none.getOverlordSpots()).toEqual([]);
        expect(none.takeOverlordSpot({ x: 1, y: 1 })).toEqual(map.getCenter(true));
    });
});

describe('overlord spot walkability', () => {
    const image = (rows: string[], values: Record<string, number>) => ({
        bitsPerPixel: 8,
        size: { x: rows[0].length, y: rows.length },
        data: Uint8Array.from(rows.flatMap((row) => [...row].map((char) => values[char]))),
    });
    const PLATEAU = ['ggggggg', 'ggggggg', 'ggpppgg', 'ggpppgg', 'ggpppgg', 'ggggggg', 'ggggggg'];

    async function spotsFor(pathing: Record<string, number>, placement: Record<string, number>) {
        const world = await createTestWorld('simple64', { loop: 896 });
        const { frame, mapAnalysis } = world.resources.get();
        const getGameInfo = spyOn(frame, 'getGameInfo').mockReturnValue({
            startRaw: {
                mapSize: { x: 7, y: 7 },
                playableArea: { p0: { x: 0, y: 0 }, p1: { x: 7, y: 7 } },
                pathingGrid: image(PLATEAU, pathing),
                placementGrid: image(PLATEAU, placement),
                terrainHeight: image(PLATEAU, { g: 100, p: 140 }),
            },
        } as never);
        try {
            mapAnalysisResource.reset!(mapAnalysis, world);
            return mapAnalysis.getOverlordSpots();
        } finally {
            getGameInfo.mockRestore();
        }
    }

    it('treats a cell as walkable when it is pathable or placeable', async () => {
        expect(await spotsFor({ g: 1, p: 0 }, { g: 1, p: 0 })).toEqual([{ x: 3, y: 3 }]);
        expect(await spotsFor({ g: 1, p: 1 }, { g: 1, p: 0 })).toEqual([]);
        expect(await spotsFor({ g: 1, p: 0 }, { g: 1, p: 1 })).toEqual([]);
    });
});

describe('mapAnalysis lifecycle', () => {
    it('analyses eagerly once per game, or lazily, and recomputes after configure with settings from config, configure and reset', async () => {
        const { analyzeChokes } = chokesModule;
        const settingsSeen: [number, number][] = [];
        const analyze = spyOn(chokesModule, 'analyzeChokes').mockImplementation((walkable, width, height, settings) => {
            settingsSeen.push([settings.minRegionArea, settings.peakRatio]);
            return analyzeChokes(walkable, width, height, settings);
        });
        try {
            const eager = await createTestWorld('blueshift', { loop: 224 });
            await stepTo(eager, 896);
            expect(analyze).toHaveBeenCalledTimes(1);

            analyze.mockClear();
            settingsSeen.length = 0;
            const lazy = await createTestWorld('blueshift', {
                loop: 896,
                config: { features: { eagerMapAnalysis: false }, resources: { mapAnalysis: { minRegionArea: 120 } } },
            });
            const { mapAnalysis } = lazy.resources.get();
            expect(analyze).not.toHaveBeenCalled();

            mapAnalysis.getRegions();
            mapAnalysis.configure({ peakRatio: 3 });
            mapAnalysis.getChokes();
            await lazy.engine.setupGame();
            mapAnalysis.getChokes();

            expect(settingsSeen).toEqual([
                [120, 2.2],
                [120, 3],
                [120, 3],
            ]);
        } finally {
            analyze.mockRestore();
        }
    });

    it('throws MapDecompositionError without start grids while the step hook stays silent, and has no enemy main ramp without an enemy main', async () => {
        const bare = createWorld();
        const { mapAnalysis } = bare.resources.get();

        expect(() => mapAnalysis.getRegions()).toThrow(MapDecompositionError);
        expect(() => mapAnalysisResource.onStep!(mapAnalysis, bare)).not.toThrow();

        const world = await createTestWorld('blueshift', { loop: 896 });
        const { map } = world.resources.get();
        const enemyMain = spyOn(map, 'getEnemyMain').mockReturnValue(undefined as never);
        expect(world.resources.get().mapAnalysis.getEnemyMainRamp()).toBeUndefined();
        enemyMain.mockRestore();
    });

    it('has no enemy main ramp on an arcade map', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { map, mapAnalysis } = world.resources.get();
        expect(mapAnalysis.getEnemyMainRamp()).toBeDefined();

        map.setLocations({ enemy: [] });

        expect(map.isArcade()).toBe(true);
        expect(map.getEnemyMain()).toBeDefined();
        expect(mapAnalysis.getEnemyMainRamp()).toBeUndefined();
    });

    it('draws choke cells and region centres', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { debug, mapAnalysis } = world.resources.get();
        const draw = spyOn(debug!, 'setDrawCells');

        mapAnalysis.drawDebug();

        const [[id, cells]] = draw.mock.calls;
        expect(id).toBe('mapAnalysisChokes');
        expect(cells.filter(({ text }) => text?.startsWith('R'))).toHaveLength(mapAnalysis.getRegions().length);
        expect(cells.filter(({ text }) => text?.startsWith('C'))).toHaveLength(
            mapAnalysis.getChokes().reduce((total, { points }) => total + points.length, 0),
        );
    });
});
