import { describe, expect, it } from 'bun:test';
import { createTestWorld } from '../test/create-test-world.ts';
import { toyFixture } from '../test/factories.ts';
import { Ramp } from '../utils/map/ramp.ts';
import { PixelMap } from '../utils/pixel-map.ts';
import type { Point2D } from '../types.ts';

const byPosition = (points: Point2D[]) => [...points].sort((left, right) => left.x - right.x || left.y - right.y);
const rounded = ({ x, y }: Point2D) => ({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });

const VISION_BLOCKERS: Array<[number, number]> = [
    [32, 97],
    [32, 98],
    [33, 96],
    [33, 97],
    [33, 98],
    [33, 99],
    [33, 100],
    [33, 101],
    [34, 96],
    [34, 97],
    [34, 98],
    [34, 101],
    [34, 102],
    [35, 96],
    [35, 97],
    [35, 98],
    [35, 101],
    [35, 102],
    [36, 96],
    [36, 97],
    [36, 98],
    [36, 99],
    [36, 100],
    [36, 101],
    [36, 102],
    [37, 97],
    [37, 98],
    [37, 99],
    [37, 100],
    [37, 101],
    [37, 102],
    [38, 98],
    [38, 99],
    [38, 100],
    [38, 101],
    [59, 72],
    [60, 68],
    [60, 70],
    [60, 71],
    [60, 72],
    [60, 73],
    [60, 74],
    [61, 67],
    [61, 68],
    [61, 69],
    [61, 70],
    [61, 71],
    [61, 72],
    [61, 73],
    [62, 68],
    [62, 69],
    [62, 70],
    [62, 71],
    [62, 72],
    [62, 73],
    [63, 67],
    [63, 68],
    [63, 69],
    [63, 70],
    [64, 65],
    [64, 67],
    [64, 68],
    [64, 69],
    [65, 63],
    [65, 64],
    [65, 65],
    [65, 66],
    [65, 67],
    [65, 68],
    [65, 69],
    [65, 70],
    [66, 63],
    [66, 64],
    [66, 65],
    [66, 66],
    [66, 67],
    [66, 68],
    [66, 69],
    [66, 70],
    [67, 63],
    [67, 64],
    [67, 65],
    [67, 66],
    [67, 72],
    [68, 63],
    [68, 69],
    [68, 70],
    [68, 71],
    [68, 72],
    [68, 73],
    [68, 74],
    [69, 65],
    [69, 66],
    [69, 67],
    [69, 68],
    [69, 69],
    [69, 70],
    [69, 71],
    [69, 72],
    [69, 73],
    [70, 65],
    [70, 66],
    [70, 67],
    [70, 68],
    [70, 69],
    [70, 70],
    [70, 71],
    [70, 72],
    [70, 73],
    [71, 66],
    [71, 67],
    [71, 68],
    [71, 70],
    [72, 65],
    [72, 66],
    [72, 67],
    [72, 68],
    [73, 63],
    [73, 64],
    [73, 65],
    [73, 66],
    [73, 67],
    [74, 63],
    [74, 64],
    [74, 65],
    [74, 66],
    [74, 67],
    [74, 68],
    [75, 63],
    [75, 64],
    [75, 65],
    [75, 67],
    [76, 63],
    [98, 35],
    [98, 36],
    [98, 37],
    [98, 38],
    [99, 34],
    [99, 35],
    [99, 36],
    [99, 37],
    [99, 38],
    [99, 39],
    [100, 34],
    [100, 37],
    [100, 38],
    [100, 39],
    [101, 34],
    [101, 37],
    [101, 38],
    [101, 39],
    [102, 34],
    [102, 35],
    [102, 36],
    [102, 37],
    [102, 38],
    [102, 39],
    [103, 35],
    [103, 36],
    [103, 37],
    [103, 38],
];

describe('MapResource', () => {
    it.each<[string, number, unknown]>([
        [
            'blueshift',
            23,
            {
                upper: [
                    { x: 22, y: 30 },
                    { x: 23, y: 31 },
                ],
                lower: [
                    { x: 18, y: 34 },
                    { x: 19, y: 35 },
                    { x: 21, y: 30 },
                ],
                topCenter: { x: 22.5, y: 30.5 },
                bottomCenter: { x: 19.333, y: 33 },
                barracksInMiddle: { x: 24.5, y: 29.5 },
                depotInMiddle: { x: 24, y: 30 },
                cornerDepots: [
                    { x: 22, y: 29 },
                    { x: 25, y: 32 },
                ],
                barracksCorrectPlacement: { x: 24.5, y: 29.5 },
                protossWallPylon: { x: 27, y: 27 },
                protossWallBuildings: [
                    { x: 23.5, y: 28.5 },
                    { x: 25.5, y: 31.5 },
                ],
                protossWallWarpin: { x: 21.5, y: 29.5 },
            },
        ],
        [
            'simple64',
            2,
            {
                upper: [
                    { x: 32, y: 51 },
                    { x: 32, y: 52 },
                    { x: 33, y: 50 },
                    { x: 33, y: 51 },
                    { x: 34, y: 50 },
                ],
                lower: [
                    { x: 36, y: 55 },
                    { x: 37, y: 54 },
                ],
                topCenter: { x: 32.8, y: 50.8 },
                bottomCenter: { x: 36.5, y: 54.5 },
                barracksInMiddle: { x: 31.5, y: 49.5 },
                depotInMiddle: { x: 32, y: 50 },
                cornerDepots: [
                    { x: 31, y: 52 },
                    { x: 34, y: 49 },
                ],
                barracksCorrectPlacement: { x: 29.5, y: 49.5 },
                protossWallPylon: { x: 29, y: 47 },
                protossWallBuildings: [
                    { x: 30.5, y: 50.5 },
                    { x: 33.5, y: 48.5 },
                ],
                protossWallWarpin: { x: 31.5, y: 52.5 },
            },
        ],
    ])(
        'finds the main base ramp and its terran and protoss wall-off positions on %s like python-sc2',
        async (mapName, rampCount, expected) => {
            const world = await createTestWorld(mapName);
            const { map } = world.resources.get();
            const ramp = map.getMainBaseRamp()!;

            expect(map.getRamps()).toHaveLength(rampCount);
            expect<unknown>({
                upper: byPosition(ramp.upper),
                lower: byPosition(ramp.lower),
                topCenter: rounded(ramp.topCenter),
                bottomCenter: rounded(ramp.bottomCenter),
                barracksInMiddle: rounded(ramp.barracksInMiddle!),
                depotInMiddle: rounded(ramp.depotInMiddle!),
                cornerDepots: byPosition(ramp.cornerDepots.map(rounded)),
                barracksCorrectPlacement: rounded(ramp.barracksCorrectPlacement!),
                protossWallPylon: rounded(ramp.protossWallPylon!),
                protossWallBuildings: byPosition(ramp.protossWallBuildings.map(rounded)),
                protossWallWarpin: rounded(ramp.protossWallWarpin!),
            }).toEqual(expected);
        },
    );

    it('has no terran wall on a main ramp too wide for a middle depot', () => {
        const upper = [
            { x: 10, y: 10 },
            { x: 13, y: 12 },
        ];
        const lower = [
            { x: 8, y: 15 },
            { x: 9, y: 16 },
        ];
        const terrainHeight = new PixelMap({ bitsPerPixel: 8, size: { x: 20, y: 20 }, data: new Uint8Array(400) });
        upper.forEach(({ x, y }) => terrainHeight.set({ x, y }, 2));
        lower.forEach(({ x, y }) => terrainHeight.set({ x, y }, 1));
        const ramp = new Ramp([...upper, ...lower], terrainHeight, () => ({ x: 0, y: 0 }));

        expect([ramp.depotInMiddle, ramp.cornerDepots, ramp.barracksCorrectPlacement]).toEqual([null, [], null]);
    });

    it('computes expansion locations and vision blockers from the start grids like python-sc2', async () => {
        const world = await createTestWorld('blueshift');
        const { map } = world.resources.get();

        const pythonLocations = [
            { x: 14.5, y: 43.5 },
            { x: 15.5, y: 15.5 },
            { x: 15.5, y: 71.5 },
            { x: 15.5, y: 121.5 },
            { x: 44.5, y: 28.5 },
            { x: 56.5, y: 98.5 },
            { x: 66.5, y: 121.5 },
            { x: 69.5, y: 14.5 },
            { x: 79.5, y: 37.5 },
            { x: 91.5, y: 107.5 },
            { x: 120.5, y: 14.5 },
            { x: 120.5, y: 64.5 },
            { x: 120.5, y: 120.5 },
            { x: 121.5, y: 92.5 },
        ];

        expect(byPosition(map.getExpansionLocations())).toEqual(pythonLocations);
        expect(
            byPosition(
                map
                    .getExpansions()
                    .map(({ townhallPosition }) => ({ x: townhallPosition.x + 0.5, y: townhallPosition.y + 0.5 })),
            ),
        ).toEqual(pythonLocations);
        expect(byPosition(map.getVisionBlockers())).toEqual(VISION_BLOCKERS.map(([x, y]) => ({ x, y })));
    });

    it('reads terrain height, z-height, pathing and placement at the floored cell of a point, with watchtowers unpathable and unbuildable rocks walkable but unplaceable', async () => {
        const world = await createTestWorld('blueshift');
        const { map } = world.resources.get();
        const commandCenter = { x: 15.5, y: 15.5 };
        const rampTop = { x: 22.5, y: 30.5 };
        const openGround = { x: 44.5, y: 28.5 };
        const corner = { x: 0, y: 0 };
        const watchtower = { x: 35, y: 100 };
        const unbuildableRocks = { x: 116, y: 99 };
        const points = [commandCenter, rampTop, openGround, corner, watchtower, unbuildableRocks];

        expect(
            points.map((point) => [
                map.getTerrainHeight(point),
                map.getTerrainZHeight(point),
                map.inPathingGrid(point),
                map.inPlacementGrid(point),
                map.getHeight(point),
                map.isPathable(point),
                map.isPlaceable(point),
            ]),
        ).toEqual([
            [223, -16 + (32 * 223) / 255, false, true, 12, false, false],
            [223, -16 + (32 * 223) / 255, true, false, 12, true, false],
            [207, -16 + (32 * 207) / 255, true, true, 10, true, true],
            [127, -16 + (32 * 127) / 255, false, false, 0, false, false],
            [207, -16 + (32 * 207) / 255, true, true, 10, false, false],
            [207, -16 + (32 * 207) / 255, true, true, 10, true, false],
        ]);
    });

    it('queries engine pathing distance from a point or a unit, null when unreachable', async () => {
        const world = await createTestWorld('blueshift', { loop: 0 });
        const { map, units } = world.resources.get();
        const scv = units.getByTag('4343988225')!;
        const sentBefore = world.client.sent.queries.length;

        expect(await map.queryPathing({ x: 14, y: 43 }, { x: 121, y: 92 })).toBe(117.68798828125);
        expect(await map.queryPathing(scv, { x: 14, y: 43 })).toBe(35.64599609375);
        expect(await map.queryPathing({ x: 14, y: 43 }, { x: 1, y: 1 })).toBeNull();
        expect(world.client.sent.queries.slice(sentBefore)).toEqual([
            { pathing: [{ startPos: { x: 14, y: 43 }, endPos: { x: 121, y: 92 } }] },
            { pathing: [{ unitTag: '4343988225', endPos: { x: 14, y: 43 } }] },
            { pathing: [{ startPos: { x: 14, y: 43 }, endPos: { x: 1, y: 1 } }] },
        ]);
    });

    it('leaves a natural without a wall-off empty and rallies from the natural townhall instead', async () => {
        const { map } = (await createTestWorld('simple64')).resources.get();

        expect(map.getNatural().getWall()).toEqual([]);
        expect(map.getCombatRally()).toEqual({ x: 49, y: 51 });
    });

    it.each([
        ['no enemy start location', { enemyStart: false }, [2, 16], [999, 999]],
        ['no own townhall', { ownTownhall: false }, [999, 999], [16, 2]],
    ])(
        'still finds every expansion with %s, and no thirds or main base ramp on a rampless two-base map, falling back to straight-line distance for the closest expansion when walled off',
        async (_, options, pathsFromMain, pathsFromEnemy) => {
            const { map } = (await createTestWorld(toyFixture(options))).resources.get();

            expect(
                map
                    .getExpansions()
                    .map(({ townhallPosition, pathFromMain, pathFromEnemy }) => [
                        townhallPosition,
                        pathFromMain!.length,
                        pathFromEnemy!.length,
                    ]),
            ).toEqual([
                [{ x: 8, y: 17 }, pathsFromMain[0], pathsFromEnemy[0]],
                [{ x: 23, y: 15 }, pathsFromMain[1], pathsFromEnemy[1]],
            ]);
            expect([map.getThirds(), map.getEnemyThirds(), map.getMainBaseRamp()]).toEqual([[], [], undefined]);

            for (let y = 0; y < 32; y++) {
                map.setPathable({ x: 28, y }, false);
            }
            expect(map.getClosestExpansion({ x: 30, y: 5 }).townhallPosition).toEqual({ x: 23, y: 15 });
        },
    );
});
