import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import type { Point2D, World } from '@sc-bot/core';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { FORGE, NEXUS, PHOTONCANNON, PROBE, PYLON } from '@sc-bot/core/constants/unit-type';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];
const WORKER_TARGET = 16;

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

const towards = (from: Point2D, to: Point2D, distance: number): Point2D => {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: from.x + ((to.x - from.x) / length) * distance, y: from.y + ((to.y - from.y) / length) * distance };
};

const randomOnDistance = (center: Point2D, distance: number): Point2D => {
    const angle = Math.random() * 2 * Math.PI;
    return { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance };
};

const bot = createAgent({
    settings: { race: Race.PROTOSS },
    async onGameStart({ resources }: World) {
        return resources.get().actions.chatSend('(probe)(pylon)(cannon)(cannon)(gg)');
    },
    async onStep({ agent, resources }: World) {
        const { units, map, actions } = resources.get();
        const enemyStart = map.getLocations().enemy[0];

        const buildNear = async (unitType: number, near: Point2D) => {
            const placement = await actions.findPlacement(unitType, near);
            if (placement) await actions.build(unitType, placement);
        };

        const nexuses = units.getById(NEXUS);
        if (nexuses.empty) {
            return actions.attackMove(units.getWorkers(true), enemyStart);
        }

        const nexus = nexuses.random;
        const pylons = units.getById(PYLON);
        const readyPylons = pylons.ready;

        if (agent.supplyWorkers < WORKER_TARGET && nexus.isIdle()) {
            if (agent.canAfford(PROBE)) await actions.train(PROBE, nexus);
        } else if (pylons.empty && agent.alreadyPending(PYLON) === 0) {
            if (agent.canAfford(PYLON)) await buildNear(PYLON, nexus.pos);
        } else if (units.getById(FORGE).empty) {
            if (readyPylons.exists && agent.canAfford(FORGE)) {
                await buildNear(FORGE, readyPylons.closestTo(nexus).pos);
            }
        } else if (pylons.amount < 2) {
            if (agent.canAfford(PYLON)) {
                const target = towards(enemyStart, map.getCenter(), randomBetween(8, 15));
                await buildNear(PYLON, target);
            }
        } else if (units.getById(PHOTONCANNON).empty) {
            const nearEnemy = readyPylons.closerThan(20, enemyStart);
            if (nearEnemy.exists && agent.canAfford(PHOTONCANNON)) {
                await buildNear(PHOTONCANNON, nearEnemy.random.pos);
            }
        } else if (agent.canAfford(PYLON) && agent.canAfford(PHOTONCANNON)) {
            const target = randomOnDistance(enemyStart, randomBetween(5, 12));
            const powered = agent.powerSources?.some(
                (source) => Math.hypot(source.pos!.x! - target.x, source.pos!.y! - target.y) < source.radius!,
            );
            await buildNear(powered ? PHOTONCANNON : PYLON, target);
        }
    },
});

const engine = createEngine();
await engine.connect();

const [, results] = await engine.runGame(
    MAP,
    [createPlayer({ race: Race.PROTOSS }, bot), createPlayer({ race: Race.PROTOSS, difficulty })],
    { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
);

console.log(results);
engine.shutdown();
