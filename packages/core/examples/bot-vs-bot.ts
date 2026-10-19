import { createAgent, createEngine } from '@sc-bot/core';
import { GameResultId, PlayerType, Race } from '@sc-bot/core/constants/enums';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;

const workerRusher = (race: number) =>
    createAgent({
        settings: { race },
        async onGameStart({ resources }) {
            const { units, map, actions } = resources.get();
            return actions.attackMove(units.getWorkers(true), map.getLocations().enemy[0]);
        },
    });

const engine = createEngine();
const terran = workerRusher(Race.TERRAN);
const zerg = workerRusher(Race.ZERG);

const [[, results]] = await engine.runBotVsBot(
    MAP,
    [
        { type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent: terran },
        { type: PlayerType.PARTICIPANT, race: Race.ZERG, agent: zerg },
    ],
    { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
);

Object.entries({ terran, zerg }).forEach(([label, agent]) => {
    const playerResult = results.find(({ playerId }) => playerId === agent.playerId);
    console.log(
        `${label} (player ${agent.playerId}): ${playerResult ? GameResultId[playerResult.result!] : 'no result'}`,
    );
});
engine.shutdown();
