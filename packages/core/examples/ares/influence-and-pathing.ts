import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import type { Point2D, World } from '@sc-bot/core';
import { center, keepGroupSafe, keepUnitSafe, pathGroupToTarget, pathUnitToTarget } from '@sc-bot/core/behaviors';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];
const RADIUS_BUFFER = 2;
const LOW_PRIORITY_POINTS = 8;
const LOW_PRIORITY_SENSITIVITY = 4;

function lowPriorityPath(rawPath: Point2D[], target: Point2D): Point2D[] {
    // findPath ignores sensitivity; assumes map_analyzer's pathfind thins the path by stride
    const path = rawPath.filter((_, index) => index % LOW_PRIORITY_SENSITIVITY === 0);
    if (path.length < 10) return [target];
    return [
        ...Array.from(
            { length: LOW_PRIORITY_POINTS },
            (_, i) => path[Math.floor((i * (path.length - 1)) / (LOW_PRIORITY_POINTS - 1))],
        ),
        target,
    ];
}

const bot = createAgent({
    settings: { race: Race.PROTOSS },
    async onStep({ resources }: World) {
        const { map, units, influence, pathing, behaviors } = resources.get();
        const start = map.getLocations().self!;
        const [enemyStart] = map.getLocations().enemy;

        influence.addCost('ground', enemyStart, 20, 100.5);
        for (const enemy of units.getEnemyUnits()) {
            if (enemy.groundDps() > 0) {
                influence.addCost('ground', enemy.pos, enemy.groundRange() + RADIUS_BUFFER, enemy.groundDps());
            }
            if (enemy.airDps() > 0) {
                influence.addCost('air', enemy.pos, enemy.airRange() + RADIUS_BUFFER, enemy.airDps());
            }
        }

        const moveTo = pathing.nextPoint(start, enemyStart, { layer: 'ground' });
        const airNextPoint = pathing.nextPoint(start, enemyStart, { layer: 'air' });
        const rawPath = pathing.findPath(start, enemyStart, { layer: 'air' });
        const lowPriority = lowPriorityPath(rawPath, enemyStart);
        const safeSpot = pathing.closestSafeSpot(start, { layer: 'airAvoidance', radius: 8 });
        console.debug(moveTo, airNextPoint, rawPath.length, lowPriority, safeSpot);

        const [pathingWorker, safeWorker, ...rest] = units.getWorkers();
        if (!pathingWorker || !safeWorker) return;

        const dangerLevel = influence.getGrid('ground').get(safeWorker.pos);
        const isSafe = pathing.isPositionSafe(safeWorker.pos, { layer: 'ground', limit: 1 });
        console.debug(dangerLevel, isSafe);

        await behaviors.run(pathUnitToTarget({ unit: pathingWorker, target: map.getCenter(), layer: 'ground' }));
        await behaviors.run(keepUnitSafe({ unit: safeWorker, layer: 'ground' }));

        const half = Math.ceil(rest.length / 2);
        const pathGroup = rest.slice(0, half);
        const safeGroup = rest.slice(half);
        if (pathGroup.length > 0) {
            await behaviors.run(
                pathGroupToTarget({
                    start: center(pathGroup),
                    group: pathGroup,
                    target: map.getCenter(),
                    layer: 'ground',
                }),
            );
        }
        await behaviors.run(keepGroupSafe({ group: safeGroup, closeEnemy: units.getEnemyUnits(), layer: 'ground' }));
    },
});

const engine = createEngine();
await engine.connect();

const [, results] = await engine.runGame(
    MAP,
    [createPlayer({ race: Race.PROTOSS }, bot), createPlayer({ race: Race.ZERG, difficulty })],
    { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
);

console.log(results);
engine.shutdown();
