import { describe, expect, it, spyOn } from 'bun:test';
import createAgent from './create-agent.ts';
import { Ability, UnitType, Upgrade } from '../constants/index.ts';
import { Alliance, Attribute, Race } from '../constants/enums.ts';
import { createTestWorld, loadFixture, stepTo } from '../test/create-test-world.ts';
import { observation, rawUnit, toyFixture, unitTypeData } from '../test/factories.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { CommandResult, Point2D, Unit } from '../types.ts';

type SentCommand = {
    tag: string;
    abilityId?: number;
    targetUnitTag?: string;
    targetWorldSpacePos?: SC2APIProtocol.Point2D;
    queueCommand: boolean;
};

async function commandsAfterStep(
    world: TestWorld,
    observation: SC2APIProtocol.ResponseObservation,
    issue: () => unknown,
): Promise<{ results: unknown; commands: SentCommand[] }> {
    const sentBefore = world.client.sent.actions.length;
    const results = await issue();
    await stepTo(world, observation);
    const commands = world.client.sent.actions
        .slice(sentBefore)
        .flatMap((request) => request.actions ?? [])
        .flatMap((action) => (action.actionRaw?.unitCommand ? [action.actionRaw.unitCommand] : []))
        .flatMap((command) =>
            command.unitTags!.map((tag) => ({
                tag,
                abilityId: command.abilityId,
                targetUnitTag: command.targetUnitTag,
                targetWorldSpacePos: command.targetWorldSpacePos,
                queueCommand: Boolean(command.queueCommand),
            })),
        );
    return { results, commands };
}

const straightLinePathing = (query: SC2APIProtocol.RequestQuery): SC2APIProtocol.ResponseQuery | undefined =>
    query.pathing?.length
        ? {
              pathing: query.pathing.map(({ startPos, endPos }) => ({
                  distance: Math.hypot(endPos!.x! - startPos!.x!, endPos!.y! - startPos!.y!),
              })),
          }
        : undefined;

async function distributeOnToy(
    playerCommon: SC2APIProtocol.PlayerCommon,
    {
        assignedToBase = 15,
        assignedToRefinery = 2,
        extraUnits = [],
        workersPerGas,
    }: {
        assignedToBase?: number;
        assignedToRefinery?: number;
        extraUnits?: SC2APIProtocol.Unit[];
        workersPerGas?: number;
    } = {},
) {
    const fixture = toyFixture();
    fixture.data.units![UnitType.REFINERY] = unitTypeData(UnitType.REFINERY, {
        attributes: [Attribute.ARMORED, Attribute.MECHANICAL, Attribute.STRUCTURE],
    });
    fixture.observations[0] = observation({
        playerCommon,
        units: [
            rawUnit({
                tag: 'mineral',
                alliance: Alliance.NEUTRAL,
                owner: 16,
                unitType: UnitType.MINERALFIELD,
                pos: { x: 2, y: 16.5, z: 10 },
                mineralContents: 1800,
            }),
            rawUnit({
                tag: 'farMineral',
                alliance: Alliance.NEUTRAL,
                owner: 16,
                unitType: UnitType.MINERALFIELD,
                pos: { x: 3, y: 12.5, z: 10 },
                mineralContents: 1800,
            }),
            rawUnit({
                tag: 'refinery',
                unitType: UnitType.REFINERY,
                pos: { x: 8.5, y: 24.5, z: 10 },
                vespeneContents: 2250,
                assignedHarvesters: assignedToRefinery,
                idealHarvesters: 3,
            }),
            rawUnit({
                tag: 'commandCenter',
                unitType: UnitType.COMMANDCENTER,
                pos: { x: 8.5, y: 16.5, z: 10 },
                assignedHarvesters: assignedToBase,
                idealHarvesters: 16,
            }),
            rawUnit({ tag: 'worker', pos: { x: 6, y: 16.5, z: 10 } }),
            ...extraUnits,
        ],
    });
    const world = await createTestWorld(fixture);
    return (
        await commandsAfterStep(world, fixture.observations[0], () =>
            world.agent.distributeWorkers(2, { workersPerGas }),
        )
    ).commands;
}

describe('agent macro helpers', () => {
    it('reports the recorded build state: pending orders, upgrade progress, structure progress and tech requirement progress', async () => {
        const { agent } = await createTestWorld('blueshift', { loop: 224 });
        const byType = (unitTypes: number[], measure: (unitType: number) => number) =>
            Object.fromEntries(unitTypes.map((unitType) => [unitType, measure(unitType)]));

        expect({
            alreadyPending: byType(
                [UnitType.SUPPLYDEPOT, UnitType.REFINERY, UnitType.SCV, UnitType.BARRACKSTECHLAB, UnitType.MARINE],
                (unitType) => agent.alreadyPending(unitType),
            ),
            alreadyPendingUpgrade: agent.alreadyPendingUpgrade(Upgrade.TERRANINFANTRYWEAPONSLEVEL1),
            structureTypeBuildProgress: byType(
                [UnitType.SUPPLYDEPOT, UnitType.REFINERY, UnitType.BARRACKS, UnitType.FACTORY],
                (unitType) => agent.structureTypeBuildProgress(unitType),
            ),
            techRequirementProgress: byType(
                [
                    UnitType.BARRACKS,
                    UnitType.FACTORY,
                    UnitType.ARMORY,
                    UnitType.MARINE,
                    UnitType.GHOST,
                    UnitType.THOR,
                    UnitType.BATTLECRUISER,
                    UnitType.MOTHERSHIP,
                ],
                (unitType) => agent.techRequirementProgress(unitType),
            ),
            hasTechFor: byType(
                [UnitType.MARINE, UnitType.GHOST, UnitType.THOR, UnitType.BATTLECRUISER, UnitType.MOTHERSHIP],
                (unitType) => Number(agent.hasTechFor(unitType)),
            ),
        }).toEqual({
            alreadyPending: {
                [UnitType.SUPPLYDEPOT]: 1,
                [UnitType.REFINERY]: 1,
                [UnitType.SCV]: 1,
                [UnitType.BARRACKSTECHLAB]: 1,
                [UnitType.MARINE]: 0,
            },
            alreadyPendingUpgrade: 0.08437502384185791,
            structureTypeBuildProgress: {
                [UnitType.SUPPLYDEPOT]: 0.40625,
                [UnitType.REFINERY]: 0.37708336114883423,
                [UnitType.BARRACKS]: 1,
                [UnitType.FACTORY]: 0,
            },
            techRequirementProgress: {
                [UnitType.BARRACKS]: 0.40625,
                [UnitType.FACTORY]: 1,
                [UnitType.ARMORY]: 0,
                [UnitType.MARINE]: 1,
                [UnitType.GHOST]: 0,
                [UnitType.THOR]: 0,
                [UnitType.BATTLECRUISER]: 0,
                [UnitType.MOTHERSHIP]: 0,
            },
            hasTechFor: {
                [UnitType.MARINE]: 1,
                [UnitType.GHOST]: 0,
                [UnitType.THOR]: 0,
                [UnitType.BATTLECRUISER]: 0,
                [UnitType.MOTHERSHIP]: 0,
            },
        });
    });

    it('counts a worker as en route to build only until its structure exists', async () => {
        const fixture = toyFixture();
        const buildDepot = (target: { x: number; y: number }) => [
            { abilityId: Ability.BUILD_SUPPLYDEPOT, targetWorldSpacePos: target, progress: 0 },
        ];
        fixture.observations[0] = observation({
            units: [
                ...fixture.observations[0].observation!.rawData!.units!,
                rawUnit({ pos: { x: 12, y: 8, z: 10 }, orders: buildDepot({ x: 14, y: 6 }) }),
                rawUnit({ pos: { x: 12, y: 24, z: 10 }, orders: buildDepot({ x: 12, y: 26 }) }),
                rawUnit({
                    unitType: UnitType.SUPPLYDEPOT,
                    pos: { x: 12, y: 26, z: 10 },
                    buildProgress: 0.5,
                    health: 200,
                    healthMax: 400,
                }),
            ],
        });
        const { agent } = await createTestWorld(fixture);

        expect({
            workerEnRouteToBuild: agent.workerEnRouteToBuild(UnitType.SUPPLYDEPOT),
            alreadyPending: agent.alreadyPending(UnitType.SUPPLYDEPOT),
            structureTypeBuildProgress: agent.structureTypeBuildProgress(UnitType.SUPPLYDEPOT),
        }).toEqual({ workerEnRouteToBuild: 1, alreadyPending: 2, structureTypeBuildProgress: 0.5 });
    });

    it('picks the closest reachable untaken expansion by pathing distance from the start location and expands there', async () => {
        const pathingOverrides = new Map<string, number>();
        const world = await createTestWorld('blueshift', {
            loop: 224,
            onQuery: (query) => {
                const answer = straightLinePathing(query);
                answer?.pathing?.forEach((pathing, index) => {
                    const { endPos } = query.pathing![index];
                    pathing.distance = pathingOverrides.get(`${endPos!.x},${endPos!.y}`) ?? pathing.distance;
                });
                return answer;
            },
        });
        const { agent } = world;

        pathingOverrides.set('14.5,43.5', 0);
        pathingOverrides.set('44.5,28.5', 500);
        expect(await agent.getNextExpansion()).toEqual({ x: 69.5, y: 14.5 });
        pathingOverrides.clear();
        expect(await agent.getNextExpansion()).toEqual({ x: 14.5, y: 43.5 });
        expect(
            agent
                .ownedExpansions()
                .map(({ location, townhall }: { location: Point2D; townhall: Unit }) => [location, townhall.tag]),
        ).toEqual([[{ x: 15.5, y: 15.5 }, '4342677505']]);

        const { commands } = await commandsAfterStep(world, world.client.fixture.observations[224], () =>
            agent.expandNow(),
        );
        expect(commands).toEqual([
            {
                tag: '4343463937',
                abilityId: Ability.BUILD_COMMANDCENTER,
                targetWorldSpacePos: { x: 14.5, y: 43.5 },
                queueCommand: false,
            },
        ]);
    });

    it('sends idle and surplus gas workers to the richest mineral patch of an undersaturated base', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });

        const { commands } = await commandsAfterStep(world, world.client.fixture.observations[896], () =>
            world.agent.distributeWorkers(),
        );

        expect(commands).toEqual(
            ['4345823233', '4343726081'].map((tag) => ({
                tag,
                abilityId: Ability.HARVEST_GATHER,
                targetUnitTag: '4324851713',
                queueCommand: false,
            })),
        );
    });

    it('sends an idle worker to the undersaturated resource the mineral-to-gas ratio favours over a closer one, then idle workers to the nearest base mineral, capping gas at workersPerGas', async () => {
        expect(await distributeOnToy({ minerals: 100, vespene: 100 })).toEqual([
            { tag: 'worker', abilityId: Ability.HARVEST_GATHER, targetUnitTag: 'mineral', queueCommand: false },
        ]);
        expect(await distributeOnToy({ minerals: 1000, vespene: 100 })).toEqual([
            { tag: 'worker', abilityId: Ability.HARVEST_GATHER, targetUnitTag: 'refinery', queueCommand: false },
        ]);
        expect(
            await distributeOnToy(
                { minerals: 100, vespene: 100 },
                {
                    assignedToBase: 17,
                    extraUnits: [
                        rawUnit({ tag: 'idleSecond', pos: { x: 4, y: 11, z: 10 } }),
                        rawUnit({
                            tag: 'surplusMiner',
                            pos: { x: 3, y: 16.5, z: 10 },
                            orders: [{ abilityId: Ability.HARVEST_GATHER, targetUnitTag: 'mineral' }],
                        }),
                    ],
                },
            ),
        ).toEqual([
            { tag: 'worker', abilityId: Ability.HARVEST_GATHER, targetUnitTag: 'refinery', queueCommand: false },
            { tag: 'idleSecond', abilityId: Ability.HARVEST_GATHER, targetUnitTag: 'farMineral', queueCommand: false },
        ]);

        const gasWorkers = ['gasA', 'gasB', 'gasC'].map((tag) =>
            rawUnit({
                tag,
                pos: { x: 8.5, y: 22, z: 10 },
                orders: [{ abilityId: Ability.HARVEST_GATHER, targetUnitTag: 'refinery' }],
            }),
        );
        const capped = await distributeOnToy(
            { minerals: 100, vespene: 100 },
            { assignedToBase: 12, assignedToRefinery: 3, extraUnits: gasWorkers, workersPerGas: 1 },
        );
        expect(capped.filter(({ tag }) => tag.startsWith('gas')).map(({ targetUnitTag }) => targetUnitTag)).toEqual([
            'mineral',
            'mineral',
        ]);

        expect(await distributeOnToy({ minerals: 1000, vespene: 100 }, { workersPerGas: 0 })).toEqual([
            { tag: 'worker', abilityId: Ability.HARVEST_GATHER, targetUnitTag: 'mineral', queueCommand: false },
        ]);

        await expect(distributeOnToy({ minerals: 100, vespene: 100 }, { workersPerGas: 4 })).rejects.toThrow(
            RangeError,
        );
    });

    it('trains up to the amount from idle finished producers not ordered this step and researches only from an idle facility', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { agent } = world;
        const { actions } = world.resources.get();

        const { results, commands } = await commandsAfterStep(
            world,
            world.client.fixture.observations[896],
            async () => [
                await agent.train(UnitType.MARINE, 2),
                await actions.do(Ability.TRAIN_SCV, '4342677505').then(() => agent.train(UnitType.SCV)),
                await agent.research(Upgrade.STIMPACK),
                await agent.research(Upgrade.SHIELDWALL),
                await agent.research(Upgrade.TERRANINFANTRYARMORSLEVEL1),
                await agent.research(Upgrade.DIGGINGCLAWS),
            ],
        );

        expect(results).toEqual([1, 0, true, false, false, false]);
        expect(commands).toEqual([
            { tag: '4350541825', abilityId: Ability.TRAIN_MARINE, queueCommand: false },
            { tag: '4342677505', abilityId: Ability.TRAIN_SCV, queueCommand: false },
            { tag: '4351066113', abilityId: Ability.RESEARCH_STIMPACK, queueCommand: false },
        ]);
    });

    it('trains techlab-only units from a techlab producer, doubles up on reactors and adds to a reactor already training one, stops training or researching once money or the supply spent this step runs out and researches nothing without the required building, previous level or protoss power, while a nexus trains unpowered and the armory researches vehicle and ship plating', async () => {
        const fixture = loadFixture('blueshift');
        fixture.observations = {
            0: observation({
                mapSize: fixture.gameInfo.startRaw!.mapSize,
                playerCommon: { minerals: 300, vespene: 200, foodCap: 200, foodUsed: 0 },
                units: [
                    rawUnit({ tag: 'plainRax', unitType: UnitType.BARRACKS }),
                    rawUnit({ tag: 'reactorRax', unitType: UnitType.BARRACKS, addOnTag: 'reactor' }),
                    rawUnit({ tag: 'reactor', unitType: UnitType.BARRACKSREACTOR }),
                    rawUnit({
                        tag: 'busyReactorRax',
                        unitType: UnitType.BARRACKS,
                        addOnTag: 'busyReactor',
                        orders: [{ abilityId: Ability.TRAIN_MARINE, progress: 0.5 }],
                    }),
                    rawUnit({ tag: 'busyReactor', unitType: UnitType.BARRACKSREACTOR }),
                    rawUnit({ tag: 'techlabRax', unitType: UnitType.BARRACKS, addOnTag: 'techlab' }),
                    rawUnit({ tag: 'techlab', unitType: UnitType.BARRACKSTECHLAB }),
                    rawUnit({ tag: 'engineeringBay', unitType: UnitType.ENGINEERINGBAY }),
                    rawUnit({ tag: 'armory', unitType: UnitType.ARMORY }),
                    rawUnit({ tag: 'ghostAcademy', unitType: UnitType.GHOSTACADEMY }),
                    rawUnit({ tag: 'spawningPool', unitType: UnitType.SPAWNINGPOOL }),
                ],
            }),
        };
        const world = await createTestWorld(fixture);
        const { agent } = world;

        const { results, commands } = await commandsAfterStep(world, fixture.observations[0], async () => [
            await agent.research(Upgrade.TERRANINFANTRYWEAPONSLEVEL2),
            await agent.research(Upgrade.ZERGLINGATTACKSPEED),
            await agent.train(UnitType.GHOST),
            await agent.research(Upgrade.STIMPACK),
            await agent.train(UnitType.MARINE, 5),
        ]);

        expect(results).toEqual([false, false, 1, false, 3]);
        expect(commands).toEqual([
            { tag: 'techlabRax', abilityId: Ability.TRAIN_GHOST, queueCommand: false },
            { tag: 'reactorRax', abilityId: Ability.TRAIN_MARINE, queueCommand: false },
            { tag: 'reactorRax', abilityId: Ability.TRAIN_MARINE, queueCommand: true },
            { tag: 'busyReactorRax', abilityId: Ability.TRAIN_MARINE, queueCommand: false },
        ]);

        const supplyCapped = observation({
            mapSize: fixture.gameInfo.startRaw!.mapSize,
            playerCommon: { minerals: 1000, vespene: 1000, foodCap: 2, foodUsed: 0 },
            units: fixture.observations[0].observation!.rawData!.units!,
        });
        await stepTo(world, supplyCapped);
        expect(
            await commandsAfterStep(world, supplyCapped, async () => [
                await agent.train(UnitType.MARINE, 5),
                await agent.research(Upgrade.TERRANVEHICLEANDSHIPARMORSLEVEL1),
            ]),
        ).toEqual({
            results: [2, true],
            commands: [
                { tag: 'reactorRax', abilityId: Ability.TRAIN_MARINE, queueCommand: false },
                { tag: 'reactorRax', abilityId: Ability.TRAIN_MARINE, queueCommand: true },
                { tag: 'armory', abilityId: Ability.RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL1, queueCommand: false },
            ],
        });
        const researchingPlating = observation({
            mapSize: fixture.gameInfo.startRaw!.mapSize,
            units: [
                ...supplyCapped.observation!.rawData!.units!.map((unit) =>
                    unit.tag === 'armory'
                        ? {
                              ...unit,
                              orders: [
                                  { abilityId: Ability.RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL1, progress: 0.25 },
                              ],
                          }
                        : unit,
                ),
                rawUnit({
                    tag: 'armoryTwo',
                    unitType: UnitType.ARMORY,
                    orders: [{ abilityId: Ability.RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL2, progress: 0.5 }],
                }),
                rawUnit({
                    tag: 'armoryThree',
                    unitType: UnitType.ARMORY,
                    orders: [{ abilityId: Ability.RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL3, progress: 0.75 }],
                }),
            ],
        });
        await stepTo(world, researchingPlating);
        expect(
            [
                Upgrade.TERRANVEHICLEANDSHIPARMORSLEVEL1,
                Upgrade.TERRANVEHICLEANDSHIPARMORSLEVEL2,
                Upgrade.TERRANVEHICLEANDSHIPARMORSLEVEL3,
            ].map((upgrade) => agent.alreadyPendingUpgrade(upgrade)),
        ).toEqual([0.25, 0.5, 0.75]);

        const protossFixture = loadFixture('blueshift-protoss');
        protossFixture.observations = {
            0: observation({
                mapSize: protossFixture.gameInfo.startRaw!.mapSize,
                playerCommon: { minerals: 1000, vespene: 1000, foodCap: 200, foodUsed: 0 },
                units: [
                    rawUnit({ tag: 'unpoweredNexus', unitType: UnitType.NEXUS }),
                    rawUnit({ tag: 'unpoweredCore', unitType: UnitType.CYBERNETICSCORE }),
                ],
            }),
        };
        const protossWorld = await createTestWorld(protossFixture, {
            agent: createAgent({ settings: { race: Race.PROTOSS } }),
        });
        expect(
            await commandsAfterStep(protossWorld, protossFixture.observations[0], async () => [
                await protossWorld.agent.train(UnitType.PROBE),
                await protossWorld.agent.research(Upgrade.PROTOSSAIRWEAPONSLEVEL1),
            ]),
        ).toEqual({
            results: [1, false],
            commands: [{ tag: 'unpoweredNexus', abilityId: Ability.TRAIN_PROBE, queueCommand: false }],
        });
    });

    it('queues every macro command for one request after the step under the calling commander, not ordering a queued producer twice', async () => {
        const agent = createAgent();
        const world = await createTestWorld('blueshift', { loop: 224, agent, onQuery: straightLinePathing });
        const { actions, events } = world.resources.get();
        const reader = events.createReader();
        const sentBefore = world.client.sent.actions.length;

        const { results, commands } = await commandsAfterStep(world, world.client.fixture.observations[224], () =>
            actions.as({ owner: 'Macro' }, async () => {
                await agent.expandNow();
                const trained = [
                    await agent.train(UnitType.SCV, 1, undefined, false),
                    await agent.train(UnitType.SCV, 1, undefined, false),
                ];
                expect(world.client.sent.actions.length).toBe(sentBefore);
                return trained;
            }),
        );

        expect(results).toEqual([1, 0]);
        expect(world.client.sent.actions.length).toBe(sentBefore + 1);
        expect(commands).toEqual([
            {
                tag: '4343463937',
                abilityId: Ability.BUILD_COMMANDCENTER,
                targetWorldSpacePos: { x: 14.5, y: 43.5 },
                queueCommand: false,
            },
            { tag: '4342677505', abilityId: Ability.TRAIN_SCV, queueCommand: false },
        ]);
        expect(
            events
                .read(reader)
                .filter(({ name }) => name === 'commandResults')
                .flatMap(({ data }) => (data as CommandResult[]).map(({ owner }) => owner)),
        ).toEqual(['Macro', 'Macro']);
    });

    it('picks a builder that only has a move order when no worker is idle or gathering', async () => {
        const fixture = loadFixture('blueshift');
        const start = fixture.observations[224];
        start
            .observation!.rawData!.units!.filter((unit) => unit.unitType === UnitType.SCV)
            .forEach((scv) => {
                scv.orders = [{ abilityId: Ability.MOVE, targetWorldSpacePos: { x: 20, y: 20 } }];
            });
        const world = await createTestWorld(fixture, { loop: 224, onQuery: straightLinePathing });

        const { commands } = await commandsAfterStep(world, start, () => world.agent.expandNow());

        expect(commands.map(({ abilityId, targetWorldSpacePos }) => ({ abilityId, targetWorldSpacePos }))).toEqual([
            { abilityId: Ability.BUILD_COMMANDCENTER, targetWorldSpacePos: { x: 14.5, y: 43.5 } },
        ]);
    });

    it('counts a hydralisk morphing to a lurker as a pending lurker', async () => {
        const fixture = toyFixture();
        fixture.data.units![UnitType.HYDRALISK] = unitTypeData(UnitType.HYDRALISK, {
            abilityId: Ability.TRAIN_HYDRALISK,
        });
        fixture.observations[0] = observation({
            units: [
                rawUnit({ unitType: UnitType.HYDRALISK, orders: [{ abilityId: Ability.MORPH_LURKER, progress: 0.5 }] }),
            ],
        });
        const { agent } = await createTestWorld(fixture);

        expect(agent.alreadyPending(UnitType.LURKERMP)).toBe(1);
    });

    it('counts zerg eggs, morphs and drone-built structures in progress as pending and trains from larva only with supply', async () => {
        const zerg = () => createAgent({ settings: { race: Race.ZERG } });
        const early = await createTestWorld('blueshift-zerg', { loop: 224, agent: zerg() });
        const late = await createTestWorld('blueshift-zerg', { loop: 896, agent: zerg() });
        const pendingTypes = [
            UnitType.DRONE,
            UnitType.OVERLORD,
            UnitType.EXTRACTOR,
            UnitType.EVOLUTIONCHAMBER,
            UnitType.CREEPTUMORQUEEN,
            UnitType.SPAWNINGPOOL,
            UnitType.LAIR,
        ];
        const pending = (world: TestWorld) => pendingTypes.map((unitType) => world.agent.alreadyPending(unitType));

        const supplyBlocked = await early.agent.train(UnitType.ZERGLING);
        const { results, commands } = await commandsAfterStep(late, late.client.fixture.observations[896], async () => [
            await late.agent.train(UnitType.ZERGLING, 2),
            await late.agent.train(UnitType.DRONE),
        ]);

        expect({ early: pending(early), late: pending(late), supplyBlocked, results, commands }).toEqual({
            early: [1, 1, 1, 1, 1, 0, 0],
            late: [0, 0, 0, 0, 0, 0, 1],
            supplyBlocked: 0,
            results: [2, 1],
            commands: [
                { tag: '4346085378', abilityId: Ability.TRAIN_ZERGLING, queueCommand: false },
                { tag: '4347658242', abilityId: Ability.TRAIN_ZERGLING, queueCommand: false },
                { tag: '4348182530', abilityId: Ability.TRAIN_DRONE, queueCommand: false },
            ],
        });
    });

    it('trains protoss units only from powered gateways, warping in at a pylon from a warp gate', async () => {
        const protoss = () => createAgent({ settings: { race: Race.PROTOSS } });
        const early = await createTestWorld('blueshift-protoss', { loop: 224, agent: protoss() });
        const fixture = loadFixture('blueshift-protoss');
        const unpoweredGateway = structuredClone(fixture.observations[896]);
        unpoweredGateway.observation!.gameLoop = 900;
        unpoweredGateway.observation!.rawData!.units!.find((unit) => unit.unitType === UnitType.GATEWAY)!.isPowered =
            false;
        const late = await createTestWorld(fixture, { loop: 896, agent: protoss() });
        const random = spyOn(Math, 'random').mockImplementation(() => 0);

        try {
            const powered = await commandsAfterStep(late, unpoweredGateway, () => late.agent.train(UnitType.ZEALOT, 3));
            const unpowered = await commandsAfterStep(late, unpoweredGateway, () =>
                late.agent.train(UnitType.ZEALOT, 3),
            );

            expect({
                pending: [UnitType.PYLON, UnitType.ZEALOT, UnitType.GATEWAY].map((unitType) =>
                    early.agent.alreadyPending(unitType),
                ),
                warpGateResearch: early.agent.alreadyPendingUpgrade(Upgrade.WARPGATERESEARCH),
                powered,
                unpowered,
            }).toEqual({
                pending: [1, 1, 0],
                warpGateResearch: 0.08928573131561279,
                powered: {
                    results: 2,
                    commands: [
                        { tag: '4350803969', abilityId: Ability.TRAIN_ZEALOT, queueCommand: false },
                        {
                            tag: '4351328257',
                            abilityId: Ability.TRAINWARP_ZEALOT,
                            targetWorldSpacePos: { x: 25, y: 15 },
                            queueCommand: false,
                        },
                    ],
                },
                unpowered: {
                    results: 1,
                    commands: [
                        {
                            tag: '4351328257',
                            abilityId: Ability.TRAINWARP_ZEALOT,
                            targetWorldSpacePos: { x: 25, y: 15 },
                            queueCommand: false,
                        },
                    ],
                },
            });
        } finally {
            random.mockRestore();
        }
    });
});
