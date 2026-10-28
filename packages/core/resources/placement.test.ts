import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { Alliance } from '../constants/enums.ts';
import { GAME_LOOPS_PER_SECOND } from '../constants/time.ts';
import * as UnitType from '../constants/unit-type.ts';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import { rawUnit, toyWorld } from '../test/factories.ts';
import type { Placement, Point2D, UserPlacement, World } from '../types.ts';
import type { Ramp } from '../utils/map/ramp.ts';

const at = (world: TestWorld, gameLoop: number, extra: SC2APIProtocol.Unit[] = []) =>
    observationAt(world, gameLoop, { base: 0, add: extra });

async function solved(
    map = 'blueshift',
    { before, placements }: { before?: (world: World) => void; placements?: UserPlacement[] } = {},
) {
    return createTestWorld(map, {
        agent: createAgent({
            settings: { skipAvailableAbilitiesQuery: true },
            async onGameStart(world) {
                if (placements) world.resources.set({ placer: { placements: () => placements } });
                before?.(world);
            },
        }),
    });
}

function cells({ pos, size }: Pick<Placement, 'pos' | 'size'>, withAddon = false) {
    const side = size === '2x2' ? 2 : 3;
    const width = withAddon && size === '3x3' ? 5 : side;
    const x0 = Math.floor(pos.x - side / 2);
    const y0 = Math.floor(pos.y - side / 2);
    return Array.from({ length: width * side }, (_, i) => `${x0 + (i % width)},${y0 + Math.floor(i / width)}`);
}

const kernelCells = (spot: Pick<Placement, 'pos' | 'size'>) => cells(spot, true);

const samePos = (a: Point2D, b: Point2D) => a.x === b.x && a.y === b.y;

const distanceSquared = (a: Point2D, b: Point2D) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

afterEach(() => {
    mock.restore();
});

describe('placement resource (Terran)', () => {
    it.each(['blueshift', 'acropolis'])('solves a valid formation on %s without querying the game', async (map) => {
        const world = await solved(map);
        const { placement, map: gameMap } = world.resources.get();
        const spots = placement.getPlacements();
        const ramp = gameMap.getMainBaseRamp()!;
        const mineralLine = new Set(
            gameMap
                .getExpansions()
                .flatMap((e) => e.areas!.mineralLine.map((c) => `${Math.floor(c.x)},${Math.floor(c.y)}`)),
        );

        expect(spots.length).toBeGreaterThan(300);
        for (const spot of spots) {
            const unitType = spot.size === '2x2' ? UnitType.SUPPLYDEPOT : UnitType.BARRACKS;
            expect(placement.canPlace(unitType, spot.pos)).toBe(true);
        }
        const cells = spots.flatMap(kernelCells);
        expect(new Set(cells).size).toBe(cells.length);

        const walls = placement.getPlacements({ flag: 'wall' });
        expect(walls.map((s) => s.pos)).toEqual([ramp.barracksCorrectPlacement!, ...ramp.cornerDepots]);
        expect(placement.getPlacements({ flag: 'bunker', base: gameMap.getNatural()!.townhallPosition })).toHaveLength(
            1,
        );

        const solvedSpots = spots.filter((s) => !s.flags.has('wall') && !s.flags.has('custom'));
        expect(solvedSpots.filter((s) => distanceSquared(s.pos, ramp.topCenter) <= 36)).toEqual([]);
        expect(solvedSpots.flatMap(kernelCells).filter((c) => mineralLine.has(c))).toEqual([]);

        placement.request(UnitType.SUPPLYDEPOT);
        placement.request(UnitType.BARRACKS, { flags: ['wall'] });
        expect(world.client.sent.queries).toHaveLength(0);
    });

    it('floods the start grid, so a structure line placed before the solve neither cuts the base nor gets a spot', async () => {
        const main = { x: 15, y: 15 };
        const wall = new Set(Array.from({ length: 50 }, (_, y) => [`21,${y}`, `22,${y}`]).flat());
        const world = await solved('blueshift', {
            before: (world) => {
                for (const cell of wall) {
                    const [x, y] = cell.split(',').map(Number);
                    world.resources.get().map.setPlaceable({ x, y }, false);
                }
            },
        });
        const spots = world.resources
            .get()
            .placement.getPlacements({ base: main })
            .filter((spot) => !spot.flags.has('wall'));

        expect(spots.filter((spot) => cells(spot).some((cell) => wall.has(cell)))).toEqual([]);
        expect(spots.filter((spot) => spot.pos.x > 23).length).toBeGreaterThan(0);
    });

    it('frees a 3x3 kernel dropped by the ramp-top rule so the 2x2 pass can place there', async () => {
        const withRampTop = (topCenter: Point2D) =>
            solved('blueshift', {
                before: (world) => {
                    const ramp = {
                        topCenter,
                        bottomCenter: topCenter,
                        barracksCorrectPlacement: null,
                        cornerDepots: [],
                    };
                    spyOn(world.resources.get().map, 'getMainBaseRamp').mockReturnValue(ramp as unknown as Ramp);
                },
            });
        const main = { x: 15, y: 15 };
        const unfiltered = (await withRampTop({ x: -100, y: -100 })).resources.get().placement;
        const kernel = unfiltered
            .getPlacements({ size: '3x3', base: main })
            .find(
                (s) =>
                    Math.max(Math.abs(s.pos.x - main.x), Math.abs(s.pos.y - main.y)) > 8 &&
                    distanceSquared(s.pos, main) < 100,
            )!;

        const filtered = (await withRampTop({ x: kernel.pos.x - 5.9, y: kernel.pos.y })).resources.get().placement;
        const kernelArea = new Set(kernelCells(kernel));
        expect(filtered.getPlacements({ size: '3x3' }).map((s) => s.pos)).not.toContainEqual(kernel.pos);
        expect(
            filtered.getPlacements({ size: '2x2' }).filter((spot) => cells(spot).every((cell) => kernelArea.has(cell))),
        ).not.toEqual([]);
    });

    it('reserves requested spots until release or the reservation timeout', async () => {
        const world = await solved();
        const { placement } = world.resources.get();
        const first = placement.request(UnitType.SUPPLYDEPOT)!;
        const second = placement.request(UnitType.SUPPLYDEPOT)!;
        expect(second).not.toEqual(first);
        expect(placement.getPlacements({ state: 'reserved' }).map((s) => s.pos)).toEqual(
            expect.arrayContaining([first, second]),
        );

        placement.release(first);
        expect(placement.request(UnitType.SUPPLYDEPOT)).toEqual(first);

        await stepTo(world, at(world, 8 + Math.ceil(61 * GAME_LOOPS_PER_SECOND)));
        expect(placement.getPlacements({ state: 'reserved' })).toEqual([]);
    });

    it('prefers wall spots and falls back to the non-wall spot closest to the ramp top', async () => {
        const world = await solved();
        const { placement, map } = world.resources.get();
        const ramp = map.getMainBaseRamp()!;
        expect(placement.request(UnitType.SUPPLYDEPOT, { flags: ['wall'] })).toEqual(ramp.cornerDepots[0]);
        expect(placement.request(UnitType.SUPPLYDEPOT, { flags: ['wall'] })).toEqual(ramp.cornerDepots[1]);

        const fallback = placement.request(UnitType.SUPPLYDEPOT, { flags: ['wall'] })!;
        const available = placement.getPlacements({
            size: '2x2',
            state: 'available',
            base: map.getMain()!.townhallPosition,
        });
        const closestToRamp = Math.min(...available.map((s) => distanceSquared(s.pos, ramp.topCenter)));
        expect(distanceSquared(fallback, ramp.topCenter)).toBeLessThanOrEqual(closestToRamp);
    });

    it('offers a spot at another own base only when findAlternative allows it', async () => {
        const world = await solved();
        const { placement, map } = world.resources.get();
        const natural = map.getNatural()!.townhallPosition;
        await stepTo(
            world,
            at(world, 16, [
                rawUnit({
                    unitType: UnitType.COMMANDCENTER,
                    pos: { ...natural, z: 10 },
                    health: 1500,
                    healthMax: 1500,
                }),
            ]),
        );
        expect(map.getOccupiedExpansions()).toHaveLength(2);
        for (const spot of placement.getPlacements({ size: '2x2', base: map.getMain()!.townhallPosition })) {
            placement.reserve(spot.pos);
        }

        expect(placement.request(UnitType.SUPPLYDEPOT, { findAlternative: false })).toBeUndefined();
        const alternative = placement.request(UnitType.SUPPLYDEPOT)!;
        expect(placement.getPlacements({ base: natural }).map((s) => s.pos)).toContainEqual(alternative);
    });

    it('marks a spot taken while an own grounded structure stands on it, freeing it on lift-off or death', async () => {
        const world = await solved();
        const { placement } = world.resources.get();
        const [first, second] = placement.getPlacements({ size: '3x3' }).filter((s) => s.flags.size === 0);
        const barracks = (unitType: number, pos: Point2D) =>
            rawUnit({ tag: '9001', unitType, pos: { ...pos, z: 10 }, isFlying: unitType === UnitType.BARRACKSFLYING });
        const taken = () => placement.getPlacements({ state: 'taken' }).map((s) => [s.pos, s.tag]);

        await stepTo(world, at(world, 16, [barracks(UnitType.BARRACKS, first.pos)]));
        expect(taken()).toEqual([[first.pos, '9001']]);

        await stepTo(world, at(world, 24, [barracks(UnitType.BARRACKSFLYING, second.pos)]));
        expect(taken()).toEqual([]);

        await stepTo(world, at(world, 32, [barracks(UnitType.BARRACKS, second.pos)]));
        expect(taken()).toEqual([[second.pos, '9001']]);

        await stepTo(world, at(world, 40));
        expect(taken()).toEqual([]);
    });

    it('solves user placements first as custom, picks them by flag and otherwise last, skipping invalid ones', async () => {
        const baseline = (await solved()).resources.get().placement.getPlacements({ size: '3x3' });
        const userPos = { ...baseline.find((s) => s.flags.size === 0)!.pos };
        const base = (await solved()).resources.get();
        const pylonPos = { ...base.placement.getPlacements({ size: '2x2' }).find((s) => s.flags.size === 0)!.pos };
        const inArea = (s: { pos: Point2D }) =>
            Math.abs(pylonPos.x - s.pos.x) < 9 && Math.abs(pylonPos.y - s.pos.y) < 9 && !samePos(s.pos, pylonPos);
        const world = await solved('blueshift', {
            placements: [
                { pos: userPos, size: '3x3', flags: ['production'] },
                { pos: pylonPos, size: '2x2', flags: ['firstPylon'] },
                { pos: { x: 0.5, y: 0.5 }, size: '3x3' },
            ],
        });
        const { placement } = world.resources.get();
        const [first, pylon] = placement.getPlacements();
        expect(first.pos).toEqual(userPos);
        expect([...first.flags]).toEqual(['custom', 'production']);
        expect([...pylon.flags]).toEqual(['custom', 'firstPylon']);
        expect(placement.getPlacements({ flag: 'custom' })).toHaveLength(2);
        expect(placement.getPlacements().some(inArea)).toBe(true);

        expect(placement.request(UnitType.BARRACKS, { reserve: false })).not.toEqual(userPos);
        expect(placement.request(UnitType.BARRACKS, { flags: ['production'] })).toEqual(userPos);
    });

    it('checks addon room for addon hosts and gas buildings within 3.5', async () => {
        const world = await solved();
        const { placement, map, units } = world.resources.get();
        const spot = placement.getPlacements({ size: '3x3' }).find((s) => s.flags.size === 0)!.pos;
        map.setPlaceable({ x: spot.x + 2.5, y: spot.y - 0.5 }, false);
        expect(placement.canPlace(UnitType.BARRACKS, spot)).toBe(false);
        expect(placement.canPlace(UnitType.BARRACKS, spot, { includeAddon: false })).toBe(true);
        expect(placement.canPlace(UnitType.ENGINEERINGBAY, spot)).toBe(true);

        const [taken, free] = units
            .getAll(Alliance.NEUTRAL)
            .filter((u) => u.unitType === UnitType.VESPENEGEYSER || u.unitType === UnitType.SPACEPLATFORMGEYSER);
        await stepTo(world, at(world, 16, [rawUnit({ unitType: UnitType.REFINERY, pos: taken.pos })]));
        expect(placement.canPlace(UnitType.REFINERY, taken.pos)).toBe(false);
        expect(placement.canPlace(UnitType.REFINERY, free.pos)).toBe(true);
    });

    it('returns undefined for a Zerg agent and ignores add() before and after the solver runs', async () => {
        const spot = { pos: { x: 30.5, y: 30.5 }, size: '3x3' } as UserPlacement;
        const world = await solved('blueshift-zerg', { before: (w) => w.resources.get().placement.add([spot]) });
        const { placement } = world.resources.get();
        expect(placement.request(UnitType.SPAWNINGPOOL)).toBeUndefined();
        expect(() => placement.add([spot])).not.toThrow();
        expect(placement.getPlacements()).toEqual([]);
    });

    it.each([
        [true, false],
        [false, true],
    ])('solves no formation on an arcade map (enemy start %s, own townhall %s)', async (enemyStart, ownTownhall) => {
        const { placement } = (await toyWorld({ enemyStart, ownTownhall })).resources.get();

        expect(placement.getPlacements()).toEqual([]);
        expect(placement.request(UnitType.SUPPLYDEPOT)).toBeUndefined();
    });

    it('keeps configured settings across a reset but drops spots and reservations', async () => {
        const world = await solved();
        const { placement } = world.resources.get();
        placement.configure({ reservationTimeout: 5 });
        placement.request(UnitType.SUPPLYDEPOT);
        world.resources.reset(world);
        expect(placement.getPlacements()).toEqual([]);

        await world.engine.setupGame();
        await stepTo(world, at(world, 8));
        const reserved = placement.request(UnitType.SUPPLYDEPOT)!;
        await stepTo(world, at(world, 8 + Math.ceil(6 * GAME_LOOPS_PER_SECOND)));
        expect(placement.getPlacements({ state: 'reserved' })).toEqual([]);
        expect(reserved).toBeDefined();
    });
});

describe('placement resource (Protoss)', () => {
    const NATURAL_SPOTS = [
        '2x2 23,39 productionPylon',
        '2x2 23,46 productionPylon optimalPylon',
        '2x2 9,53 productionPylon',
        '2x2 16,53 productionPylon',
        '3x3 5.5,35.5',
        '3x3 8.5,35.5',
        '3x3 5.5,38.5',
        '3x3 20.5,41.5',
        '3x3 23.5,41.5',
        '3x3 26.5,41.5',
        '3x3 20.5,44.5',
        '3x3 26.5,44.5',
        '3x3 5.5,47.5',
        '3x3 20.5,47.5',
        '3x3 26.5,47.5',
        '3x3 5.5,50.5',
        '3x3 8.5,50.5',
        '3x3 17.5,50.5',
        '3x3 20.5,50.5',
        '3x3 11.5,53.5',
        '2x2 12,32',
        '2x2 16,35',
        '2x2 4,41',
        '2x2 6,41',
        '2x2 4,44',
        '2x2 24,44',
        '2x2 26,50',
        '2x2 28,50',
        '2x2 14,53',
        '2x2 18,53',
        '2x2 20,53',
    ];

    it('solves a valid formation with a ramp wall and one optimal pylon per base, pinning the natural', async () => {
        const world = await solved('blueshift-protoss');
        const { placement, map } = world.resources.get();
        const spots = placement.getPlacements();
        const ramp = map.getMainBaseRamp()!;

        for (const spot of spots) {
            expect(placement.canPlace(spot.size === '2x2' ? UnitType.PYLON : UnitType.GATEWAY, spot.pos)).toBe(true);
        }
        const footprints = spots.flatMap((spot) => cells(spot));
        expect(new Set(footprints).size).toBe(footprints.length);
        expect(placement.getPlacements({ flag: 'wall' }).map((s) => s.pos)).toEqual([
            ramp.protossWallPylon!,
            ...ramp.protossWallBuildings,
        ]);

        for (const { townhallPosition: base } of map.getExpansions()) {
            const [optimal, ...others] = placement.getPlacements({ base, flag: 'optimalPylon' });
            expect(others).toEqual([]);
            const near = (pylon: Placement) =>
                placement
                    .getPlacements({ base, size: '3x3' })
                    .filter((s) => distanceSquared(s.pos, pylon.pos) < 6.5 ** 2).length;
            const mostNear = Math.max(...placement.getPlacements({ base, flag: 'productionPylon' }).map(near));
            expect(near(optimal)).toBe(mostNear);
        }

        const natural = placement.getPlacements({ base: map.getNatural()!.townhallPosition });
        expect(
            natural.map((s) => `${s.size} ${s.pos.x},${s.pos.y}${[...s.flags].map((f) => ` ${f}`).join('')}`),
        ).toEqual(NATURAL_SPOTS);
    });

    it('returns powered spots only near own pylons that are far enough along, on the same height', async () => {
        const world = await solved('blueshift-protoss');
        const { placement, map } = world.resources.get();
        const spot = placement.getPlacements({ size: '3x3', base: map.getNatural()!.townhallPosition })[7].pos;
        const pylonPos = { x: spot.x + 3.5, y: spot.y + 0.5 };
        const pylon = rawUnit({ unitType: UnitType.PYLON, pos: { ...pylonPos, z: 12 }, buildProgress: 0.5 });
        await stepTo(world, at(world, 16, [pylon]));

        const request = (pylonBuildProgress?: number) =>
            placement.request(UnitType.GATEWAY, {
                base: map.getNatural()!.townhallPosition,
                powered: true,
                reserve: false,
                findAlternative: false,
                pylonBuildProgress,
            });
        expect(request()).toBeUndefined();
        expect(distanceSquared(request(0.5)!, pylon.pos as Point2D)).toBeLessThan(6.5 ** 2);

        const offsets = [];
        for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) offsets.push({ dx, dy });
        const within = offsets
            .map(({ dx, dy }) => ({ x: pylonPos.x + dx, y: pylonPos.y + dy }))
            .filter((pos) => distanceSquared(pos, pylonPos) < 6.5 ** 2);
        const otherHeight = within.find((pos) => map.getTerrainHeight(pos) !== map.getTerrainHeight(pylonPos))!;
        const sameHeight = within.find((pos) => map.getTerrainHeight(pos) === map.getTerrainHeight(pylonPos))!;
        const edge = { x: pylonPos.x + 6.5, y: pylonPos.y };

        expect(placement.isPowered(sameHeight)).toBe(false);
        expect(placement.isPowered(sameHeight, { pylonBuildProgress: 0.5 })).toBe(true);
        expect(placement.isPowered(otherHeight, { pylonBuildProgress: 0.5 })).toBe(false);
        expect(placement.wouldPower(pylonPos, sameHeight)).toBe(true);
        expect(placement.wouldPower(pylonPos, otherHeight)).toBe(false);
        expect(placement.wouldPower(pylonPos, edge)).toBe(false);
    });

    it('never gives a pylon a staticDefence spot', async () => {
        const baseline = (await solved('blueshift-protoss')).resources.get();
        const [defence] = baseline.placement
            .getPlacements({ size: '2x2', base: baseline.map.getMain()!.townhallPosition })
            .filter((s) => s.flags.size === 0);
        const world = await solved('blueshift-protoss', {
            placements: [{ pos: { ...defence.pos }, size: '2x2', flags: ['staticDefence'] }],
        });
        const { placement } = world.resources.get();

        expect(placement.request(UnitType.PYLON, { flags: ['staticDefence'], reserve: false })).not.toEqual(
            defence.pos,
        );
        expect(placement.request(UnitType.PHOTONCANNON, { flags: ['staticDefence'] })).toEqual(defence.pos);
    });

    it('offers a user first pylon on request, falls back to a normal spot, and keeps formations 16x16 clear of it', async () => {
        const baseline = (await solved('blueshift-protoss')).resources.get();
        const main = baseline.map.getMain()!.townhallPosition;
        const [free] = baseline.placement.getPlacements({ size: '2x2', base: main }).filter((s) => s.flags.size === 0);
        const firstPos = { ...free.pos };
        const inArea = (pos: Point2D) =>
            Math.abs(pos.x - firstPos.x) < 8 + 1 && Math.abs(pos.y - firstPos.y) < 8 + 1 && !samePos(pos, firstPos);
        expect(baseline.placement.getPlacements().some((s) => inArea(s.pos))).toBe(true);

        const world = await solved('blueshift-protoss', {
            placements: [{ pos: firstPos, size: '2x2', flags: ['firstPylon'] }],
        });
        const { placement } = world.resources.get();
        const [first] = placement.getPlacements();
        expect([...first.flags]).toEqual(['custom', 'wall', 'firstPylon']);
        expect(placement.getPlacements().filter((s) => inArea(s.pos))).toEqual([]);

        expect(placement.request(UnitType.PYLON, { firstPylon: true })).toEqual(firstPos);
        expect(placement.request(UnitType.PYLON, { firstPylon: true, reserve: false })).not.toEqual(firstPos);
        expect(placement.request(UnitType.PYLON, { reserve: false })).not.toEqual(firstPos);
    });

    it('keeps gatekeeper placements out of the spots and returns them per closest expansion', async () => {
        const baseline = (await solved('blueshift-protoss')).resources.get();
        const natural = baseline.map.getNatural()!.townhallPosition;
        const main = baseline.map.getMain()!.townhallPosition;
        const near = (base: Point2D, dx: number) => ({ x: base.x + dx, y: base.y + 3 });
        const height = baseline.map.getTerrainHeight(main);
        const bases = baseline.map.getExpansions().map((e) => e.townhallPosition);
        const farHeight = Array.from({ length: 136 * 136 }, (_, i) => ({
            x: (i % 136) + 0.5,
            y: Math.trunc(i / 136) + 0.5,
        }))
            .filter((p) => baseline.map.getTerrainHeight(p) === height)
            .find((p) => {
                const nearest = bases.reduce((a, b) => (distanceSquared(p, b) < distanceSquared(p, a) ? b : a));
                return (
                    baseline.map.getTerrainHeight(nearest) !== height &&
                    bases
                        .filter((b) => baseline.map.getTerrainHeight(b) === height && b !== main)
                        .every((b) => distanceSquared(p, main) < distanceSquared(p, b))
                );
            })!;
        expect(farHeight).toBeDefined();
        const world = await solved('blueshift-protoss', {
            placements: [
                { pos: farHeight, gateKeeper: true },
                { pos: near(natural, 2), gateKeeper: true },
                { pos: near(natural, 4), gateKeeper: true },
                { pos: near(main, 2), gateKeeper: true },
            ],
        });
        const { placement } = world.resources.get();

        expect(placement.getPlacements().map((s) => s.pos)).toEqual(
            baseline.placement.getPlacements().map((s) => s.pos),
        );
        expect(placement.getGatekeeperPositions(natural)).toEqual([near(natural, 2), near(natural, 4)]);
        expect(placement.getGatekeeperPositions(main)).toEqual([farHeight, near(main, 2)]);
        expect(placement.getNatGatekeeperPosition()).toEqual(near(natural, 2));
        expect(baseline.placement.getNatGatekeeperPosition()).toBeUndefined();
    });
});
