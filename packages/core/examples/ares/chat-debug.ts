import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;

const bot = createAgent({ settings: { race: Race.TERRAN } });

const engine = createEngine({ config: { features: { chatDebug: true } } });
await engine.connect();

const [, results] = await engine.runGame(
    MAP,
    [createPlayer({ race: Race.TERRAN }, bot), createPlayer({ race: Race.ZERG, difficulty: Difficulty.MEDIUM })],
    { realtime: true, gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
);

console.log(results);
engine.shutdown();
