import { describe, expect, it, spyOn } from 'bun:test';
import { Ability, UnitType } from '../constants/index.ts';
import { ENEMY_NAT_VISION, ENEMY_SPAWN, NAT } from '../constants/build-target.ts';
import { CARRYMINERALFIELDMINERALS } from '../constants/buff.ts';
import { BuildOrder, BuildResult, Race } from '../constants/enums.ts';
import { BUILD_RUNNER_SCOUT } from '../constants/unit-role.ts';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import { resolveTarget, scoutWaypoints } from '../utils/build-order/targets.ts';
import { builderPlugin, taskFunctions } from './builder-plugin.ts';
import createSystem from './create-system.ts';
import type { BuildOrderStep, BuildTaskI, CommandResult, EventReader, System, World } from '../types.ts';

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
    it('parses string steps, then fills supply gaps with worker tasks, counting a train task with several unit types at the supply of the costliest and a plain task at the running supply', async () => {
        const world = await createTestWorld('blueshift');
        const { train, build } = taskFunctions;
        const system = {
            state: {},
            setState(this: { state: object }, newState: object) {
                this.state = { ...this.state, ...newState };
            },
            buildOrder: [[12, train([UnitType.MARINE, UnitType.MARAUDER])], build(UnitType.BARRACKS), '15 supply'],
        } as unknown as EventReader<System>;
        builderPlugin(system);

        await system.onGameStart!(world);

        const [buildOrderKey] = Object.getOwnPropertySymbols(system.state);
        const runtime = { touched: false, status: BuildOrder.NOT_STARTED, started: null, earmarked: false };
        expect(system.state[buildOrderKey]).toEqual([
            {
                type: 'train',
                id: [UnitType.MARINE, UnitType.MARAUDER],
                qty: 1,
                opts: {},
                index: 0,
                supply: null,
                ...runtime,
            },
            { type: 'build', id: UnitType.BARRACKS, qty: 1, opts: {}, index: 1, supply: null, ...runtime },
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
        const earmarks = () => world.data.get('earmarks').map(({ name }: { name: string }) => name);

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

    it('hands T/P structures to the tracker with solver flags or near base without queries, a target as its base, proxy or townhall spot, a placer result first, gas tracked, findPlacement without a solver spot', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { build } = taskFunctions;
        const { actions, buildings, map, placement, units } = world.resources.get();
        const request = spyOn(placement, 'request');
        const placementQueries = () =>
            world.client.sent.queries.filter((query) => query.placements?.length || query.pathing?.length).length;
        const trackedTypes = () => buildings.getTracked().map(({ unitType }) => unitType);
        let gameLoop = 896;
        const run = (task: BuildTaskI | BuildOrderStep) => {
            world.agent.use(createSystem({ name: `Build${gameLoop}`, type: 'build', buildOrder: [task] }));
            gameLoop += 4;
            return stepAt(world, gameLoop);
        };
        const earmarks = () => world.data.get('earmarks').map(({ name }: { name: string }) => name);
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
            [[UnitType.BARRACKS, map.getEnemyNatural().townhallPosition]],
            [
                [UnitType.BARRACKS, proxy],
                [UnitType.COMMANDCENTER, map.getNatural().townhallPosition],
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
        settled.push((await runEarmarked(build(UnitType.COMMANDCENTER))).earmarks);

        const placed = { x: 40.5, y: 40.5 };
        world.resources.set({ placer: { place: () => [placed] } });
        spyOn(actions, 'canPlace').mockResolvedValue(placed);
        await run(build(UnitType.ENGINEERINGBAY));
        expect(buildings.getTracked().at(-1)).toMatchObject({ unitType: UnitType.ENGINEERINGBAY, target: placed });
        spyOn(buildings, 'build').mockReturnValueOnce(undefined);
        settled.push((await runEarmarked(build(UnitType.ENGINEERINGBAY))).earmarks);
        expect(settled).toEqual(Array(3).fill([['saving', 'task0'], []]));

        world.resources.set({ placer: undefined });
        world.agent.race = Race.PROTOSS;
        await run(build(UnitType.GATEWAY));
        expect(request.mock.calls).toEqual([
            [UnitType.SUPPLYDEPOT, { flags: ['supplyDepot'] }],
            [UnitType.BARRACKS, { base: cc.pos, closestTo: cc.pos, flags: ['production'] }],
            [UnitType.BARRACKS, { base: map.getNatural().townhallPosition }],
            [UnitType.SUPPLYDEPOT, { flags: ['supplyDepot'] }],
            [UnitType.GATEWAY, { powered: true }],
        ]);
    });

    it('without fillWorkers holds an unstarted step until supply used reaches its supply, adding no worker tasks, while a started step still completes or resets after 250 loops when supply drops', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings } = world.resources.get();
        const { system, results, statuses } = buildSystem(['17 marine', '17 supply', '17 supply'], {
            earmarks: null,
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
        const main = map.getMain().townhallPosition;
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
});
