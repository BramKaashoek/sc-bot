import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import type { InfluenceGrid, World } from '@sc-bot/core';
import { center, keepGroupSafe, keepUnitSafe, pathGroupToTarget, pathUnitToTarget } from '@sc-bot/core/behaviors';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];
const RADIUS_BUFFER = 2;

let ownGrid: InfluenceGrid | undefined;

const bot = createAgent({
    settings: { race: Race.PROTOSS },
    async onStep({ resources }: World) {
        const { map, units, influence, pathing, behaviors } = resources.get();
        const start = map.getLocations().self!;
        const [enemyStart] = map.getLocations().enemy;

        if (!ownGrid) {
            ownGrid = influence.getCleanGrid('ground');
            influence.addCost(ownGrid, enemyStart, 20, 100.5);
        }
        for (const enemy of units.getEnemyUnits()) {
            if (enemy.groundDps() > 0) {
                influence.addCost('ground', enemy.pos, enemy.groundRange() + RADIUS_BUFFER, enemy.groundDps());
            }
            if (enemy.airDps() > 0) {
                influence.addCost('air', enemy.pos, enemy.airRange() + RADIUS_BUFFER, enemy.airDps());
            }
        }

        const moveTo = pathing.nextPoint(start, enemyStart, { layer: 'ground', smoothing: true });
        const climbPoint = pathing.nextPoint(start, enemyStart, { layer: 'climber' });
        const airPath = pathing.findPath(start, enemyStart, { layer: 'airVsGround', smoothing: true });
        const customPath = pathing.findPath(start, enemyStart, { layer: ownGrid, smoothing: true });
        const lowPriority = pathing.findLowPriorityPath(start, enemyStart, { layer: 'air' });
        const safeSpot = pathing.closestSafeSpot(start, { layer: 'airAvoidance', radius: 8 });
        console.debug(moveTo, climbPoint, airPath.length, customPath.length, lowPriority, safeSpot);

        const [pathingWorker, safeWorker, ...rest] = units.getWorkers();
        if (!pathingWorker || !safeWorker) return;

        const dangerLevel = influence.getGrid('ground').get(safeWorker.pos);
        const isSafe = pathing.isPositionSafe(safeWorker.pos, { layer: 'ground', limit: 1 });
        const antiAirCost = influence.getGrid('groundToAir').get(safeWorker.pos);
        console.debug(dangerLevel, isSafe, antiAirCost);

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
