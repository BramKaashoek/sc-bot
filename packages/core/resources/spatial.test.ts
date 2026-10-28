import { describe, expect, it, spyOn } from 'bun:test';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { Unit } from '../types.ts';
import { intelResource } from './intel.ts';

const ZERGLINGS = ['4354473985', '4354736129'];
const OVERLORD = '4353949698';
const HATCHERY = '8617918489';
const MARINE = '4354211841';
const COMMAND_CENTER = '4342677505';
const ZERGLINGS_SPOT = { x: 14.7, y: 24.8 };

const sortedTags = (group: Unit[]) => group.map((unit) => unit.tag).sort();

function hideFogged(world: TestWorld, gameLoop: number, tag: string): SC2APIProtocol.ResponseObservation {
    const responseObservation = observationAt(world, gameLoop, { hide: [tag] });
    const { data, size } = responseObservation.observation!.rawData!.mapState!.visibility!;
    for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
            data![(Math.floor(ZERGLINGS_SPOT.y) + dy) * size!.x! + Math.floor(ZERGLINGS_SPOT.x) + dx] = 1;
    return responseObservation;
}

describe('SpatialIndex', () => {
    it('indexes enemies with ghosts and structures, split by flying, next to own units', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { spatial, units } = world.resources.get();
        await stepTo(world, hideFogged(world, 900, ZERGLINGS[0]));
        const [marine] = units.getByTag([MARINE]);

        expect({
            enemy: sortedTags(spatial.unitsInRange(ZERGLINGS_SPOT, 5, 'enemy')),
            enemyGround: sortedTags(spatial.unitsInRange(ZERGLINGS_SPOT, 5, 'enemyGround')),
            enemyAir: sortedTags(spatial.unitsInRange(ZERGLINGS_SPOT, 5, 'enemyAir')),
            structure: spatial.closest({ x: 120, y: 120 }, 'enemyGround')?.tag,
            ownGround: spatial.unitsInRange(marine, 0, 'ownGround').map((unit) => unit.tag),
            ownAir: spatial.anyInRange(marine, 30, 'ownAir'),
            own: spatial.closest(units.getByTag([COMMAND_CENTER])[0], 'own', 0)?.tag,
            outOfReach: spatial.closest({ x: 70, y: 70 }, 'enemy', 10),
        }).toEqual({
            enemy: [...ZERGLINGS, OVERLORD].sort(),
            enemyGround: [...ZERGLINGS].sort(),
            enemyAir: [OVERLORD],
            structure: HATCHERY,
            ownGround: [MARINE],
            ownAir: false,
            own: COMMAND_CENTER,
            outOfReach: undefined,
        });
    });

    it('builds once per game loop', async () => {
        // intel queries spatial and memory every step, which would hide spatial's own rebuilds
        const intelStep = spyOn(intelResource, 'onStep').mockImplementation(() => {});
        try {
            const world = await createTestWorld('blueshift', { loop: 896 });
            const { spatial, memory } = world.resources.get();
            const getEnemies = spyOn(memory, 'getEnemies');

            spatial.anyInRange(ZERGLINGS_SPOT, 5, 'enemy');
            spatial.unitsInRange(ZERGLINGS_SPOT, 5, 'ownAir');
            expect(getEnemies).toHaveBeenCalledTimes(1);

            await stepTo(world, hideFogged(world, 900, ZERGLINGS[0]));
            spatial.closest(ZERGLINGS_SPOT, 'enemy');
            expect(getEnemies).toHaveBeenCalledTimes(2);
        } finally {
            intelStep.mockRestore();
        }
    });
});
