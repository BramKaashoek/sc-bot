import { describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { Alliance, Attribute, DisplayType } from '../constants/enums.ts';
import { UnitType } from '../constants/index.ts';
import { observation, rawUnit, toyFixture, unitTypeData } from '../test/factories.ts';
import { footprintCells } from '../utils/geometry/units.ts';

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
        ]),
    )(
        'frees the footprint of an %s %p when it lifts and blocks it where it lands, leaving townhall corners pathable',
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
            await stepTo(world, at(16, flying, 10.5));
            expect(footprintState(10.5)).toEqual(free);
            await stepTo(world, at(24, flying, 4.5));
            await stepTo(world, at(32, landed, 4.5));
            expect(footprintState(4.5)).toEqual(blocked);
            expect(footprintState(10.5)).toEqual(free);

            const destroyed = observation({ gameLoop: 40, units: [...base, depot] });
            destroyed.observation!.rawData!.event!.deadUnits = [tag];
            await stepTo(world, destroyed);
            expect(footprintState(4.5)).toEqual(free);
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
