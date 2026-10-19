import { describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { observation, toyFixture } from '../test/factories.ts';

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
});
