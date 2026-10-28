import { describe, expect, it } from 'bun:test';
import { Ability, Buff, UnitType } from '../constants/index.ts';
import { Alliance, Attribute, DisplayType, Race, WeaponTargetType } from '../constants/enums.ts';
import { createTestWorld } from '../test/create-test-world.ts';
import { rawUnit, toyFixture, toyWorld, unitTypeData } from '../test/factories.ts';
import { Units } from './units-collection.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { Unit } from '../types.ts';

function collect(world: TestWorld, raws: SC2APIProtocol.Unit[]): Units {
    const { units } = world.resources.get();
    return Units.from(raws.map((raw) => units.getByTag(raw.tag!)!));
}

const tagsOf = (group: Unit[]): Array<string | undefined> => group.map((unit) => unit.tag);

describe('Units', () => {
    it('answers center-to-center distance queries against a point, a unit or a group', async () => {
        const near = rawUnit({ pos: { x: 11, y: 10, z: 10 } });
        const mid = rawUnit({ pos: { x: 13, y: 14, z: 10 } });
        const far = rawUnit({ pos: { x: 18, y: 16, z: 10 } });
        const farthest = rawUnit({ pos: { x: 22, y: 10, z: 10 } });
        const origin = rawUnit({ pos: { x: 10, y: 10, z: 10 }, radius: 2 });
        const world = await toyWorld({ units: [near, mid, far, farthest, origin] });
        const group = collect(world, [mid, farthest, near, far]);
        const originUnit = world.resources.get().units.getByTag(origin.tag!)!;
        const point = { x: 10, y: 10 };

        expect(group.closestTo(point)?.tag).toBe(near.tag);
        expect(group.closestTo(originUnit)?.tag).toBe(near.tag);
        expect(group.furthestTo(point)?.tag).toBe(farthest.tag);
        expect(group.closestDistanceTo(point)).toBe(1);
        expect(group.closestDistanceTo(originUnit)).toBe(1);
        expect(group.furthestDistanceTo(point)).toBe(12);
        expect(tagsOf(group.closerThan(5, point))).toEqual([near.tag]);
        expect(tagsOf(group.furtherThan(10, originUnit))).toEqual([farthest.tag]);
        expect(tagsOf(group.inDistanceBetween(point, 1, 10))).toEqual([mid.tag]);
        expect(tagsOf(group.closestNUnits(point, 2))).toEqual([near.tag, mid.tag]);
        expect(tagsOf(group.furthestNUnits(point, 2))).toEqual([farthest.tag, far.tag]);
        expect(group.furthestNUnits(point, 3)[0].tag).toBe(group.furthestTo(point)!.tag);
        expect(tagsOf(group.furthestNUnits(point, 0))).toEqual([]);
        expect(tagsOf(group.sortedByDistanceTo(point))).toEqual([near.tag, mid.tag, far.tag, farthest.tag]);
        expect(tagsOf(group.sortedByDistanceTo(originUnit, true))).toEqual([farthest.tag, far.tag, mid.tag, near.tag]);
        expect(tagsOf(group.inDistanceOfGroup(Units.from([originUnit]), 5.5))).toEqual([mid.tag, near.tag]);
        expect(tagsOf(group.sorted((unit) => -unit.pos.x))).toEqual([farthest.tag, far.tag, mid.tag, near.tag]);
        expect(group.center).toEqual({ x: 16, y: 12.5 });
        expect(tagsOf(group.nClosestToDistance(point, 6, 2))).toEqual([mid.tag, far.tag]);
        expect(tagsOf(group.nClosestToDistance(originUnit, 6, 1))).toEqual([mid.tag]);
        expect(tagsOf(group.nFurthestToDistance(point, 6, 2))).toEqual([near.tag, farthest.tag]);
        expect(group.nFurthestToDistance(point, 6, 0)).toHaveLength(0);
        expect(group.nFurthestToDistance(point, 6, -1)).toHaveLength(0);
        expect(group.inClosestDistanceToGroup(Units.from([originUnit]))?.tag).toBe(near.tag);
    });

    it('selects units inside the attack range of a unit, including radii and bonus distance', async () => {
        const melee = unitTypeData(UnitType.ZEALOT, {
            race: Race.PROTOSS,
            attributes: [Attribute.LIGHT, Attribute.BIOLOGICAL],
            weapons: [{ type: WeaponTargetType.GROUND, damage: 8, attacks: 2, range: 1, speed: 1.2 }],
        });
        const attacker = rawUnit({ unitType: UnitType.ZEALOT, pos: { x: 10, y: 10, z: 10 }, radius: 0.5 });
        const inReach = rawUnit({ alliance: Alliance.ENEMY, owner: 2, pos: { x: 12, y: 10, z: 10 }, radius: 0.5 });
        const justOutside = rawUnit({
            alliance: Alliance.ENEMY,
            owner: 2,
            pos: { x: 10, y: 12.5, z: 10 },
            radius: 0.5,
        });
        const airborne = rawUnit({
            alliance: Alliance.ENEMY,
            owner: 2,
            pos: { x: 11, y: 10, z: 10 },
            radius: 0.5,
            isFlying: true,
        });
        const lifted = rawUnit({
            alliance: Alliance.ENEMY,
            owner: 2,
            pos: { x: 9, y: 10, z: 10 },
            radius: 0.5,
            buffIds: [Buff.GRAVITONBEAM],
        });
        const world = await toyWorld({ units: [attacker, inReach, justOutside, airborne, lifted], unitTypes: [melee] });
        const targets = collect(world, [inReach, justOutside, airborne, lifted]);
        const zealot = world.resources.get().units.getByTag(attacker.tag!)!;

        expect(tagsOf(targets.inAttackRangeOf(zealot))).toEqual([inReach.tag]);
        expect(tagsOf(targets.inAttackRangeOf(zealot, 0.5))).toEqual([inReach.tag, justOutside.tag]);
    });

    it('filters and combines by type, tech/unit alias and tag', async () => {
        const terranStructure = [Attribute.ARMORED, Attribute.MECHANICAL, Attribute.STRUCTURE];
        const unitTypes = [
            unitTypeData(UnitType.ORBITALCOMMAND, {
                race: Race.TERRAN,
                attributes: terranStructure,
                techAlias: [UnitType.COMMANDCENTER],
            }),
            unitTypeData(UnitType.PLANETARYFORTRESS, {
                race: Race.TERRAN,
                attributes: terranStructure,
                techAlias: [UnitType.COMMANDCENTER],
            }),
            unitTypeData(UnitType.COMMANDCENTERFLYING, {
                race: Race.TERRAN,
                attributes: terranStructure,
                unitAlias: UnitType.COMMANDCENTER,
            }),
            unitTypeData(UnitType.ORBITALCOMMANDFLYING, {
                race: Race.TERRAN,
                attributes: terranStructure,
                unitAlias: UnitType.ORBITALCOMMAND,
            }),
        ];
        const commandCenter = rawUnit({ unitType: UnitType.COMMANDCENTER, pos: { x: 20, y: 20, z: 10 } });
        const orbital = rawUnit({ unitType: UnitType.ORBITALCOMMAND, pos: { x: 20, y: 26, z: 10 } });
        const fortress = rawUnit({ unitType: UnitType.PLANETARYFORTRESS, pos: { x: 26, y: 26, z: 10 } });
        const flyingCommandCenter = rawUnit({ unitType: UnitType.COMMANDCENTERFLYING, isFlying: true });
        const flyingOrbital = rawUnit({ unitType: UnitType.ORBITALCOMMANDFLYING, isFlying: true });
        const worker = rawUnit();
        const raws = [commandCenter, orbital, fortress, flyingCommandCenter, flyingOrbital, worker];
        const world = await toyWorld({ units: raws, unitTypes });
        const group = collect(world, raws);

        expect(tagsOf(group.ofType(UnitType.SCV))).toEqual([worker.tag]);
        expect(tagsOf(group.ofType([UnitType.ORBITALCOMMAND, UnitType.PLANETARYFORTRESS]))).toEqual([
            orbital.tag,
            fortress.tag,
        ]);
        expect(
            tagsOf(group.excludeType([UnitType.SCV, UnitType.COMMANDCENTERFLYING, UnitType.ORBITALCOMMANDFLYING])),
        ).toEqual([commandCenter.tag, orbital.tag, fortress.tag]);
        expect(tagsOf(group.sameTech([UnitType.ORBITALCOMMAND]))).toEqual([
            commandCenter.tag,
            orbital.tag,
            fortress.tag,
        ]);
        expect(tagsOf(group.sameUnit([UnitType.COMMANDCENTER]))).toEqual([commandCenter.tag, flyingCommandCenter.tag]);
        expect(tagsOf(group.sameUnit(UnitType.ORBITALCOMMAND))).toEqual([orbital.tag, flyingOrbital.tag]);
        expect(tagsOf(group.tagsIn(new Set([worker.tag!, fortress.tag!])))).toEqual([fortress.tag, worker.tag]);
        expect(tagsOf(group.tagsNotIn([commandCenter.tag!, orbital.tag!, fortress.tag!]))).toEqual([
            flyingCommandCenter.tag,
            flyingOrbital.tag,
            worker.tag,
        ]);
        expect(group.findByTag(orbital.tag!)?.tag).toBe(orbital.tag);
        expect(group.findByTag('missing')).toBeUndefined();
        expect(group.tags).toEqual(new Set((raws as Unit[]).map((unit) => unit.tag)));
        expect(tagsOf(collect(world, [commandCenter, orbital]).union(collect(world, [orbital, worker])))).toEqual([
            commandCenter.tag,
            orbital.tag,
            worker.tag,
        ]);
        expect(
            tagsOf(
                collect(world, [commandCenter, orbital, fortress]).intersection(
                    collect(world, [worker, fortress, commandCenter]),
                ),
            ),
        ).toEqual([fortress.tag, commandCenter.tag]);
        expect(
            tagsOf(collect(world, [commandCenter, orbital, fortress]).difference(collect(world, [orbital]))),
        ).toEqual([commandCenter.tag, fortress.tag]);
        expect(tagsOf(group.take(2))).toEqual([commandCenter.tag, orbital.tag]);
        expect(group.take(10)).not.toBe(group);
        expect(tagsOf(group.take(10))).toEqual(tagsOf(group));
        expect(new Units().randomOr(null)).toBeNull();
        expect(tagsOf(raws as Unit[])).toContain(group.randomOr(null)!.tag);
    });

    it('filters by order, idleness, build progress, flight, structure, selection and snapshot visibility', async () => {
        const fixture = toyFixture();
        const [mineral] = fixture.observations[0].observation!.rawData!.units!.filter(
            (raw) => raw.unitType === UnitType.MINERALFIELD,
        );
        const gatherer = rawUnit({ orders: [{ abilityId: Ability.HARVEST_GATHER, targetUnitTag: mineral.tag }] });
        const returner = rawUnit({ orders: [{ abilityId: Ability.HARVEST_RETURN }] });
        const mule = rawUnit({ orders: [{ abilityId: Ability.HARVEST_GATHER_MULE, targetUnitTag: mineral.tag }] });
        const lifted = rawUnit({ buffIds: [Buff.GRAVITONBEAM] });
        const returnsLater = rawUnit({ orders: [{ abilityId: Ability.MOVE }, { abilityId: Ability.HARVEST_RETURN }] });
        const depot = rawUnit({ unitType: UnitType.SUPPLYDEPOT, buildProgress: 0.5 });
        const snapshot = rawUnit({ alliance: Alliance.ENEMY, owner: 2, displayType: DisplayType.SNAPSHOT });
        const selectedFlyer = rawUnit({ isFlying: true, isSelected: true });
        fixture.observations[0].observation!.rawData!.units!.push(
            gatherer,
            returner,
            returnsLater,
            depot,
            snapshot,
            selectedFlyer,
            mule,
            lifted,
        );
        const world = await createTestWorld(fixture);
        const group = collect(world, [gatherer, returner, returnsLater, depot, snapshot]);

        expect(tagsOf(group.gathering)).toEqual([gatherer.tag]);
        expect(tagsOf(group.returning)).toEqual([returner.tag]);
        expect(tagsOf(group.collecting)).toEqual([gatherer.tag, returner.tag]);
        expect(tagsOf(collect(world, [mule]).gathering)).toEqual([mule.tag]);
        const everyone = collect(world, [gatherer, returner, returnsLater, mule, depot, snapshot]);
        expect(tagsOf(everyone.gathering)).toEqual(tagsOf(everyone.filter((unit) => unit.isGathering())));
        expect(tagsOf(everyone.returning)).toEqual(tagsOf(everyone.filter((unit) => unit.isReturning())));
        expect(tagsOf(everyone.collecting)).toEqual(tagsOf(everyone.filter((unit) => unit.isCollecting())));
        expect(tagsOf(group.ready)).toEqual([gatherer.tag, returner.tag, returnsLater.tag, snapshot.tag]);
        expect(tagsOf(group.notReady)).toEqual([depot.tag]);
        expect(tagsOf(group.visible)).toEqual([gatherer.tag, returner.tag, returnsLater.tag, depot.tag]);

        world.baseBuild = 75689;
        world.resources.get().map._mapState.visibility[16][16] = 1;
        expect(tagsOf(group.visible)).toEqual([]);
        expect(group.map((unit) => unit.isSnapshot())).toEqual([true, true, true, true, true]);
        world.resources.get().map._mapState.visibility[16][16] = 2;
        expect(group.map((unit) => unit.isSnapshot())).toEqual([false, false, false, false, false]);

        const mixed = collect(world, [gatherer, mineral, returnsLater, depot, selectedFlyer]);
        expect(tagsOf(mixed.idle)).toEqual([mineral.tag, depot.tag, selectedFlyer.tag]);
        expect(tagsOf(mixed.preferIdle)).toEqual([
            mineral.tag,
            depot.tag,
            selectedFlyer.tag,
            gatherer.tag,
            returnsLater.tag,
        ]);
        expect(tagsOf(mixed.flying)).toEqual([selectedFlyer.tag]);
        expect(tagsOf(collect(world, [lifted]).flying)).toEqual([lifted.tag]);
        expect(collect(world, [lifted, selectedFlyer, gatherer]).map((unit) => unit.isFlyingOrGravitoned())).toEqual([
            true,
            true,
            false,
        ]);
        expect(tagsOf(mixed.notFlying)).toEqual([gatherer.tag, mineral.tag, returnsLater.tag, depot.tag]);
        expect(tagsOf(mixed.structures)).toEqual([mineral.tag, depot.tag]);
        expect(tagsOf(mixed.notStructures)).toEqual([gatherer.tag, returnsLater.tag, selectedFlyer.tag]);
        expect(tagsOf(mixed.mineralFields)).toEqual([mineral.tag]);
        expect(tagsOf(mixed.selected)).toEqual([selectedFlyer.tag]);
    });

    it('is returned by UnitResource getters and keeps its species through array methods', async () => {
        const raws = [
            rawUnit({ pos: { x: 5, y: 5, z: 10 } }),
            rawUnit({ pos: { x: 6, y: 5, z: 10 } }),
            rawUnit({ pos: { x: 25, y: 5, z: 10 } }),
        ];
        const world = await toyWorld({ units: raws });
        const { units } = world.resources.get();
        const group = units.getAlive().tagsIn(raws.map((raw) => raw.tag!));

        const filtered = group.filter((unit) => unit.pos.x < 10);
        const sliced = group.slice(1);

        expect(units.getWorkers()).toBeInstanceOf(Units);
        expect(tagsOf(group)).toEqual(tagsOf(raws as Unit[]));
        expect(filtered).toBeInstanceOf(Units);
        expect(sliced).toBeInstanceOf(Units);
        expect(group.map((unit) => unit).first?.tag).toBe(raws[0].tag);
        expect(group.flatMap((unit) => [unit]).amount).toBe(3);
        expect(Object.getPrototypeOf(group.map((unit) => unit.tag))).toBe(Array.prototype);
        expect(Object.getPrototypeOf(group.flatMap((unit) => [unit.tag, unit]))).toBe(Array.prototype);
        expect(group.slice().reverse().first?.tag).toBe(raws[2].tag);
        expect(group.copy().splice(1).amount).toBe(2);
        const spliced = group.copy();
        spliced.splice(0, undefined);
        expect(spliced.amount).toBe(3);
        expect(filtered.closestTo({ x: 6, y: 6 })?.tag).toBe(raws[1].tag);
        expect(sliced.furthestTo({ x: 0, y: 0 })?.tag).toBe(raws[2].tag);
        const none = group.filter((unit) => unit.pos.x > 100);
        const origin = { x: 0, y: 0 };
        expect(none.first).toBeUndefined();
        expect(none.random).toBeUndefined();
        expect(none.center).toBeUndefined();
        expect(none.closestTo(origin)).toBeUndefined();
        expect(none.furthestTo(origin)).toBeUndefined();
        expect(none.inClosestDistanceToGroup(group)).toBeUndefined();
        expect(group.inClosestDistanceToGroup(none)).toBeUndefined();
        expect(none.closestDistanceTo(origin)).toBe(Infinity);
        expect(none.furthestDistanceTo(origin)).toBe(-Infinity);
        expect(group.inDistanceOfGroup(none, 5).amount).toBe(0);
        expect(group.randomGroupOf(0).amount).toBe(0);
        expect(group.randomGroupOf(5)).toEqual(group);
        expect(group.randomGroupOf(5)).not.toBe(group);
        expect(group.randomGroupOf(2)).toBeInstanceOf(Units);
        expect(new Set(tagsOf(group.randomGroupOf(2))).size).toBe(2);
    });
});
