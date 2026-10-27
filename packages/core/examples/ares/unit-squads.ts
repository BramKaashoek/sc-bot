import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import type { Point2D, Unit, World } from '@sc-bot/core';
import { aMoveGroup, plan, stutterGroupForward } from '@sc-bot/core/behaviors';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { ATTACKING, CONTROL_GROUP_ONE } from '@sc-bot/core/constants/unit-role';
import { ROACH } from '@sc-bot/core/constants/unit-type';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];

const controlRoachHitSquad = async ({ resources }: World, target: Point2D) => {
    const { squads, spatial, behaviors } = resources.get();

    for (const squad of squads.getSquads(CONTROL_GROUP_ONE, { radius: 9 })) {
        const closeGroundEnemy = [...spatial.unitsInRange(squad.position, 11.5, 'enemyGround')];
        const group = [...squad.units];

        await behaviors.run(
            plan(
                stutterGroupForward({ group, groupPosition: squad.position, target, enemies: closeGroundEnemy }),
                aMoveGroup({ group, target }),
            ),
        );
    }
};

export const createBot = () => {
    let assignedRoachHitSquad = false;

    return createAgent({
        settings: { race: Race.ZERG },
        async onUnitCreated({ resources }: World, unit: Unit) {
            if (unit.isStructure() || unit.isWorker()) return;
            resources.get().roles.assign(unit, ATTACKING);
        },
        async onStep(world: World) {
            const { roles, map, frame } = world.resources.get();

            await controlRoachHitSquad(world, map.getLocations().enemy[0]);

            if (!assignedRoachHitSquad && frame.time() > 360) {
                assignedRoachHitSquad = true;
                roles.assign(roles.get(ATTACKING, { types: ROACH }), CONTROL_GROUP_ONE);
            }
        },
    });
};

if (import.meta.main) {
    const engine = createEngine();
    await engine.connect();

    const [, results] = await engine.runGame(
        MAP,
        [createPlayer({ race: Race.ZERG }, createBot()), createPlayer({ race: Race.PROTOSS, difficulty })],
        { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
    );

    console.log(results);
    engine.shutdown();
}
