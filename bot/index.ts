import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import { Alliance, Difficulty, Race } from '@sc-bot/core/constants/enums';

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
const RESULT_NAMES: Record<number, string> = { 1: 'Victory', 2: 'Defeat', 3: 'Tie', 4: 'Undecided' };

const formatGameTime = (gameLoop: number) => {
  const seconds = Math.floor(gameLoop / LOOPS_PER_GAME_SECOND);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

let nextStatusLoop = 0;

const bot = createAgent({
  settings: { race: Race.TERRAN },
  async onGameStart({ resources }) {
    const { units, actions, map } = resources.get();
    return actions.attackMove(units.getWorkers(), map.getEnemyMain().townhallPosition);
  },
  async onStep({ agent, resources }) {
    const { frame, units } = resources.get();
    const gameLoop = frame.getGameLoop();
    if (gameLoop < nextStatusLoop) return;
    nextStatusLoop = gameLoop + STATUS_EVERY_LOOPS;

    console.log([
      formatGameTime(gameLoop),
      `supply ${agent.foodUsed}/${agent.foodCap}`,
      `minerals ${agent.minerals}`,
      `gas ${agent.vespene}`,
      `workers ${units.getWorkers().length}`,
      `army ${units.getCombatUnits().length}`,
      `enemy units seen ${units.getAlive(Alliance.ENEMY).length}`,
    ].join(' | '));
  },
});

const engine = createEngine();

// Under a ladder manager (--LadderServer etc.) the engine skips createGame and only joins, so the AI player is ignored.
await engine.connect();
const [world, results] = await engine.runGame(process.env.MAP ?? 'Ladder2018Season4/BlueshiftLE', [
  createPlayer({ race: Race.TERRAN }, bot),
  createPlayer({
    race: Race[raceName as keyof typeof Race],
    difficulty: Difficulty[difficultyName as keyof typeof Difficulty],
  }),
]);

const ownResult = results.find((result) => result.playerId === world.agent.playerId);
console.log(`Game over at ${formatGameTime(world.resources.get().frame.getGameLoop())}: ${RESULT_NAMES[ownResult?.result ?? 4]}`);
