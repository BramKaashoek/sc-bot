import { Ability, UnitType } from '../constants/index.ts';
import { Alliance, Attribute, CloakState, DisplayType, PlayerType, Race } from '../constants/enums.ts';
import { createTestWorld } from './create-test-world.ts';
import type { TestWorld, TestWorldOptions } from './create-test-world.ts';
import type { Fixture } from './fake-client.ts';

const TOY_MAP_SIZE = { x: 32, y: 32 };

let nextTag = 1;

export function rawUnit(overrides: SC2APIProtocol.Unit = {}): SC2APIProtocol.Unit & { tag: string } {
    return {
        displayType: DisplayType.VISIBLE,
        alliance: Alliance.SELF,
        tag: String(nextTag++),
        unitType: UnitType.SCV,
        owner: 1,
        pos: { x: 16, y: 16, z: 10 },
        facing: 0,
        radius: 0.375,
        buildProgress: 1,
        cloak: CloakState.NOTCLOAKED,
        isSelected: false,
        isOnScreen: false,
        isBlip: false,
        isPowered: false,
        health: 45,
        healthMax: 45,
        shield: 0,
        shieldMax: 0,
        energy: 0,
        energyMax: 0,
        mineralContents: 0,
        vespeneContents: 0,
        isFlying: false,
        isBurrowed: false,
        orders: [],
        addOnTag: '0',
        passengers: [],
        cargoSpaceTaken: 0,
        cargoSpaceMax: 0,
        buffIds: [],
        assignedHarvesters: 0,
        idealHarvesters: 0,
        weaponCooldown: 0,
        engagedTargetTag: '0',
        ...overrides,
    };
}

export function packBits(
    size: SC2APIProtocol.Size2DI,
    isSet: (x: number, y: number) => boolean,
): SC2APIProtocol.ImageData {
    const width = size.x!;
    const height = size.y!;
    const bytes = new Uint8Array(Math.ceil((width * height) / 8));
    for (let index = 0; index < width * height; index += 1) {
        if (isSet(index % width, Math.floor(index / width))) {
            bytes[index >> 3] |= 0x80 >> (index & 7);
        }
    }
    return { bitsPerPixel: 1, size, data: bytes };
}

function fillBytes(size: SC2APIProtocol.Size2DI, value: number): SC2APIProtocol.ImageData {
    return { bitsPerPixel: 8, size, data: new Uint8Array(size.x! * size.y!).fill(value) };
}

type ObservationOverrides = {
    gameLoop?: number;
    units?: SC2APIProtocol.Unit[];
    playerCommon?: SC2APIProtocol.PlayerCommon;
    mapSize?: SC2APIProtocol.Size2DI;
};

export function observation({
    gameLoop = 0,
    units = [],
    playerCommon = {},
    mapSize = TOY_MAP_SIZE,
}: ObservationOverrides = {}): SC2APIProtocol.ResponseObservation {
    return {
        actions: [],
        actionErrors: [],
        playerResult: [],
        chat: [],
        observation: {
            gameLoop,
            playerCommon: {
                playerId: 1,
                minerals: 50,
                vespene: 0,
                foodCap: 15,
                foodUsed: 12,
                foodArmy: 0,
                foodWorkers: 12,
                idleWorkerCount: 0,
                armyCount: 0,
                warpGateCount: 0,
                larvaCount: 0,
                ...playerCommon,
            },
            alerts: [],
            abilities: [],
            rawData: {
                player: { powerSources: [], camera: { x: 0, y: 0 }, upgradeIds: [] },
                units,
                mapState: {
                    visibility: fillBytes(mapSize, 2),
                    creep: packBits(mapSize, () => false),
                },
                event: { deadUnits: [] },
                effects: [],
            },
        },
    };
}

export function unitTypeData(unitId: number, overrides: SC2APIProtocol.UnitTypeData): SC2APIProtocol.UnitTypeData {
    return {
        unitId,
        available: true,
        mineralCost: 0,
        vespeneCost: 0,
        foodRequired: 0,
        foodProvided: 0,
        abilityId: 0,
        race: Race.NORACE,
        techAlias: [],
        unitAlias: 0,
        techRequirement: 0,
        requireAttached: false,
        attributes: [],
        weapons: [],
        ...overrides,
    };
}

export type ToyOptions = {
    enemyStart?: boolean;
    ownTownhall?: boolean;
    race?: SC2APIProtocol.Race;
    units?: SC2APIProtocol.Unit[];
    unitTypes?: SC2APIProtocol.UnitTypeData[] | Record<number, Partial<SC2APIProtocol.UnitTypeData>>;
    abilities?: SC2APIProtocol.AbilityData[];
    upgrades?: SC2APIProtocol.UpgradeData[];
    upgradeIds?: number[];
    playerCommon?: SC2APIProtocol.PlayerCommon;
    hasCreep?: (x: number, y: number) => boolean;
};

export function toyFixture({
    enemyStart = true,
    ownTownhall = true,
    race = Race.TERRAN,
    units: extraUnits = [],
    unitTypes = {},
    abilities = [],
    upgrades = [],
    upgradeIds = [],
    playerCommon,
    hasCreep,
}: ToyOptions = {}): Fixture {
    const mapSize = TOY_MAP_SIZE;
    const isInterior = (x: number, y: number) => x > 0 && y > 0 && x < mapSize.x - 1 && y < mapSize.y - 1;

    const baseUnits = (townhallX: number, mineralX: number, geyserY: number, owned: boolean) => [
        ...[13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5].map((mineralY) =>
            rawUnit({
                alliance: Alliance.NEUTRAL,
                owner: 16,
                unitType: UnitType.MINERALFIELD,
                pos: { x: mineralX, y: mineralY, z: 10 },
                mineralContents: 1800,
            }),
        ),
        rawUnit({
            alliance: Alliance.NEUTRAL,
            owner: 16,
            unitType: UnitType.VESPENEGEYSER,
            pos: { x: townhallX, y: geyserY, z: 10 },
            vespeneContents: 2250,
        }),
        ...(owned
            ? [
                  ...(ownTownhall
                      ? [
                            rawUnit({
                                unitType: UnitType.COMMANDCENTER,
                                pos: { x: townhallX, y: 16.5, z: 10 },
                                health: 1500,
                                healthMax: 1500,
                            }),
                        ]
                      : []),
                  ...[14.5, 16.5, 18.5].map((workerY) => rawUnit({ pos: { x: 4.5, y: workerY, z: 10 } })),
              ]
            : []),
    ];

    const units: SC2APIProtocol.UnitTypeData[] = [];
    units[UnitType.COMMANDCENTER] = unitTypeData(UnitType.COMMANDCENTER, {
        name: 'CommandCenter',
        abilityId: Ability.BUILD_COMMANDCENTER,
        mineralCost: 400,
        foodProvided: 15,
        race: Race.TERRAN,
        attributes: [Attribute.ARMORED, Attribute.MECHANICAL, Attribute.STRUCTURE],
    });
    units[UnitType.SUPPLYDEPOT] = unitTypeData(UnitType.SUPPLYDEPOT, {
        name: 'SupplyDepot',
        abilityId: Ability.BUILD_SUPPLYDEPOT,
        mineralCost: 100,
        foodProvided: 8,
        race: Race.TERRAN,
        attributes: [Attribute.ARMORED, Attribute.MECHANICAL, Attribute.STRUCTURE],
    });
    units[UnitType.SCV] = unitTypeData(UnitType.SCV, {
        name: 'SCV',
        abilityId: Ability.TRAIN_SCV,
        mineralCost: 50,
        foodRequired: 1,
        race: Race.TERRAN,
        attributes: [Attribute.LIGHT, Attribute.BIOLOGICAL, Attribute.MECHANICAL],
    });
    units[UnitType.MINERALFIELD] = unitTypeData(UnitType.MINERALFIELD, {
        name: 'MineralField',
        hasMinerals: true,
        attributes: [Attribute.ARMORED, Attribute.STRUCTURE],
    });
    units[UnitType.VESPENEGEYSER] = unitTypeData(UnitType.VESPENEGEYSER, {
        name: 'VespeneGeyser',
        hasVespene: true,
        attributes: [Attribute.ARMORED, Attribute.STRUCTURE],
    });

    (Array.isArray(unitTypes)
        ? unitTypes.map((typeData) => [typeData.unitId!, typeData] as const)
        : Object.entries(unitTypes).map(([id, partial]) => [Number(id), partial] as const)
    ).forEach(([id, partial]) => {
        // merging over the toy definition keeps its cost and ability for the types the toy already has
        units[id] = unitTypeData(id, { ...units[id], ...partial });
    });
    const dataAbilities: SC2APIProtocol.AbilityData[] = [];
    abilities.forEach((abilityData) => {
        dataAbilities[abilityData.abilityId!] = abilityData;
    });
    const dataUpgrades: SC2APIProtocol.UpgradeData[] = [];
    upgrades.forEach((upgradeData) => {
        dataUpgrades[upgradeData.upgradeId!] = upgradeData;
    });

    const responseObservation = observation({
        playerCommon,
        units: [...baseUnits(8.5, 2, 24.5, true), ...baseUnits(23.5, 30, 8.5, false), ...extraUnits],
    });
    const { rawData } = responseObservation.observation!;
    rawData!.player!.upgradeIds = upgradeIds;
    if (hasCreep) rawData!.mapState!.creep = packBits(mapSize, hasCreep);

    return {
        gameInfo: {
            mapName: 'Toy',
            playerInfo: [
                { playerId: 1, type: PlayerType.PARTICIPANT, raceRequested: race, raceActual: race },
                { playerId: 2, type: PlayerType.COMPUTER, raceRequested: Race.TERRAN },
            ],
            startRaw: {
                mapSize,
                pathingGrid: packBits(mapSize, isInterior),
                placementGrid: packBits(mapSize, isInterior),
                terrainHeight: fillBytes(mapSize, 200),
                playableArea: { p0: { x: 1, y: 1 }, p1: { x: mapSize.x - 1, y: mapSize.y - 1 } },
                startLocations: enemyStart ? [{ x: 23.5, y: 16.5 }] : [],
            },
        },
        data: { units, abilities: dataAbilities, upgrades: dataUpgrades, buffs: [], effects: [] },
        observations: { 0: responseObservation },
    };
}

export const toyWorld = (options: ToyOptions & { world?: TestWorldOptions } = {}): Promise<TestWorld> =>
    createTestWorld(toyFixture(options), options.world);
