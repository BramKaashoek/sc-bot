import { describe, expect, it, spyOn } from 'bun:test';
import { Ability, UnitType } from '../constants/index.ts';
import { BuildOrder, BuildResult, Race } from '../constants/enums.ts';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import { builderPlugin, taskFunctions } from './builder-plugin.ts';
import createSystem from './create-system.ts';
import type { BuildTaskI, EventReader, System, World } from '../types.ts';

async function stepAt(world: TestWorld, gameLoop: number, edits: Record<string, SC2APIProtocol.Unit> = {}) {
    const next = structuredClone(world.client.fixture.observations[896]);
    next.observation!.gameLoop = gameLoop;
    next.observation!.rawData!.units = next.observation!.rawData!.units!.map((raw) => ({ ...raw, ...edits[raw.tag!] }));
    const before = world.client.sent.actions.length;
    await stepTo(world, next);
    return world.client.sent.actions
        .slice(before)
        .flatMap((request) => request.actions!.map((action) => action.actionRaw!.unitCommand!.abilityId));
}

describe('builderPlugin', () => {
    it('fills supply gaps with worker tasks, counting a train task with several unit types at the supply of the costliest', async () => {
        const world = await createTestWorld('blueshift');
        const { train, build } = taskFunctions;
        const system = {
            state: {},
            setState(this: { state: object }, newState: object) {
                this.state = { ...this.state, ...newState };
            },
            buildOrder: [
                [12, train([UnitType.MARINE, UnitType.MARAUDER])],
                [15, build(UnitType.SUPPLYDEPOT)],
            ],
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
            { type: 'worker', qty: 1, index: 1, supply: 15, ...runtime },
            { type: 'build', id: UnitType.SUPPLYDEPOT, qty: 1, opts: {}, index: 2, supply: null, ...runtime },
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

    it('hands T/P structures to the tracker with solver flags or near base without queries, a placer result first, gas tracked, findPlacement without a solver spot', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { build } = taskFunctions;
        const { actions, buildings, placement, units } = world.resources.get();
        const request = spyOn(placement, 'request');
        const placementQueries = () =>
            world.client.sent.queries.filter((query) => query.placements?.length || query.pathing?.length).length;
        const trackedTypes = () => buildings.getTracked().map(({ unitType }) => unitType);
        let gameLoop = 896;
        const run = (task: BuildTaskI) => {
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

        request.mockReturnValueOnce(undefined);
        const fallback = await runEarmarked(build(UnitType.SUPPLYDEPOT));
        expect([
            fallback.commands.includes(Ability.BUILD_SUPPLYDEPOT),
            fallback.earmarks,
            placementQueries() > 0,
            trackedTypes().length,
        ]).toEqual([true, [['saving', 'task0'], []], true, 3]);

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
            [UnitType.SUPPLYDEPOT, { flags: ['supplyDepot'] }],
            [UnitType.GATEWAY, { powered: true }],
        ]);
    });
});
