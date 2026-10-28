import { describe, expect, it, mock, spyOn } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { UnitType } from '../constants/index.ts';
import { Alliance } from '../constants/enums.ts';
import { createTestWorld, observationAt, stepTo } from './create-test-world.ts';
import { observation, rawUnit, toyFixture } from './factories.ts';
import type { Unit } from '../types.ts';

describe('createTestWorld', () => {
    it('runs the engine systems over the fixture observation', async () => {
        const world = await createTestWorld(toyFixture());
        const { units, frame, map } = world.resources.get();

        expect(frame.getGameLoop()).toBe(0);
        expect(units.getBases().map((base) => base.unitType)).toEqual([UnitType.COMMANDCENTER]);
        expect(units.getWorkers()).toHaveLength(3);
        expect(units.getMineralFields()).toHaveLength(14);
        expect(units.getGasGeysers()).toHaveLength(2);
        expect(map.getLocations().self).toMatchObject({ x: 8.5, y: 16.5 });
        expect(world.agent.minerals).toBe(50);

        const captured = (await createTestWorld('simple64')).resources.get();
        expect(captured.units.getWorkers()).toHaveLength(12);
        expect(captured.map.getExpansions()).toHaveLength(4);
    });

    it('steps the arcade fixture (no enemy start location, no townhall) 50 times without a resource error or a command', async () => {
        const warn = spyOn(console, 'warn');
        const error = spyOn(console, 'error');
        const world = await createTestWorld('arcade', { loop: 0, config: { features: { eagerMapAnalysis: true } } });
        const { map, mining, nydus, intel } = world.resources.get();
        mining.configure({ enabled: true });

        for (let step = 1; step <= 50; step++) await stepTo(world, observationAt(world, step * 12, { base: 224 }));

        expect(map.isArcade()).toBe(true);
        expect([warn, error].map((spy) => spy.mock.calls)).toEqual([[], []]);
        expect(world.client.sent.actions).toEqual([]);
        expect([nydus.getEnemyMainNydusPoints(), intel.getProxies()]).toEqual([[map.getCenter()], []]);
        mock.restore();
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
        await stepTo(
            world,
            observation({
                gameLoop: 8,
                units: [...fixture.observations[0].observation!.rawData!.units!, newWorker],
            }),
        );

        expect(created.map((unit) => unit.tag)).toEqual([newWorker.tag]);
        expect(world.resources.get().units.getAlive(Alliance.SELF)).toHaveLength(5);
    });
});
