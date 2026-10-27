import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { ATTACKING } from '@sc-bot/core/constants/unit-role';

// Under a ladder manager (--LadderServer/--GamePort/--StartPort) createEngine connects to the
// server and runGame joins the existing game; the opponent entry only matters locally
const bot = createAgent({
    settings: { race: Race.TERRAN },
    async onGameStart({ agent, resources }) {
        console.log(`opponent id: ${agent.opponent?.id ?? 'none'}`);
        const { units, map, actions, roles } = resources.get();
        const workers = units.getWorkers(true);
        roles.assign(workers, ATTACKING);
        return roles.as(ATTACKING, () => actions.attackMove(workers, map.getLocations().enemy[0]));
    },
});

const engine = createEngine();
await engine.connect();

const [, results] = await engine.runGame(
    process.env.MAP ?? 'Melee/Simple64',
    [createPlayer({ race: Race.TERRAN }, bot), createPlayer({ race: Race.RANDOM, difficulty: Difficulty.VERYEASY })],
    { gameTimeLimit: process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined },
);

console.log(results);
engine.shutdown();
