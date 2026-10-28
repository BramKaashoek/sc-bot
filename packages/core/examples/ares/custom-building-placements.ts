import {
    createAgent,
    createEngine,
    createPlacer,
    createPlayer,
    createSystem,
    loadAresProtossPlacements,
    parseAresPlacements,
} from '@sc-bot/core';
import type { PlacementTable, World } from '@sc-bot/core';
import { buildStructure, plan } from '@sc-bot/core/behaviors';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { CYBERNETICSCORE, GATEWAY, MISSILETURRET, SUPPLYDEPOT, PYLON } from '@sc-bot/core/constants/unit-type';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];

// the tutorial's dummy positions, only for illustration; "Pylon" stands in for a map name there
export const TERRAN_PLACEMENTS: PlacementTable = {
    Pylon: {
        UpperSpawn: {
            VsAll: {
                BunkersWall: [[147.5, 78.5]],
                MissileTurrets: [[172, 88]],
                Production: [
                    [170.5, 92.5],
                    [165.5, 92.5],
                    [160.5, 92.5],
                ],
                UpgradeStructures: [
                    [170.5, 89.5],
                    [165.5, 89.5],
                ],
                SensorTowers: [
                    [169, 90],
                    [165.5, 89.5],
                ],
                SupplyDepots: [
                    [169, 82],
                    [170, 54],
                    [171, 86],
                    [138, 76],
                ],
                SupplyDepotsWall: [
                    [166, 90],
                    [166, 92],
                ],
            },
            VsZerg: {
                Production: [
                    [166.5, 92.5],
                    [163.5, 92.5],
                    [160.5, 92.5],
                ],
                SupplyDepots: [
                    [170, 92],
                    [171, 92],
                    [138, 76],
                ],
                SupplyDepotsWall: [
                    [166, 90],
                    [166, 92],
                ],
            },
            VsProtoss: { SupplyDepots: [[105, 170]] },
            VsTerran: { SupplyDepots: [[105, 170]] },
            VsRandom: { SupplyDepots: [[105, 170]] },
        },
        LowerSpawn: {
            VsAll: {
                BunkersWall: [[147.5, 78.5]],
                MissileTurrets: [[172, 88]],
                Production: [
                    [170.5, 92.5],
                    [165.5, 92.5],
                    [160.5, 92.5],
                ],
                UpgradeStructures: [
                    [170.5, 89.5],
                    [165.5, 89.5],
                ],
                SensorTowers: [
                    [169, 90],
                    [165.5, 89.5],
                ],
                SupplyDepots: [
                    [169, 82],
                    [170, 54],
                    [171, 86],
                    [138, 76],
                ],
                SupplyDepotsWall: [
                    [166, 90],
                    [166, 92],
                ],
            },
            VsZerg: {
                Production: [
                    [166.5, 92.5],
                    [163.5, 92.5],
                    [160.5, 92.5],
                ],
                SupplyDepots: [
                    [170, 92],
                    [171, 92],
                    [138, 76],
                ],
                SupplyDepotsWall: [
                    [166, 90],
                    [166, 92],
                ],
            },
            VsProtoss: { SupplyDepots: [[105, 170]] },
            VsTerran: { SupplyDepots: [[105, 170]] },
            VsRandom: { SupplyDepots: [[105, 170]] },
        },
    },
};

export const PROTOSS_PLACEMENTS: PlacementTable = {
    Persephone: {
        UpperSpawn: {
            VsZerg: {
                FirstPylon: [[69, 144]],
                GateKeeper: [[72.5, 140.5]],
                PylonsWall: [[71, 145]],
                ThreeByThreesWall: [
                    [71.5, 138.5],
                    [73.5, 142.5],
                    [74.5, 145.5],
                ],
                StaticDefencesWall: [[68, 140]],
            },
        },
        LowerSpawn: {
            VsZerg: {
                FirstPylon: [[69, 36]],
                GateKeeper: [[73.5, 37.5]],
                PylonsWall: [[71, 39]],
                ThreeByThreesWall: [
                    [74.5, 35.5],
                    [72.5, 39.5],
                    [69.5, 41.5],
                ],
                StaticDefencesWall: [[68, 38]],
            },
        },
    },
};

const natWall = createSystem({
    name: 'NatWallOpening',
    type: 'build',
    buildOrder: [
        '14 pylon @ nat_wall',
        '15 gate @ nat_wall',
        '16 gate @ nat_wall',
        '16 core @ nat_wall',
        '16 pylon @ nat_wall',
        '16 shieldbattery @ nat_wall',
        '16 pylon @ reaper_wall',
        '16 gate @ reaper_wall',
        '16 gate @ reaper_wall',
    ],
});

export const nextFirstPylon = ({ resources }: World) => {
    const { map, placement } = resources.get();
    return placement.request(PYLON, {
        base: map.getExpansions()[1].townhallPosition,
        firstPylon: true,
        reserve: false,
    });
};

export const natGatekeeper = ({ resources }: World) => resources.get().placement.getNatGatekeeperPosition();

export const placerFromYaml = (yamlText: string) => createPlacer(parseAresPlacements(yamlText));

export const naturalWallSpots = ({ resources }: World) => {
    const { map, placement } = resources.get();
    const base = map.getExpansions()[1].townhallPosition;
    return {
        twoByTwos: placement.getPlacements({ base, size: '2x2', flag: 'wall' }),
        threeByThrees: placement.getPlacements({ base, size: '3x3', flag: 'wall' }),
    };
};

export const mainProductionSpots = ({ resources }: World) => {
    const { map, placement } = resources.get();
    return placement.getPlacements({ base: map.getLocations().self, size: '3x3', flag: 'production' });
};

export const createBot = () => {
    const agent = createAgent({
        settings: { race: Race.PROTOSS },
        async onGameStart({ resources }: World) {
            resources.set({ placer: createPlacer(PROTOSS_PLACEMENTS) });
        },
        async onStep({ resources }: World) {
            const { behaviors, map } = resources.get();
            const base = map.getExpansions()[1].townhallPosition;

            await behaviors.run(
                plan(
                    buildStructure({ structureType: GATEWAY, base, flags: ['wall'], toCount: 2 }),
                    buildStructure({ structureType: CYBERNETICSCORE, base, flags: ['wall'], toCount: 1 }),
                ),
            );
        },
    });
    agent.use(natWall);
    return agent;
};

export const createShippedYamlBot = () =>
    createAgent({
        settings: { race: Race.PROTOSS },
        async onGameStart({ resources }: World) {
            resources.set({ placer: createPlacer(loadAresProtossPlacements()) });
        },
    });

export const createTerranBot = () =>
    createAgent({
        settings: { race: Race.TERRAN },
        async onGameStart({ resources }: World) {
            resources.set({ placer: createPlacer(TERRAN_PLACEMENTS) });
        },
        async onStep({ resources }: World) {
            const { behaviors, map, mapAnalysis } = resources.get();

            await behaviors.run(
                plan(
                    buildStructure({
                        structureType: SUPPLYDEPOT,
                        base: map.getLocations().self,
                        flags: ['supplyDepot'],
                    }),
                    buildStructure({
                        structureType: MISSILETURRET,
                        base: mapAnalysis.getDefensiveThird()?.townhallPosition,
                        flags: ['missileTurret'],
                        toCount: 3,
                    }),
                ),
            );
        },
    });

if (import.meta.main) {
    const engine = createEngine();
    await engine.connect();

    const [, results] = await engine.runGame(
        MAP,
        [createPlayer({ race: Race.PROTOSS }, createBot()), createPlayer({ race: Race.ZERG, difficulty })],
        { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
    );

    console.log(results);
    engine.shutdown();
}
