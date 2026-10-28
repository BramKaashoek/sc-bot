import { describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { Alliance } from '../constants/enums.ts';
import { observation, toyFixture } from '../test/factories.ts';
import type { OwnedEffect } from '../types.ts';

describe('map system effects', () => {
    it('keeps an own and an enemy effect of the same id at the same spot as separate effects', async () => {
        const fixture = toyFixture();
        fixture.data.effects![1] = { effectId: 1, radius: 1 };
        const reported: string[] = [];
        const agent = createAgent({
            async onNewEffect(_, effect: OwnedEffect) {
                reported.push(`new ${effect.alliance}/${effect.owner}`);
            },
            async onExpiredEffect(_, effect: OwnedEffect) {
                reported.push(`expired ${effect.alliance}/${effect.owner}`);
            },
        });
        const world = await createTestWorld(fixture, { agent });
        const withEffects = (gameLoop: number, effects: SC2APIProtocol.Effect[]) => {
            const next = observation({ gameLoop, units: fixture.observations[0].observation!.rawData!.units! });
            next.observation!.rawData!.effects = effects;
            return next;
        };
        const pos = [{ x: 5, y: 5 }];
        const own = { effectId: 1, alliance: Alliance.SELF, owner: 1, pos };
        const enemy = { effectId: 1, alliance: Alliance.ENEMY, owner: 2, pos };

        await stepTo(world, withEffects(8, [enemy, own]));
        const active = world.resources
            .get()
            .map.getEffects()
            .map((effect: OwnedEffect) => `${effect.alliance}/${effect.owner}`);
        await stepTo(world, withEffects(16, [enemy]));

        expect(reported).toEqual([`new ${Alliance.ENEMY}/2`, `new ${Alliance.SELF}/1`, `expired ${Alliance.SELF}/1`]);
        expect(active).toEqual([`${Alliance.ENEMY}/2`, `${Alliance.SELF}/1`]);
    });

    it('reports an effect with no data as new with an empty grid instead of failing the map step', async () => {
        const fixture = toyFixture();
        const reported: OwnedEffect[] = [];
        const agent = createAgent({
            async onNewEffect(_, effect: OwnedEffect & { effectGrid?: unknown[] }) {
                reported.push(effect);
            },
        });
        const world = await createTestWorld(fixture, { agent });
        const next = observation({ gameLoop: 8, units: fixture.observations[0].observation!.rawData!.units! });
        const unknownEffect = { effectId: 999, alliance: Alliance.ENEMY, owner: 2, pos: [{ x: 5, y: 5 }] };
        next.observation!.rawData!.effects = [unknownEffect];

        await stepTo(world, next);

        expect(
            reported.map(({ effectId, effectGrid }: OwnedEffect & { effectGrid?: unknown[] }) => [
                effectId,
                effectGrid,
            ]),
        ).toEqual([[999, [{ x: 5, y: 5 }]]]);
    });
});
