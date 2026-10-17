import { describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { UnitType } from '../constants/index.ts';
import { Alliance } from '../constants/enums.ts';
import { createTestWorld, stepTo } from './create-test-world.ts';
import { observation, rawUnit, toyFixture } from './factories.ts';
import type { Unit } from '../types.ts';

describe('createTestWorld', () => {
    it('runs the engine systems over the fixture observation', async () => {
        const world = await createTestWorld(toyFixture());
        const { units, frame, map } = world.resources.get();

        expect(frame.getGameLoop()).toBe(0);
        expect(units.getBases().map(base => base.unitType)).toEqual([UnitType.COMMANDCENTER]);
        expect(units.getWorkers()).toHaveLength(3);
        expect(units.getMineralFields()).toHaveLength(14);
        expect(units.getGasGeysers()).toHaveLength(2);
        expect(map.getLocations().self).toMatchObject({ x: 8.5, y: 16.5 });
        expect(world.agent.minerals).toBe(50);
    });

    it('stepTo emits unitCreated only for units new in the next frame', async () => {
        const created: Unit[] = [];
        const agent = createAgent({
            async onUnitCreated(_world, unit) {
                created.push(unit);
            },
        });
        const fixture = toyFixture();
        const world = await createTestWorld(fixture, { agent });
        created.length = 0;

        const newWorker = rawUnit({ pos: { x: 12, y: 16, z: 10 } });
        await stepTo(world, observation({
            gameLoop: 8,
            units: [...fixture.observations[0].observation!.rawData!.units!, newWorker],
        }));

        expect(created.map(unit => unit.tag)).toEqual([newWorker.tag]);
        expect(world.resources.get().units.getAlive(Alliance.SELF)).toHaveLength(5);
    });
});
