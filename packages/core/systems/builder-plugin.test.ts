import { describe, expect, it, spyOn } from 'bun:test';
import { Ability, UnitType, Upgrade } from '../constants/index.ts';
import { ENEMY_NAT_VISION, ENEMY_SPAWN, NAT } from '../constants/build-target.ts';
import { CARRYMINERALFIELDMINERALS } from '../constants/buff.ts';
import { Alliance, BuildOrder, BuildResult, Race } from '../constants/enums.ts';
import { BASE_DEFENDER, BUILD_RUNNER_SCOUT, GATHERING, PERSISTENT_BUILDER } from '../constants/unit-role.ts';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import { resolveTarget, scoutWaypoints } from '../utils/build-order/targets.ts';
import { NodeSC2Error } from '../engine/errors.ts';
import { builderPlugin, taskFunctions } from './builder-plugin.ts';
import createSystem from './create-system.ts';
import type {
    BuildOrderStep,
    BuildTaskI,
    CommandResult,
    EventReader,
    OpeningDefinition,
    System,
    World,
} from '../types.ts';

const BARRACKS_TAGS = ['4352638978', '4350541825'];
const REFINERY_TAG = '4351590401';
const MINER_TAG = '4345561089';

async function stepCommands(
    world: TestWorld,
    gameLoop: number,
    edits: Record<string, SC2APIProtocol.Unit> = {},
    added: SC2APIProtocol.Unit[] = [],
    playerCommon: SC2APIProtocol.PlayerCommon = {},
) {
    const next = structuredClone(world.client.fixture.observations[896]);
    next.observation!.gameLoop = gameLoop;
    Object.assign(next.observation!.playerCommon!, playerCommon);
    next.observation!.rawData!.units = [
        ...next.observation!.rawData!.units!.map((raw) => ({ ...raw, ...edits[raw.tag!] })),
        ...added,
    ];
    const before = world.client.sent.actions.length;
    await stepTo(world, next);
    return world.client.sent.actions
        .slice(before)
        .flatMap((request) => request.actions!.map((action) => action.actionRaw!.unitCommand!));
}

async function stepAt(world: TestWorld, gameLoop: number, edits: Record<string, SC2APIProtocol.Unit> = {}) {
    return (await stepCommands(world, gameLoop, edits)).map(({ abilityId }) => abilityId);
}

function commandResults(world: TestWorld) {
    const { events } = world.resources.get();
    const reader = events.createReader();
    return () =>
        events
            .read(reader)
            .filter(({ name }) => name === 'commandResults')
            .flatMap(({ data }) => data as CommandResult[])
            .filter(({ owner }) => owner === `role:${BUILD_RUNNER_SCOUT}`)
            .map(({ command }) => command);
}

function buildSystem(buildOrder: System['buildOrder'], buildOptions?: System['buildOptions']) {
    const results: BuildResult[] = [];
    const statuses: BuildTaskI['status'][] = [];
    const system = createSystem({
        name: 'Opener',
        type: 'build',
        buildOrder,
        buildOptions,
        async onStep(_world: World, _gameLoop: number, task?: BuildTaskI, result?: BuildResult) {
            results.push(result!);
            statuses.push(task?.status);
        },
    });
    return { system, results, statuses };
}

describe('builderPlugin', () => {
    it('parses string steps mixed in any order with plain tasks and pairs, then fills supply gaps with worker tasks, counting a plain task at the running supply and a train task with several unit types at the supply of the costliest', async () => {
        const world = await createTestWorld('blueshift');
        const { train, build } = taskFunctions;
        const system = {
            state: {},
            setState(this: { state: object }, newState: object) {
                this.state = { ...this.state, ...newState };
            },
            buildOrder: [build(UnitType.BARRACKS), [12, train([UnitType.MARINE, UnitType.MARAUDER])], '15 supply'],
        } as unknown as EventReader<System>;
        builderPlugin(system);

        await system.onGameStart!(world);

        const [buildOrderKey] = Object.getOwnPropertySymbols(system.state);
        const runtime = { touched: false, status: BuildOrder.NOT_STARTED, started: null, earmarked: false };
        expect(system.state[buildOrderKey]).toEqual([
            { type: 'build', id: UnitType.BARRACKS, qty: 1, opts: {}, index: 0, supply: null, ...runtime },
            {
                type: 'train',
                id: [UnitType.MARINE, UnitType.MARAUDER],
                qty: 1,
                opts: {},
                index: 1,
                supply: null,
                ...runtime,
            },
            { type: 'worker', qty: 1, index: 2, supply: 15, ...runtime },
            { type: 'build', id: UnitType.SUPPLYDEPOT, qty: 1, opts: {}, index: 3, supply: null, ...runtime },
        ]);
    });

    it('calls a build system onStep with (world, gameLoop, task, result), keeping an earmark until the tracker sends BUILD and resetting a given build command after 250 loops only once nothing is pending', async () => {
        const received: unknown[][] = [];
        const agent = createAgent();
        agent.use(
            createSystem({
                name: 'SkippingOpener',
                type: 'build',
                defaultOptions: { state: { skipMarines: true } },
                buildOptions: { earmarks: 4 },
                buildOrder: [
                    taskFunctions.train(UnitType.MARINE, 1, { skip: 'skipMarines' }),
                    taskFunctions.build(UnitType.SUPPLYDEPOT),
                ],
                async onStep(world: World, gameLoop: number, task?: BuildTaskI, result?: BuildResult) {
                    received.push([world, gameLoop, task && { ...task }, result]);
                },
            }),
        );
        const world = await createTestWorld('blueshift', { agent, loop: 896 });
        const { buildings } = world.resources.get();
        const earmarks = () =>
            world.data.get('earmarks').map(({ name }: { name: string }) => name.replace(/^build\d+:/, ''));

        expect(received).toEqual([
            [
                world,
                896,
                {
                    type: 'train',
                    id: UnitType.MARINE,
                    qty: 1,
                    opts: { skip: 'skipMarines' },
                    index: 0,
                    touched: false,
                    supply: null,
                    status: BuildOrder.SKIPPED,
                    started: null,
                    earmarked: false,
                },
                BuildResult.SKIPPED,
            ],
        ]);

        world.data.addEarmark({ name: 'saving', minerals: 4800, vespene: 0 });
        await stepAt(world, 900);
        await stepAt(world, 904);
        world.data.settleEarmark('saving');
        await stepAt(world, 908);
        expect(earmarks()).toEqual(['task1']);

        const { workerTag, target } = buildings.getTracked()[0];
        const inRange = { [workerTag!]: { pos: { ...target, z: 12 }, orders: [] } };
        spyOn(world.client, 'action').mockImplementationOnce(async (request) => {
            world.client.sent.actions.push(request);
            return { result: (request.actions ?? []).map(() => 2 as SC2APIProtocol.ActionResult) };
        });
        expect([await stepAt(world, 912, inRange), earmarks()]).toEqual([[Ability.BUILD_SUPPLYDEPOT], ['task1']]);
        expect([await stepAt(world, 916, inRange), earmarks()]).toEqual([[Ability.BUILD_SUPPLYDEPOT], []]);

        await stepAt(world, 908 + 250);
        buildings.cancel(buildings.getTracked()[0]);
        await stepAt(world, 908 + 251);
        expect(
            received
                .slice(1)
                .map(([, gameLoop, task, result]) => [
                    gameLoop,
                    (task as BuildTaskI).status,
                    (task as { commanded?: number }).commanded,
                    (task as BuildTaskI).earmarked,
                    result,
                ]),
        ).toEqual([
            [900, BuildOrder.NOT_STARTED, undefined, false, BuildResult.CANNOT_SATISFY],
            [904, BuildOrder.NOT_STARTED, undefined, true, BuildResult.CANNOT_SATISFY],
            [908, BuildOrder.COMMAND_GIVEN, 908, true, BuildResult.COMMAND_SENT],
            [912, BuildOrder.COMMAND_GIVEN, 908, true, BuildResult.CANNOT_SATISFY],
            [916, BuildOrder.COMMAND_GIVEN, 908, true, BuildResult.CANNOT_SATISFY],
            [908 + 250, BuildOrder.COMMAND_GIVEN, 908, true, BuildResult.CANNOT_SATISFY],
            [908 + 251, BuildOrder.COMMAND_GIVEN, 908 + 251, true, BuildResult.COMMAND_SENT],
        ]);
    });

    it('earmarks a morph task at its net cost, keeps the earmark while every producer is busy and settles it when the train is sent', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        world.data.addEarmark({ name: 'saving', minerals: 4800, vespene: 0 });
        world.agent.use(
            createSystem({
                name: 'Morph',
                type: 'build',
                buildOptions: { earmarks: 1 },
                buildOrder: [taskFunctions.train(UnitType.ORBITALCOMMAND)],
            }),
        );
        await stepAt(world, 900);
        await stepAt(world, 904);

        expect(world.data.get('earmarks')).toEqual([
            { name: 'saving', minerals: 4800, vespene: 0 },
            { name: expect.stringMatching(/task0$/), minerals: 150, vespene: 0 },
        ]);

        world.data.settleEarmark('saving');
        const tech = (orders: SC2APIProtocol.UnitOrder[]) => [
            rawUnit({ tag: 'rax', unitType: UnitType.BARRACKS, pos: { x: 40, y: 40, z: 10 } }),
            rawUnit({ tag: 'cc', unitType: UnitType.COMMANDCENTER, pos: { x: 60, y: 40, z: 10 }, orders }),
        ];
        const training = [{ abilityId: Ability.TRAIN_SCV }];
        const busyCc = Object.fromEntries(
            world.resources
                .get()
                .units.getById(UnitType.COMMANDCENTER)
                .map(({ tag }) => [tag!, { orders: training }]),
        );
        const busy = await stepCommands(world, 908, busyCc, tech(training));
        const busyEarmarks = world.data.get('earmarks');
        const sent = await stepCommands(world, 912, {}, tech([]));
        expect([busy, busyEarmarks, sent.map(({ abilityId }) => abilityId), world.data.get('earmarks')]).toEqual([
            [],
            [{ name: expect.stringMatching(/task0$/), minerals: 150, vespene: 0 }],
            [Ability.MORPH_ORBITALCOMMAND],
            [],
        ]);
    });

    it('earmarks an ability task at the net cost of the unit it creates while a caster exists (by ability data or availability), holds it while unaffordable, settles it when the ability is sent or no caster is left (addon hosts all holding an addon), and never earmarks zero-cost abilities', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        world.data.addEarmark({ name: 'saving', minerals: 4900, vespene: 0 });
        const unearmarked = [
            taskFunctions.ability(Ability.MORPH_ZERGLING),
            taskFunctions.ability(Ability.BUILD_REACTOR_STARPORT, { on: UnitType.BARRACKS }),
        ].map((task, i) =>
            createSystem({
                name: `AbilityUnearmarked${i}`,
                type: 'build',
                buildOptions: { earmarks: 1 },
                buildOrder: [task],
            }),
        );
        for (const system of unearmarked) world.agent.use(system);
        await stepAt(world, 900);
        await stepAt(world, 904);
        expect(world.data.get('earmarks')).toEqual([{ name: 'saving', minerals: 4900, vespene: 0 }]);
        for (const system of unearmarked) system._system.pause();

        const rejected = spyOn(world.resources.get().actions, 'do').mockRejectedValue(new Error('rejected'));
        const staleAbilityData = spyOn(world.data, 'findUnitTypesWithAbility').mockReturnValue([]);
        world.agent.use(
            createSystem({
                name: 'AbilityMorph',
                type: 'build',
                buildOptions: { earmarks: 1 },
                buildOrder: [taskFunctions.ability(Ability.MORPH_ORBITALCOMMAND, { on: UnitType.COMMANDCENTER })],
            }),
        );
        await stepAt(world, 908);
        await stepAt(world, 912);
        const pending = world.data.get('earmarks');

        world.data.settleEarmark('saving');
        await stepCommands(world, 916, {}, [], { minerals: 100 });
        const attempts = rejected.mock.calls.length;

        await stepAt(world, 920);
        const afterRejected = world.data.get('earmarks');

        rejected.mockRestore();
        const sent = await stepAt(world, 924);
        staleAbilityData.mockRestore();
        const orbitalEarmark = { name: expect.stringMatching(/task0$/), minerals: 150, vespene: 0 };
        expect([
            pending,
            attempts,
            afterRejected,
            sent.includes(Ability.MORPH_ORBITALCOMMAND),
            world.data.get('earmarks'),
        ]).toEqual([[{ name: 'saving', minerals: 4900, vespene: 0 }, orbitalEarmark], 1, [orbitalEarmark], true, []]);

        world.data.addEarmark({ name: 'saving', minerals: 4815, vespene: 0 });
        world.agent.use(
            createSystem({
                name: 'AbilityAddon',
                type: 'build',
                buildOptions: { earmarks: 1 },
                buildOrder: [taskFunctions.ability(Ability.BUILD_REACTOR)],
            }),
        );
        await stepAt(world, 928);
        await stepAt(world, 932);
        const addonPending = world.data.get('earmarks');
        await stepAt(world, 936, { [BARRACKS_TAGS[0]]: { addOnTag: 'addon' } });
        expect([addonPending, world.data.get('earmarks')]).toEqual([
            [
                { name: 'saving', minerals: 4815, vespene: 0 },
                { name: expect.stringMatching(/task0$/), minerals: 50, vespene: 50 },
            ],
            [{ name: 'saving', minerals: 4815, vespene: 0 }],
        ]);
    });

    it('finds ability casters from generated unit abilities and remaps without `on`, sends generic and specific addon tasks through the specific ids SC2 reports, settles the earmark of a dead stale ability, and falls back to the stale map before ability data loads', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { data } = world;
        const addonHosts = [
            UnitType.BARRACKS,
            UnitType.FACTORY,
            UnitType.STARPORT,
            UnitType.FACTORYFLYING,
            UnitType.STARPORTFLYING,
            UnitType.BARRACKSFLYING,
        ];
        expect([
            data.findUnitTypesWithAbility(Ability.RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL1),
            data.findUnitTypesWithAbility(Ability.BUILD_LURKERDEN),
            data.findUnitTypesWithAbility(Ability.BUILD_TECHLAB_BARRACKS),
            data.findUnitTypesWithAbility(Ability.MORPH_LURKERDEN),
            data.findUnitTypesWithAbility(Ability.BUILD_TECHLAB),
            data.findUnitTypesWithAbility(Ability.LIFT),
            data.findUnitTypesWithAbility(Ability.RESEARCH_BANSHEECLOAKINGFIELD),
            data.findUnitTypesWithAbility(Ability.EFFECT_MASSRECALL),
            data.findUnitTypesWithAbility(Ability.EFFECT_STIM),
        ]).toEqual([
            [UnitType.ARMORY],
            [UnitType.DRONE],
            [UnitType.BARRACKS, UnitType.BARRACKSFLYING],
            [],
            addonHosts,
            [UnitType.COMMANDCENTER, UnitType.BARRACKS, UnitType.FACTORY, UnitType.STARPORT, UnitType.ORBITALCOMMAND],
            [UnitType.STARPORTTECHLAB],
            [UnitType.MOTHERSHIP, UnitType.NEXUS, UnitType.MOTHERSHIPCORE],
            [UnitType.BUNKER, UnitType.MARINE, UnitType.MARAUDER],
        ]);

        world.client.fixture.abilities![896][BARRACKS_TAGS[1]] = [
            Ability.BUILD_REACTOR_BARRACKS,
            Ability.BUILD_TECHLAB_BARRACKS,
        ];
        world.agent.use(
            createSystem({
                name: 'GenericReactor',
                type: 'build',
                buildOrder: [taskFunctions.ability(Ability.BUILD_REACTOR)],
            }),
        );
        const idleBarracks = { [BARRACKS_TAGS[1]]: { addOnTag: '0' } };
        expect([await stepAt(world, 900, idleBarracks), await stepAt(world, 904, idleBarracks)]).toEqual([
            [Ability.BUILD_REACTOR],
            [],
        ]);

        world.agent.use(
            createSystem({
                name: 'SpecificReactor',
                type: 'build',
                buildOrder: [taskFunctions.ability(Ability.BUILD_REACTOR_BARRACKS)],
            }),
        );
        expect(await stepCommands(world, 906, idleBarracks)).toEqual([
            { abilityId: Ability.BUILD_REACTOR_BARRACKS, queueCommand: false, unitTags: [BARRACKS_TAGS[1]] },
        ]);

        const den = rawUnit({ tag: 'den', unitType: UnitType.HYDRALISKDEN, pos: { x: 40, y: 40, z: 10 } });
        world.agent.use(
            createSystem({
                name: 'DeadMorph',
                type: 'build',
                buildOptions: { earmarks: 1 },
                buildOrder: [taskFunctions.ability(Ability.MORPH_LURKERDEN)],
            }),
        );
        await stepCommands(world, 908, {}, [den]);
        await stepCommands(world, 912, {}, [den]);
        expect(world.data.get('earmarks')).toEqual([]);

        data.set('abilities', null);
        expect<unknown[]>([
            data.findUnitTypesWithAbility(Ability.MORPH_LURKERDEN),
            data.getAbilityData(Ability.BUILD_REACTOR),
        ]).toEqual([[UnitType.HYDRALISKDEN], undefined]);
    });

    it('hands T/P structures to the tracker with solver flags or near base without queries, a target as its base, proxy or townhall spot, a placer result first, gas tracked, findPlacement without a solver spot', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { build } = taskFunctions;
        const { actions, buildings, map, placement, units } = world.resources.get();
        const request = spyOn(placement, 'request');
        const placementQueries = () =>
            world.client.sent.queries.filter((query) => query.placements?.length || query.pathing?.length).length;
        const trackedTypes = () => buildings.getTracked().map(({ unitType }) => unitType);
        let gameLoop = 896;
        const run = (task: BuildTaskI | BuildOrderStep, added: SC2APIProtocol.Unit[] = []) => {
            world.agent.use(createSystem({ name: `Build${gameLoop}`, type: 'build', buildOrder: [task] }));
            gameLoop += 4;
            return stepCommands(world, gameLoop, {}, added).then((commands) =>
                commands.map(({ abilityId }) => abilityId),
            );
        };
        const earmarks = () =>
            world.data.get('earmarks').map(({ name }: { name: string }) => name.replace(/^build\d+:/, ''));
        const runEarmarked = async (task: BuildTaskI) => {
            world.data.addEarmark({ name: 'saving', minerals: 4800, vespene: 0 });
            const system = createSystem({
                name: `Build${gameLoop}`,
                type: 'build',
                buildOptions: { earmarks: 1 },
                buildOrder: [task],
            });
            world.agent.use(system);
            await stepAt(world, (gameLoop += 4));
            await stepAt(world, (gameLoop += 4));
            const earmarked = earmarks();
            world.data.settleEarmark('saving');
            const commands = await stepAt(world, (gameLoop += 4));
            // every system's first task earmarks as `task0`, so a retrying one would settle the next run's earmark
            system._system.pause();
            return { commands, earmarks: [earmarked, earmarks()] };
        };
        const [cc] = units.getById(UnitType.COMMANDCENTER);

        await run(build(UnitType.SUPPLYDEPOT));
        await run(build(UnitType.BARRACKS, 1, { near: UnitType.COMMANDCENTER }));
        await run(build(UnitType.REFINERY));
        expect([placementQueries(), trackedTypes()]).toEqual([
            0,
            [UnitType.SUPPLYDEPOT, UnitType.BARRACKS, UnitType.REFINERY],
        ]);

        const proxy = { x: 120.5, y: 40.5 };
        const findPlacement = spyOn(actions, 'findPlacement').mockResolvedValueOnce(proxy);
        await run('12 barracks @nat');
        await run('12 barracks @enemy_nat');
        await run('12 expand @nat');
        expect([
            findPlacement.mock.calls,
            buildings
                .getTracked()
                .slice(4)
                .map(({ unitType, target }) => [unitType, target]),
        ]).toEqual([
            [[UnitType.BARRACKS, map.getEnemyNatural()!.townhallPosition]],
            [
                [UnitType.BARRACKS, proxy],
                [UnitType.COMMANDCENTER, map.getNatural()!.townhallPosition],
            ],
        ]);

        request.mockReturnValueOnce(undefined);
        const fallback = await runEarmarked(build(UnitType.SUPPLYDEPOT));
        expect([
            fallback.commands.includes(Ability.BUILD_SUPPLYDEPOT),
            fallback.earmarks,
            placementQueries() > 0,
            trackedTypes().length,
        ]).toEqual([true, [['saving', 'task0'], []], true, 6]);

        const settled = [(await runEarmarked(build(UnitType.REFINERY))).earmarks];
        const [first, second] = map.getAvailableExpansions().map((candidate) => candidate.townhallPosition);
        const guard = rawUnit({
            tag: '9301',
            unitType: UnitType.ZERGLING,
            alliance: Alliance.ENEMY,
            pos: { x: first.x + 3, y: first.y, z: 10 },
        });
        const pendingTownhalls = buildings.pending(UnitType.COMMANDCENTER);
        await run(build(UnitType.COMMANDCENTER), [guard]);
        expect([buildings.pending(UnitType.COMMANDCENTER) - pendingTownhalls, buildings.getTracked().at(-1)]).toEqual([
            1,
            expect.objectContaining({ unitType: UnitType.COMMANDCENTER, target: second }),
        ]);

        const placed = { x: 40.5, y: 40.5 };
        world.resources.set({ placer: { place: () => [placed] } });
        spyOn(actions, 'canPlace').mockResolvedValue(placed);
        await run(build(UnitType.ENGINEERINGBAY));
        expect(buildings.getTracked().at(-1)).toMatchObject({ unitType: UnitType.ENGINEERINGBAY, target: placed });
        spyOn(buildings, 'build').mockReturnValueOnce(undefined);
        settled.push((await runEarmarked(build(UnitType.ENGINEERINGBAY))).earmarks);
        expect(settled).toEqual(Array(2).fill([['saving', 'task0'], []]));

        world.resources.set({ placer: undefined });
        world.agent.race = Race.PROTOSS;
        await run(build(UnitType.GATEWAY));
        expect(request.mock.calls).toEqual([
            [UnitType.SUPPLYDEPOT, { flags: ['supplyDepot'] }],
            [UnitType.BARRACKS, { base: cc.pos, closestTo: cc.pos, flags: ['production'] }],
            [UnitType.BARRACKS, { base: map.getNatural()!.townhallPosition }],
            [UnitType.SUPPLYDEPOT, { flags: ['supplyDepot'] }],
            [UnitType.GATEWAY, { powered: true }],
        ]);
    });

    it('without fillWorkers holds an unstarted step until supply used reaches its supply, adding no worker tasks, while a started step still completes or resets after 250 loops when supply drops', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings } = world.resources.get();
        const { system, results, statuses } = buildSystem(['17 marine', '17 supply', '17 supply'], {
            fillWorkers: false,
        });
        world.agent.use(system);
        const depot = [rawUnit({ unitType: UnitType.SUPPLYDEPOT, buildProgress: 0.1, pos: { x: 60, y: 60, z: 10 } })];

        const commands = [
            await stepCommands(world, 900, {}, [], { foodUsed: 16 }),
            await stepCommands(world, 904, {}, [], { foodUsed: 17 }),
        ];
        await stepCommands(world, 908, {}, [], { foodUsed: 17 });
        await stepCommands(world, 912, {}, depot, { foodUsed: 16 });
        await stepCommands(world, 916, {}, depot, { foodUsed: 17 });
        buildings.getTracked().forEach((build) => buildings.cancel(build));
        await stepCommands(world, 916 + 250, {}, [], { foodUsed: 16 });
        expect([commands.map((step) => step.map(({ abilityId }) => abilityId)), results, statuses]).toEqual([
            [[], [Ability.TRAIN_MARINE]],
            [
                BuildResult.CANNOT_SATISFY,
                BuildResult.SUCCESS,
                BuildResult.COMMAND_SENT,
                BuildResult.SUCCESS,
                BuildResult.COMMAND_SENT,
                BuildResult.CANNOT_SATISFY,
            ],
            [
                BuildOrder.NOT_STARTED,
                BuildOrder.COMPLETE,
                BuildOrder.COMMAND_GIVEN,
                BuildOrder.COMPLETE,
                BuildOrder.COMMAND_GIVEN,
                BuildOrder.NOT_STARTED,
            ],
        ]);

        const beforeDelay = world.data.get('earmarks');
        await stepCommands(world, 916 + 1250, {}, [], { foodUsed: 17, minerals: 0 });

        expect([
            beforeDelay,
            world.data
                .get('earmarks')
                .map(({ name, ...cost }: { name: string }) => [name.replace(/^build\d+:/, ''), cost]),
        ]).toEqual([[], [['task2', { minerals: 100, vespene: 0 }]]]);
    });

    it('trains a unit with a target at the producer closest to it', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        world.agent.use(buildSystem(['12 marine @nat']).system);
        const nat = resolveTarget(world, NAT);

        const commands = await stepCommands(world, 900, {
            [BARRACKS_TAGS[0]]: { buildProgress: 1 },
            [BARRACKS_TAGS[1]]: { pos: { ...nat, z: 10 } },
        });

        expect(commands).toEqual([
            { abilityId: Ability.TRAIN_MARINE, unitTags: [BARRACKS_TAGS[1]], queueCommand: false },
        ]);
    });

    it('sends a worker scout as BUILD_RUNNER_SCOUT: the closest mineral worker with mining off, returning cargo before queued moves; mining picks it when on, and none cannot satisfy', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { map, mining, roles, units } = world.resources.get();
        const scoutCommands = commandResults(world);
        const expected = (tag: string, returning: boolean) => [
            ...(returning ? [{ abilityId: Ability.HARVEST_RETURN, unitTags: [tag] }] : []),
            ...scoutWaypoints(world, [ENEMY_SPAWN]).map((targetWorldSpacePos, i) => ({
                abilityId: Ability.MOVE,
                unitTags: [tag],
                targetWorldSpacePos,
                queueCommand: returning || i > 0,
            })),
        ];
        const main = map.getMain()!.townhallPosition;
        const off = buildSystem(['12 worker_scout']);
        world.agent.use(off.system);

        await stepCommands(world, 900, {
            [MINER_TAG]: { pos: { x: main.x, y: main.y - 2, z: 10 }, buffIds: [CARRYMINERALFIELDMINERALS] },
        });
        expect([scoutCommands(), roles.roleOf(MINER_TAG), off.results]).toEqual([
            expected(MINER_TAG, true),
            BUILD_RUNNER_SCOUT,
            [BuildResult.SUCCESS],
        ]);

        mining.configure({ enabled: true });
        const picked = units.getMineralWorkers().find((worker) => worker.tag !== MINER_TAG)!;
        const selectWorker = spyOn(mining, 'selectWorker').mockReturnValueOnce(undefined).mockReturnValueOnce(picked);
        const on = buildSystem([taskFunctions.scout('worker')]);
        world.agent.use(on.system);
        await stepCommands(world, 904);
        await stepCommands(world, 908);
        expect([selectWorker.mock.calls, on.results, scoutCommands()]).toEqual([
            [
                [main, { role: BUILD_RUNNER_SCOUT }],
                [main, { role: BUILD_RUNNER_SCOUT }],
            ],
            [BuildResult.CANNOT_SATISFY, BuildResult.SUCCESS],
            expected(picked.tag, false),
        ]);
    });

    it('sends the first overlord without the scout role to the waypoints', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const overlords = [rawUnit({ unitType: UnitType.OVERLORD }), rawUnit({ unitType: UnitType.OVERLORD })];
        await stepCommands(world, 900, {}, overlords);
        world.resources.get().roles.assign(overlords[0].tag, BUILD_RUNNER_SCOUT);
        const scoutCommands = commandResults(world);
        world.agent.use(buildSystem([taskFunctions.scout('overlord')]).system);

        await stepCommands(world, 904, {}, overlords);

        expect(scoutCommands()).toEqual([
            {
                abilityId: Ability.MOVE,
                unitTags: [overlords[1].tag],
                targetWorldSpacePos: resolveTarget(world, ENEMY_NAT_VISION),
                queueCommand: false,
            },
        ]);
    });

    it('cancels only the gas building on CANCEL_GAS', async () => {
        const cancellable = [BARRACKS_TAGS[0], REFINERY_TAG];
        const world = await createTestWorld('blueshift', {
            loop: 896,
            onQuery: (query) =>
                query.abilities?.length
                    ? {
                          abilities: query.abilities.map(({ unitTag }) => ({
                              unitTag,
                              abilities: cancellable.includes(unitTag!)
                                  ? [{ abilityId: Ability.CANCEL_BUILDINPROGRESS }]
                                  : [],
                          })),
                      }
                    : undefined,
        });
        const inProgress = Object.fromEntries(cancellable.map((tag) => [tag, { buildProgress: 0.5 }]));
        await stepCommands(world, 900, inProgress);
        world.agent.use(buildSystem(['12 cancel_gas']).system);

        expect(await stepCommands(world, 904, inProgress)).toEqual([
            { abilityId: Ability.CANCEL_BUILDINPROGRESS, unitTags: [REFINERY_TAG], queueCommand: false },
        ]);
    });

    it('swaps addons through the flying resource, cannot satisfy until it accepts', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const addonSwap = spyOn(world.resources.get().flying, 'addonSwap')
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        const { system, results } = buildSystem([taskFunctions.addonSwap(UnitType.FACTORY, UnitType.BARRACKSREACTOR)]);
        world.agent.use(system);

        await stepCommands(world, 900);
        await stepCommands(world, 904);

        expect([addonSwap.mock.calls, results]).toEqual([
            [
                [UnitType.FACTORY, UnitType.BARRACKSREACTOR],
                [UnitType.FACTORY, UnitType.BARRACKSREACTOR],
            ],
            [BuildResult.CANNOT_SATISFY, BuildResult.SUCCESS],
        ]);
    });

    describe('openings', () => {
        const { build, train } = taskFunctions;
        const opening = (buildOrder: OpeningDefinition['buildOrder'], rest: Partial<OpeningDefinition> = {}) => ({
            buildOrder,
            ...rest,
        });

        async function start(world: World, props: Partial<System>) {
            const system = {
                state: {},
                setState(this: { state: object }, newState: object) {
                    this.state = { ...this.state, ...newState };
                },
                ...props,
            } as unknown as EventReader<System>;
            builderPlugin(system);
            const started = system.onGameStart!(world);
            const tasks = () =>
                (system.state[Object.getOwnPropertySymbols(system.state)[0]] as BuildTaskI[]).map(({ type, id }) => [
                    type,
                    id,
                ]);
            return { system, started, tasks };
        }

        it('picks the opening from the blueprint, a function, a config, or choose(), recording every pick, ignoring buildOrder, and throws NodeSC2Error for an unknown or missing name', async () => {
            const world = await createTestWorld('blueshift');
            const warn = spyOn(console, 'warn').mockImplementation(() => {});
            const { openings } = world.resources.get();
            const a = opening([build(UnitType.BARRACKS)]);
            const b = opening([build(UnitType.FACTORY)]);
            const picked = async (props: Partial<System>) => {
                world.resources.reset(world);
                const run = await start(world, props);
                await run.started;
                return [run.tasks(), run.system.getOpening!(), openings.getChosen()];
            };

            expect(await picked({ openings: { a, b }, opening: 'b', buildOrder: [build(UnitType.STARPORT)] })).toEqual([
                [['build', UnitType.FACTORY]],
                'b',
                'b',
            ]);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(await picked({ openings: { a, b }, opening: (w) => (w === world ? 'a' : 'b') })).toEqual([
                [['build', UnitType.BARRACKS]],
                'a',
                'a',
            ]);

            openings.configure({ builds: { b, a } });
            expect(await picked({ openings: 'config' })).toEqual([[['build', UnitType.FACTORY]], 'b', 'b']);

            await expect(start(world, { openings: { a }, opening: 'nope' }).then((run) => run.started)).rejects.toThrow(
                NodeSC2Error,
            );
            await expect(start(world, { openings: {} }).then((run) => run.started)).rejects.toThrow(NodeSC2Error);
        });

        it('runs the new opening after a switch even when the previous one had completed', async () => {
            const world = await createTestWorld('blueshift', { loop: 896 });
            let completions = 0;
            world.agent.use(
                createSystem({
                    name: 'Opener',
                    type: 'build',
                    openings: { done: opening([]), next: opening([train(UnitType.MARINE)]) },
                    opening: 'done',
                    buildComplete: async () => {
                        completions += 1;
                    },
                }),
            );
            const idle = await stepAt(world, 900);
            const system = world.agent.systems.find(({ name }) => name === 'OpenerWrapper' || name === 'Opener') as {
                _system?: System;
            };
            system._system!.switchOpening!('next', { removeCompleted: false });

            const trained = await stepAt(world, 904);
            await stepAt(world, 908);

            expect([idle, trained, completions]).toEqual([[], [Ability.TRAIN_MARINE], 2]);
        });

        it('sets fillWorkers false only while the current opening has constantWorkerProductionTill above 0, re-applying it on switch', async () => {
            const world = await createTestWorld('blueshift');
            const orders = [build(UnitType.BARRACKS)];
            const { system, started } = await start(world, {
                openings: { gate: opening(orders, { constantWorkerProductionTill: 20 }), fill: opening(orders) },
                opening: 'gate',
            });
            await started;
            const fill = () => system.buildOptions!.fillWorkers;

            const seen = [fill()];
            system.switchOpening!('fill');
            seen.push(fill());
            system.switchOpening!('gate');
            seen.push(fill());

            expect(seen).toEqual([false, undefined, false]);
        });

        it('names earmarks per build system: two systems earmarking task 0 keep both, one spending leaves the other, and switchOpening settles only its own', async () => {
            const world = await createTestWorld('blueshift', { loop: 896 });
            const earmarks = () => world.data.get('earmarks').map(({ name }: { name: string }) => name);
            const upgrading = (id: number) =>
                start(world, {
                    openings: {
                        first: opening([taskFunctions.upgrade(id)]),
                        second: opening([build(UnitType.BARRACKS)]),
                    },
                    opening: 'first',
                    buildOptions: { earmarks: 1 },
                });
            const earmarkBoth = async () => {
                const a = await upgrading(Upgrade.STIMPACK);
                const b = await upgrading(Upgrade.SHIELDWALL);
                await Promise.all([a.started, b.started]);
                world.data.addEarmark({ name: 'saving', minerals: 4750, vespene: 0 });
                for (const { system } of [a, b]) {
                    await system.onStep!(world, 900);
                    await system.onStep!(world, 901);
                }
                return { a, b, both: earmarks().filter((name: string) => name !== 'saving') };
            };

            const first = await earmarkBoth();
            first.a.system.switchOpening!('second');
            const afterSwitch = earmarks().filter((name: string) => name !== 'saving');

            world.data.get('earmarks').length = 0;
            const second = await earmarkBoth();
            world.data.settleEarmark('saving');
            await second.a.system.onStep!(world, 902);

            expect([first.both.length, afterSwitch, second.both.length, earmarks()]).toEqual([
                2,
                [first.both[1]],
                2,
                [second.both[1]],
            ]);
        });

        it('switchOpening drops steps already present (seeded townhall, overlord, worker; unfinished structures count), scouts, chrono and pending upgrades, counts pending builds, re-indexes, settles the old earmarks, resets the persistent builder, keeps all without removeCompleted, and is a no-op for the current opening', async () => {
            const world = await createTestWorld('blueshift', { loop: 896 });
            const { roles } = world.resources.get();
            const second = opening([
                '14 supply',
                '16 barracks',
                '17 barracks',
                '18 barracks',
                '19 worker_scout',
                [20, taskFunctions.ability(Ability.EFFECT_CHRONOBOOSTENERGYCOST)],
                [20, build(UnitType.COMMANDCENTER)],
                [20, train(UnitType.MARINE)],
                [20, train(UnitType.MARINE)],
                [20, train(UnitType.MARINE)],
                [20, train(UnitType.MARINE)],
                [20, train(UnitType.OVERLORD)],
                [20, taskFunctions.upgrade(Upgrade.STIMPACK)],
                [20, taskFunctions.upgrade(Upgrade.SHIELDWALL)],
            ]);
            spyOn(world.resources.get().buildings, 'pending').mockImplementation((id) =>
                id === UnitType.BARRACKS ? 1 : 0,
            );
            spyOn(world.agent, 'alreadyPendingUpgrade').mockImplementation((id) => (id === Upgrade.STIMPACK ? 0.5 : 0));
            world.data.addEarmark({ name: 'saving', minerals: 4800, vespene: 0 });
            await stepCommands(world, 897, {}, [rawUnit({ unitType: UnitType.OVERLORD })]);
            const { system, started, tasks } = await start(world, {
                openings: { first: opening([build(UnitType.SUPPLYDEPOT)]), second },
                opening: 'first',
                buildOptions: { earmarks: 1 },
            });
            await started;
            await system.onStep!(world, 900);
            await system.onStep!(world, 901);
            const earmarks = () =>
                world.data.get('earmarks').map(({ name }: { name: string }) => name.replace(/^build\d+:/, ''));
            const earmarked = earmarks();
            const [builder] = roles.getTags(PERSISTENT_BUILDER);
            const initial = system.state;

            system.switchOpening!('first');
            expect(system.state).toBe(initial);

            system.switchOpening!('second');
            const kept = tasks();
            const indices = (system.state[Object.getOwnPropertySymbols(system.state)[0]] as BuildTaskI[]).map(
                ({ index }) => index,
            );
            const switched = [earmarks(), roles.roleOf(builder)];
            await system.onStep!(world, 902);
            const repicked = roles.getTags(PERSISTENT_BUILDER).size;
            system.switchOpening!('first');
            system.switchOpening!('second', { removeCompleted: false });

            expect([kept, indices, earmarked, switched, repicked, tasks().length]).toEqual([
                [
                    ...Array(8).fill(['worker', undefined]),
                    ['build', UnitType.COMMANDCENTER],
                    ['train', UnitType.MARINE],
                    ['train', UnitType.OVERLORD],
                    ['upgrade', Upgrade.SHIELDWALL],
                ],
                kept.map((_, index) => index),
                ['saving', 'task0'],
                [['saving'], GATHERING],
                1,
                22,
            ]);
        });

        it('trains workers up to the till value on an idle ready townhall while supply is left and affordable, holding it for a townhall morph that is current after the step unless orbital tech is under 0.95', async () => {
            const barracksDone = { [BARRACKS_TAGS[0]]: { buildProgress: 1 } };
            const barracksUnfinished = { [BARRACKS_TAGS[1]]: { buildProgress: 0.5 } };
            const abilities = async (
                steps: OpeningDefinition['buildOrder'],
                { till = 20, foodUsed = 16, foodCap = 23, minerals = 4815, edits = {} as Record<string, object> },
            ) => {
                const world = await createTestWorld('blueshift', {
                    loop: 896,
                    onQuery: (query) =>
                        query.abilities?.length
                            ? { abilities: query.abilities.map(({ unitTag }) => ({ unitTag, abilities: [] })) }
                            : undefined,
                });
                world.agent.use(
                    createSystem({
                        name: 'Opener',
                        type: 'build',
                        openings: { a: { buildOrder: steps, constantWorkerProductionTill: till } },
                        opening: 'a',
                    }),
                );
                const commands = await stepCommands(world, 900, edits, [], { foodUsed, foodCap, minerals });
                return commands.some(({ abilityId }) => abilityId === Ability.TRAIN_SCV);
            };

            expect([
                await abilities(['100 barracks'], {}),
                await abilities(['100 barracks'], { till: 13 }),
                await abilities(['100 barracks'], { foodUsed: 23 }),
                await abilities(['100 barracks'], { minerals: 0 }),
                await abilities(['14 orbital'], { foodUsed: 13, edits: barracksDone }),
                await abilities(['14 orbital'], { foodUsed: 14, edits: barracksDone }),
                await abilities(['14 orbital'], { foodUsed: 14, edits: barracksUnfinished }),
                await abilities(['14 worker_scout', '14 orbital'], { foodUsed: 14, edits: barracksDone }),
                await abilities([[14, taskFunctions.ability(Ability.MORPH_PLANETARYFORTRESS)]], { foodUsed: 14 }),
            ]).toEqual([true, false, false, false, true, false, true, false, false]);
        }, 30_000);

        it('starts auto supply at the threshold through the phase-5 behavior', async () => {
            const world = await createTestWorld('blueshift', { loop: 896 });
            const run = spyOn(world.resources.get().behaviors, 'run').mockResolvedValue(false);
            world.agent.use(
                createSystem({
                    name: 'Opener',
                    type: 'build',
                    openings: { a: { buildOrder: ['100 barracks'], autoSupplyAtSupply: 20 } },
                    opening: 'a',
                }),
            );

            await stepCommands(world, 900, {}, [], { foodUsed: 19 });
            const before = run.mock.calls.length;
            await stepCommands(world, 904, {}, [], { foodUsed: 20 });

            expect([before, run.mock.calls.length]).toEqual([0, 1]);
        });

        it('picks a persistent builder at 9s for a late first depot, moves it to the depot spot, hands it to builds while it is not on a tracked build, reclaims it from gathering after one, and releases it when the opening completes', async () => {
            const world = await createTestWorld('blueshift', { loop: 896 });
            const { buildings, frame, placement, roles } = world.resources.get();
            const spot = { x: 30.5, y: 40.5 };
            spyOn(placement, 'request').mockReturnValue(spot);
            const release = spyOn(placement, 'release');
            let now = 8;
            spyOn(frame, 'time').mockImplementation(() => now);
            world.agent.use(
                createSystem({
                    name: 'Opener',
                    type: 'build',
                    openings: {
                        a: {
                            buildOrder: ['18 supply', '18 barracks', '18 engineeringbay', '18 worker_scout'],
                            constantWorkerProductionTill: 20,
                        },
                    },
                    opening: 'a',
                }),
            );
            const persistent = () => [...roles.getTags(PERSISTENT_BUILDER)];
            const structures: SC2APIProtocol.Unit[] = [];
            const add = (unitType: number) =>
                structures.push(rawUnit({ unitType, buildProgress: 0.1, pos: { ...spot, z: 10 } }));
            const handed = new Map<number, boolean>();
            let gameLoop = 904;
            const step = async () => {
                await stepCommands(world, (gameLoop += 4), {}, [...structures], { foodUsed: 18, minerals: 4815 });
                for (const { unitType, workerTag } of buildings.getTracked()) handed.set(unitType, workerTag === tag);
            };

            await stepCommands(world, 900, {}, [], { foodUsed: 16 });
            const early = persistent();
            now = 9;
            const moves = (await stepCommands(world, 904, {}, [], { foodUsed: 16 })).filter(
                ({ abilityId }) => abilityId === Ability.MOVE,
            );
            const [tag] = persistent();
            const released = [...release.mock.calls];
            await step();
            add(UnitType.SUPPLYDEPOT);
            await step();
            await step();
            structures[0].buildProgress = 1;
            add(UnitType.BARRACKS);
            await step();
            await step();
            add(UnitType.ENGINEERINGBAY);
            await step();
            structures[2].buildProgress = 1;
            await step();
            await step();

            expect([early, moves, released, [...handed], roles.roleOf(tag)]).toEqual([
                [],
                [{ abilityId: Ability.MOVE, unitTags: [tag], targetWorldSpacePos: spot, queueCommand: false }],
                [[spot]],
                [
                    [UnitType.SUPPLYDEPOT, true],
                    [UnitType.BARRACKS, false],
                    [UnitType.ENGINEERINGBAY, true],
                ],
                GATHERING,
            ]);
        });

        it('picks the persistent builder at 3s when the first supply is at most 13 or at the natural, else at 9s, never without a supply step, and neither reclaims nor releases it from a role someone else gave it', async () => {
            const picked = async (order: string) => {
                const world = await createTestWorld('blueshift', { loop: 896 });
                const { frame, roles } = world.resources.get();
                spyOn(frame, 'time').mockReturnValue(3);
                const system = createSystem({
                    name: 'Opener',
                    type: 'build',
                    openings: { a: { buildOrder: [order], constantWorkerProductionTill: 20 }, b: { buildOrder: [] } },
                    opening: 'a',
                });
                world.agent.use(system);
                await stepCommands(world, 900, {}, [], { foodUsed: 12 });
                const [tag] = roles.getTags(PERSISTENT_BUILDER);
                if (tag) roles.assign(tag, BASE_DEFENDER);
                await stepCommands(world, 904, {}, [], { foodUsed: 12 });
                system._system.switchOpening!('b');
                return tag && roles.roleOf(tag);
            };

            expect([
                await picked('13 supply'),
                await picked('16 supply'),
                await picked('16 supply @nat'),
                await picked('13 barracks'),
            ]).toEqual([BASE_DEFENDER, undefined, BASE_DEFENDER, undefined]);
        });

        it('releases the persistent builder when a Protoss pylon task completes, before the opening does', async () => {
            const world = await createTestWorld('blueshift', { loop: 896 });
            const { buildings, placement, roles, units } = world.resources.get();
            const probes = Object.fromEntries(
                units.getById(UnitType.SCV).map(({ tag }) => [tag, { unitType: UnitType.PROBE }]),
            );
            world.agent.race = Race.PROTOSS;
            spyOn(placement, 'request').mockReturnValue({ x: 30.5, y: 40.5 });
            world.agent.use(
                createSystem({
                    name: 'Opener',
                    type: 'build',
                    openings: { a: { buildOrder: ['14 pylon', '100 gateway'], constantWorkerProductionTill: 20 } },
                    opening: 'a',
                }),
            );
            const persistent = () => [...roles.getTags(PERSISTENT_BUILDER)];

            await stepCommands(world, 900, probes, [], { foodUsed: 16 });
            const [tag] = persistent();
            await stepCommands(world, 904, probes, [], { foodUsed: 16 });
            const [tracked] = buildings.getTracked();
            const pylon = [
                rawUnit({ unitType: UnitType.PYLON, buildProgress: 0.1, pos: { ...tracked.target, z: 10 } }),
            ];
            await stepCommands(world, 908, probes, pylon, { foodUsed: 16 });
            await stepCommands(world, 912, probes, pylon, { foodUsed: 16 });

            expect([tag !== undefined, roles.roleOf(tag)]).toEqual([true, GATHERING]);
        });
    });
});
