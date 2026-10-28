import { createAgent, createEngine, createPlayer, createSystem, parseAresBuilds } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import { MORPH_SUPPLYDEPOT_LOWER } from '@sc-bot/core/constants/ability';
import { WorkerRace } from '@sc-bot/core/constants/race-map';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { BUILD_RUNNER_SCOUT } from '@sc-bot/core/constants/unit-role';
import { SUPPLYDEPOT } from '@sc-bot/core/constants/unit-type';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];

export const RACES = { terran: Race.TERRAN, protoss: Race.PROTOSS, zerg: Race.ZERG };
export type RaceName = keyof typeof RACES;
const raceName = (process.env.RACE ?? 'terran').toLowerCase() as RaceName;

export const DEFENSIVE_OPENING: Partial<Record<RaceName, string>> = { protoss: 'OneBaseTempests' };

export const configFile = (race: RaceName) => join(import.meta.dir, 'openings', `${race}.config.json`);

export const aresYamlFile = (race: RaceName) => join(import.meta.dir, 'openings', `${race}_builds.yml`);

// ares' own YAML (ShouldHandleGasSteal included) feeds the system directly; only the build definitions are used, so
// the opening is named here instead of coming from BuildChoices
export const createYamlBuildRunner = (race: RaceName, yamlPath: string, opening?: string) => {
    const { builds } = parseAresBuilds(readFileSync(yamlPath, 'utf8'));
    return createBuildRunner(race, { openings: builds, opening: opening ?? Object.keys(builds!)[0] });
};

export const createBuildRunner = (
    race: RaceName,
    source: Pick<Parameters<typeof createSystem>[0], 'openings' | 'opening'> = { openings: 'config' },
) =>
    createSystem({
        name: 'BuildRunner',
        type: 'build',
        ...source,
        async onGameStart() {
            console.log(`Opening: ${this.getOpening!()}`);
        },
        async onStep({ resources }: World) {
            const { intel, roles, units } = resources.get();

            // ares' build_runner_bot lowers every depot: a raised ramp wall seals the main from builders outside it
            await Promise.all(
                units.getById(SUPPLYDEPOT).ready.map((depot) => depot.useAbility(MORPH_SUPPLYDEPOT_LOWER)),
            );

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

export const createBot = (race: RaceName = raceName, runner = createBuildRunner(race)) => {
    const agent = createAgent({
        settings: { race: RACES[race] },
        async onGameStart({ resources }: World) {
            resources.get().mining.configure({ enabled: true });
        },
    });
    agent.use(runner);
    return agent;
};

if (import.meta.main) {
    const useYaml = process.env.ARES_YAML === '1';
    const engine = createEngine(useYaml ? {} : { configFile: configFile(raceName) });
    await engine.connect();

    const [, results] = await engine.runGame(
        MAP,
        [
            createPlayer(
                { race: RACES[raceName] },
                createBot(raceName, useYaml ? createYamlBuildRunner(raceName, aresYamlFile(raceName)) : undefined),
            ),
            createPlayer({ race: Race.PROTOSS, difficulty }),
        ],
        { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
    );

    console.log(results);
    engine.shutdown();
}
