import { describe, expect, it } from 'bun:test';
import { Ability, UnitType, Upgrade } from '../constants/index.ts';
import { Alliance, Attribute, Race } from '../constants/enums.ts';
import createSystem from '../systems/create-system.ts';
import { createTestWorld, loadFixture, stepTo } from '../test/create-test-world.ts';
import createAgent from './create-agent.ts';
import { observation, rawUnit, toyFixture, toyWorld, unitTypeData } from '../test/factories.ts';

const terranStructure = [Attribute.ARMORED, Attribute.MECHANICAL, Attribute.STRUCTURE];
const zergStructure = [Attribute.ARMORED, Attribute.BIOLOGICAL, Attribute.STRUCTURE];

const unitTypes: SC2APIProtocol.UnitTypeData[] = [
    unitTypeData(UnitType.ORBITALCOMMAND, {
        abilityId: Ability.MORPH_ORBITALCOMMAND,
        mineralCost: 550,
        race: Race.TERRAN,
        attributes: terranStructure,
        techAlias: [UnitType.COMMANDCENTER],
    }),
    unitTypeData(UnitType.SUPPLYDEPOTLOWERED, {
        abilityId: Ability.MORPH_SUPPLYDEPOT_LOWER,
        mineralCost: 100,
        race: Race.TERRAN,
        attributes: terranStructure,
    }),
    unitTypeData(UnitType.TECHLAB, {
        abilityId: Ability.BUILD_TECHLAB,
        race: Race.TERRAN,
        attributes: terranStructure,
    }),
    unitTypeData(UnitType.BARRACKS, {
        abilityId: Ability.BUILD_BARRACKS,
        mineralCost: 150,
        race: Race.TERRAN,
        attributes: terranStructure,
    }),
    unitTypeData(UnitType.MARINE, {
        abilityId: Ability.TRAIN_MARINE,
        mineralCost: 50,
        foodRequired: 1,
        race: Race.TERRAN,
        attributes: [Attribute.LIGHT, Attribute.BIOLOGICAL],
    }),
    unitTypeData(UnitType.HATCHERY, {
        abilityId: Ability.BUILD_HATCHERY,
        mineralCost: 350,
        race: Race.ZERG,
        attributes: zergStructure,
    }),
    unitTypeData(UnitType.LAIR, {
        abilityId: Ability.MORPH_LAIR,
        mineralCost: 500,
        vespeneCost: 100,
        race: Race.ZERG,
        attributes: zergStructure,
        techAlias: [UnitType.HATCHERY],
    }),
    unitTypeData(UnitType.HIVE, {
        abilityId: Ability.MORPH_HIVE,
        mineralCost: 700,
        vespeneCost: 250,
        race: Race.ZERG,
        attributes: zergStructure,
        techAlias: [UnitType.HATCHERY, UnitType.LAIR],
    }),
    unitTypeData(UnitType.EXTRACTOR, {
        abilityId: Ability.BUILD_EXTRACTOR,
        mineralCost: 75,
        race: Race.ZERG,
        attributes: zergStructure,
    }),
    unitTypeData(UnitType.LARVA, { race: Race.ZERG, attributes: [Attribute.LIGHT, Attribute.BIOLOGICAL] }),
    unitTypeData(UnitType.ZERGLING, {
        abilityId: Ability.TRAIN_ZERGLING,
        mineralCost: 25,
        foodRequired: 0.5,
        race: Race.ZERG,
        attributes: [Attribute.LIGHT, Attribute.BIOLOGICAL],
    }),
    unitTypeData(UnitType.BANELING, {
        abilityId: Ability.TRAIN_BANELING,
        mineralCost: 50,
        vespeneCost: 25,
        foodRequired: 0.5,
        race: Race.ZERG,
        attributes: [Attribute.BIOLOGICAL],
    }),
    unitTypeData(UnitType.ROACH, {
        abilityId: Ability.TRAIN_ROACH,
        mineralCost: 75,
        vespeneCost: 25,
        foodRequired: 2,
        race: Race.ZERG,
        attributes: [Attribute.ARMORED, Attribute.BIOLOGICAL],
    }),
    unitTypeData(UnitType.RAVAGER, {
        abilityId: Ability.MORPH_RAVAGER,
        mineralCost: 100,
        vespeneCost: 100,
        foodRequired: 3,
        race: Race.ZERG,
        attributes: [Attribute.BIOLOGICAL],
    }),
];

const abilities: SC2APIProtocol.AbilityData[] = [
    { abilityId: Ability.BUILD_COMMANDCENTER, linkName: 'TerranBuild' },
    { abilityId: Ability.MORPH_ORBITALCOMMAND, linkName: 'UpgradeToOrbital' },
    { abilityId: Ability.MORPH_SUPPLYDEPOT_LOWER, linkName: 'SupplyDepotLower' },
    { abilityId: Ability.BUILD_TECHLAB, linkName: 'BuildTechLab' },
    { abilityId: Ability.BUILD_BARRACKS, linkName: 'TerranBuild' },
    { abilityId: Ability.TRAIN_MARINE, linkName: 'BarracksTrain' },
    { abilityId: Ability.BUILD_HATCHERY, linkName: 'ZergBuild' },
    { abilityId: Ability.MORPH_LAIR, linkName: 'UpgradeToLair' },
    { abilityId: Ability.MORPH_HIVE, linkName: 'UpgradeToHive' },
    { abilityId: Ability.BUILD_EXTRACTOR, linkName: 'ZergBuild' },
    { abilityId: Ability.TRAIN_ZERGLING, linkName: 'LarvaTrain' },
    { abilityId: Ability.TRAIN_BANELING, linkName: 'MorphZerglingToBaneling' },
    { abilityId: Ability.TRAIN_ROACH, linkName: 'LarvaTrain' },
    { abilityId: Ability.MORPH_RAVAGER, linkName: 'MorphToRavager' },
    { abilityId: Ability.RESEARCH_STIMPACK, linkName: 'BarracksTechLabResearch' },
];

const gameData = {
    unitTypes,
    abilities,
    upgrades: [
        { upgradeId: Upgrade.STIMPACK, mineralCost: 100, vespeneCost: 100, abilityId: Ability.RESEARCH_STIMPACK },
    ],
};

describe('createAgent', () => {
    it('exposes supply accessors, correcting the rounded-down half supply of an odd zergling count for zerg only', async () => {
        const playerCommon = { foodCap: 20, foodUsed: 13, foodArmy: 1, foodWorkers: 12 };
        const zerglings = () => [0, 1, 2].map(() => rawUnit({ unitType: UnitType.ZERGLING }));
        const even = (await toyWorld({ ...gameData, playerCommon, race: Race.ZERG })).agent;
        const odd = (await toyWorld({ ...gameData, playerCommon, units: zerglings(), race: Race.ZERG })).agent;
        const terran = (await toyWorld({ ...gameData, playerCommon, units: zerglings() })).agent;

        expect(odd.foodUsed).toBe(13);
        expect([even.supplyCap, even.supplyUsed, even.supplyLeft, even.supplyArmy, even.supplyWorkers]).toEqual([
            20, 13, 7, 1, 12,
        ]);
        expect([odd.supplyCap, odd.supplyUsed, odd.supplyLeft, odd.supplyArmy, odd.supplyWorkers]).toEqual([
            20, 14, 6, 2, 12,
        ]);
        expect([terran.supplyUsed, terran.supplyLeft, terran.supplyArmy]).toEqual([13, 7, 1]);
    });

    it('calculates python-sc2 costs: morphs net of their source, hard-coded overrides, zerg drone correction, free morphs, upgrades', async () => {
        const { agent } = await toyWorld(gameData);
        const unitCosts = Object.fromEntries(
            [
                UnitType.ORBITALCOMMAND,
                UnitType.HIVE,
                UnitType.RAVAGER,
                UnitType.ZERGLING,
                UnitType.BANELING,
                UnitType.TECHLAB,
                UnitType.EXTRACTOR,
                UnitType.SUPPLYDEPOTLOWERED,
            ].map((unitType) => [unitType, agent.calculateCost(unitType)]),
        );

        expect(unitCosts).toEqual({
            [UnitType.ORBITALCOMMAND]: { minerals: 150, vespene: 0 },
            [UnitType.HIVE]: { minerals: 200, vespene: 150 },
            [UnitType.RAVAGER]: { minerals: 25, vespene: 75 },
            [UnitType.ZERGLING]: { minerals: 50, vespene: 0 },
            [UnitType.BANELING]: { minerals: 25, vespene: 25 },
            [UnitType.TECHLAB]: { minerals: 50, vespene: 25 },
            [UnitType.EXTRACTOR]: { minerals: 25, vespene: 0 },
            [UnitType.SUPPLYDEPOTLOWERED]: { minerals: 0, vespene: 0 },
        });
        expect(agent.calculateUpgradeCost(Upgrade.STIMPACK)).toEqual({ minerals: 100, vespene: 100 });
        expect(() => agent.calculateUpgradeCost(999999 as never)).toThrow('No upgrade data for upgrade 999999');
    });

    it('calculates supply cost net of the morph source and gates feeding and affordability on free supply', async () => {
        const { agent: poor } = await toyWorld({
            ...gameData,
            playerCommon: { minerals: 30, vespene: 25, foodCap: 15, foodUsed: 14 },
        });
        expect([poor.canAfford(UnitType.BANELING), poor.canAfford(UnitType.BANELING, null, { supply: true })]).toEqual([
            true,
            true,
        ]);

        const { agent } = await toyWorld({
            ...gameData,
            playerCommon: { minerals: 200, vespene: 100, foodCap: 15, foodUsed: 14 },
        });
        const unitTypeIds = [
            UnitType.ZERGLING,
            UnitType.BANELING,
            UnitType.ROACH,
            UnitType.RAVAGER,
            UnitType.MARINE,
            UnitType.ORBITALCOMMAND,
        ];

        expect(
            unitTypeIds.map((unitType) => ({
                supplyCost: agent.calculateSupplyCost(unitType),
                canFeed: agent.canFeed(unitType),
                canAffordWithSupply: agent.canAfford(unitType, null, { supply: true }),
                canAfford: agent.canAfford(unitType),
            })),
        ).toEqual([
            { supplyCost: 1, canFeed: true, canAffordWithSupply: true, canAfford: true },
            { supplyCost: 0, canFeed: true, canAffordWithSupply: true, canAfford: true },
            { supplyCost: 2, canFeed: false, canAffordWithSupply: false, canAfford: true },
            { supplyCost: 1, canFeed: true, canAffordWithSupply: true, canAfford: true },
            { supplyCost: 1, canFeed: true, canAffordWithSupply: true, canAfford: true },
            { supplyCost: 0, canFeed: true, canAffordWithSupply: true, canAfford: true },
        ]);
        expect(agent.canAfford(UnitType.ROACH)).toBe(true);
        expect([1, 2].map((count) => agent.canAfford(UnitType.ORBITALCOMMAND, null, { count }))).toEqual([true, false]);
        expect(
            [4, 5]
                .map((count) => agent.canAfford(UnitType.MARINE, null, { count }))
                .concat([1, 2].map((count) => agent.canAfford(UnitType.MARINE, null, { count, supply: true }))),
        ).toEqual([true, false, true, false]);
    });

    it('passes (world, data, event) on to the blueprint onGameStart and onStep, keeping a preset opponent id when filling in its race', async () => {
        const received: Record<string, unknown[]> = {};
        const agent = createAgent({
            async onGameStart(...args: unknown[]) {
                received.gameStart = args;
            },
            async onStep(...args: unknown[]) {
                received.step = args;
            },
        });
        agent.opponent = { id: 'ladder-42' };
        const fixture = toyFixture();
        const world = await createTestWorld(fixture, { agent });
        await stepTo(world, observation({ gameLoop: 8, units: fixture.observations[0].observation!.rawData!.units! }));

        expect(received).toEqual({
            gameStart: [world, null, expect.objectContaining({ name: 'gameStart', type: 'all', gameLoop: 0 })],
            step: [world, 8, expect.objectContaining({ name: 'step', type: 'all', data: 8 })],
        });
        expect(agent.opponent).toEqual({ id: 'ladder-42', race: Race.TERRAN });
    });

    it('requests score in the default interface options unless the blueprint overrides them', () => {
        expect(createAgent({}).interface).toEqual({ raw: true, score: true, rawCropToPlayableArea: true });
        expect(createAgent({ interface: { raw: true } }).interface).toEqual({ raw: true });
    });

    it('lets blueprint keys and assignment win over the added helpers and serializes before setup', () => {
        const calculateCost = () => ({ minerals: 1, vespene: 1 });
        const agent = createAgent({ supplyCap: 99, calculateCost } as never);

        expect(JSON.parse(JSON.stringify({ ...agent }))).toMatchObject({
            supplyCap: 99,
            supplyUsed: 0,
            supplyLeft: 99,
        });
        expect(agent.calculateCost).toBe(calculateCost);
        agent.supplyLeft = 3;
        expect(agent.supplyLeft).toBe(3);
    });

    it('detects a random opponent race from the first live enemy once, but never for a race known at game start', async () => {
        const detect = async (raceRequested: SC2APIProtocol.Race) => {
            const fixture = loadFixture('blueshift');
            fixture.gameInfo.playerInfo!.find(({ playerId }) => playerId === 2)!.raceRequested = raceRequested;
            const withEnemies = structuredClone(fixture.observations[896]);
            const rawData = fixture.observations[896].observation!.rawData!;
            rawData.units = rawData.units!.filter(({ alliance }) => alliance !== Alliance.ENEMY);

            const detected: SC2APIProtocol.Race[] = [];
            const agent = createAgent();
            agent.use(
                createSystem({
                    name: 'Scout',
                    async onEnemyRaceDetected(_world, race) {
                        detected.push(race);
                    },
                }),
            );
            const world = await createTestWorld(fixture, { loop: 896, agent });
            const opponent = agent.opponent;
            const enemyFree = fixture.observations[896];
            await stepTo(world, { ...enemyFree, observation: { ...enemyFree.observation!, gameLoop: 898 } });
            const raceBeforeEnemies = agent.opponent?.race;
            const detectedBeforeEnemies = detected.length;
            for (const gameLoop of [900, 904, 908]) {
                await stepTo(world, { ...withEnemies, observation: { ...withEnemies.observation!, gameLoop } });
            }
            return {
                raceBeforeEnemies,
                detectedBeforeEnemies,
                race: agent.opponent?.race,
                detected,
                sameOpponent: agent.opponent === opponent,
            };
        };

        expect(await detect(Race.RANDOM)).toEqual({
            raceBeforeEnemies: Race.NORACE,
            detectedBeforeEnemies: 0,
            race: Race.ZERG,
            detected: [Race.ZERG],
            sameOpponent: true,
        });
        expect(await detect(Race.PROTOSS)).toEqual({
            raceBeforeEnemies: Race.PROTOSS,
            detectedBeforeEnemies: 0,
            race: Race.PROTOSS,
            detected: [],
            sameOpponent: true,
        });
    });
});
