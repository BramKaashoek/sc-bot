import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import type { Point2D, World } from '@sc-bot/core';
import { MORPH_SUPPLYDEPOT_LOWER, MORPH_SUPPLYDEPOT_RAISE } from '@sc-bot/core/constants/ability';
import { Alliance, Difficulty, Race } from '@sc-bot/core/constants/enums';
import { BARRACKS, COMMANDCENTER, SCV, SUPPLYDEPOT, SUPPLYDEPOTLOWERED } from '@sc-bot/core/constants/unit-type';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];
const WORKER_TARGET = 16;
const RAISE_DISTANCE = 10;
const LOWER_DISTANCE = 15;

const bot = createAgent({
    settings: { race: Race.TERRAN },
    async onStep({ agent, resources }: World) {
        const { units, map, actions } = resources.get();
        const [commandCenter] = units.getById(COMMANDCENTER);
        if (!commandCenter) return;

        await agent.distributeWorkers();

        if (agent.supplyWorkers < WORKER_TARGET && commandCenter.isIdle() && agent.canAfford(SCV)) {
            await actions.train(SCV, commandCenter);
        }

        const ramp = map.getMainBaseRamp();
        if (!ramp) return;
        const depots = units.getById([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]);
        const barracksPosition = ramp.barracksCorrectPlacement;

        const [depotSpot] = ramp.cornerDepots.filter(
            (corner) => !depots.some((depot) => Math.hypot(depot.pos.x - corner.x, depot.pos.y - corner.y) < 1),
        );
        if (depotSpot && agent.alreadyPending(SUPPLYDEPOT) === 0 && agent.canAfford(SUPPLYDEPOT)) {
            await actions.build(SUPPLYDEPOT, depotSpot);
        } else if (
            barracksPosition &&
            depots.ready.exists &&
            units.getById(BARRACKS).empty &&
            agent.alreadyPending(BARRACKS) === 0 &&
            agent.canAfford(BARRACKS)
        ) {
            await actions.build(BARRACKS, barracksPosition);
        }

        const enemies = units.getAlive(Alliance.ENEMY).filter((unit) => !unit.isStructure());
        const nearestEnemyDistance = (depot: { pos: Point2D }) =>
            Math.min(...enemies.map((enemy) => Math.hypot(enemy.pos.x - depot.pos.x, enemy.pos.y - depot.pos.y)));

        await Promise.all([
            ...units
                .getById(SUPPLYDEPOT)
                .ready.filter((depot) => nearestEnemyDistance(depot) >= LOWER_DISTANCE)
                .map((depot) => depot.useAbility(MORPH_SUPPLYDEPOT_LOWER)),
            ...units
                .getById(SUPPLYDEPOTLOWERED)
                .ready.filter((depot) => nearestEnemyDistance(depot) < RAISE_DISTANCE)
                .map((depot) => depot.useAbility(MORPH_SUPPLYDEPOT_RAISE)),
        ]);
    },
});

const engine = createEngine();
await engine.connect();

const [, results] = await engine.runGame(
    MAP,
    [createPlayer({ race: Race.TERRAN }, bot), createPlayer({ race: Race.ZERG, difficulty })],
    { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
);

console.log(results);
engine.shutdown();
