import { describe, expect, it } from 'bun:test';
import { Ability, UnitType, Upgrade } from '../constants/index.ts';
import { Alliance } from '../constants/enums.ts';
import { GAME_LOOPS_PER_SECOND } from '../constants/time.ts';
import { NodeSC2Error } from '../engine/errors.ts';
import { createTestWorld, observationAt, stepTo, stepWith } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import { Units } from './units-collection.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { Unit } from '../types.ts';

const tagsOf = (group: Unit[]) => group.map((unit) => unit.tag);
const sortedTags = (group: Unit[]) => tagsOf(group).sort();

function pick(world: TestWorld, ...tags: string[]): Units {
    const { units } = world.resources.get();
    return Units.from(tags.map((tag) => units.getByTag(tag)!));
}

const ZERGLINGS = ['4354473985', '4354736129'];
const OVERLORD = '4353949698';
const MARINE_TAG = '4354211841';
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
        await stepWith(world, 900, [
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
        ]);

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
        await stepTo(world, observationAt(world, 940, { hide: ZERGLINGS, fogAt: [zerglingsSpot] }));

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

        const killed = observationAt(world, 944, { hide: ZERGLINGS, fogAt: [zerglingsSpot] });
        killed.observation!.rawData!.event = { deadUnits: [ZERGLINGS[0]] };
        await stepTo(world, killed);

        expect(zergling.isMemory()).toBe(false);
        expect(pick(world, ZERGLINGS[1]).map((unit) => unit.isMemory())).toEqual([true]);
        expect(sortedTags(units.getAll(Alliance.ENEMY))).toEqual([ZERGLINGS[1], OVERLORD, ...ENEMY_SNAPSHOTS].sort());
    });

    it('drops a killed own unit from the store while the destroyed event and the Unit keep it', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { units, events } = world.resources.get();
        const marine = units.getByTag(MARINE_TAG)!;
        const reader = events.createReader();

        const killed = observationAt(world, 900, { hide: [MARINE_TAG] });
        killed.observation!.rawData!.event = { deadUnits: [MARINE_TAG] };
        await stepTo(world, killed);

        expect(units.getByTag(MARINE_TAG)).toBeUndefined();
        expect(tagsOf(units.getAll())).not.toContain(MARINE_TAG);
        expect(tagsOf(units.getAll(Alliance.SELF))).not.toContain(MARINE_TAG);
        expect(marine.labels.has('dead')).toBe(true);
        expect(
            events
                .read(reader)
                .filter(({ name }) => name === 'unitDestroyed')
                .map(({ data }) => data),
        ).toEqual([marine]);
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
            observationAt(world, 900, {
                hide: [ZERGLINGS[0]],
                fogAt: [zerglingsSpot],
                add: producing,
                patch: {
                    '4350541825': { orders: [trainMarine, trainMarine] },
                    '4342677505': { orders: [{ abilityId: Ability.TRAIN_SCV }] },
                },
            }),
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
