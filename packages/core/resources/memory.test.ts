import { describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { Unit } from '../types.ts';

const ZERGLINGS = ['4354473985', '4354736129'];
const OVERLORD = '4353949698';
const ENEMY_SNAPSHOTS = ['8603041799', '8617918489', '8619032579'];
const LOOPS_PER_SECOND = 22.4;

const sortedTags = (group: Unit[]) => group.map((unit) => unit.tag).sort();

function observation(
    world: TestWorld,
    gameLoop: number,
    {
        hide = [],
        fogged = true,
        edit = (raw) => raw,
    }: {
        hide?: string[];
        fogged?: boolean;
        edit?: (raw: SC2APIProtocol.Unit) => SC2APIProtocol.Unit;
    } = {},
): SC2APIProtocol.ResponseObservation {
    const responseObservation = structuredClone(world.client.fixture.observations[896]);
    const { rawData } = responseObservation.observation!;
    responseObservation.observation!.gameLoop = gameLoop;
    const hidden = rawData!.units!.filter((raw) => hide.includes(raw.tag!));
    rawData!.units = rawData!.units!.filter((raw) => !hide.includes(raw.tag!)).map(edit);

    if (fogged) {
        const { data, size } = rawData!.mapState!.visibility!;
        hidden.forEach(({ pos }) => {
            for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++)
                    data![(Math.floor(pos!.y!) + dy) * size!.x! + Math.floor(pos!.x!) + dx] = 1;
        });
    }
    return responseObservation;
}

describe('EnemyMemory', () => {
    it('keeps an enemy that left vision as a ghost, apart from current snapshots', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { memory } = world.resources.get();

        await stepTo(world, observation(world, 900, { hide: [ZERGLINGS[0]] }));

        expect(sortedTags(memory.getGhosts())).toEqual([ZERGLINGS[0]]);
        expect(sortedTags(memory.getSnapshots())).toEqual(ENEMY_SNAPSHOTS);
        expect(sortedTags(memory.getEnemies())).toEqual([...ZERGLINGS, OVERLORD, ...ENEMY_SNAPSHOTS].sort());
        expect(sortedTags(memory.getEnemies({ includeGhosts: false }))).toEqual(
            [ZERGLINGS[1], OVERLORD].concat(ENEMY_SNAPSHOTS).sort(),
        );
        expect(sortedTags(memory.getEnemies({ structures: false }))).toEqual([...ZERGLINGS, OVERLORD].sort());

        const killed = observation(world, 904, { hide: [ZERGLINGS[0]] });
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
        await stepTo(world, observation(world, 896 + 10 * LOOPS_PER_SECOND, { hide }));
        expect(sortedTags(memory.getGhosts())).toEqual([ZERGLINGS[0], OVERLORD].sort());

        await stepTo(world, observation(world, 896 + 10 * LOOPS_PER_SECOND + 1, { hide }));
        expect(sortedTags(memory.getGhosts())).toEqual([ZERGLINGS[0]]);

        await stepTo(world, observation(world, 896 + 30 * LOOPS_PER_SECOND + 1, { hide }));
        expect(memory.getGhosts()).toHaveLength(0);
    });

    it('drops a ghost whose surrounding cells are visible, unless it is burrowed', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { memory } = world.resources.get();
        await stepTo(
            world,
            observation(world, 900, { edit: (raw) => (raw.tag === ZERGLINGS[1] ? { ...raw, isBurrowed: true } : raw) }),
        );

        await stepTo(world, observation(world, 904, { hide: ZERGLINGS, fogged: false }));

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
        await stepTo(world, observation(world, 900, { hide: [ZERGLINGS[0]] }));
        seen.entered.length = 0;
        seen.firstSeen.length = 0;

        memory.forget(ZERGLINGS[0]);
        expect(memory.getGhosts()).toHaveLength(0);

        await stepTo(world, observation(world, 904));
        expect(seen).toEqual({ entered: [ZERGLINGS[0]], firstSeen: [] });
    });
});
