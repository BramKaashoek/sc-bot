import { describe, expect, it, spyOn } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, loadFixture, stepTo } from '../test/create-test-world.ts';
import { Alliance, Attribute, DisplayType } from '../constants/enums.ts';
import { UnitType } from '../constants/index.ts';
import { observation, packBits, rawUnit, toyFixture, unitTypeData } from '../test/factories.ts';
import { footprintCells } from '../utils/geometry/units.ts';
import { PixelMap } from '../utils/pixel-map.ts';
import { GameEndedError } from '../engine/errors.ts';
import type { Point2D } from '../types.ts';

const hiding = (next: SC2APIProtocol.ResponseObservation, hidden: (x: number, y: number) => boolean) => {
    const data = new Uint8Array(32 * 32).map((_, i) => (hidden(i % 32, Math.floor(i / 32)) ? 1 : 2));
    next.observation!.rawData!.mapState!.visibility = { bitsPerPixel: 8, size: { x: 32, y: 32 }, data };
    return next;
};

describe('map system', () => {
    it('reports each effect once when it appears and once when it expires, telling same-type effects apart by position, keeping only current effects active', async () => {
        const fixture = toyFixture();
        fixture.data.effects![1] = { effectId: 1, radius: 1 };
        fixture.data.effects![2] = { effectId: 2, radius: 1 };
        const reported: string[] = [];
        const describeEffect = (effect: SC2APIProtocol.Effect) =>
            `${effect.effectId} at ${effect.pos![0].x} x${effect.pos!.length}`;
        const agent = createAgent({
            async onNewEffect(_, effect) {
                reported.push(`new ${describeEffect(effect)}`);
            },
            async onExpiredEffect(_, effect) {
                reported.push(`expired ${describeEffect(effect)}`);
            },
        });
        const world = await createTestWorld(fixture, { agent });
        const unknownEnemy = rawUnit({ unitType: 99999, alliance: Alliance.ENEMY, owner: 2 });
        const withEffects = (gameLoop: number, effects: SC2APIProtocol.Effect[]) => {
            const next = observation({
                gameLoop,
                units: [...fixture.observations[0].observation!.rawData!.units!, unknownEnemy],
            });
            next.observation!.rawData!.effects = effects;
            return next;
        };
        const first = { effectId: 1, pos: [{ x: 5, y: 5 }] };
        const second = { effectId: 2, pos: [{ x: 5, y: 5 }] };
        const firstElsewhere = { effectId: 1, pos: [{ x: 9, y: 5 }] };
        const secondLonger = {
            effectId: 2,
            pos: [
                { x: 5, y: 5 },
                { x: 6, y: 6 },
            ],
        };

        await stepTo(world, withEffects(8, [first, second]));
        await stepTo(world, withEffects(16, [first, second, firstElsewhere, secondLonger]));
        await stepTo(world, withEffects(24, [second]));

        expect(reported).toEqual([
            'new 1 at 5 x1',
            'new 2 at 5 x1',
            'new 1 at 9 x1',
            'new 2 at 5 x2',
            'expired 1 at 5 x1',
            'expired 1 at 9 x1',
            'expired 2 at 5 x2',
        ]);
        expect(
            world.resources
                .get()
                .map.getEffects()
                .map((effect) => effect.effectId),
        ).toEqual([2]);
    });

    it.each(
        (['own', 'enemy'] as const).flatMap((owner) => [
            [owner, UnitType.BARRACKS, UnitType.BARRACKSFLYING, 1, 'false/false'] as const,
            [owner, UnitType.COMMANDCENTER, UnitType.COMMANDCENTERFLYING, 2, 'false/true'] as const,
            [owner, UnitType.SPINECRAWLER, UnitType.SPINECRAWLERUPROOTED, 1, 'false/false'] as const,
            [owner, UnitType.SPORECRAWLER, UnitType.SPORECRAWLERUPROOTED, 1, 'false/false'] as const,
        ]),
    )(
        'frees the footprint of an %s %p when it lifts even if already moved off it, blocks it where it lands leaving townhall corners pathable, and frees nothing when it dies unlanded',
        async (owner, landed, flying, half, landedCorner) => {
            const fixture = toyFixture();
            for (const unitType of [landed, flying]) {
                fixture.data.units![unitType] ??= unitTypeData(unitType, { attributes: [Attribute.STRUCTURE] });
            }
            const world = await createTestWorld(fixture);
            const { map } = world.resources.get();
            const tag = '9001';
            const alliance = owner === 'enemy' ? { alliance: Alliance.ENEMY, owner: 2 } : {};
            const base = fixture.observations[0].observation!.rawData!.units!;
            const depot = rawUnit({ tag: '9002', unitType: UnitType.SUPPLYDEPOT, pos: { x: 18, y: 7, z: 10 } });
            const depotCells = () => [...new Set([17, 18].flatMap((x) => [6, 7].map((y) => map.isPathable({ x, y }))))];
            const at = (gameLoop: number, unitType: number, y: number) =>
                observation({
                    gameLoop,
                    units: [...base, depot, rawUnit({ tag, unitType, pos: { x: 14.5, y, z: 10 }, ...alliance })],
                });
            const footprintState = (y: number) => {
                const body = new Set<string>();
                const corners = new Set<string>();
                for (let dy = -half; dy <= half; dy++) {
                    for (let dx = -half; dx <= half; dx++) {
                        const cell = { x: 14 + dx, y: Math.floor(y) + dy };
                        const corner = Math.abs(dx) === half && Math.abs(dy) === half;
                        (corner ? corners : body).add(`${map.isPlaceable(cell)}/${map.isPathable(cell)}`);
                    }
                }
                return { body: [...body], corners: [...corners] };
            };
            const blocked = { body: ['false/false'], corners: [landedCorner] };
            const free = { body: ['true/true'], corners: ['true/true'] };

            await stepTo(world, at(8, landed, 10.5));
            expect(footprintState(10.5)).toEqual(blocked);
            await stepTo(world, at(16, flying, 12.5));
            expect(footprintState(10.5)).toEqual(free);
            await stepTo(world, at(24, flying, 4.5));
            await stepTo(world, at(32, landed, 4.5));
            expect(footprintState(4.5)).toEqual(blocked);
            expect(footprintState(10.5)).toEqual(free);

            await stepTo(world, at(40, flying, 1.5));
            expect(footprintState(4.5)).toEqual(free);
            const destroyed = observation({ gameLoop: 48, units: [...base, depot] });
            destroyed.observation!.rawData!.event!.deadUnits = [tag];
            await stepTo(world, destroyed);
            expect(map.isPlaceable({ x: 14, y: 0 })).toBe(false);
            expect(depotCells()).toEqual([false]);
        },
    );

    it.each([
        ['an own', {}],
        ['an enemy', { alliance: Alliance.ENEMY, owner: 2 }],
    ])(
        'keeps %s lowered depot placement-blocked but pathable, re-blocks pathing when raised, and frees placement when it dies',
        async (_, alliance) => {
            const fixture = toyFixture();
            for (const unitType of [UnitType.SUPPLYDEPOT, UnitType.SUPPLYDEPOTLOWERED]) {
                fixture.data.units![unitType] ??= unitTypeData(unitType, { attributes: [Attribute.STRUCTURE] });
            }
            const world = await createTestWorld(fixture);
            const { map } = world.resources.get();
            const base = fixture.observations[0].observation!.rawData!.units!;
            const cells = [17, 18].flatMap((x) => [6, 7].map((y) => ({ x, y })));
            const state = (area = cells) => [
                ...new Set(
                    area.map(
                        (cell) =>
                            `${map.isPlaceable(cell)}/${map.isPathable(cell)}/${map._graph.isWalkableAt(cell.x, cell.y)}`,
                    ),
                ),
            ];
            const at = (gameLoop: number, unitType?: number) =>
                observation({
                    gameLoop,
                    units: unitType
                        ? [...base, rawUnit({ tag: '9002', unitType, pos: { x: 18, y: 7, z: 10 }, ...alliance })]
                        : base,
                });
            const depotHidden = (x: number, y: number) => x >= 17 && x <= 18 && y >= 6 && y <= 7;

            await stepTo(world, at(8, UnitType.SUPPLYDEPOT));
            expect(state()).toEqual(['false/false/false']);
            await stepTo(world, at(16, UnitType.SUPPLYDEPOTLOWERED));
            expect(state()).toEqual(['false/true/true']);
            await stepTo(world, at(24, UnitType.SUPPLYDEPOT));
            expect(state()).toEqual(['false/false/false']);
            await stepTo(world, at(32, UnitType.SUPPLYDEPOTLOWERED));
            const destroyed = hiding(at(40), depotHidden);
            destroyed.observation!.rawData!.event!.deadUnits = ['9002'];
            await stepTo(world, destroyed);
            expect(state()).toEqual(['true/true/true']);

            const overlapping = rawUnit({
                tag: '9003',
                unitType: UnitType.SUPPLYDEPOT,
                pos: { x: 18, y: 8, z: 10 },
                alliance: Alliance.ENEMY,
                owner: 2,
            });
            await stepTo(world, hiding(observation({ gameLoop: 48, units: [...base, overlapping] }), depotHidden));
            await stepTo(world, hiding(at(56), depotHidden));
            expect(state([...cells, { x: 17, y: 8 }, { x: 18, y: 8 }])).toEqual(['true/true/true']);
        },
    );

    it('forgets the previous game structures, so they hold no cells in the next game', async () => {
        const fixture = toyFixture();
        fixture.data.units![UnitType.BARRACKS] = unitTypeData(UnitType.BARRACKS, { attributes: [Attribute.STRUCTURE] });
        const world = await createTestWorld(fixture);
        const base = fixture.observations[0].observation!.rawData!.units!;
        const barracks = (tag: string, y: number) =>
            rawUnit({ tag, unitType: UnitType.BARRACKS, pos: { x: 14.5, y, z: 10 } });

        await stepTo(world, observation({ gameLoop: 8, units: [...base, barracks('9001', 10.5)] }));
        world.client.setObservation(fixture.observations[0]);
        await world.engine.setupGame();
        await stepTo(world, observation({ gameLoop: 8, units: [...base, barracks('9002', 12.5)] }));
        const destroyed = observation({ gameLoop: 16, units: base });
        destroyed.observation!.rawData!.event!.deadUnits = ['9002'];
        await stepTo(world, destroyed);

        expect(world.resources.get().map.isPlaceable({ x: 14, y: 11 })).toBe(true);
    });

    it('blocks placement only for a depot created already lowered', async () => {
        const fixture = toyFixture();
        fixture.data.units![UnitType.SUPPLYDEPOTLOWERED] ??= unitTypeData(UnitType.SUPPLYDEPOTLOWERED, {
            attributes: [Attribute.STRUCTURE],
        });
        const world = await createTestWorld(fixture);
        const { map } = world.resources.get();
        const lowered = rawUnit({ tag: '9002', unitType: UnitType.SUPPLYDEPOTLOWERED, pos: { x: 18, y: 7, z: 10 } });

        await stepTo(
            world,
            observation({ gameLoop: 8, units: [...fixture.observations[0].observation!.rawData!.units!, lowered] }),
        );

        expect(
            [
                { x: 17, y: 6 },
                { x: 18, y: 7 },
            ].map((cell) => `${map.isPlaceable(cell)}/${map.isPathable(cell)}`),
        ).toEqual(['false/true', 'false/true']);
    });

    it('unassigns the base a townhall lifts off and assigns the one it lands on', async () => {
        const fixture = toyFixture({ enemyStart: false });
        fixture.data.units![UnitType.COMMANDCENTERFLYING] = unitTypeData(UnitType.COMMANDCENTERFLYING, {
            attributes: [Attribute.STRUCTURE],
        });
        const world = await createTestWorld(fixture);
        const { map } = world.resources.get();
        const base = fixture.observations[0].observation!.rawData!.units!;
        const townhall = base.find((unit) => unit.unitType === UnitType.COMMANDCENTER)!;
        const [main, other] = map.getExpansions();
        const at = (gameLoop: number, unitType: number, pos: Point2D) =>
            observation({
                gameLoop,
                units: [...base.filter((unit) => unit !== townhall), { ...townhall, unitType, pos: { ...pos, z: 10 } }],
            });
        const bases = () => map.getExpansions().map((expansion) => expansion.base);

        expect(bases()).toEqual([townhall.tag, undefined]);
        await stepTo(world, at(8, UnitType.COMMANDCENTERFLYING, main.townhallPosition));
        expect(bases()).toEqual([undefined, undefined]);
        await stepTo(world, at(16, UnitType.COMMANDCENTERFLYING, other.townhallPosition));
        await stepTo(world, at(24, UnitType.COMMANDCENTER, other.townhallPosition));
        expect(bases()).toEqual([undefined, townhall.tag]);
    });

    it('keeps townhall corners pathable and the rest blocked when a command center morphs in place', async () => {
        const fixture = toyFixture();
        for (const unitType of [UnitType.COMMANDCENTER, UnitType.ORBITALCOMMAND]) {
            fixture.data.units![unitType] ??= unitTypeData(unitType, { attributes: [Attribute.STRUCTURE] });
        }
        const world = await createTestWorld(fixture);
        const { map } = world.resources.get();
        const base = fixture.observations[0].observation!.rawData!.units!;
        const at = (gameLoop: number, unitType: number) =>
            observation({
                gameLoop,
                units: [...base, rawUnit({ tag: '9001', unitType, pos: { x: 14.5, y: 10.5, z: 10 } })],
            });
        const state = () => {
            const corners = new Set<string>();
            const body = new Set<string>();
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const cell = { x: 14 + dx, y: 10 + dy };
                    (Math.abs(dx) === 2 && Math.abs(dy) === 2 ? corners : body).add(
                        `${map.isPlaceable(cell)}/${map.isPathable(cell)}/${map._graph.isWalkableAt(cell.x, cell.y)}`,
                    );
                }
            }
            return { body: [...body], corners: [...corners] };
        };
        const expected = { body: ['false/false/false'], corners: ['false/true/true'] };

        await stepTo(world, at(8, UnitType.COMMANDCENTER));
        expect(state()).toEqual(expected);
        await stepTo(world, at(16, UnitType.ORBITALCOMMAND));
        expect(state()).toEqual(expected);
    });

    it('leaves a nydus canal corners pathable and the rest blocked, and frees everything when it dies', async () => {
        const fixture = toyFixture();
        fixture.data.units![UnitType.NYDUSCANAL] ??= unitTypeData(UnitType.NYDUSCANAL, {
            attributes: [Attribute.STRUCTURE],
        });
        const world = await createTestWorld(fixture);
        const { map } = world.resources.get();
        const base = fixture.observations[0].observation!.rawData!.units!;
        const state = () => {
            const corners = new Set<string>();
            const body = new Set<string>();
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const cell = { x: 14 + dx, y: 10 + dy };
                    (Math.abs(dx) === 1 && Math.abs(dy) === 1 ? corners : body).add(
                        `${map.isPlaceable(cell)}/${map.isPathable(cell)}`,
                    );
                }
            }
            return { body: [...body], corners: [...corners] };
        };

        await stepTo(
            world,
            observation({
                gameLoop: 8,
                units: [
                    ...base,
                    rawUnit({ tag: '9003', unitType: UnitType.NYDUSCANAL, pos: { x: 14.5, y: 10.5, z: 10 } }),
                ],
            }),
        );
        expect(state()).toEqual({ body: ['false/false'], corners: ['false/true'] });

        const destroyed = observation({ gameLoop: 16, units: base });
        destroyed.observation!.rawData!.event!.deadUnits = ['9003'];
        await stepTo(world, destroyed);
        expect(state()).toEqual({ body: ['true/true'], corners: ['true/true'] });
    });

    it('blocks destructible rocks and towers for pathing in the grid and the graph, rocks until they die, and leaves unbuildable rocks walkable', async () => {
        const fixture = toyFixture();
        fixture.data.units![UnitType.DESTRUCTIBLEROCKEX16X6] = unitTypeData(UnitType.DESTRUCTIBLEROCKEX16X6, {
            name: 'DestructibleRockEx16x6',
            attributes: [Attribute.STRUCTURE],
        });
        const base = fixture.observations[0].observation!.rawData!.units!;
        const rock = rawUnit({
            alliance: Alliance.NEUTRAL,
            owner: 16,
            unitType: UnitType.DESTRUCTIBLEROCKEX16X6,
            pos: { x: 20, y: 25, z: 10 },
        });
        const tower = rawUnit({
            alliance: Alliance.NEUTRAL,
            owner: 16,
            unitType: UnitType.XELNAGATOWER,
            pos: { x: 16, y: 26, z: 10 },
        });
        const plate = rawUnit({
            alliance: Alliance.NEUTRAL,
            owner: 16,
            unitType: UnitType.UNBUILDABLEROCKSDESTRUCTIBLE,
            pos: { x: 26, y: 26, z: 10 },
        });
        base.push(rock, tower, plate);
        const world = await createTestWorld(fixture);
        const { map } = world.resources.get();
        const state = (unitType = UnitType.DESTRUCTIBLEROCKEX16X6, pos = { x: 20, y: 25 }) => [
            ...new Set(
                footprintCells(world, unitType, pos).map(
                    (cell) =>
                        `${map.isPlaceable(cell)}/${map.isPathable(cell)}/${map._graph.isWalkableAt(cell.x, cell.y)}`,
                ),
            ),
        ];

        expect([
            state(),
            state(UnitType.XELNAGATOWER, { x: 16, y: 26 }),
            state(UnitType.UNBUILDABLEROCKSDESTRUCTIBLE, { x: 26, y: 26 }),
            state(UnitType.MINERALFIELD, { x: 2, y: 13.5 }),
            state(UnitType.VESPENEGEYSER, { x: 8.5, y: 24.5 }),
        ]).toEqual([
            ['false/false/false'],
            ['false/false/false'],
            ['false/true/true'],
            ['false/false/false'],
            ['false/false/false'],
        ]);
        const destroyed = observation({ gameLoop: 8, units: base.filter((unit) => unit !== rock) });
        destroyed.observation!.rawData!.event!.deadUnits = [rock.tag];
        await stepTo(world, destroyed);
        expect(state()).toEqual(['true/true/true']);
    });

    it("blocks a rock that appears mid-game where SC2's live pathing grid has it, and on death frees what the live grid frees, keeping cliffs, ramps, resources and own and stale enemy structures blocked", async () => {
        const fixture = toyFixture();
        fixture.data.units![UnitType.DESTRUCTIBLEROCKEX1VERTICALHUGE] = unitTypeData(
            UnitType.DESTRUCTIBLEROCKEX1VERTICALHUGE,
            { name: 'DestructibleRockEx1VerticalHuge', attributes: [Attribute.STRUCTURE] },
        );
        fixture.data.units![UnitType.SUPPLYDEPOTLOWERED] = unitTypeData(UnitType.SUPPLYDEPOTLOWERED, {
            unitAlias: UnitType.SUPPLYDEPOT,
            attributes: [Attribute.STRUCTURE],
        });
        const startRaw = fixture.gameInfo.startRaw!;
        const interior = (x: number, y: number) => x > 0 && y > 0 && x < 31 && y < 31;
        const isCliff = (x: number, y: number) => (x === 16 || x === 17) && y === 29;
        const isRamp = (x: number, y: number) => x >= 15 && x <= 18 && y === 18;
        const isRock = (x: number, y: number) => x >= 15 && x <= 18 && y >= 18 && y <= 29;
        const isOwnDepot = (x: number, y: number) => (x === 19 || x === 20) && (y === 26 || y === 27);
        const isEnemyDepot = (x: number, y: number) => (x === 19 || x === 20) && (y === 20 || y === 21);
        const isMineral = (x: number, y: number) => (x === 12 || x === 13) && y === 21;
        startRaw.pathingGrid = packBits(startRaw.mapSize!, (x, y) => interior(x, y) && !isCliff(x, y));
        startRaw.placementGrid = packBits(
            startRaw.mapSize!,
            (x, y) => interior(x, y) && !isCliff(x, y) && !isRamp(x, y),
        );
        const live = (...blocked: Array<(x: number, y: number) => boolean>) => ({
            ...fixture.gameInfo,
            startRaw: {
                ...startRaw,
                pathingGrid: packBits(
                    startRaw.mapSize!,
                    (x, y) =>
                        interior(x, y) &&
                        !isCliff(x, y) &&
                        !isMineral(x, y) &&
                        !blocked.some((isBlocked) => isBlocked(x, y)),
                ),
            },
        });
        const base = fixture.observations[0].observation!.rawData!.units!;
        base.push(
            rawUnit({
                alliance: Alliance.NEUTRAL,
                owner: 16,
                unitType: UnitType.MINERALFIELD,
                pos: { x: 13, y: 21.5, z: 10 },
                mineralContents: 1800,
            }),
            rawUnit({
                alliance: Alliance.ENEMY,
                owner: 2,
                displayType: DisplayType.SNAPSHOT,
                unitType: UnitType.SUPPLYDEPOT,
                pos: { x: 20, y: 21, z: 10 },
            }),
        );
        const ownDepot = (unitType: number) => rawUnit({ tag: '9201', unitType, pos: { x: 20, y: 27, z: 10 } });
        const rock = rawUnit({
            alliance: Alliance.NEUTRAL,
            owner: 16,
            unitType: UnitType.DESTRUCTIBLEROCKEX1VERTICALHUGE,
            pos: { x: 17, y: 24, z: 10 },
            radius: 6.125,
        });
        const world = await createTestWorld(fixture);
        const { map } = world.resources.get();
        const cells = (keep: (x: number, y: number) => boolean) => {
            const states = new Set<string>();
            for (let y = 17; y <= 30; y++) {
                for (let x = 11; x <= 22; x++) {
                    if (keep(x, y))
                        states.add(
                            `${map.isPlaceable({ x, y })}/${map.isPathable({ x, y })}/${map._graph.isWalkableAt(x, y)}`,
                        );
                }
            }
            return [...states];
        };
        const state = () => ({
            rock: cells((x, y) => isRock(x, y) && !isRamp(x, y) && !isCliff(x, y)),
            ramp: cells(isRamp),
            cliff: cells(isCliff),
            ownDepot: cells(isOwnDepot),
            enemyDepot: cells(isEnemyDepot),
            mineral: cells(isMineral),
            beside: cells((x, y) => !isRock(x, y) && !isOwnDepot(x, y) && !isEnemyDepot(x, y) && !isMineral(x, y)),
        });

        fixture.liveGameInfo = live(isOwnDepot);
        await stepTo(world, observation({ gameLoop: 8, units: [...base, ownDepot(UnitType.SUPPLYDEPOT)] }));
        fixture.liveGameInfo = live(isOwnDepot, isRock);
        await stepTo(world, observation({ gameLoop: 16, units: [...base, ownDepot(UnitType.SUPPLYDEPOT), rock] }));
        expect(state()).toEqual({
            rock: ['false/false/false'],
            ramp: ['false/false/false'],
            cliff: ['false/false/false'],
            ownDepot: ['false/false/false'],
            enemyDepot: ['false/false/false'],
            mineral: ['false/false/false'],
            beside: ['true/true/true'],
        });

        fixture.liveGameInfo = live(isRock);
        await stepTo(
            world,
            observation({ gameLoop: 24, units: [...base, ownDepot(UnitType.SUPPLYDEPOTLOWERED), rock] }),
        );
        fixture.liveGameInfo = live();
        const destroyed = observation({ gameLoop: 32, units: [...base, ownDepot(UnitType.SUPPLYDEPOTLOWERED)] });
        destroyed.observation!.rawData!.event!.deadUnits = [rock.tag];
        await stepTo(world, destroyed);
        expect(state()).toEqual({
            rock: ['true/true/true'],
            ramp: ['false/true/true'],
            cliff: ['false/false/false'],
            ownDepot: ['false/true/true'],
            enemyDepot: ['false/false/false'],
            mineral: ['false/false/false'],
            beside: ['true/true/true'],
        });
    });

    it('falls back to rock footprints while the live pathing grid cannot be read, and frees two rocks dying in one step with one live grid read', async () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        const fixture = toyFixture();
        fixture.data.units![UnitType.DESTRUCTIBLEROCKEX16X6] = unitTypeData(UnitType.DESTRUCTIBLEROCKEX16X6, {
            name: 'DestructibleRockEx16x6',
            attributes: [Attribute.STRUCTURE],
        });
        fixture.data.units![UnitType.DESTRUCTIBLEROCKEX1VERTICALHUGE] = unitTypeData(
            UnitType.DESTRUCTIBLEROCKEX1VERTICALHUGE,
            { name: 'DestructibleRockEx1VerticalHuge', attributes: [Attribute.STRUCTURE] },
        );
        const startRaw = fixture.gameInfo.startRaw!;
        const interior = (x: number, y: number) => x > 0 && y > 0 && x < 31 && y < 31;
        const isCliff = (x: number, y: number) => x === 17 && y === 27;
        startRaw.pathingGrid = packBits(startRaw.mapSize!, (x, y) => interior(x, y) && !isCliff(x, y));
        startRaw.placementGrid = packBits(startRaw.mapSize!, (x, y) => interior(x, y) && !isCliff(x, y));
        let readable = false;
        const liveGameInfo = fixture.gameInfo;
        Object.defineProperty(fixture, 'liveGameInfo', {
            get() {
                if (!readable) throw new Error('connection lost');
                return liveGameInfo;
            },
        });
        const base = fixture.observations[0].observation!.rawData!.units!;
        const sixBySix = (x: number, y: number) =>
            rawUnit({
                alliance: Alliance.NEUTRAL,
                owner: 16,
                unitType: UnitType.DESTRUCTIBLEROCKEX16X6,
                pos: { x, y, z: 10 },
                radius: 3.1875,
            });
        const unreadDeath = sixBySix(26, 27);
        const rocks = [sixBySix(20, 25), sixBySix(14, 5)];
        base.push(
            unreadDeath,
            ...rocks,
            rawUnit({
                alliance: Alliance.NEUTRAL,
                owner: 16,
                unitType: UnitType.DESTRUCTIBLEROCKEX1VERTICALHUGE,
                pos: { x: 5, y: 27, z: 10 },
                radius: 6.125,
            }),
        );
        const world = await createTestWorld(fixture);
        const { map } = world.resources.get();
        const state = (x: number, y: number) => [
            ...new Set(
                footprintCells(world, UnitType.DESTRUCTIBLEROCKEX16X6, { x, y })
                    .filter((cell) => !isCliff(cell.x, cell.y))
                    .map(
                        (cell) =>
                            `${map.isPlaceable(cell)}/${map.isPathable(cell)}/${map._graph.isWalkableAt(cell.x, cell.y)}`,
                    ),
            ),
        ];
        expect([state(26, 27), state(20, 25), state(14, 5), map.isPathable({ x: 5, y: 27 })]).toEqual([
            ['false/false/false'],
            ['false/false/false'],
            ['false/false/false'],
            true,
        ]);

        const unreadDestroyed = observation({ gameLoop: 8, units: base.filter((unit) => unit !== unreadDeath) });
        unreadDestroyed.observation!.rawData!.event!.deadUnits = [unreadDeath.tag];
        await stepTo(world, unreadDestroyed);
        expect(state(26, 27)).toEqual(['true/true/true']);

        readable = true;
        const gameInfo = spyOn(world.client, 'gameInfo');
        const destroyed = observation({
            gameLoop: 16,
            units: base.filter((unit) => unit !== unreadDeath && !rocks.some((rock) => rock === unit)),
        });
        destroyed.observation!.rawData!.event!.deadUnits = rocks.map((rock) => rock.tag);
        await stepTo(world, destroyed);

        expect([
            state(20, 25),
            state(14, 5),
            `${map.isPlaceable({ x: 17, y: 27 })}/${map.isPathable({ x: 17, y: 27 })}`,
            gameInfo.mock.calls.length,
            warn.mock.calls.filter(([message]) => String(message).includes('live pathing grid')).length,
        ]).toEqual([['true/true/true'], ['true/true/true'], 'false/false', 1, 2]);
        warn.mockRestore();
    });

    it('lets a game end surface through the live pathing grid read', async () => {
        const fixture = toyFixture();
        fixture.data.units![UnitType.XELNAGATOWER] = unitTypeData(UnitType.XELNAGATOWER, {
            name: 'XelNagaTower',
            attributes: [Attribute.STRUCTURE],
        });
        const world = await createTestWorld(fixture);
        world.client.gameInfo = async () => {
            throw new GameEndedError('game over');
        };
        const rock = rawUnit({
            alliance: Alliance.NEUTRAL,
            owner: 16,
            unitType: UnitType.XELNAGATOWER,
            pos: { x: 16, y: 26, z: 10 },
            radius: 1.125,
        });

        await expect(
            stepTo(
                world,
                observation({ gameLoop: 8, units: [...fixture.observations[0].observation!.rawData!.units!, rock] }),
            ),
        ).rejects.toBeInstanceOf(GameEndedError);
    });

    it('recalculates the natural wall when the live pathing grid shows a rock in it', async () => {
        const fixture = loadFixture('acropolis');
        const startRaw = fixture.gameInfo.startRaw!;
        const start = new PixelMap(startRaw.pathingGrid as ConstructorParameters<typeof PixelMap>[0]);
        const isRock = (x: number, y: number) => x >= 14 && x <= 16 && y >= 83 && y <= 85;
        fixture.liveGameInfo = {
            ...fixture.gameInfo,
            startRaw: {
                ...startRaw,
                pathingGrid: packBits(startRaw.mapSize!, (x, y) => start.isSet({ x, y }) && !isRock(x, y)),
            },
        };
        const firstLoop = Math.min(...Object.keys(fixture.observations).map(Number));
        fixture.observations[firstLoop].observation!.rawData!.units!.push(
            rawUnit({
                alliance: Alliance.NEUTRAL,
                owner: 16,
                unitType: UnitType.DESTRUCTIBLEROCKEX1VERTICALHUGE,
                pos: { x: 15.5, y: 84.5, z: 10 },
                radius: 6.125,
            }),
        );

        const world = await createTestWorld(fixture);

        expect(world.resources.get().map.getNatural()!.getWall()).toEqual([
            { x: 16, y: 82 },
            { x: 17, y: 83 },
            { x: 18, y: 83 },
            { x: 19, y: 83 },
            { x: 20, y: 83 },
            { x: 21, y: 83 },
            { x: 22, y: 83 },
        ]);
    });

    it('keeps a burrowed creep tumor placement-blocked but pathable', async () => {
        const fixture = toyFixture();
        fixture.data.units![UnitType.CREEPTUMORBURROWED] ??= unitTypeData(UnitType.CREEPTUMORBURROWED, {
            attributes: [Attribute.STRUCTURE],
        });
        const world = await createTestWorld(fixture);
        const { map } = world.resources.get();
        const tumor = rawUnit({ tag: '9004', unitType: UnitType.CREEPTUMORBURROWED, pos: { x: 14.5, y: 10.5, z: 10 } });

        await stepTo(
            world,
            observation({ gameLoop: 8, units: [...fixture.observations[0].observation!.rawData!.units!, tumor] }),
        );

        expect(`${map.isPlaceable({ x: 14, y: 10 })}/${map.isPathable({ x: 14, y: 10 })}`).toBe('false/true');
    });
    it('keeps enemy structures and snapshots blocked out of vision, moves them where they are seen next, and keeps own cells blocked when freeing them', async () => {
        const fixture = toyFixture();
        fixture.data.units![UnitType.BARRACKS] ??= unitTypeData(UnitType.BARRACKS, {
            attributes: [Attribute.STRUCTURE],
        });
        const world = await createTestWorld(fixture);
        const { map } = world.resources.get();
        const base = fixture.observations[0].observation!.rawData!.units!;
        const enemy = (tag: string, unitType: number, x: number, y: number, displayType = DisplayType.VISIBLE) =>
            rawUnit({ tag, unitType, pos: { x, y, z: 10 }, alliance: Alliance.ENEMY, owner: 2, displayType });
        const ownDepot = (x: number, y: number) =>
            rawUnit({ tag: `own-${x}-${y}`, unitType: UnitType.SUPPLYDEPOT, pos: { x, y, z: 10 } });
        const at = (gameLoop: number, units: SC2APIProtocol.Unit[], hidden: (x: number, y: number) => boolean) =>
            hiding(observation({ gameLoop, units: [...base, ...units] }), hidden);
        const area = (x0: number, y0: number, x1: number, y1: number) => {
            const cells = new Set<string>();
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) cells.add(`${map.isPlaceable({ x, y })}/${map.isPathable({ x, y })}`);
            }
            return [...cells];
        };
        const footprintOf = (x: number, y: number) => area(Math.floor(x) - 1, Math.floor(y) - 1, x + 1, y + 1);
        const nearP = (x: number, y: number) => x >= 12 && x <= 17 && y >= 8 && y <= 13;
        const nearSnapshot = (x: number, y: number) => x >= 12 && x <= 17 && y >= 20;
        const hidden = (x: number, y: number) => nearP(x, y) || nearSnapshot(x, y);
        const snapshot = enemy('9103', UnitType.BARRACKS, 14.5, 24.5, DisplayType.SNAPSHOT);

        await stepTo(world, at(8, [enemy('9101', UnitType.BARRACKS, 14.5, 10.5), snapshot], nearSnapshot));
        expect([footprintOf(14.5, 10.5), footprintOf(14.5, 24.5)]).toEqual([['false/false'], ['false/false']]);

        await stepTo(world, at(16, [snapshot], hidden));
        expect([footprintOf(14.5, 10.5), footprintOf(14.5, 24.5)]).toEqual([['false/false'], ['false/false']]);

        const snapshotNeighbour = ownDepot(15, 25);
        await stepTo(world, at(24, [snapshotNeighbour, enemy('9101', UnitType.BARRACKS, 14.5, 4.5), snapshot], hidden));
        expect([footprintOf(14.5, 10.5), footprintOf(14.5, 4.5)]).toEqual([['true/true'], ['false/false']]);

        await stepTo(world, at(32, [snapshotNeighbour, enemy('9101', UnitType.BARRACKS, 14.5, 4.5)], nearP));
        expect([area(14, 24, 15, 25), area(13, 23, 13, 25), area(14, 23, 15, 23)]).toEqual([
            ['false/false'],
            ['true/true'],
            ['true/true'],
        ]);

        const townhall = enemy('9104', UnitType.COMMANDCENTER, 14.5, 16.5);
        await stepTo(world, at(40, [townhall, enemy('9105', UnitType.COMMANDCENTER, 18.5, 16.5)], nearP));
        await stepTo(world, at(48, [townhall], nearP));
        expect([area(16, 15, 16, 17), area(17, 14, 20, 18)]).toEqual([['false/false'], ['true/true']]);
    });
});
