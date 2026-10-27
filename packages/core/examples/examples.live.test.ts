import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Alliance, PlayerType } from '../constants/enums.ts';
import { GAME_LOOPS_PER_SECOND } from '../constants/time.ts';
import { BARRACKS, FACTORY, MARINE, SUPPLYDEPOT, SUPPLYDEPOTLOWERED } from '../constants/unit-type.ts';
import createEngine from '../engine/create-engine.ts';
import { killNewSc2, Race, sc2Pids, veryEasyZerg } from '../test/live.ts';
import type { Agent, System, World } from '../types.ts';
import { configFile, createBot as createBuildRunnerBot } from './ares/build-runner.ts';
import { createBot as createProductionBot } from './ares/managing-production.ts';
import { createBot as createRampWallBot } from './ramp-wall.ts';

const WALL_SECONDS = 4 * 60;
const PRODUCTION_SECONDS = 6 * 60;
const BUILD_SECONDS = 7 * 60;
const MIN_MARINES = 8;

let engine: ReturnType<typeof createEngine> | undefined;
let sc2PidsBefore = new Set<number>();

beforeEach(() => {
    sc2PidsBefore = sc2Pids();
});

afterEach(() => {
    try {
        engine?.shutdown();
    } catch {}
    killNewSc2(sc2PidsBefore);
});

const play = async (
    port: number,
    agent: Agent,
    gameTimeLimit: number,
    options: Parameters<typeof createEngine>[0] = {},
) => {
    engine = createEngine({ port, ...options });
    await engine.connect();
    await engine.runGame(
        'Melee/Simple64',
        [{ type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent }, veryEasyZerg()],
        { gameTimeLimit },
    );
};

const onEachStep = (agent: Agent, observe: (world: World) => void) => {
    const onStep = agent.onStep!.bind(agent);
    agent.onStep = async (world: World) => {
        await onStep(world);
        observe(world);
    };
};

describe.skipIf(!process.env.SC2PATH)('examples live smoke', () => {
    it('ramp-wall puts a depot and a barracks on wall placements by 4:00', async () => {
        const agent = createRampWallBot();
        let taken: string[] = [];
        let standing: number[] = [];
        onEachStep(agent, ({ resources }) => {
            const { placement, units } = resources.get();
            taken = placement.getPlacements({ flag: 'wall', state: 'taken' }).map(({ size }) => size);
            standing = [units.getById([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]).amount, units.getById(BARRACKS).amount];
        });

        await play(5410, agent, WALL_SECONDS);

        console.log(`LIVE ${JSON.stringify({ example: 'ramp-wall', taken, standing })}`);
        expect(taken).toContain('2x2');
        expect(taken).toContain('3x3');
        expect(standing[0]).toBeGreaterThanOrEqual(1);
        expect(standing[1]).toBeGreaterThanOrEqual(1);
    }, 600_000);

    it('managing-production has a factory and 8 marines by 6:00', async () => {
        const agent = createProductionBot();
        let factories = 0;
        let marines = 0;
        onEachStep(agent, ({ resources }) => {
            const { units, buildings } = resources.get();
            factories = Math.max(factories, units.getById(FACTORY).amount + buildings.pending(FACTORY));
            marines = Math.max(marines, units.getAlive(Alliance.SELF).filter((u) => u.unitType === MARINE).length);
        });

        await play(5411, agent, PRODUCTION_SECONDS);

        console.log(`LIVE ${JSON.stringify({ example: 'managing-production', factories, marines })}`);
        expect(factories).toBeGreaterThanOrEqual(1);
        expect(marines).toBeGreaterThanOrEqual(MIN_MARINES);
    }, 600_000);

    it('build-runner completes the ThreeRax opening before 7:00', async () => {
        const agent = createBuildRunnerBot('terran');
        let opening: string | undefined;
        let completeAt: number | undefined;
        onEachStep(agent, (world) => {
            const { _system } = world.agent.systems.find(({ name }) => name === 'BuildRunnerWrapper')! as unknown as {
                _system: System;
            };
            opening = _system.getOpening!();
            if (completeAt === undefined && _system.state.buildComplete) {
                completeAt = world.resources.get().frame.getGameLoop() / GAME_LOOPS_PER_SECOND;
            }
        });

        await play(5412, agent, BUILD_SECONDS, {
            configFile: configFile('terran'),
            config: { resources: { openings: { choices: { Zerg: ['ThreeRax'] } } } },
        });

        console.log(`LIVE ${JSON.stringify({ example: 'build-runner', opening, completeAt })}`);
        expect(opening).toBe('ThreeRax');
        expect(completeAt ?? Infinity).toBeLessThan(BUILD_SECONDS);
    }, 600_000);
});
