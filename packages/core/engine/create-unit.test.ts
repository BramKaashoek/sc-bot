import { describe, expect, it } from 'bun:test';
import { Ability, UnitType, Upgrade } from '../constants/index.ts';
import { AbilityDataTarget, Alliance, Attribute, Race, WeaponTargetType } from '../constants/enums.ts';
import { rawUnit, toyWorld, unitTypeData } from '../test/factories.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { Unit } from '../types.ts';

const Buff = {
    FUNGALGROWTH: 17,
    GUARDIANSHIELD: 18,
    STIMPACK: 27,
    MEDIVACSPEEDBOOST: 89,
    VOIDRAYSWARMDAMAGEBOOST: 122,
    CARRYMINERALFIELDMINERALS: 271,
    CARRYHARVESTABLEVESPENEGEYSERGASZERG: 275,
    RAVENSHREDDERMISSILETINT: 279,
    DUTCHMARAUDERSLOW: 226,
};

const unitOf = (world: TestWorld, raw: SC2APIProtocol.Unit): Unit => world.resources.get().units.getByTag(raw.tag!)!;

const enemy = (overrides: SC2APIProtocol.Unit) => rawUnit({ alliance: Alliance.ENEMY, owner: 2, ...overrides });

const marineData = unitTypeData(UnitType.MARINE, {
    race: Race.TERRAN,
    attributes: [Attribute.LIGHT, Attribute.BIOLOGICAL],
    movementSpeed: 3,
    sightRange: 9,
    weapons: [{ type: WeaponTargetType.ANY, damage: 6, attacks: 1, range: 5, speed: 0.61 }],
});
const marauderData = unitTypeData(UnitType.MARAUDER, {
    race: Race.TERRAN,
    attributes: [Attribute.ARMORED, Attribute.BIOLOGICAL],
    armor: 1,
    weapons: [
        {
            type: WeaponTargetType.GROUND,
            damage: 10,
            attacks: 1,
            range: 6,
            speed: 1.07,
            damageBonus: [{ attribute: Attribute.ARMORED, bonus: 10 }],
        },
    ],
});
const vikingData = unitTypeData(UnitType.VIKINGFIGHTER, {
    race: Race.TERRAN,
    attributes: [Attribute.ARMORED, Attribute.MECHANICAL],
    weapons: [{ type: WeaponTargetType.AIR, damage: 10, attacks: 2, range: 9, speed: 2 }],
});
const colossusData = unitTypeData(UnitType.COLOSSUS, {
    race: Race.PROTOSS,
    attributes: [Attribute.ARMORED, Attribute.MECHANICAL, Attribute.MASSIVE],
    armor: 1,
});
const zerglingData = unitTypeData(UnitType.ZERGLING, {
    race: Race.ZERG,
    attributes: [Attribute.LIGHT, Attribute.BIOLOGICAL],
    movementSpeed: 4,
    weapons: [{ type: WeaponTargetType.GROUND, damage: 5, attacks: 1, range: 0.1, speed: 0.497 }],
});
const zealotData = unitTypeData(UnitType.ZEALOT, {
    race: Race.PROTOSS,
    attributes: [Attribute.LIGHT, Attribute.BIOLOGICAL],
    weapons: [{ type: WeaponTargetType.GROUND, damage: 8, attacks: 2, range: 0.1, speed: 1.2 }],
});
const roachData = unitTypeData(UnitType.ROACH, {
    race: Race.ZERG,
    attributes: [Attribute.ARMORED, Attribute.BIOLOGICAL],
    armor: 1,
});

describe('createUnit', () => {
    it('reads order and carry predicates, from the first order through ability remaps', async () => {
        const abilities: SC2APIProtocol.AbilityData[] = [
            { abilityId: Ability.HARVEST_GATHER_SCV, remapsToAbilityId: Ability.HARVEST_GATHER },
            { abilityId: Ability.HARVEST_RETURN_SCV, remapsToAbilityId: Ability.HARVEST_RETURN },
            { abilityId: Ability.EFFECT_REPAIR_SCV, remapsToAbilityId: Ability.EFFECT_REPAIR },
        ];
        const unitTypes = [
            unitTypeData(UnitType.SIEGETANK, {
                race: Race.TERRAN,
                attributes: [Attribute.ARMORED, Attribute.MECHANICAL],
            }),
            unitTypeData(UnitType.SIEGETANKSIEGED, {
                race: Race.TERRAN,
                attributes: [Attribute.ARMORED, Attribute.MECHANICAL],
            }),
        ];
        const mover = rawUnit({ orders: [{ abilityId: Ability.MOVE }, { abilityId: Ability.ATTACK_ATTACK }] });
        const attacker = rawUnit({ orders: [{ abilityId: Ability.ATTACK_ATTACK }] });
        const patroller = rawUnit({ orders: [{ abilityId: Ability.PATROL }] });
        const generalMover = rawUnit({ orders: [{ abilityId: Ability.GENERAL_MOVE }] });
        const generalPatroller = rawUnit({ orders: [{ abilityId: Ability.GENERAL_PATROL }] });
        const generalHolder = rawUnit({ orders: [{ abilityId: Ability.GENERAL_HOLDPOSITION }] });
        const repairer = rawUnit({ orders: [{ abilityId: Ability.EFFECT_REPAIR_SCV }] });
        const gatherer = rawUnit({
            orders: [{ abilityId: Ability.HARVEST_GATHER_SCV }],
            buffIds: [Buff.CARRYHARVESTABLEVESPENEGEYSERGASZERG],
        });
        const returnsLater = rawUnit({
            orders: [{ abilityId: Ability.MOVE }, { abilityId: Ability.HARVEST_RETURN_SCV }],
            buffIds: [Buff.CARRYMINERALFIELDMINERALS],
        });
        const builder = rawUnit({ orders: [{ abilityId: Ability.BUILD_SUPPLYDEPOT }] });
        const movesThenGathers = rawUnit({
            orders: [{ abilityId: Ability.MOVE }, { abilityId: Ability.HARVEST_GATHER_SCV }],
        });
        const mule = rawUnit({ orders: [{ abilityId: Ability.HARVEST_GATHER_MULE }] });
        const queuedBuilder = rawUnit({
            orders: [{ abilityId: Ability.MOVE }, { abilityId: Ability.BUILD_SUPPLYDEPOT }],
        });
        const depot = rawUnit({ unitType: UnitType.SUPPLYDEPOT, buildProgress: 0.5 });
        const sieging = rawUnit({
            unitType: UnitType.SIEGETANKSIEGED,
            orders: [{ abilityId: Ability.MORPH_SIEGEMODE }],
        });
        const tank = rawUnit({ unitType: UnitType.SIEGETANK, orders: [{ abilityId: Ability.MORPH_SIEGEMODE }] });
        const idler = rawUnit();
        const world = await toyWorld({
            units: [
                mover,
                attacker,
                patroller,
                generalMover,
                generalPatroller,
                generalHolder,
                repairer,
                gatherer,
                returnsLater,
                builder,
                movesThenGathers,
                mule,
                queuedBuilder,
                depot,
                sieging,
                tank,
                idler,
            ],
            unitTypes,
            abilities,
        });

        expect(unitOf(world, gatherer).isGathering()).toBe(true);
        expect(unitOf(world, returnsLater).isReturning()).toBe(false);
        expect(unitOf(world, returnsLater).hasOrder(Ability.HARVEST_RETURN)).toBe(true);
        expect(unitOf(world, movesThenGathers).isGathering()).toBe(false);
        expect(unitOf(world, movesThenGathers).hasOrder(Ability.HARVEST_GATHER)).toBe(true);
        expect(unitOf(world, gatherer).hasOrder([Ability.MOVE, Ability.HARVEST_GATHER])).toBe(true);
        expect(unitOf(world, idler).hasOrder(Ability.MOVE)).toBe(false);
        expect(unitOf(world, mule).isGathering()).toBe(true);
        expect(unitOf(world, builder).hasBuildOrder()).toBe(true);
        expect(unitOf(world, queuedBuilder).hasBuildOrder()).toBe(true);
        expect(unitOf(world, queuedBuilder).isConstructingScv()).toBe(false);
        expect(unitOf(world, idler).hasBuildOrder()).toBe(false);
        expect(unitOf(world, depot).isUnderConstruction()).toBe(true);
        expect(unitOf(world, idler).isUnderConstruction()).toBe(false);
        expect(unitOf(world, mover).isMoving()).toBe(true);
        expect(unitOf(world, mover).isAttacking()).toBe(false);
        expect(unitOf(world, mover).isUsingAbility([Ability.PATROL, Ability.MOVE])).toBe(true);
        expect(unitOf(world, attacker).isAttacking()).toBe(true);
        expect(unitOf(world, patroller).isPatrolling()).toBe(true);
        expect([
            unitOf(world, generalMover).isMoving(),
            unitOf(world, generalPatroller).isPatrolling(),
            unitOf(world, generalHolder).isHolding(),
        ]).toEqual([true, true, true]);
        expect(unitOf(world, repairer).isRepairing()).toBe(true);
        expect(unitOf(world, gatherer).isUsingAbility(Ability.HARVEST_GATHER)).toBe(true);
        expect(unitOf(world, gatherer).isCollecting()).toBe(true);
        expect(unitOf(world, returnsLater).isCollecting()).toBe(false);
        expect(unitOf(world, builder).isConstructingScv()).toBe(true);
        expect(unitOf(world, sieging).isTransforming()).toBe(true);
        expect(unitOf(world, tank).isTransforming()).toBe(false);
        expect(unitOf(world, idler).isUsingAbility(Ability.MOVE)).toBe(false);
        expect(unitOf(world, idler).isConstructingScv()).toBe(false);
        expect(
            [returnsLater, gatherer, idler].map((raw) => [
                unitOf(world, raw).isCarryingMinerals(),
                unitOf(world, raw).isCarryingVespene(),
                unitOf(world, raw).isCarryingResource(),
            ]),
        ).toEqual([
            [true, false, true],
            [false, true, true],
            [false, false, false],
        ]);
        unitOf(world, mover)._availableAbilities = [Ability.MOVE];
        unitOf(world, generalMover)._availableAbilities = [Ability.GENERAL_MOVE];
        expect([mover, generalMover, idler].map((raw) => unitOf(world, raw).canMove())).toEqual([true, true, false]);
        expect(unitOf(world, gatherer).buffs()).toEqual(new Set([Buff.CARRYHARVESTABLEVESPENEGEYSERGASZERG]));
        expect(
            [unitOf(world, returnsLater), unitOf(world, idler)].map((unit) =>
                unit.hasBuff(Buff.CARRYMINERALFIELDMINERALS),
            ),
        ).toEqual([true, false]);
    });

    it('treats a unit of a type missing from game data as not a structure', async () => {
        const unknown = rawUnit({ unitType: 99999 });
        const world = await toyWorld({ units: [unknown] });

        expect(unitOf(world, unknown).isStructure()).toBe(false);
    });

    it('classifies rich gas mines and every mineral field variant as resource buildings', async () => {
        const gasTypes = [
            UnitType.REFINERY,
            UnitType.ASSIMILATOR,
            UnitType.EXTRACTOR,
            UnitType.REFINERYRICH,
            UnitType.ASSIMILATORRICH,
            UnitType.EXTRACTORRICH,
        ];
        const mineralTypes = [
            UnitType.MINERALFIELD,
            UnitType.RICHMINERALFIELD,
            UnitType.MINERALFIELD450,
            UnitType.MINERALFIELDOPAQUE,
            UnitType.MINERALFIELDOPAQUE900,
        ];
        const gases = gasTypes.map((unitType) => rawUnit({ unitType, alliance: Alliance.NEUTRAL }));
        const minerals = mineralTypes.map((unitType) => rawUnit({ unitType, alliance: Alliance.NEUTRAL }));
        const world = await toyWorld({ units: [...gases, ...minerals] });

        expect(gases.map((raw) => unitOf(world, raw).isGasMine())).toEqual(gasTypes.map(() => true));
        expect(
            world.resources
                .get()
                .units.getGasMines(Alliance.NEUTRAL)
                .map((unit) => unit.tag)
                .sort(),
        ).toEqual(gases.map((raw) => raw.tag).sort());
        expect(minerals.map((raw) => unitOf(world, raw).isMineralField())).toEqual(mineralTypes.map(() => true));
        expect(minerals.map((raw) => unitOf(world, raw).isGasMine())).toEqual(mineralTypes.map(() => false));
    });

    it('locates add-ons and reports harvester surplus', async () => {
        const terranStructure = [Attribute.ARMORED, Attribute.MECHANICAL, Attribute.STRUCTURE];
        const unitTypes = [
            unitTypeData(UnitType.BARRACKS, { race: Race.TERRAN, attributes: terranStructure }),
            unitTypeData(UnitType.BARRACKSTECHLAB, { race: Race.TERRAN, attributes: terranStructure }),
        ];
        const techLab = rawUnit({ unitType: UnitType.BARRACKSTECHLAB, pos: { x: 13, y: 10, z: 10 } });
        const barracks = rawUnit({
            unitType: UnitType.BARRACKS,
            pos: { x: 10.5, y: 10.5, z: 10 },
            addOnTag: techLab.tag,
        });
        const bareBarracks = rawUnit({ unitType: UnitType.BARRACKS, pos: { x: 10.5, y: 20.5, z: 10 } });
        const base = rawUnit({
            unitType: UnitType.COMMANDCENTER,
            pos: { x: 20.5, y: 25.5, z: 10 },
            assignedHarvesters: 14,
            idealHarvesters: 16,
        });
        const world = await toyWorld({ units: [techLab, barracks, bareBarracks, base], unitTypes });

        expect([unitOf(world, barracks).hasTechLab(), unitOf(world, barracks).hasReactor()]).toEqual([true, false]);
        expect(unitOf(world, bareBarracks).hasTechLab()).toBe(false);
        expect(unitOf(world, barracks).addOnPosition()).toEqual({ x: 13, y: 10 });
        expect(unitOf(world, techLab).addOnLandPosition()).toEqual({ x: 10.5, y: 10.5 });
        expect(unitOf(world, barracks).hasAddOn()).toBe(true);
        expect(unitOf(world, bareBarracks).hasAddOn()).toBe(false);
        expect(unitOf(world, base).surplusHarvesters()).toBe(-2);
    });

    it('burrows any burrowable unit and toggles every two-way morph, ignoring units without one', async () => {
        const unitTypes = [UnitType.ROACH, UnitType.SPINECRAWLERUPROOTED, UnitType.MARINE].map((unitType) =>
            unitTypeData(unitType, { race: Race.ZERG }),
        );
        const [roach, uprooted, marine] = unitTypes.map(({ unitId }) => rawUnit({ unitType: unitId }));
        const world = await toyWorld({ units: [roach, uprooted, marine], unitTypes });
        const sentBefore = world.client.sent.actions.length;

        await unitOf(world, roach).burrow();
        await unitOf(world, marine).burrow();
        await unitOf(world, uprooted).toggle({ target: { x: 5, y: 6 } });
        await unitOf(world, marine).toggle();
        await world.resources.get().actions.flushQueuedActions();

        expect(
            world.client.sent.actions
                .slice(sentBefore)
                .flatMap((request) => request.actions!.map((action) => action.actionRaw!.unitCommand)),
        ).toEqual([
            { abilityId: Ability.BURROWDOWN, unitTags: [roach.tag!], queueCommand: false },
            {
                abilityId: Ability.MORPH_SPINECRAWLERROOT,
                unitTags: [uprooted.tag!],
                queueCommand: false,
                targetWorldSpacePos: { x: 5, y: 6 },
            },
        ]);
    });

    it('derives attributes and weapon stats from type data, with the battlecruiser special case', async () => {
        const unitTypes = [
            marineData,
            vikingData,
            unitTypeData(UnitType.HIGHTEMPLAR, {
                race: Race.PROTOSS,
                attributes: [Attribute.LIGHT, Attribute.BIOLOGICAL, Attribute.PSIONIC],
            }),
            unitTypeData(UnitType.ULTRALISK, {
                race: Race.ZERG,
                attributes: [Attribute.ARMORED, Attribute.BIOLOGICAL, Attribute.MASSIVE],
            }),
            unitTypeData(UnitType.BATTLECRUISER, {
                race: Race.TERRAN,
                attributes: [Attribute.ARMORED, Attribute.MECHANICAL, Attribute.MASSIVE],
            }),
        ];
        const marineRaw = rawUnit({ unitType: UnitType.MARINE });
        const vikingRaw = rawUnit({ unitType: UnitType.VIKINGFIGHTER, isFlying: true });
        const templarRaw = rawUnit({ unitType: UnitType.HIGHTEMPLAR });
        const ultraRaw = rawUnit({ unitType: UnitType.ULTRALISK });
        const cruiserRaw = rawUnit({ unitType: UnitType.BATTLECRUISER, isFlying: true });
        const world = await toyWorld({ units: [marineRaw, vikingRaw, templarRaw, ultraRaw, cruiserRaw], unitTypes });
        const marine = unitOf(world, marineRaw);
        const viking = unitOf(world, vikingRaw);
        const cruiser = unitOf(world, cruiserRaw);

        expect([
            marine.isLight(),
            marine.isArmored(),
            marine.isBiological(),
            marine.isMechanical(),
            marine.isMassive(),
            marine.isPsionic(),
        ]).toEqual([true, false, true, false, false, false]);
        expect([unitOf(world, ultraRaw).isMassive(), unitOf(world, ultraRaw).isArmored()]).toEqual([true, true]);
        expect(unitOf(world, templarRaw).isPsionic()).toBe(true);
        expect(marine.groundDps()).toBeCloseTo(6 / 0.61, 10);
        expect(marine.airDps()).toBeCloseTo(6 / 0.61, 10);
        expect([marine.groundRange(), marine.airRange(), marine.sightRange(), marine.movementSpeed()]).toEqual([
            5, 5, 9, 3,
        ]);
        expect([viking.groundDps(), viking.airDps(), viking.groundRange(), viking.airRange()]).toEqual([0, 10, 0, 9]);
        expect([cruiser.groundDps(), cruiser.airDps(), cruiser.groundRange(), cruiser.airRange()]).toEqual([
            0, 0, 6, 6,
        ]);
    });

    it('computes realSpeed from own speed upgrades, creep and speed buffs', async () => {
        const unitTypes = [
            zerglingData,
            marineData,
            unitTypeData(UnitType.HYDRALISK, {
                race: Race.ZERG,
                attributes: [Attribute.ARMORED, Attribute.BIOLOGICAL],
                movementSpeed: 3,
            }),
            unitTypeData(UnitType.ULTRALISK, {
                race: Race.ZERG,
                attributes: [Attribute.ARMORED, Attribute.BIOLOGICAL, Attribute.MASSIVE],
                movementSpeed: 4,
            }),
            unitTypeData(UnitType.MEDIVAC, {
                race: Race.TERRAN,
                attributes: [Attribute.ARMORED, Attribute.MECHANICAL],
                movementSpeed: 3.5,
            }),
            unitTypeData(UnitType.VOIDRAY, {
                race: Race.PROTOSS,
                attributes: [Attribute.ARMORED, Attribute.MECHANICAL],
                movementSpeed: 3.85,
            }),
        ];
        const onCreep = { x: 5, y: 5, z: 10 };
        const offCreep = { x: 25, y: 5, z: 10 };
        const ownLingOnCreep = rawUnit({ unitType: UnitType.ZERGLING, pos: onCreep });
        const ownLingOffCreep = rawUnit({ unitType: UnitType.ZERGLING, pos: offCreep });
        const enemyLingOnCreep = enemy({ unitType: UnitType.ZERGLING, pos: onCreep });
        const enemyLingOffCreep = enemy({ unitType: UnitType.ZERGLING, pos: offCreep });
        const hydraOnCreep = rawUnit({ unitType: UnitType.HYDRALISK, pos: onCreep });
        const hydraOffCreep = rawUnit({ unitType: UnitType.HYDRALISK, pos: offCreep });
        const stimmedMarine = rawUnit({ unitType: UnitType.MARINE, pos: offCreep, buffIds: [Buff.STIMPACK] });
        const fungaledMarine = rawUnit({ unitType: UnitType.MARINE, pos: offCreep, buffIds: [Buff.FUNGALGROWTH] });
        const concussedMarine = rawUnit({
            unitType: UnitType.MARINE,
            pos: offCreep,
            buffIds: [Buff.DUTCHMARAUDERSLOW],
        });
        const fungaledUltra = rawUnit({ unitType: UnitType.ULTRALISK, pos: onCreep, buffIds: [Buff.FUNGALGROWTH] });
        const ultraOffCreepWithoutItsUpgrade = rawUnit({ unitType: UnitType.ULTRALISK, pos: offCreep });
        const boostedMedivac = rawUnit({
            unitType: UnitType.MEDIVAC,
            pos: offCreep,
            isFlying: true,
            buffIds: [Buff.MEDIVACSPEEDBOOST],
        });
        const fluxVanesVoidray = rawUnit({ unitType: UnitType.VOIDRAY, pos: offCreep, isFlying: true });
        const chargedVoidray = rawUnit({
            unitType: UnitType.VOIDRAY,
            pos: offCreep,
            isFlying: true,
            buffIds: [Buff.VOIDRAYSWARMDAMAGEBOOST],
        });
        const world = await toyWorld({
            units: [
                ownLingOnCreep,
                ownLingOffCreep,
                enemyLingOnCreep,
                enemyLingOffCreep,
                hydraOnCreep,
                hydraOffCreep,
                stimmedMarine,
                fungaledMarine,
                concussedMarine,
                fungaledUltra,
                ultraOffCreepWithoutItsUpgrade,
                boostedMedivac,
                fluxVanesVoidray,
                chargedVoidray,
            ],
            unitTypes,
            upgradeIds: [Upgrade.ZERGLINGMOVEMENTSPEED, Upgrade.EVOLVEMUSCULARAUGMENTS, Upgrade.VOIDRAYSPEEDUPGRADE],
            hasCreep: (x) => x < 16,
        });

        expect(unitOf(world, ownLingOnCreep).realSpeed()).toBeCloseTo(4 * 1.6 * 1.3, 10);
        expect(unitOf(world, ownLingOffCreep).realSpeed()).toBeCloseTo(4 * 1.6, 10);
        expect(unitOf(world, enemyLingOnCreep).realSpeed()).toBeCloseTo(4 * 1.3, 10);
        expect(unitOf(world, enemyLingOffCreep).realSpeed()).toBe(4);
        expect(unitOf(world, hydraOnCreep).realSpeed()).toBeCloseTo(3 * 1.3, 10);
        expect(unitOf(world, hydraOffCreep).realSpeed()).toBeCloseTo(3 * 1.25, 10);
        expect(unitOf(world, stimmedMarine).realSpeed()).toBeCloseTo(3 * 1.5, 10);
        expect(unitOf(world, fungaledMarine).realSpeed()).toBeCloseTo(3 * 0.25, 10);
        expect(unitOf(world, concussedMarine).realSpeed()).toBeCloseTo(3 * 0.5, 10);
        expect(unitOf(world, fungaledUltra).realSpeed()).toBeCloseTo(4 * 1.3, 10);
        expect(unitOf(world, ultraOffCreepWithoutItsUpgrade).realSpeed()).toBe(4);
        expect(unitOf(world, boostedMedivac).realSpeed()).toBeCloseTo(3.5 * 1.7, 10);
        expect(unitOf(world, fluxVanesVoidray).realSpeed()).toBeCloseTo(3.85 * 1.328, 10);
        expect(unitOf(world, chargedVoidray).realSpeed()).toBeCloseTo(3.85 * 0.75, 10);
    });

    it('checks attack range with both radii, bonus distance and air-weapon reach on colossi', async () => {
        const marineRaw = rawUnit({ unitType: UnitType.MARINE, pos: { x: 10, y: 10, z: 10 }, radius: 0.375 });
        const atEdge = enemy({ pos: { x: 15.75, y: 10, z: 10 }, radius: 0.375 });
        const pastEdge = enemy({ pos: { x: 16, y: 10, z: 10 }, radius: 0.375 });
        const vikingRaw = rawUnit({
            unitType: UnitType.VIKINGFIGHTER,
            pos: { x: 10, y: 20, z: 10 },
            radius: 0.75,
            isFlying: true,
        });
        const colossusRaw = enemy({ unitType: UnitType.COLOSSUS, pos: { x: 20, y: 20, z: 10 }, radius: 1 });
        const groundRaw = enemy({ pos: { x: 12, y: 20, z: 10 }, radius: 0.375 });
        const world = await toyWorld({
            units: [marineRaw, atEdge, pastEdge, vikingRaw, colossusRaw, groundRaw],
            unitTypes: [marineData, vikingData, colossusData],
        });
        const marine = unitOf(world, marineRaw);
        const viking = unitOf(world, vikingRaw);

        expect(marine.targetInRange(unitOf(world, atEdge))).toBe(true);
        expect(marine.targetInRange(unitOf(world, pastEdge))).toBe(false);
        expect(marine.targetInRange(unitOf(world, pastEdge), 0.25)).toBe(true);
        expect(viking.targetInRange(unitOf(world, colossusRaw))).toBe(true);
        expect(viking.targetInRange(unitOf(world, groundRaw))).toBe(false);
    });

    it('measures center distance and checks ability cast range against units (both radii) and points (caster radius only)', async () => {
        const abilities: SC2APIProtocol.AbilityData[] = [
            { abilityId: Ability.EFFECT_TRANSFUSION, castRange: 7, target: AbilityDataTarget.UNIT },
            { abilityId: Ability.EFFECT_PSISTORM, castRange: 9, target: AbilityDataTarget.POINT },
        ];
        const casterRaw = rawUnit({ pos: { x: 10, y: 10, z: 10 }, radius: 0.375 });
        const atEdge = rawUnit({ pos: { x: 17.75, y: 10, z: 10 }, radius: 0.375 });
        const pastEdge = rawUnit({ pos: { x: 18, y: 10, z: 10 }, radius: 0.375 });
        const world = await toyWorld({ units: [casterRaw, atEdge, pastEdge], abilities });
        const caster = unitOf(world, casterRaw);

        expect([caster.distanceTo(unitOf(world, atEdge)), caster.distanceTo({ x: 13, y: 14 })]).toEqual([7.75, 5]);
        expect(caster.inAbilityCastRange(Ability.EFFECT_TRANSFUSION, unitOf(world, atEdge))).toBe(true);
        expect(caster.inAbilityCastRange(Ability.EFFECT_TRANSFUSION, unitOf(world, pastEdge))).toBe(false);
        expect(caster.inAbilityCastRange(Ability.EFFECT_TRANSFUSION, unitOf(world, pastEdge), 0.25)).toBe(true);
        expect(caster.inAbilityCastRange(Ability.EFFECT_PSISTORM, { x: 19.375, y: 10 })).toBe(true);
        expect(caster.inAbilityCastRange(Ability.EFFECT_PSISTORM, { x: 19.5, y: 10 })).toBe(false);
        expect(caster.inAbilityCastRange(Ability.EFFECT_TRANSFUSION, { x: 11, y: 10 })).toBe(false);
        expect(caster.inAbilityCastRange(Ability.EFFECT_PSISTORM, unitOf(world, atEdge))).toBe(false);
    });

    it('calculates damage and attack speed with upgrades, armor, shields carried into health, attribute bonus, buffs and overkill', async () => {
        const stalkerData = unitTypeData(UnitType.STALKER, {
            race: Race.PROTOSS,
            attributes: [Attribute.ARMORED, Attribute.MECHANICAL],
            armor: 1,
        });
        const stalkerRaw = enemy({
            unitType: UnitType.STALKER,
            health: 100,
            healthMax: 160,
            shield: 10,
            shieldMax: 80,
            shieldUpgradeLevel: 1,
        });
        const marauderRaw = rawUnit({ unitType: UnitType.MARAUDER, attackUpgradeLevel: 1 });
        const roachRaw = enemy({ unitType: UnitType.ROACH, health: 100, healthMax: 100, armorUpgradeLevel: 1 });
        const lingRaw = enemy({ unitType: UnitType.ZERGLING, health: 5, healthMax: 35 });
        const ownLingRaw = rawUnit({ unitType: UnitType.ZERGLING, health: 35, healthMax: 35 });
        const ownHellionRaw = rawUnit({ unitType: UnitType.HELLION });
        const enemyHellionRaw = enemy({ unitType: UnitType.HELLION });
        const zealotRaw = rawUnit({ unitType: UnitType.ZEALOT });
        const stimmedMarineRaw = rawUnit({ unitType: UnitType.MARINE, buffIds: [Buff.STIMPACK] });
        const ownUltraRaw = rawUnit({ unitType: UnitType.ULTRALISK, health: 500, healthMax: 500 });
        const shieldedRaw = enemy({
            unitType: UnitType.ZERGLING,
            health: 100,
            healthMax: 100,
            buffIds: [Buff.GUARDIANSHIELD],
        });
        const shreddedRaw = enemy({
            unitType: UnitType.ZERGLING,
            health: 100,
            healthMax: 100,
            armorUpgradeLevel: 3,
            buffIds: [Buff.RAVENSHREDDERMISSILETINT],
        });
        const ultraData = unitTypeData(UnitType.ULTRALISK, {
            race: Race.ZERG,
            attributes: [Attribute.ARMORED, Attribute.BIOLOGICAL, Attribute.MASSIVE],
            armor: 2,
        });
        const hellionData = unitTypeData(UnitType.HELLION, {
            race: Race.TERRAN,
            attributes: [Attribute.LIGHT, Attribute.MECHANICAL],
            weapons: [
                {
                    type: WeaponTargetType.GROUND,
                    damage: 8,
                    attacks: 1,
                    range: 5,
                    speed: 1.79,
                    damageBonus: [{ attribute: Attribute.LIGHT, bonus: 6 }],
                },
            ],
        });
        const world = await toyWorld({
            units: [
                marauderRaw,
                roachRaw,
                lingRaw,
                ownLingRaw,
                ownHellionRaw,
                enemyHellionRaw,
                zealotRaw,
                stimmedMarineRaw,
                ownUltraRaw,
                shieldedRaw,
                shreddedRaw,
                stalkerRaw,
            ],
            unitTypes: [
                marauderData,
                roachData,
                zerglingData,
                hellionData,
                zealotData,
                marineData,
                ultraData,
                stalkerData,
            ],
            upgradeIds: [Upgrade.HIGHCAPACITYBARRELS, Upgrade.CHITINOUSPLATING, Upgrade.ZERGLINGATTACKSPEED],
        });
        const marauder = unitOf(world, marauderRaw);
        const roach = unitOf(world, roachRaw);
        const ling = unitOf(world, lingRaw);
        const shielded = unitOf(world, shieldedRaw);

        expect(unitOf(world, ownHellionRaw).calculateDamageVsTarget(ling)).toEqual([19, 1.79, 5]);
        expect(unitOf(world, enemyHellionRaw).calculateDamageVsTarget(unitOf(world, ownLingRaw))).toEqual([
            14, 1.79, 5,
        ]);
        expect(unitOf(world, enemyHellionRaw).calculateDamageVsTarget(unitOf(world, ownUltraRaw))).toEqual([
            4, 1.79, 5,
        ]);
        expect(unitOf(world, ownLingRaw).calculateDamageVsTarget(ling)).toEqual([5, 0.497 / 1.4, 0.1]);
        expect(unitOf(world, stimmedMarineRaw).calculateDamageVsTarget(ling)).toEqual([6, 0.61 / 1.5, 5]);
        expect(marauder.calculateDamageVsTarget(shielded)).toEqual([9, 1.07, 6]);
        expect(unitOf(world, zealotRaw).calculateDamageVsTarget(shielded)).toEqual([16, 1.2, 0.1]);
        expect(marauder.calculateDamageVsTarget(unitOf(world, shreddedRaw))).toEqual([10, 1.07, 6]);

        expect(marauder.calculateDamageVsTarget(roach)).toEqual([20, 1.07, 6]);
        expect(marauder.calculateDamageVsTarget(roach, true)).toEqual([22, 1.07, 6]);
        expect(marauder.calculateDamageVsTarget(ling)).toEqual([11, 1.07, 6]);
        expect(marauder.calculateDamageVsTarget(ling, false, false)).toEqual([5, 1.07, 6]);
        expect(unitOf(world, zealotRaw).calculateDamageVsTarget(unitOf(world, stalkerRaw))).toEqual([13, 1.2, 0.1]);
    });

    it('returns no damage when the target is unreachable or the attacker unfinished, and picks the best weapon', async () => {
        const queenData = unitTypeData(UnitType.QUEEN, {
            race: Race.ZERG,
            attributes: [Attribute.BIOLOGICAL, Attribute.PSIONIC],
            weapons: [
                { type: WeaponTargetType.GROUND, damage: 5, attacks: 1, range: 3, speed: 1 },
                { type: WeaponTargetType.ANY, damage: 3, attacks: 3, range: 7, speed: 2 },
            ],
        });
        const vikingRaw = rawUnit({ unitType: UnitType.VIKINGFIGHTER, isFlying: true });
        const queenRaw = rawUnit({ unitType: UnitType.QUEEN });
        const unfinishedRaw = rawUnit({ unitType: UnitType.MARAUDER, buildProgress: 0.5 });
        const marineRaw = enemy({ unitType: UnitType.MARINE });
        const colossusRaw = enemy({ unitType: UnitType.COLOSSUS, health: 200, healthMax: 200 });
        const lingRaw = enemy({ unitType: UnitType.ZERGLING, health: 35, healthMax: 35 });
        const roachRaw = enemy({ unitType: UnitType.ROACH, health: 145, healthMax: 145 });
        const world = await toyWorld({
            units: [vikingRaw, queenRaw, unfinishedRaw, marineRaw, colossusRaw, lingRaw, roachRaw],
            unitTypes: [vikingData, queenData, marauderData, marineData, colossusData, zerglingData, roachData],
        });
        const viking = unitOf(world, vikingRaw);

        expect(viking.calculateDamageVsTarget(unitOf(world, marineRaw))).toEqual([0, 0, 0]);
        expect(viking.calculateDpsVsTarget(unitOf(world, marineRaw))).toBe(0);
        expect(viking.calculateDamageVsTarget(unitOf(world, colossusRaw))).toEqual([18, 2, 9]);
        expect(unitOf(world, unfinishedRaw).calculateDamageVsTarget(unitOf(world, roachRaw))).toEqual([0, 0, 0]);
        expect(unitOf(world, queenRaw).calculateDamageVsTarget(unitOf(world, lingRaw))).toEqual([9, 2, 7]);
    });

    it('reports weapon readiness and travel distance until the weapon is ready', async () => {
        const coolingRaw = rawUnit({ unitType: UnitType.MARINE, weaponCooldown: 4.48 });
        const readyRaw = rawUnit({ unitType: UnitType.MARINE, weaponCooldown: 0 });
        const unarmedRaw = rawUnit({ weaponCooldown: 0 });
        const world = await toyWorld({ units: [coolingRaw, readyRaw, unarmedRaw], unitTypes: [marineData] });
        const unarmed = unitOf(world, unarmedRaw);

        expect(unarmed.weaponCooldown).toBe(0);
        expect(unitOf(world, coolingRaw).weaponReady()).toBe(false);
        expect(unitOf(world, coolingRaw).distanceToWeaponReady()).toBeCloseTo((3 / 16) * 4.48, 10);
        expect(unitOf(world, readyRaw).weaponReady()).toBe(true);
        expect(unarmed.weaponReady()).toBe(false);

        const realMarineRaw = rawUnit({ unitType: UnitType.MARINE, weaponCooldown: 16 });
        const realMarineWorld = await toyWorld({
            units: [realMarineRaw],
            unitTypes: [{ ...marineData, movementSpeed: 2.25 }],
        });
        expect(unitOf(realMarineWorld, realMarineRaw).distanceToWeaponReady()).toBeCloseTo(2.25, 10);
    });

    it('checks facing within an angle tolerance, normalising negative angles', async () => {
        const eastRaw = rawUnit({ pos: { x: 10, y: 10, z: 10 }, facing: 0 });
        const almostNorthRaw = rawUnit({ pos: { x: 10, y: 10, z: 10 }, facing: Math.PI / 2 - 0.1 });
        const southRaw = rawUnit({ pos: { x: 10, y: 10, z: 10 }, facing: Math.PI * 1.5 });
        const eastTarget = rawUnit({ pos: { x: 15, y: 10, z: 10 } });
        const northTarget = rawUnit({ pos: { x: 10, y: 15, z: 10 } });
        const southTarget = rawUnit({ pos: { x: 10, y: 5, z: 10 } });
        const world = await toyWorld({
            units: [eastRaw, almostNorthRaw, southRaw, eastTarget, northTarget, southTarget],
        });
        const east = unitOf(world, eastRaw);
        const almostNorth = unitOf(world, almostNorthRaw);

        expect(east.isFacing(unitOf(world, eastTarget))).toBe(true);
        expect(east.isFacing(unitOf(world, northTarget))).toBe(false);
        expect(almostNorth.isFacing(unitOf(world, northTarget))).toBe(false);
        expect(almostNorth.isFacing(unitOf(world, northTarget), 0.2)).toBe(true);
        expect(unitOf(world, southRaw).isFacing(unitOf(world, southTarget))).toBe(true);
    });
});
