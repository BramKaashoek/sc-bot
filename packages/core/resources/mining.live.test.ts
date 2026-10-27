import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { PlayerType, Race } from '../constants/enums.ts';
import { killNewSc2, newLiveEngine, sc2Pids, veryEasyZerg } from '../test/live.ts';
import type { World } from '../types.ts';

const MEASURE_LOOP = 6720;
const GAME_SECONDS = MEASURE_LOOP / 22.4 + 5;
const MAP = 'Melee/Simple64';

let engine: ReturnType<typeof newLiveEngine> | undefined;
let sc2PidsBefore = new Set<number>();
let nextPort = 5600;

beforeEach(() => {
    sc2PidsBefore = sc2Pids();
});

afterEach(() => {
    try {
        engine?.shutdown();
    } catch {}
    killNewSc2(sc2PidsBefore);
});

const mineralsAtMeasureLoop = async (gameStep: number, enabled: boolean) => {
    let minerals: number | undefined;
    const agent = createAgent({
        settings: { race: Race.TERRAN },
        async onGameStart({ resources }: World) {
            resources.get().mining.configure({ enabled, speedMining: true });
        },
        async onStep(world: World) {
            if (minerals === undefined && world.resources.get().frame.getGameLoop() >= MEASURE_LOOP) {
                minerals = world.agent.minerals;
            }
        },
    });
    nextPort += 2;
    engine = newLiveEngine(nextPort, gameStep);
    await engine.connect();
    await engine.runGame(MAP, [{ type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent }, veryEasyZerg()], {
        gameTimeLimit: GAME_SECONDS,
    });
    engine.shutdown();
    return minerals;
};

describe.skipIf(!process.env.SC2PATH)('live speed mining', () => {
    const minerals: Record<string, number | undefined> = {};

    it('records minerals at loop 6720 for 12 SCVs on one base (step 4 not asserted)', async () => {
        minerals.speed = await mineralsAtMeasureLoop(2, true);
        minerals.auto = await mineralsAtMeasureLoop(2, false);
        minerals.speedStep4 = await mineralsAtMeasureLoop(4, true);
        minerals.autoStep4 = await mineralsAtMeasureLoop(4, false);
        console.log(
            `mining.live minerals at loop ${MEASURE_LOOP}: step2 speed=${minerals.speed} auto=${minerals.auto}; step4 (not asserted) speed=${minerals.speedStep4} auto=${minerals.autoStep4}`,
        );

        Object.values(minerals).forEach((value) => expect(typeof value).toBe('number'));
    }, 600_000);

    // backlog: speed mining slower than auto at step 1-2
    it.failing('speed mining at step 2 mines more than mining disabled', () => {
        expect(minerals.speed).toBeGreaterThan(minerals.auto!);
    });
});
