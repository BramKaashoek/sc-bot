import { describe, expect, it } from 'bun:test';
import { Alliance } from '../constants/enums.ts';
import { createTestWorld, loadFixture, stepTo } from '../test/create-test-world.ts';

describe('resetGameState', () => {
    it('lets setupGame start a new game on another map without the previous unit store, enemy memory, combat rally, earmarks, events or debug drawings', async () => {
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
    });
});
