import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { ATTACKING } from '@sc-bot/core/constants/unit-role';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];

const bot = createAgent({
    settings: { race: Race.ZERG },
    async onGameStart({ resources }) {
        const { units, map, actions, roles } = resources.get();
        const workers = units.getWorkers(true);
        roles.assign(workers, ATTACKING);
        return roles.as(ATTACKING, () => actions.attackMove(workers, map.getLocations().enemy[0]));
    },
});

const engine = createEngine();
await engine.connect();

const [, results] = await engine.runGame(
    MAP,
    [createPlayer({ race: Race.ZERG }, bot), createPlayer({ race: Race.PROTOSS, difficulty })],
    { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
);

console.log(results);
engine.shutdown();
