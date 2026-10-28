import { describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { GAME_LOOPS_PER_SECOND } from '../constants/time.ts';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { Unit } from '../types.ts';

const ZERGLINGS = ['4354473985', '4354736129'];
const OVERLORD = '4353949698';
const ENEMY_SNAPSHOTS = ['8603041799', '8617918489', '8619032579'];

const sortedTags = (group: Unit[]) => group.map((unit) => unit.tag).sort();

describe('EnemyMemory', () => {
    it('keeps an enemy that left vision as a ghost, apart from current snapshots', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { memory } = world.resources.get();

        await stepTo(world, observationAt(world, 900, { hide: [ZERGLINGS[0]], fog: true }));

        expect(sortedTags(memory.getGhosts())).toEqual([ZERGLINGS[0]]);
        expect(sortedTags(memory.getSnapshots())).toEqual(ENEMY_SNAPSHOTS);
        expect(sortedTags(memory.getEnemies())).toEqual([...ZERGLINGS, OVERLORD, ...ENEMY_SNAPSHOTS].sort());
        expect(sortedTags(memory.getEnemies({ includeGhosts: false }))).toEqual(
            [ZERGLINGS[1], OVERLORD].concat(ENEMY_SNAPSHOTS).sort(),
        );
        expect(sortedTags(memory.getEnemies({ structures: false }))).toEqual([...ZERGLINGS, OVERLORD].sort());

        const killed = observationAt(world, 904, { hide: [ZERGLINGS[0]], fog: true });
        killed.observation!.rawData!.event = { deadUnits: [ZERGLINGS[0]] };
        await stepTo(world, killed);

        expect(memory.getGhosts()).toHaveLength(0);
        expect(memory.getEnemies().map((unit) => unit.tag)).not.toContain(ZERGLINGS[0]);
    });

    it('expires ghosts by the air or ground setting, and configure survives a game reset', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { memory } = world.resources.get();
        memory.configure({ expireAir: 10 });
        await world.engine.setupGame();
        await stepTo(world, 896);

        const hide = [ZERGLINGS[0], OVERLORD];
        await stepTo(world, observationAt(world, 896 + 10 * GAME_LOOPS_PER_SECOND, { hide, fog: true }));
        expect(sortedTags(memory.getGhosts())).toEqual([ZERGLINGS[0], OVERLORD].sort());

        await stepTo(world, observationAt(world, 896 + 10 * GAME_LOOPS_PER_SECOND + 1, { hide, fog: true }));
        expect(sortedTags(memory.getGhosts())).toEqual([ZERGLINGS[0]]);

        await stepTo(world, observationAt(world, 896 + 30 * GAME_LOOPS_PER_SECOND + 1, { hide, fog: true }));
        expect(memory.getGhosts()).toHaveLength(0);
    });

    it('drops a ghost whose surrounding cells are visible, unless it is burrowed', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { memory } = world.resources.get();
        await stepTo(
            world,
            observationAt(world, 900, {
                edit: (units) => units.map((raw) => (raw.tag === ZERGLINGS[1] ? { ...raw, isBurrowed: true } : raw)),
            }),
        );

        await stepTo(world, observationAt(world, 904, { hide: ZERGLINGS }));

        expect(sortedTags(memory.getGhosts())).toEqual([ZERGLINGS[1]]);
    });

    it('forgets a tag on request; seeing it again fires entered vision but not first seen', async () => {
        const seen: Record<string, string[]> = { entered: [], firstSeen: [] };
        const agent = createAgent({
            onEnemyUnitEnteredVision: async (_world, unit) => void seen.entered.push(unit.tag!),
            onEnemyFirstSeen: async (_world, unit) => void seen.firstSeen.push(unit.tag!),
        });
        const world = await createTestWorld('blueshift', { loop: 896, agent });
        const { memory } = world.resources.get();
        await stepTo(world, observationAt(world, 900, { hide: [ZERGLINGS[0]], fog: true }));
        seen.entered.length = 0;
        seen.firstSeen.length = 0;

        memory.forget(ZERGLINGS[0]);
        expect(memory.getGhosts()).toHaveLength(0);

        await stepTo(world, observationAt(world, 904));
        expect(seen).toEqual({ entered: [ZERGLINGS[0]], firstSeen: [] });
    });
});
