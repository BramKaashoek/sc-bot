import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import type { Unit, World } from '@sc-bot/core';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { ATTACKING, HARASSING } from '@sc-bot/core/constants/unit-role';
import { ROACH, ZERGLING } from '@sc-bot/core/constants/unit-type';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];

const LING_ROACH_TYPES = [ZERGLING, ROACH];

export const createBot = () => {
    let assignedLingHarass = false;

    return createAgent({
        settings: { race: Race.ZERG },
        async onUnitCreated({ resources }: World, unit: Unit) {
            if (LING_ROACH_TYPES.includes(unit.unitType!)) resources.get().roles.assign(unit, ATTACKING);
        },
        async onStep({ resources }: World) {
            const { roles, actions, map } = resources.get();

            if (roles.get(ATTACKING).length > 0 && !assignedLingHarass) {
                assignedLingHarass = true;
                const lings = roles.get(ATTACKING, { types: ZERGLING });
                roles.assign(
                    lings.filter((_, index) => index % 2 === 0),
                    HARASSING,
                );
            }

            const lingRoachForce = roles.get(ATTACKING);
            if (lingRoachForce.length > 0) {
                await actions.attackMove(lingRoachForce, map.getLocations().enemy[0]);
            }

            const lingHarassers = roles.get(HARASSING);
            if (lingHarassers.length > 0) {
                await actions.attackMove(lingHarassers, map.getEnemyThirds()[0].townhallPosition);
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
