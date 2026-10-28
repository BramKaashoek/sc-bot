import { describe, expect, it, spyOn } from 'bun:test';
import createAgent from './create-agent.ts';
import { Ability, UnitType, Upgrade } from '../constants/index.ts';
import { Alliance, Attribute, Race } from '../constants/enums.ts';
import { createTestWorld, loadFixture, observationAt, stepTo } from '../test/create-test-world.ts';
import { observation, rawUnit, toyWorld } from '../test/factories.ts';
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

    it('treats a finished tech-equivalent structure as the required tech', async () => {
        const fixture = loadFixture('blueshift');
        const { agent: unfinished } = await createTestWorld(fixture, { loop: 224 });
        fixture.observations[224]
            .observation!.rawData!.units!.filter((unit) => unit.unitType === UnitType.SUPPLYDEPOT)
            .forEach((depot) => {
                depot.unitType = UnitType.SUPPLYDEPOTLOWERED;
                depot.buildProgress = 1;
            });
        const { agent: lowered } = await createTestWorld(fixture, { loop: 224 });

        expect([unfinished.hasTechFor(UnitType.BARRACKS), lowered.hasTechFor(UnitType.BARRACKS)]).toEqual([
            false,
            true,
        ]);
    });

    it('counts a worker as en route to build only until its structure exists, and an abandoned structure or add-on as pending once', async () => {
        const buildDepot = (target: { x: number; y: number }) => [
            { abilityId: Ability.BUILD_SUPPLYDEPOT, targetWorldSpacePos: target, progress: 0 },
        ];
        const { agent } = await toyWorld({
            unitTypes: {
                [UnitType.BARRACKSREACTOR]: {
                    abilityId: Ability.BUILD_REACTOR_BARRACKS,
                    race: Race.TERRAN,
                    attributes: [Attribute.STRUCTURE],
                },
            },
            units: [
                rawUnit({ pos: { x: 12, y: 8, z: 10 }, orders: buildDepot({ x: 14, y: 6 }) }),
                rawUnit({ pos: { x: 12, y: 24, z: 10 }, orders: buildDepot({ x: 12, y: 26 }) }),
                rawUnit({
                    unitType: UnitType.SUPPLYDEPOT,
                    pos: { x: 12, y: 26, z: 10 },
                    buildProgress: 0.5,
                    health: 200,
                    healthMax: 400,
                }),
                rawUnit({ unitType: UnitType.SUPPLYDEPOT, pos: { x: 20, y: 26, z: 10 }, buildProgress: 0.25 }),
                rawUnit({ unitType: UnitType.BARRACKS, orders: [{ abilityId: Ability.BUILD_REACTOR_BARRACKS }] }),
                rawUnit({ unitType: UnitType.BARRACKSREACTOR, buildProgress: 0.5 }),
            ],
        });

        expect({
            workerEnRouteToBuild: agent.workerEnRouteToBuild(UnitType.SUPPLYDEPOT),
            alreadyPending: [UnitType.SUPPLYDEPOT, UnitType.BARRACKSREACTOR].map((type) => agent.alreadyPending(type)),
            structureTypeBuildProgress: agent.structureTypeBuildProgress(UnitType.SUPPLYDEPOT),
        }).toEqual({ workerEnRouteToBuild: 1, alreadyPending: [3, 1], structureTypeBuildProgress: 0.5 });
    });

    it('picks the first available expansion the building tracker accepts, with no pathing query, and expands there', async () => {
        const queries: SC2APIProtocol.RequestQuery[] = [];
        const world = await createTestWorld('blueshift', {
            loop: 224,
            onQuery: (query) => {
                queries.push(query);
                return straightLinePathing(query);
            },
        });
        const { agent } = world;
        const { buildings } = world.resources.get();

        const first = buildings.getNextExpansion()!;
        const center = (spot: Point2D) => ({ x: spot.x + 0.5, y: spot.y + 0.5 });
        expect(await agent.getNextExpansion()).toEqual(center(first));
        expect(
            agent
                .ownedExpansions()
                .map(({ location, townhall }: { location: Point2D; townhall: Unit }) => [location, townhall.tag]),
        ).toEqual([[{ x: 15.5, y: 15.5 }, '4342677505']]);

        await agent.expandNow();
        await agent.expandNow();
        await agent.expandNow();
        expect(buildings.getTracked().map(({ unitType, target, status }) => ({ unitType, target, status }))).toEqual([
            { unitType: UnitType.COMMANDCENTER, target: first, status: 'moving' },
        ]);
        expect(await agent.getNextExpansion()).toEqual(center(buildings.getNextExpansion()!));
        expect(await agent.getNextExpansion()).not.toEqual(center(first));
        expect(queries.filter((query) => query.pathing?.length)).toEqual([]);
    });

    it('blocks the floored spot expandNow built at after its worker gets CantBuildLocationInvalid, so the next expansion skips it', async () => {
        const world = await createTestWorld('blueshift', { loop: 224, onQuery: straightLinePathing });
        const { agent, client } = world;
        const { buildings } = world.resources.get();
        const first = buildings.getNextExpansion()!;

        await agent.expandNow();
        const rejected = structuredClone(client.fixture.observations[224]);
        rejected.observation!.gameLoop = 226;
        rejected.actionErrors = [
            { unitTag: buildings.getTracked()[0].workerTag, result: 44 as SC2APIProtocol.ActionResult },
        ];
        await stepTo(world, rejected);

        expect(buildings.isExpansionBlocked(first)).toBe(true);
        expect(await agent.getNextExpansion()).not.toEqual({ x: first.x + 0.5, y: first.y + 0.5 });
    });

    it('sends one townhall build at a time, with or without a location, from the first order until it is done', async () => {
        const world = await createTestWorld('blueshift', { loop: 224, onQuery: straightLinePathing });
        const { agent, client } = world;
        const { buildings } = world.resources.get();
        const snapshot = () => buildings.getTracked().map(({ target, status }) => ({ target, status }));
        const expandTwice = async (build: { target: Point2D }) => {
            await agent.expandNow();
            await agent.expandNow(undefined, build.target);
        };
        const stepWith = async (gameLoop: number, edit: (units: SC2APIProtocol.Unit[]) => SC2APIProtocol.Unit[]) => {
            const next = structuredClone(client.fixture.observations[224]);
            next.observation!.gameLoop = gameLoop;
            next.observation!.rawData!.units = edit(next.observation!.rawData!.units!);
            await stepTo(world, next);
        };

        await agent.expandNow();
        const [build] = buildings.getTracked();
        const { target, workerTag } = build;
        expect(snapshot()).toEqual([{ target, status: 'moving' }]);

        const building = [{ abilityId: Ability.BUILD_COMMANDCENTER, targetWorldSpacePos: target }];
        await stepWith(226, (units) =>
            units.map((raw) => (raw.tag === workerTag ? { ...raw, orders: building } : raw)),
        );
        expect(snapshot()).toEqual([{ target, status: 'ordered' }]);
        await expandTwice(build);
        expect(snapshot()).toEqual([{ target, status: 'ordered' }]);

        const structure = rawUnit({
            unitType: UnitType.COMMANDCENTER,
            pos: { x: target.x, y: target.y, z: 12 },
            buildProgress: 0.5,
        });
        await stepWith(228, (units) => [...units, structure]);
        expect(snapshot()).toEqual([{ target, status: 'constructing' }]);
        await expandTwice(build);
        expect(snapshot()).toEqual([{ target, status: 'constructing' }]);

        await stepWith(230, (units) => [...units, { ...structure, buildProgress: 1 }]);
        expect(snapshot()).toEqual([{ target, status: 'done' }]);
        await agent.expandNow();
        expect(snapshot()).toEqual([
            { target, status: 'done' },
            { target: expect.not.objectContaining(target), status: 'moving' },
        ]);
    });

    it('does not expand below the townhall cost', async () => {
        const world = await createTestWorld('blueshift', { loop: 0, onQuery: straightLinePathing });

        await world.agent.expandNow(undefined, { x: 14.5, y: 43.5 });

        expect(world.resources.get().buildings.getTracked()).toEqual([]);
    });

    it('trains up to the amount from idle finished producers not ordered this step and researches only from an idle facility', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { agent } = world;
        const { actions } = world.resources.get();

        world.data.addEarmark({ name: 'saving', minerals: agent.minerals!, vespene: 0 });
        expect(await agent.train(UnitType.MARINE)).toBe(0);
        world.data.settleEarmark('saving');

        const { results, commands } = await commandsAfterStep(
            world,
            world.client.fixture.observations[896],
            async () => [
                await agent.train(UnitType.MARINE, { count: 2 }),
                await actions.do('4342677505', Ability.TRAIN_SCV).then(() => agent.train(UnitType.SCV)),
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
            await agent.train(UnitType.MARINE, { count: 5 }),
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
                await agent.train(UnitType.MARINE, { count: 5 }),
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

    it('trains from the producer nearest the near point rather than the default order', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const raxes = [
            rawUnit({ tag: 'far', unitType: UnitType.BARRACKS, pos: { x: 150, y: 150, z: 10 }, buildProgress: 1 }),
            rawUnit({ tag: 'close', unitType: UnitType.BARRACKS, pos: { x: 60, y: 60, z: 10 }, buildProgress: 1 }),
        ];
        const stocked = observationAt(world, 900, { add: raxes });
        stocked.observation!.playerCommon!.minerals = 500;
        stocked.observation!.playerCommon!.foodCap = 100;
        await stepTo(world, stocked);

        const { results, commands } = await commandsAfterStep(world, observationAt(world, 904), () =>
            world.agent.train(UnitType.MARINE, { near: { x: 60, y: 60 } }),
        );

        expect({ results, tags: commands.map(({ tag }) => tag) }).toEqual({ results: 1, tags: ['close'] });
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
                    await agent.train(UnitType.SCV, { idleOnly: false }),
                    await agent.train(UnitType.SCV, { idleOnly: false }),
                ];
                expect(world.client.sent.actions.length).toBe(sentBefore);
                return trained;
            }),
        );

        expect(results).toEqual([1, 0]);
        expect(world.client.sent.actions.length).toBe(sentBefore + 1);
        expect(commands).toEqual([
            {
                tag: '4342677505',
                abilityId: Ability.TRAIN_SCV,
                targetUnitTag: undefined,
                targetWorldSpacePos: undefined,
                queueCommand: false,
            },
            {
                tag: '4343463937',
                abilityId: Ability.MOVE,
                targetUnitTag: undefined,
                targetWorldSpacePos: { x: 14, y: 43 },
                queueCommand: false,
            },
        ]);
        expect(
            events
                .read(reader)
                .filter(({ name }) => name === 'commandResults')
                .flatMap(({ data }) => (data as CommandResult[]).map(({ owner }) => owner)),
        ).toEqual(['Macro', 'role:BUILDING']);
    });

    it('builds with the worker mining selects when mining is enabled', async () => {
        const world = await createTestWorld('blueshift', { loop: 224, onQuery: straightLinePathing });
        const { buildings, mining, units } = world.resources.get();
        mining.configure({ enabled: true });
        const worker = units.getWorkers().find((scv) => scv.tag !== '4343463937')!;
        const select = spyOn(mining, 'selectWorker').mockReturnValue(worker);
        const target = { x: 14.5, y: 43.5 };

        await world.agent.expandNow(undefined, target);

        expect(select.mock.calls[0]).toEqual([target, expect.objectContaining({ forceClose: true })]);
        expect(buildings.getTracked().map(({ unitType, workerTag }) => ({ unitType, workerTag }))).toEqual([
            { unitType: UnitType.COMMANDCENTER, workerTag: worker.tag },
        ]);
    });

    it('counts a hydralisk morphing to a lurker as a pending lurker', async () => {
        const { agent } = await toyWorld({
            unitTypes: { [UnitType.HYDRALISK]: { abilityId: Ability.TRAIN_HYDRALISK } },
            units: [
                rawUnit({ unitType: UnitType.HYDRALISK, orders: [{ abilityId: Ability.MORPH_LURKER, progress: 0.5 }] }),
            ],
        });

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
            await late.agent.train(UnitType.ZERGLING, { count: 2 }),
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
            const powered = await commandsAfterStep(late, unpoweredGateway, () =>
                late.agent.train(UnitType.ZEALOT, { count: 3 }),
            );
            const unpowered = await commandsAfterStep(late, unpoweredGateway, () =>
                late.agent.train(UnitType.ZEALOT, { count: 3 }),
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
