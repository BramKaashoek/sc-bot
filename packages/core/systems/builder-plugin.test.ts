import { describe, expect, it } from 'bun:test';
import { UnitType } from '../constants/index.ts';
import { BuildOrder, BuildResult } from '../constants/enums.ts';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld } from '../test/create-test-world.ts';
import { builderPlugin, taskFunctions } from './builder-plugin.ts';
import createSystem from './create-system.ts';
import type { BuildTaskI, EventReader, System, World } from '../types.ts';

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

    it('calls a build system onStep with (world, gameLoop, task, result)', async () => {
        const received: unknown[][] = [];
        const agent = createAgent();
        agent.use(
            createSystem({
                name: 'SkippingOpener',
                type: 'build',
                defaultOptions: { state: { skipMarines: true } },
                buildOrder: [taskFunctions.train(UnitType.MARINE, 1, { skip: 'skipMarines' })],
                async onStep(world: World, gameLoop: number, task?: BuildTaskI, result?: BuildResult) {
                    received.push([world, gameLoop, task, result]);
                },
            }),
        );
        const world = await createTestWorld('blueshift', { agent, loop: 224 });

        expect(received).toEqual([
            [
                world,
                224,
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
    });
});
