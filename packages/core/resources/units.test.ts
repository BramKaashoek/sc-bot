import { describe, expect, it } from 'bun:test';
import { Ability, UnitType, Upgrade } from '../constants/index.ts';
import { Alliance } from '../constants/enums.ts';
import { GAME_LOOPS_PER_SECOND } from '../constants/time.ts';
import { NodeSC2Error } from '../engine/errors.ts';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import { Units } from './units-collection.ts';
import type { ObservationEdit, TestWorld } from '../test/create-test-world.ts';
import type { Unit } from '../types.ts';

const tagsOf = (group: Unit[]) => group.map((unit) => unit.tag);
const sortedTags = (group: Unit[]) => tagsOf(group).sort();

const editedObservation = (
    world: TestWorld,
    base: number,
    gameLoop: number,
    edit: NonNullable<ObservationEdit['edit']>,
) => observationAt(world, gameLoop, { base, edit });

function fogAround(responseObservation: SC2APIProtocol.ResponseObservation, center: { x: number; y: number }) {
    const { data, size } = responseObservation.observation!.rawData!.mapState!.visibility!;
    for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) data![(Math.floor(center.y) + dy) * size!.x! + Math.floor(center.x) + dx] = 1;
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
        workers = workers.closestNUnits({ x: 15.5, y: 15.5 }, 3);
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
        expect(units.getByTag('404')).toBeUndefined();
        expect(tagsOf(units.getByTag([OVERLORD, '404', ZERGLINGS[0]]))).toEqual([OVERLORD, ZERGLINGS[0]]);

        const [overlord] = pick(world, OVERLORD);
        overlord.labels.set('scouted', 896);
        const clonedLabels = units.clone().get(OVERLORD)!.labels;
        overlord.labels.set('scouted', 900);
        expect([...clonedLabels]).toEqual([['scouted', 896]]);

        const larva = rawUnit({ unitType: UnitType.LARVA, pos: { x: 17, y: 12, z: 12 }, health: 25, healthMax: 25 });
        const [gateway, warpGate, hydralisk, hydraliskDen, lurkerDen, lair, greaterSpire, cyberneticsCore, factory] = [
            UnitType.GATEWAY,
            UnitType.WARPGATE,
            UnitType.HYDRALISK,
            UnitType.HYDRALISKDEN,
            UnitType.LURKERDENMP,
            UnitType.LAIR,
            UnitType.GREATERSPIRE,
            UnitType.CYBERNETICSCORE,
            UnitType.FACTORY,
        ].map((unitType) => rawUnit({ unitType }));
        await stepTo(
            world,
            editedObservation(world, 896, 900, (raws) => [
                ...raws,
                larva,
                gateway,
                warpGate,
                hydralisk,
                hydraliskDen,
                lurkerDen,
                lair,
                greaterSpire,
                cyberneticsCore,
                factory,
            ]),
        );

        expect(tagsOf(units.getLarva())).toEqual([larva.tag]);
        expect({
            zealot: sortedTags(units.getProductionUnits(UnitType.ZEALOT)),
            lurker: tagsOf(units.getProductionUnits(UnitType.LURKERMP)),
            barracksTechlab: sortedTags(units.getProductionUnits(UnitType.BARRACKSTECHLAB)),
            groovedSpines: tagsOf(units.getUpgradeFacilities(Upgrade.EVOLVEGROOVEDSPINES)),
            seismicSpines: tagsOf(units.getUpgradeFacilities(Upgrade.LURKERRANGE)),
            overlordSpeed: tagsOf(units.getUpgradeFacilities(Upgrade.OVERLORDSPEED)),
            flyerWeapons: tagsOf(units.getUpgradeFacilities(Upgrade.ZERGFLYERWEAPONSLEVEL1)),
            hallucination: tagsOf(units.getUpgradeFacilities(Upgrade.HALTECH)),
        }).toEqual({
            zealot: [gateway.tag, warpGate.tag].sort(),
            lurker: [hydralisk.tag],
            barracksTechlab: sortedTags(units.getById(UnitType.BARRACKS)),
            groovedSpines: [hydraliskDen.tag],
            seismicSpines: [lurkerDen.tag],
            overlordSpeed: [lair.tag],
            flyerWeapons: [greaterSpire.tag],
            hallucination: [cyberneticsCore.tag],
        });
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

        const zerglingsSpot = { x: 14.7, y: 24.8 };
        await stepTo(
            world,
            fogAround(
                editedObservation(world, 896, 940, (raws) => raws.filter((unit) => !ZERGLINGS.includes(unit.tag!))),
                zerglingsSpot,
            ),
        );

        const [zergling] = pick(world, ZERGLINGS[0]);
        const [hatchery, overlord] = pick(world, '8617918489', OVERLORD);

        expect(tagsOf(units.getEnemyUnits())).toEqual([OVERLORD]);
        expect(sortedTags(units.getAll(Alliance.ENEMY))).toEqual([...ZERGLINGS, OVERLORD, ...ENEMY_SNAPSHOTS].sort());
        expect([zergling.isMemory(), zergling.isSnapshot(), zergling.age()]).toEqual([
            true,
            false,
            (940 - 896) / GAME_LOOPS_PER_SECOND,
        ]);
        expect([hatchery.isMemory(), hatchery.isSnapshot(), hatchery.age()]).toEqual([false, true, 0]);
        expect([overlord.isMemory(), overlord.isSnapshot(), overlord.age()]).toEqual([false, false, 0]);

        const killed = fogAround(
            editedObservation(world, 896, 944, (raws) => raws.filter((unit) => !ZERGLINGS.includes(unit.tag!))),
            zerglingsSpot,
        );
        killed.observation!.rawData!.event = { deadUnits: [ZERGLINGS[0]] };
        await stepTo(world, killed);

        expect(zergling.isMemory()).toBe(false);
        expect(pick(world, ZERGLINGS[1]).map((unit) => unit.isMemory())).toEqual([true]);
        expect(sortedTags(units.getAll(Alliance.ENEMY))).toEqual([ZERGLINGS[1], OVERLORD, ...ENEMY_SNAPSHOTS].sort());
    });

    it('values combat units by cost, with pending production for own and ghosts for enemy', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { units } = world.resources.get();
        const reactor = rawUnit({ unitType: UnitType.BARRACKSREACTOR, pos: { x: 40.5, y: 40.5, z: 12 } });
        const trainMarine = { abilityId: Ability.TRAIN_MARINE };
        const producing = [
            reactor,
            rawUnit({
                unitType: UnitType.BARRACKS,
                addOnTag: reactor.tag,
                orders: [trainMarine, trainMarine, trainMarine],
            }),
            rawUnit({ unitType: UnitType.EGG, orders: [{ abilityId: Ability.TRAIN_ROACH }] }),
            rawUnit({ unitType: UnitType.RAVAGER }),
        ];
        const zerglingsSpot = { x: 14.7, y: 24.8 };

        await stepTo(
            world,
            fogAround(
                editedObservation(world, 896, 900, (raws) => [
                    ...raws
                        .filter((raw) => raw.tag !== ZERGLINGS[0])
                        .map((raw) => {
                            if (raw.tag === '4350541825') return { ...raw, orders: [trainMarine, trainMarine] };
                            if (raw.tag === '4342677505') return { ...raw, orders: [{ abilityId: Ability.TRAIN_SCV }] };
                            return raw;
                        }),
                    ...producing,
                ]),
                zerglingsSpot,
            ),
        );

        expect({
            own: units.getArmyValue(),
            pending: units.getArmyValue(Alliance.SELF, { includePending: true }),
            enemy: units.getArmyValue(Alliance.ENEMY),
            enemyVisible: units.getArmyValue(Alliance.ENEMY, { includeGhosts: false }),
        }).toEqual({ own: 150 + 200, pending: 150 + 200 + 50 + 100 + 100, enemy: 50, enemyVisible: 25 });
        for (const alliance of [Alliance.ALLY, Alliance.NEUTRAL, 7])
            expect(() => units.getArmyValue(alliance as SC2APIProtocol.Alliance.Self)).toThrow(NodeSC2Error);
    });
});
