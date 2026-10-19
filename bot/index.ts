import createDebug from 'debug';
import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import { Alliance, Difficulty, Race } from '@sc-bot/core/constants/enums';
import buildSystem from './systems/build.ts';
import combatSystem from './systems/combat/index.ts';
import economySystem from './systems/economy.ts';
import militarySystem from './systems/military.ts';
import logSystem, { formatGameTime } from './systems/log.ts';

// system errors are only reported through debug(), and the arena passes no DEBUG env
createDebug.enable('sc2:debug:system');

const difficultyName = (process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase();
if (!(difficultyName in Difficulty)) {
    throw new Error(`Unknown DIFFICULTY "${difficultyName}", expected one of ${Object.keys(Difficulty).join(', ')}`);
}
const raceName = (process.env.AI_RACE ?? 'TERRAN').toUpperCase();
if (!(raceName in Race)) {
    throw new Error(`Unknown AI_RACE "${raceName}", expected one of ${Object.keys(Race).join(', ')}`);
}

const LOOPS_PER_GAME_SECOND = 22.4;
const STATUS_EVERY_LOOPS = Math.round(10 * LOOPS_PER_GAME_SECOND);
const RESULT_NAMES: Record<number, string> = {
    1: 'Victory',
    2: 'Defeat',
    3: 'Tie',
    4: 'Undecided',
};

let nextStatusLoop = 0;

const bot = createAgent({
    settings: { race: Race.TERRAN },
    async onStep({ agent, resources }) {
        const { frame, units } = resources.get();
        const gameLoop = frame.getGameLoop();
        if (gameLoop < nextStatusLoop) return;
        nextStatusLoop = gameLoop + STATUS_EVERY_LOOPS;

        console.log(
            [
                formatGameTime(gameLoop),
                `supply ${agent.foodUsed}/${agent.foodCap}`,
                `minerals ${agent.minerals}`,
                `gas ${agent.vespene}`,
                `workers ${units.getWorkers().length}`,
                `army ${units.getCombatUnits().length}`,
                `enemy units seen ${units.getAlive(Alliance.ENEMY).length}`,
            ].join(' | '),
        );
    },
});
bot.use(buildSystem);
bot.use(economySystem);
bot.use(combatSystem);
bot.use(militarySystem);
bot.use(logSystem);

const sc2Host = process.env.SC2_HOST;
const engine = createEngine(
    sc2Host ? { host: sc2Host, port: Number(process.env.SC2_PORT ?? 5000), launch: false } : { force: true },
);
const mapName = process.env.MAP ?? 'Ladder2018Season4/BlueshiftLE';

// Under a ladder manager (--LadderServer etc.) the engine skips createGame and only joins, so the AI player is ignored.
await engine.connect();
// a remote SC2 needs a .SC2Map path; without it core falls back to a Battle.net map lookup
const [world, results] = await engine.runGame(
    sc2Host && !mapName.endsWith('.SC2Map') ? `${mapName}.SC2Map` : mapName,
    [
        createPlayer({ race: Race.TERRAN }, bot),
        createPlayer({
            race: Race[raceName as keyof typeof Race],
            difficulty: Difficulty[difficultyName as keyof typeof Difficulty],
        }),
    ],
    { realtime: Boolean(process.env.REALTIME) },
);

const ownResult = results.find((result) => result.playerId === world.agent.playerId);
console.log(
    `Game over at ${formatGameTime(world.resources.get().frame.getGameLoop())}: ${RESULT_NAMES[ownResult?.result ?? 4]}`,
);
