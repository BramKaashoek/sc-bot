import { describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { Attribute } from '../constants/enums.ts';
import { UnitType } from '../constants/index.ts';
import { observation, rawUnit, toyFixture, unitTypeData } from '../test/factories.ts';

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
        const withEffects = (gameLoop: number, effects: SC2APIProtocol.Effect[]) => {
            const next = observation({ gameLoop, units: fixture.observations[0].observation!.rawData!.units! });
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

    it.each([
        [UnitType.BARRACKS, UnitType.BARRACKSFLYING, 1, 'false/false'],
        [UnitType.COMMANDCENTER, UnitType.COMMANDCENTERFLYING, 2, 'false/true'],
    ])(
        'frees the footprint of %p when it lifts and blocks it where it lands, leaving townhall corners pathable',
        async (landed, flying, half, landedCorner) => {
            const fixture = toyFixture();
            for (const unitType of [landed, flying]) {
                fixture.data.units![unitType] ??= unitTypeData(unitType, { attributes: [Attribute.STRUCTURE] });
            }
            const world = await createTestWorld(fixture);
            const { map } = world.resources.get();
            const tag = '9001';
            const base = fixture.observations[0].observation!.rawData!.units!;
            const depot = rawUnit({ tag: '9002', unitType: UnitType.SUPPLYDEPOT, pos: { x: 18, y: 7, z: 10 } });
            const depotCells = () => [...new Set([17, 18].flatMap((x) => [6, 7].map((y) => map.isPathable({ x, y }))))];
            const at = (gameLoop: number, unitType: number, y: number) =>
                observation({
                    gameLoop,
                    units: [...base, depot, rawUnit({ tag, unitType, pos: { x: 14.5, y, z: 10 } })],
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
});
