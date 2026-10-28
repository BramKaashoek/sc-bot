import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import {
    autoSupply,
    buildWorkers,
    gasBuildingController,
    plan,
    productionController,
    spawnController,
} from '@sc-bot/core/behaviors';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { MARINE, RAVEN, SIEGETANK, VIKINGFIGHTER } from '@sc-bot/core/constants/unit-type';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];

export const vikingTank = {
    [MARINE]: { proportion: 0.69, priority: 4 },
    [SIEGETANK]: { proportion: 0.13, priority: 0 },
    [VIKINGFIGHTER]: { proportion: 0.16, priority: 3 },
    [RAVEN]: { proportion: 0.02, priority: 1 },
};

export const createBot = () =>
    createAgent({
        settings: { race: Race.TERRAN },
        async onGameStart({ resources }: World) {
            // mining is opt-in in core; ares mines by default
            resources.get().mining.configure({ enabled: true });
        },
        async onStep({ resources }: World) {
            const { map, behaviors } = resources.get();
            const productionLocation = map.getLocations().self!;

            await behaviors.run(
                plan(
                    autoSupply({ base: productionLocation }),
                    buildWorkers({ toCount: 48 }),
                    gasBuildingController({ toCount: 8 }),
                    spawnController({ composition: vikingTank }),
                    productionController({ composition: vikingTank, base: productionLocation }),
                ),
            );
        },
    });

if (import.meta.main) {
    const engine = createEngine();
    await engine.connect();

    const [, results] = await engine.runGame(
        MAP,
        [createPlayer({ race: Race.TERRAN }, createBot()), createPlayer({ race: Race.PROTOSS, difficulty })],
        { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
    );

    console.log(results);
    engine.shutdown();
}
