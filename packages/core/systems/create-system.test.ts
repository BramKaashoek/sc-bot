import { describe, expect, it, spyOn } from 'bun:test';
import createDebug from 'debug';
import createAgent from '../agent/create-agent.ts';
import { GameEndedError, NodeSC2Error } from '../engine/errors.ts';
import { UnitType } from '../constants/index.ts';
import { observation, toyFixture } from '../test/factories.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { taskFunctions } from './builder-plugin.ts';
import createSystem from './create-system.ts';

describe('createSystem', () => {
    it('starts the systems of a reused agent from their initial state and step timing, running the build order once per step, with setState usable detached', async () => {
        const agent = createAgent();
        const scoreOf = (tag: string) => tag.length;
        const pulse = createSystem({
            name: 'Pulse',
            defaultOptions: { state: { defending: null, pulses: 0, seen: [], lastSeen: new Map(), scoreOf } },
            async onStep() {
                const { setState } = this;
                setState({ defending: '42' });
                setState((current: { pulses: number }) => ({ ...current, pulses: current.pulses + 1 }));
            },
        });
        const opener = createSystem({
            name: 'Opener',
            type: 'build',
            buildOrder: [[13, taskFunctions.train(UnitType.MARINE)]],
        });
        agent.use([pulse, opener]);
        const world = await createTestWorld('blueshift', { loop: 896, agent });
        const train = spyOn(world.resources.get().actions, 'train').mockResolvedValue();
        pulse._system.pause!();
        pulse._system.state.seen.push('previous game');
        opener._system.pauseBuild!();
        opener._system.buildOptions!.earmarks = 50;

        await world.engine.setupGame();
        await stepTo(world, 896);

        expect(pulse._system.state).toEqual({ defending: '42', pulses: 1, seen: [], lastSeen: new Map(), scoreOf });
        expect(opener._system.buildOptions).toEqual({ paused: false, earmarks: 1000 });
        expect(train.mock.calls).toEqual([[UnitType.SCV]]);

        pulse._system.state.seen.push('second game');
        pulse._system.state.lastSeen.set('42', 896);
        await world.engine.setupGame();
        expect(pulse._system.state.seen).toEqual([]);
        expect(pulse._system.state.lastSeen).toEqual(new Map());
        expect(pulse._system.state.scoreOf).toBe(scoreOf);
    });

    it('rejects dispatch with a fatal error thrown by a system handler but logs and survives any other', async () => {
        let failure: Error = new Error('boom');
        const agent = createAgent();
        agent.use(
            createSystem({
                name: 'Flaky',
                async onStep() {
                    throw failure;
                },
            }),
        );
        const world = await createTestWorld(toyFixture(), { agent });
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        const lines: string[] = [];
        const { log } = createDebug;
        createDebug.log = (line: string) => lines.push(line);
        createDebug.enable('sc2:debug:system');
        try {
            failure = new NodeSC2Error('refused');
            await stepTo(world, observation({ gameLoop: 4 }));
            failure = new TypeError('bad');
            await stepTo(world, observation({ gameLoop: 8 }));
            expect(['refused', 'bad'].map((text) => lines.some((line) => line.includes(text)))).toEqual([true, true]);

            failure = new GameEndedError('over');
            await expect(stepTo(world, observation({ gameLoop: 16 }))).rejects.toBe(failure);
        } finally {
            createDebug.disable();
            createDebug.log = log;
            warn.mockRestore();
        }
    });
});
