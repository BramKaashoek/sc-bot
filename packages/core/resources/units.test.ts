import { describe, expect, it } from 'bun:test';
import { UnitType, Upgrade } from '../constants/index.ts';
import { Alliance } from '../constants/enums.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import { Units } from './units-collection.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { Unit } from '../types.ts';

const tagsOf = (group: Unit[]) => group.map((unit) => unit.tag);
const sortedTags = (group: Unit[]) => tagsOf(group).sort();

function editedObservation(
    world: TestWorld,
    loop: number,
    gameLoop: number,
    edit: (units: SC2APIProtocol.Unit[]) => SC2APIProtocol.Unit[],
): SC2APIProtocol.ResponseObservation {
    const responseObservation = structuredClone(world.client.fixture.observations[loop]);
    responseObservation.observation!.gameLoop = gameLoop;
    responseObservation.observation!.rawData!.units = edit(responseObservation.observation!.rawData!.units!);
    return responseObservation;
}

function pick(world: TestWorld, ...tags: string[]): Units {
    const { units } = world.resources.get();
    return Units.from(tags.map((tag) => units.getByTag(tag)!));
}

const ZERGLINGS = ['4354473985', '4354736129'];
const OVERLORD = '4353949698';
const ENEMY_SNAPSHOTS = ['8603041799', '8617918489', '8619032579'];

describe('UnitResource', () => {
    it('groups units like python-sc2: own workers/townhalls/structures/gas/larva, enemy units vs structures, neutral resources, destructables and towers', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { units } = world.resources.get();
        const neutralOfTypes = (types: number[]) =>
            world.client.fixture.observations[896]
                .observation!.rawData!.units!.filter(
                    (unit) => unit.alliance === Alliance.NEUTRAL && types.includes(unit.unitType!),
                )
                .map((unit) => unit.tag!)
                .sort();

        expect(units.getWorkers(true)).toHaveLength(12);
        expect(sortedTags(units.getAll((unit) => unit.isWorker() && unit.alliance === Alliance.SELF))).toEqual(
            sortedTags(units.getWorkers(true)),
        );
        let workers = units.getWorkers(true);
        workers = workers.filter((worker) => worker.isGathering());
        workers = units.getClosest({ x: 15.5, y: 15.5 }, workers, 3);
        workers = workers.concat(units.getByTag([OVERLORD])).slice(1);
        expect([workers instanceof Units, workers.length]).toEqual([true, 3]);
        expect(tagsOf(units.getBases())).toEqual(['4342677505']);
        expect(units.getStructures()).toHaveLength(7);
        expect(tagsOf(units.getGasMines())).toEqual(['4351590401']);
        expect(units.getMineralFields()).toHaveLength(112);
        expect(units.getGasGeysers()).toHaveLength(28);

        expect(sortedTags(units.getEnemyUnits())).toEqual([...ZERGLINGS, OVERLORD].sort());
        expect(sortedTags(units.getEnemyStructures())).toEqual(ENEMY_SNAPSHOTS);
        expect(sortedTags(units.getDestructables())).toEqual(
            neutralOfTypes([
                UnitType.DESTRUCTIBLEROCKEX16X6,
                UnitType.DESTRUCTIBLEROCKEX1DIAGONALHUGEBLUR,
                UnitType.UNBUILDABLEROCKSDESTRUCTIBLE,
            ]),
        );
        expect(units.getDestructables()).toHaveLength(8);
        expect(sortedTags(units.getWatchtowers())).toEqual(neutralOfTypes([UnitType.XELNAGATOWER]));
        expect(units.getWatchtowers()).toHaveLength(2);
        expect(units.getLarva()).toHaveLength(0);
        expect(tagsOf(units.getProductionUnits(UnitType.SCV))).toEqual(['4342677505']);
        expect([
            units.getProductionUnits(UnitType.QUEEN).length,
            units.getUpgradeFacilities(Upgrade.BURROW).length,
        ]).toEqual([0, 0]);
        expect(units.getByTag('404')).toBeUndefined();
        expect(tagsOf(units.getByTag([OVERLORD, '404', ZERGLINGS[0]]))).toEqual([OVERLORD, ZERGLINGS[0]]);

        const [overlord] = pick(world, OVERLORD);
        overlord.labels.set('scouted', 896);
        const clonedLabels = units.clone().get(OVERLORD)!.labels;
        overlord.labels.set('scouted', 900);
        expect([...clonedLabels]).toEqual([['scouted', 896]]);

        const larva = rawUnit({ unitType: UnitType.LARVA, pos: { x: 17, y: 12, z: 12 }, health: 25, healthMax: 25 });
        await stepTo(
            world,
            editedObservation(world, 896, 900, (raws) => [...raws, larva]),
        );

        expect(tagsOf(units.getLarva())).toEqual([larva.tag]);
    });

    it('finds unfinished structures of a type near a spot plus workers ordered to build one there', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { units } = world.resources.get();

        expect(tagsOf(units.getPendingAt(UnitType.BARRACKS, { x: 20.5, y: 12.5 }))).toEqual([
            '4352638978',
            '4344512513',
        ]);
        expect(units.getPendingAt(UnitType.BARRACKS, { x: 20.5, y: 17.5 })).toHaveLength(0);
        expect(units.getPendingAt(UnitType.SUPPLYDEPOT, { x: 20.5, y: 12.5 })).toHaveLength(0);
    });

    it('remembers enemies that left vision with their age while snapshots stay current', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { units } = world.resources.get();

        await stepTo(
            world,
            editedObservation(world, 896, 940, (raws) => raws.filter((unit) => !ZERGLINGS.includes(unit.tag!))),
        );

        const [zergling] = pick(world, ZERGLINGS[0]);
        const [hatchery, overlord] = pick(world, '8617918489', OVERLORD);

        expect(tagsOf(units.getEnemyUnits())).toEqual([OVERLORD]);
        expect(sortedTags(units.getAll(Alliance.ENEMY))).toEqual([...ZERGLINGS, OVERLORD, ...ENEMY_SNAPSHOTS].sort());
        expect([zergling.isMemory(), zergling.isSnapshot(), zergling.age()]).toEqual([true, false, (940 - 896) / 22.4]);
        expect([hatchery.isMemory(), hatchery.isSnapshot(), hatchery.age()]).toEqual([false, true, 0]);
        expect([overlord.isMemory(), overlord.isSnapshot(), overlord.age()]).toEqual([false, false, 0]);

        const killed = editedObservation(world, 896, 944, (raws) =>
            raws.filter((unit) => !ZERGLINGS.includes(unit.tag!)),
        );
        killed.observation!.rawData!.event = { deadUnits: [ZERGLINGS[0]] };
        await stepTo(world, killed);

        expect(zergling.isMemory()).toBe(false);
        expect(pick(world, ZERGLINGS[1]).map((unit) => unit.isMemory())).toEqual([true]);
        expect(sortedTags(units.getAll(Alliance.ENEMY))).toEqual([ZERGLINGS[1], OVERLORD, ...ENEMY_SNAPSHOTS].sort());
    });
});
