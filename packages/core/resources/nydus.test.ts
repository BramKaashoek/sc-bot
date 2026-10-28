import { describe, expect, it } from 'bun:test';
import { Ability, UnitType } from '../constants/index.ts';
import { Alliance, Race } from '../constants/enums.ts';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';
import { rawUnit, toyFixture, toyWorld } from '../test/factories.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import { stateByNydus } from './nydus.ts';
import type { InfluenceGrid, Point2D } from '../types.ts';

const SIZE = 32;
const TYPES = Object.fromEntries(
    [UnitType.NYDUSNETWORK, UnitType.NYDUSCANAL, UnitType.QUEEN, UnitType.ROACH].map((id) => [id, {}]),
);

const nydusUnit = (unitType: number, x: number, y: number, extra: SC2APIProtocol.Unit = {}) =>
    rawUnit({ unitType, pos: { x, y, z: 10 }, health: 300, healthMax: 300, ...extra });

const zergWorld = (units: SC2APIProtocol.Unit[]) => toyWorld({ race: Race.ZERG, unitTypes: TYPES, units });

const footprints = [8.5, 24.5].flatMap((x) => [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => [x + dx, 5.5 + dy])));

function wallGrid(): InfluenceGrid {
    const data = new Float32Array(SIZE * SIZE).fill(1);
    for (let y = 0; y < 30; y++) data[y * SIZE + 16] = Infinity;
    footprints.forEach(([x, y]) => {
        data[Math.floor(y) * SIZE + Math.floor(x)] = Infinity;
    });
    return {
        layer: 'ground',
        width: SIZE,
        height: SIZE,
        data,
        get: ({ x, y }) => data[Math.floor(y) * SIZE + Math.floor(x)] ?? Infinity,
    };
}

const step = (world: TestWorld, loop: number, edit?: Parameters<typeof observationAt>[2]) =>
    stepTo(world, observationAt(world, loop, { base: 0, ...edit }));

const closestToNaturalTag = (world: TestWorld, candidates: SC2APIProtocol.Unit[]) => {
    const { map } = world.resources.get();
    const natural = map.getNatural()?.townhallPosition ?? map.getLocations().self!;
    const d = (raw: SC2APIProtocol.Unit) => Math.hypot(raw.pos!.x! - natural.x, raw.pos!.y! - natural.y);
    return candidates.reduce((best, raw) => (d(raw) < d(best) ? raw : best)).tag!;
};

const start = { x: 5.5, y: 5.5 };
const target = { x: 26.5, y: 5.5 };

describe('nydus-aware path', () => {
    it('enters a ready pair only when it shortens the trip, caches for 44 loops and drops the cache when a nydus dies', async () => {
        const entry = nydusUnit(UnitType.NYDUSNETWORK, 8.5, 5.5);
        const exit = nydusUnit(UnitType.NYDUSCANAL, 24.5, 5.5);
        const world = await zergWorld([entry, exit]);
        const { nydus } = world.resources.get();
        const layer = wallGrid();

        expect(nydus.nextPoint(start, target, { layer })).toEqual({
            point: { x: 8.5, y: 5.5 },
            exitTowards: { x: 26.5, y: 5.5 },
            nydusTags: [entry.tag, exit.tag],
        });
        expect(nydus.nextPoint(start, { x: 12.5, y: 5.5 }, { layer }).nydusTags).toBeUndefined();

        const costly = wallGrid();
        for (let y = 0; y < 30; y++) costly.data[y * SIZE + 16] = 1;
        for (let y = 3; y <= 7; y++) {
            for (let x = 6; x <= 10; x++) if (costly.data[y * SIZE + x] !== Infinity) costly.data[y * SIZE + x] = 100;
        }
        await step(world, 44);
        expect(nydus.nextPoint(start, target, { layer: costly }).nydusTags).toEqual([entry.tag, exit.tag]);
        await step(world, 46);
        expect(nydus.nextPoint(start, target, { layer: costly })).toEqual({ point: expect.anything() });

        const nearby = { x: 26.5, y: 6.5 };
        await step(world, 47);
        expect(nydus.nextPoint(start, nearby, { layer }).nydusTags).toEqual([entry.tag, exit.tag]);
        await step(world, 48, { hide: [exit.tag] });
        expect(nydus.nextPoint(start, nearby, { layer })).toEqual({ point: expect.anything() });
    });

    it('ignores nyduses that are still building', async () => {
        const entry = nydusUnit(UnitType.NYDUSNETWORK, 8.5, 5.5);
        const building = nydusUnit(UnitType.NYDUSCANAL, 24.5, 5.5, { buildProgress: 0.4 });
        const world = await zergWorld([entry, building]);

        expect(world.resources.get().nydus.nextPoint(start, target, { layer: wallGrid() })).toEqual({
            point: expect.anything(),
        });
    });
});

describe('start and goal in rock', () => {
    const openGrid = (rock: (x: number, y: number) => boolean): InfluenceGrid => {
        const data = new Float32Array(SIZE * SIZE).fill(1);
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (rock(x, y)) data[y * SIZE + x] = Infinity;
        return {
            layer: 'ground',
            width: SIZE,
            height: SIZE,
            data,
            get: ({ x, y }) => data[Math.floor(y) * SIZE + Math.floor(x)] ?? Infinity,
        };
    };
    const cliffWorld = () => {
        const fixture = toyFixture({ race: Race.ZERG, unitTypes: TYPES });
        const heights = fixture.gameInfo.startRaw!.terrainHeight!.data!;
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) heights[y * SIZE + x] = x < 10 ? 100 : 200;
        return createTestWorld(fixture);
    };

    it('moves a start in rock to the nearest cell on its own height, not the nearer low ground across the cliff', async () => {
        const world = await cliffWorld();
        const layer = openGrid((x, y) => x >= 10 && x <= 14 && y >= 7 && y <= 12);

        expect(
            world.resources
                .get()
                .nydus.nextPoint({ x: 11.5, y: 10.5 }, { x: 11.5, y: 17.5 }, { layer, sensitivity: 1 }),
        ).toEqual({ point: { x: 11.5, y: 14.5 } });
    });

    it('falls back to the nearest cell on any height when none shares its height', async () => {
        const world = await cliffWorld();
        const layer = openGrid((x) => x >= 10);

        expect(
            world.resources.get().nydus.nextPoint({ x: 12.5, y: 10.5 }, { x: 2.5, y: 10.5 }, { layer, sensitivity: 1 }),
        ).toEqual({ point: { x: 8.5, y: 10.5 } });
    });
});

describe('nydus path cache', () => {
    it('prunes entries older than 44 loops on every step', async () => {
        const world = await zergWorld([]);
        const { nydus } = world.resources.get();
        nydus.nextPoint(start, target, { layer: wallGrid() });
        expect(stateByNydus.get(nydus)!.pathCache.size).toBe(1);
        await step(world, 44);
        expect(stateByNydus.get(nydus)!.pathCache.size).toBe(1);
        await step(world, 45);
        expect(stateByNydus.get(nydus)!.pathCache.size).toBe(0);
    });

    it('starts a game from a clean cache and traveller list', async () => {
        const first = nydusUnit(UnitType.NYDUSNETWORK, 8.5, 5.5);
        const second = nydusUnit(UnitType.NYDUSCANAL, 24.5, 5.5);
        const roach = rawUnit({ unitType: UnitType.ROACH, tag: 'roach' });
        const world = await zergWorld([first, second, roach]);
        const { nydus, units } = world.resources.get();
        nydus.nextPoint(start, target, { layer: wallGrid() });
        nydus.addTraveller(units.getByTag('roach')!, first.tag, second.tag, { x: 1, y: 1 });

        world.resources.reset(world);
        expect([stateByNydus.get(nydus)!.pathCache.size, nydus.getTravellers().size]).toEqual([0, 0]);
    });

    it('treats a path touching one nydus as entering and leaving the same network', async () => {
        const lone = nydusUnit(UnitType.NYDUSNETWORK, 8.5, 5.5);
        const far = nydusUnit(UnitType.NYDUSCANAL, 24.5, 25.5);
        const world = await zergWorld([lone, far]);
        const data = new Float32Array(SIZE * SIZE).fill(1);
        const layer: InfluenceGrid = {
            layer: 'ground',
            width: SIZE,
            height: SIZE,
            data,
            get: ({ x, y }) => data[Math.floor(y) * SIZE + Math.floor(x)] ?? Infinity,
        };

        expect(world.resources.get().nydus.nextPoint(start, { x: 11.5, y: 5.5 }, { layer })).toEqual({
            point: { x: 8.5, y: 5.5 },
            exitTowards: { x: 11.5, y: 5.5 },
            nydusTags: [lone.tag, lone.tag],
        });
    });
});

describe('nydus travel', () => {
    it('unloads one passenger per exit per loop, queens first, from any nydus, bans for 5 s and repoints on death', async () => {
        const first = nydusUnit(UnitType.NYDUSNETWORK, 8.5, 5.5);
        const exit = nydusUnit(UnitType.NYDUSCANAL, 24.5, 5.5, {
            passengers: [{ tag: 'roach' }, { tag: 'queen' }, { tag: 'stray' }],
        });
        const spare = nydusUnit(UnitType.NYDUSCANAL, 20.5, 25.5);
        const queen = rawUnit({ unitType: UnitType.QUEEN, tag: 'queen', pos: { x: 24.5, y: 5.5, z: 10 } });
        const roach = rawUnit({ unitType: UnitType.ROACH, tag: 'roach', pos: { x: 24.5, y: 5.5, z: 10 } });
        const world = await zergWorld([first, exit, spare, queen, roach]);
        const { nydus, units, actions, map } = world.resources.get();
        const rally = { x: 12, y: 12 };
        nydus.addTraveller(units.getByTag('roach')!, first.tag, exit.tag, rally);
        nydus.addTraveller(units.getByTag('queen')!, first.tag, exit.tag, rally);

        const sentBefore = world.client.sent.actions.length;
        await step(world, 10);
        await actions.flushQueuedActions();
        expect(world.client.sent.actions.slice(sentBefore)).toEqual([
            {
                actions: [
                    { actionRaw: { unitCommand: { abilityId: 0, unitTags: [exit.tag] } } },
                    { actionUi: { cargoPanel: { unitIndex: 1 } } },
                ],
            },
            {
                actions: [
                    {
                        actionRaw: {
                            unitCommand: {
                                abilityId: Ability.RALLY_BUILDING,
                                unitTags: [exit.tag],
                                targetWorldSpacePos: rally,
                                queueCommand: false,
                            },
                        },
                    },
                ],
            },
        ]);
        expect([nydus.isBanned('queen'), nydus.isBanned('roach')]).toEqual([true, false]);
        expect([...nydus.getTravellers().keys()].sort()).toEqual(['queen', 'roach', 'stray']);
        expect(nydus.getTravellers().get('queen')).toEqual({
            entry: first.tag,
            exit: exit.tag,
            exitTowards: rally,
            unitType: UnitType.QUEEN,
        });
        expect(nydus.getTravellers().get('stray')).toEqual({
            entry: closestToNaturalTag(world, [first, exit, spare]),
            exit: closestToNaturalTag(world, [first, exit, spare]),
            exitTowards: map.getCenter(),
        });

        const roachOnly = (list: SC2APIProtocol.Unit[]) =>
            list.map((raw) => (raw.tag === exit.tag ? { ...raw, passengers: [{ tag: 'roach' }] } : raw));
        const sentBeforeSecond = world.client.sent.actions.length;
        await step(world, 20, { edit: roachOnly });
        expect(nydus.isBanned('queen')).toBe(true);
        expect(world.client.sent.actions[sentBeforeSecond]).toEqual({
            actions: [
                { actionRaw: { unitCommand: { abilityId: 0, unitTags: [exit.tag] } } },
                { actionUi: { cargoPanel: { unitIndex: 0 } } },
            ],
        });

        await step(world, 10 + 113, { edit: roachOnly });
        expect([nydus.isBanned('queen'), nydus.isBanned('roach')]).toEqual([false, true]);

        await step(world, 10 + 114, { hide: [exit.tag] });
        expect(nydus.getTravellers().get('queen')).toMatchObject({ exit: closestToNaturalTag(world, [first, spare]) });
        expect(nydus.getTravellers().get('stray')).toMatchObject({ exit: closestToNaturalTag(world, [first, spare]) });
        await step(world, 10 + 115, { hide: [exit.tag, first.tag, spare.tag] });
        expect(nydus.getTravellers().size).toBe(0);
    });

    it('does not unload through an exit nydus that is still building', async () => {
        const first = nydusUnit(UnitType.NYDUSNETWORK, 8.5, 5.5);
        const exit = nydusUnit(UnitType.NYDUSCANAL, 24.5, 5.5, {
            buildProgress: 0.4,
            passengers: [{ tag: 'roach' }],
        });
        const roach = rawUnit({ unitType: UnitType.ROACH, tag: 'roach' });
        const world = await zergWorld([first, exit, roach]);
        const { nydus, units } = world.resources.get();
        nydus.addTraveller(units.getByTag('roach')!, first.tag, exit.tag, { x: 1, y: 1 });

        const sentBefore = world.client.sent.actions.length;
        await step(world, 10);
        expect(world.client.sent.actions.length).toBe(sentBefore);
        expect(nydus.isBanned('roach')).toBe(false);
    });

    it('sends every traveller out of a lone nydus', async () => {
        const only = nydusUnit(UnitType.NYDUSNETWORK, 8.5, 5.5, { passengers: [{ tag: 'roach' }] });
        const roach = rawUnit({ unitType: UnitType.ROACH, tag: 'roach' });
        const world = await zergWorld([only, roach]);
        const { nydus, units } = world.resources.get();
        nydus.addTraveller(units.getByTag('roach')!, 'gone-a', 'gone-b', { x: 1, y: 1 });

        await step(world, 10);
        expect([nydus.getTravellers().size, nydus.isBanned('roach')]).toEqual([1, true]);
        expect(world.client.sent.actions[0].actions?.[1]).toEqual({ actionUi: { cargoPanel: { unitIndex: 0 } } });
    });
});

describe('main nydus points and findNydusAtLocation', () => {
    it('lists the map center as the only enemy main point, and the bare own start, on an arcade map', async () => {
        const { resources } = await zergWorld([]);
        const { nydus, map } = resources.get();
        map.setLocations({ enemy: [] });

        expect(nydus.getEnemyMainNydusPoints()).toEqual([map.getCenter()]);
        expect(nydus.getOwnMainNydusPoints()).toEqual([map.getLocations().self!]);
    });

    it('lists perimeter spots away from the townhall, geysers and ramp, furthest first, and finds a cheap quiet spot in a base region', async () => {
        const world: TestWorld = await createTestWorld('blueshift-zerg', { loop: 896 });
        const { nydus, map, mapAnalysis, units, influence } = world.resources.get();
        const self = map.getLocations().self!;
        const rampTop = map.getMainBaseRamp()!.topCenter;
        const dist = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);

        const own = nydus.getOwnMainNydusPoints();
        const geysers = units.getGasGeysers().filter((geyser) => dist(geyser.pos!, self) < 12);
        const score = (p: Point2D) => dist(p, self) ** 2 + dist(p, rampTop) ** 2;
        expect(own.length).toBeGreaterThan(0);
        expect(own.every((p) => map.inPathingGrid(p) && dist(p, self) > 15 && dist(p, rampTop) > 13)).toBe(true);
        expect(own.every((p) => geysers.slice(0, 2).every((geyser) => dist(p, geyser.pos!) > 11))).toBe(true);
        expect(own.every((p, i) => i === 0 || score(own[i - 1]) + 1e-6 >= score(p))).toBe(true);
        expect(nydus.findNydusAtLocation(self)).toEqual(own[0]);
        expect(nydus.getEnemyMainNydusPoints().length).toBeGreaterThan(0);
        expect(nydus.findNydusAtLocation(map.getLocations().enemy[0])).toEqual(nydus.getEnemyMainNydusPoints()[0]);

        const third = map.getThirds()[0];
        const spot = nydus.findNydusAtLocation(third.townhallPosition)!;
        const region = mapAnalysis.getRegion(third.townhallPosition)!;
        expect(mapAnalysis.getRegion(spot)?.id).toBe(region.id);
        expect(dist(spot, third.townhallPosition)).toBeLessThanOrEqual(25);
        expect(region.expansions.every((e) => dist(spot, e.townhallPosition) >= 15)).toBe(true);
        expect(influence.getGrid('ground').get(spot)).toBeLessThan(20);
        expect(nydus.findNydusAtLocation(third.townhallPosition, { maxCost: 0 })).toBeUndefined();
        expect(nydus.findNydusAtLocation(third.townhallPosition, { maxNydusDistance: 1 })).toBeUndefined();
        expect(nydus.findNydusAtLocation({ x: 1, y: 1 })).toBeUndefined();

        const ground = influence.getGrid('ground');
        const base = third.townhallPosition;
        const candidates = mapAnalysis
            .getRegionCells(region)
            .filter(
                (cell) =>
                    dist(cell, base) <= 25 &&
                    region.expansions.every((e) => dist(cell, e.townhallPosition) >= 15) &&
                    ground.get(cell) === ground.get(spot),
            );
        const furthest = candidates.reduce((best, cell) => (dist(cell, base) > dist(best, base) ? cell : best));
        const { size } = world.client.fixture.observations[896].observation!.rawData!.mapState!.visibility!;
        const watched = observationAt(world, 900);
        const { data: visibility } = watched.observation!.rawData!.mapState!.visibility!;
        visibility!.fill(1);
        visibility![Math.floor(furthest.y) * size!.x! + Math.floor(furthest.x)] = 2;
        await stepTo(world, watched);
        expect(furthest).not.toEqual(spot);
        expect(nydus.findNydusAtLocation(base)).toEqual(furthest);

        const enemy = rawUnit({
            alliance: Alliance.ENEMY,
            owner: 2,
            unitType: UnitType.ZEALOT,
            pos: { x: furthest.x, y: furthest.y, z: 10 },
        });
        await stepTo(world, observationAt(world, 904, { add: [enemy] }));
        const avoided = nydus.findNydusAtLocation(base)!;
        expect(dist(avoided, furthest)).toBeGreaterThan(12);
    });
});
