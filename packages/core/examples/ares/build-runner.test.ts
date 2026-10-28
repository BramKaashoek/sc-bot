import { describe, expect, it, spyOn } from 'bun:test';
import { createAgent, parseBuildOrder } from '@sc-bot/core';
import type { BuildTaskI, System } from '@sc-bot/core';
import { Race } from '@sc-bot/core/constants/enums';
import { BUILD_RUNNER_SCOUT } from '@sc-bot/core/constants/unit-role';
import { resolveConfig } from '../../engine/config.ts';
import { createTestWorld, loadFixture, stepTo } from '../../test/create-test-world.ts';
import { aresYamlFile, configFile, createBuildRunner, createYamlBuildRunner } from './build-runner.ts';
import type { RaceName } from './build-runner.ts';

const MINER_TAG = '4345561089';
const RACES = { terran: Race.TERRAN, protoss: Race.PROTOSS };

async function startRunner(
    race: keyof typeof RACES,
    choices: Record<string, string[]>,
    rushed = false,
    runner = createBuildRunner(race as RaceName),
) {
    const fixture = loadFixture('blueshift');
    fixture.gameInfo.playerInfo!.find(({ playerId }) => playerId === 1)!.raceRequested = RACES[race];
    fixture.gameInfo.playerInfo!.find(({ playerId }) => playerId !== 1)!.raceRequested = Race.ZERG;
    const config = resolveConfig({ resources: { openings: { choices } } }, { file: configFile(race), env: {} });
    const agent = createAgent({
        settings: { race: RACES[race] },
        async onGameStart({ resources }) {
            spyOn(resources.get().intel, 'has').mockImplementation((flag) => rushed && flag === 'rushed');
        },
    });
    agent.use(runner);
    const world = await createTestWorld(fixture, { agent, config, loop: 896 });

    const { _system } = world.agent.systems.find(({ name }) => name === 'BuildRunnerWrapper')! as unknown as {
        _system: System;
    };
    const step = async (gameLoop: number) => {
        const next = structuredClone(fixture.observations[896]);
        next.observation!.gameLoop = gameLoop;
        await stepTo(world, next);
    };
    return { world, config, system: _system, step };
}

describe('build-runner example', () => {
    it('picks the opening listed for the enemy race and queues its parsed steps in order', async () => {
        const { system, config } = await startRunner('terran', { Zerg: ['ThreeRax', 'FastCC'] });

        const tasks = system.state[Object.getOwnPropertySymbols(system.state)[0]] as BuildTaskI[];
        const { buildOrder } = config.resources.openings!.builds!.ThreeRax;
        const parsed = parseBuildOrder(buildOrder, Race.TERRAN) as [number, BuildTaskI][];
        expect(tasks).toHaveLength(23);
        expect([system.getOpening!(), tasks.map(({ type, id, opts }) => ({ type, id, opts }))]).toEqual([
            'ThreeRax',
            parsed.map(([, { type, id, opts }]) => ({ type, id, opts })),
        ]);
    });

    it('loads an ares YAML file directly and queues the same steps as the translated config', async () => {
        const yaml = await startRunner(
            'terran',
            {},
            false,
            createYamlBuildRunner('terran', aresYamlFile('terran'), 'ThreeRax'),
        );
        const translated = await startRunner('terran', { Zerg: ['ThreeRax'] });

        const queued = ({ system }: typeof yaml) =>
            (system.state[Object.getOwnPropertySymbols(system.state)[0]] as BuildTaskI[]).map(({ type, id, opts }) => ({
                type,
                id,
                opts,
            }));
        expect([yaml.system.getOpening!(), queued(yaml)]).toEqual([
            translated.system.getOpening!(),
            queued(translated),
        ]);
    });

    it('holds the build runner scouts without commanding them, and has no defensive switch for Terran', async () => {
        const { world, system, step } = await startRunner('terran', { Zerg: ['ThreeRax'] }, true);
        world.resources.get().roles.assign(MINER_TAG, BUILD_RUNNER_SCOUT);

        await step(900);

        expect([system.state.scouts, system.getOpening!()]).toEqual([[MINER_TAG], 'ThreeRax']);
    });

    it('switches a Protoss opening to the defensive one only when intel says rushed', async () => {
        const calm = await startRunner('protoss', { Zerg: ['AdeptOracle'] });
        const rushed = await startRunner('protoss', { Zerg: ['AdeptOracle'] }, true);
        await Promise.all([calm.step(900), rushed.step(900)]);

        expect([calm.system.getOpening!(), rushed.system.getOpening!()]).toEqual(['AdeptOracle', 'OneBaseTempests']);
    });
});
