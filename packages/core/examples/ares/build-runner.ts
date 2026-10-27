import { createAgent, createEngine, createPlayer, createSystem } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import { WorkerRace } from '@sc-bot/core/constants/race-map';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { BUILD_RUNNER_SCOUT } from '@sc-bot/core/constants/unit-role';
import { join } from 'node:path';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];

export const RACES = { terran: Race.TERRAN, protoss: Race.PROTOSS, zerg: Race.ZERG };
export type RaceName = keyof typeof RACES;
const raceName = (process.env.RACE ?? 'terran').toLowerCase() as RaceName;

export const DEFENSIVE_OPENING: Partial<Record<RaceName, string>> = { protoss: 'OneBaseTempests' };

export const configFile = (race: RaceName) => join(import.meta.dir, 'openings', `${race}.config.json`);

export const createBuildRunner = (race: RaceName) =>
    createSystem({
        name: 'BuildRunner',
        type: 'build',
        openings: 'config',
        async onGameStart() {
            console.log(`Opening: ${this.getOpening!()}`);
        },
        async onStep({ resources }: World) {
            const { intel, roles } = resources.get();

            const scouts = roles.get(BUILD_RUNNER_SCOUT, { types: WorkerRace[RACES[race]] });
            this.setState({ scouts: scouts.map(({ tag }) => tag) });

            const defensive = DEFENSIVE_OPENING[race];
            if (defensive && !this.state.switched && !this.state.buildComplete && intel.has('rushed')) {
                this.setState({ switched: true });
                this.switchOpening!(defensive);
            }
        },
        async buildComplete() {
            this.setState({ buildComplete: true });
            console.log(`Build complete: ${this.getOpening!()}`);
        },
    });

export const createBot = (race: RaceName = raceName) => {
    const agent = createAgent({
        settings: { race: RACES[race] },
        async onGameStart({ resources }: World) {
            resources.get().mining.configure({ enabled: true });
        },
    });
    agent.use(createBuildRunner(race));
    return agent;
};

if (import.meta.main) {
    const engine = createEngine({ configFile: configFile(raceName) });
    await engine.connect();

    const [, results] = await engine.runGame(
        MAP,
        [createPlayer({ race: RACES[raceName] }, createBot()), createPlayer({ race: Race.PROTOSS, difficulty })],
        { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
    );

    console.log(results);
    engine.shutdown();
}
