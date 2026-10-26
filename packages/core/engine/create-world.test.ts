import { describe, expect, it } from 'bun:test';
import { Alliance } from '../constants/enums.ts';
import { NodeSC2Error } from './errors.ts';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, loadFixture, stepTo } from '../test/create-test-world.ts';
import { observation, toyFixture } from '../test/factories.ts';
import type { ResourceDefinition, World } from '@sc-bot/core/types';

declare module '@sc-bot/core/types' {
    interface ResourceContainer {
        testCounter?: { count: number };
        testTally?: { items: string[] };
        testStepLog?: object;
    }
}

const counterResource: ResourceDefinition<'testCounter'> = {
    name: 'testCounter',
    create: () => ({ count: 0 }),
    reset: (counter) => {
        counter.count = 0;
    },
};

const tallyResource: ResourceDefinition<'testTally'> = {
    name: 'testTally',
    create: () => ({ items: [] }),
};

describe('resetGameState', () => {
    it('lets setupGame start a new game on another map without the previous unit store, enemy memory, combat rally, earmarks, events, debug drawings or registered resource state, keeping registered resource identity', async () => {
        const acropolis = loadFixture('acropolis');
        const acropolisEnemyTags = acropolis.observations[896]
            .observation!.rawData!.units!.filter((unit) => unit.alliance === Alliance.ENEMY)
            .map((unit) => unit.tag!)
            .sort();
        const acropolisRally = (await createTestWorld(acropolis, { loop: 896 })).resources.get().map.getCombatRally();

        const world = await createTestWorld('blueshift', { loop: 896 });
        const { units, map, events, debug } = world.resources.get();
        const blueshiftRally = map.getCombatRally();
        world.data.addEarmark({ name: 'leftover', minerals: 100, vespene: 0 });
        const staleReader = events.createReader();
        events.write({ name: 'stale', type: 'all' });
        debug!.setDrawTextScreen('stale', [{ text: 'leftover', pos: { x: 0, y: 0 } }]);
        const counter = world.resources.register(counterResource);
        const tally = world.resources.register(tallyResource);
        counter.count = 5;
        tally.items.push('stale');
        Object.assign(world.client.fixture, acropolis);
        world.client.setObservation(acropolis.observations[896]);

        await world.engine.setupGame();
        await stepTo(world, 896);
        await debug!.updateScreen();

        expect(blueshiftRally).not.toEqual(acropolisRally);
        expect(map.getCombatRally()).toEqual(acropolisRally);
        expect(
            units
                .getAll(Alliance.ENEMY)
                .map((unit) => unit.tag!)
                .sort(),
        ).toEqual(acropolisEnemyTags);
        expect(world.data.get('earmarks')).toEqual([]);
        expect(events.read(staleReader)).toEqual([]);
        expect(world.client.sent.debug.at(-1)).toEqual({ debug: [] });
        expect(world.resources.get().testCounter).toBe(counter);
        expect(world.resources.get().testTally).toBe(tally);
        expect(counter.count).toBe(0);
        expect(tally.items).toEqual([]);
    });
});

describe('resources registry', () => {
    it('returns the existing instance when the same definition is registered again', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const counter = world.resources.register(counterResource);

        expect(world.resources.register(counterResource)).toBe(counter);
    });

    it('throws when a different definition claims a registered name', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        world.resources.register(counterResource);

        expect(() => world.resources.register({ ...counterResource })).toThrow(NodeSC2Error);
    });

    it('runs step hooks in registration order once per dispatch, after engine systems and before the agent, past a throwing hook', async () => {
        const calls: string[] = [];
        const loopOf = (world: World) => world.resources.get().frame.getGameLoop();
        const agent = createAgent({
            async onStep(world: World) {
                calls.push(`agent@${loopOf(world)}`);
            },
        });
        const fixture = toyFixture();
        const world = await createTestWorld(fixture, { agent });
        calls.splice(0);
        world.resources.register({ ...tallyResource, onStep: (_, w) => calls.push(`tally@${loopOf(w)}`) });
        world.resources.register({
            ...counterResource,
            onStep: () => {
                throw new Error('boom');
            },
        });
        world.resources.register({
            name: 'testStepLog',
            create: () => ({}),
            onStep: (_, w) => calls.push(`log@${loopOf(w)}`),
        });
        const units = fixture.observations[0].observation!.rawData!.units!;

        await stepTo(world, observation({ gameLoop: 8, units }));
        await stepTo(world, observation({ gameLoop: 16, units }));

        expect(calls).toEqual(['tally@8', 'log@8', 'agent@8', 'tally@16', 'log@16', 'agent@16']);
    });
});
