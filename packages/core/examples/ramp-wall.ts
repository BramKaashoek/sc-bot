import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import { buildWorkers } from '@sc-bot/core/behaviors';
import { MORPH_SUPPLYDEPOT_LOWER, MORPH_SUPPLYDEPOT_RAISE } from '@sc-bot/core/constants/ability';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { BARRACKS, COMMANDCENTER, SUPPLYDEPOT, SUPPLYDEPOTLOWERED } from '@sc-bot/core/constants/unit-type';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];
const WORKER_TARGET = 16;
const WALL_DEPOTS = 2;
const RAISE_DISTANCE = 10;
const LOWER_DISTANCE = 15;

export const createBot = () =>
    createAgent({
        settings: { race: Race.TERRAN },
        async onGameStart({ resources }: World) {
            resources.get().mining.configure({ enabled: true });
        },
        async onStep({ resources }: World) {
            const { units, buildings, behaviors, spatial } = resources.get();
            if (units.getById(COMMANDCENTER).empty) return;

            await behaviors.run(buildWorkers({ toCount: WORKER_TARGET }));

            const depots = units.getById([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]);
            if (depots.amount < WALL_DEPOTS && buildings.pending(SUPPLYDEPOT) === 0) {
                buildings.build(SUPPLYDEPOT, { placement: { flags: ['wall'] } });
            } else if (depots.ready.exists && units.getById(BARRACKS).empty && buildings.pending(BARRACKS) === 0) {
                buildings.build(BARRACKS, { placement: { flags: ['wall'] } });
            }

            await Promise.all([
                ...units
                    .getById(SUPPLYDEPOT)
                    .ready.filter((depot) => !spatial.anyInRange(depot, LOWER_DISTANCE, 'enemyGround'))
                    .map((depot) => depot.useAbility(MORPH_SUPPLYDEPOT_LOWER)),
                ...units
                    .getById(SUPPLYDEPOTLOWERED)
                    .ready.filter((depot) => spatial.anyInRange(depot, RAISE_DISTANCE, 'enemyGround'))
                    .map((depot) => depot.useAbility(MORPH_SUPPLYDEPOT_RAISE)),
            ]);
        },
    });

if (import.meta.main) {
    const engine = createEngine();
    await engine.connect();

    const [, results] = await engine.runGame(
        MAP,
        [createPlayer({ race: Race.TERRAN }, createBot()), createPlayer({ race: Race.ZERG, difficulty })],
        { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
    );

    console.log(results);
    engine.shutdown();
}
