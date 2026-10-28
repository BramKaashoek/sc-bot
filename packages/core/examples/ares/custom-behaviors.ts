import { createAgent, createEngine, createPlayer, totalSupply } from '@sc-bot/core';
import type { Behavior, Unit, World } from '@sc-bot/core';
import { aMove, plan } from '@sc-bot/core/behaviors';
import { MORPH_SIEGEMODE, MORPH_UNSIEGE } from '@sc-bot/core/constants/ability';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { MARINE, SIEGETANK, SIEGETANKSIEGED } from '@sc-bot/core/constants/unit-type';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];

const MARINE_TANK_TYPES = [MARINE, SIEGETANKSIEGED, SIEGETANK];

export const customSiegeTankDecision = ({ unit }: { unit: Unit }): Behavior => ({
    name: 'customSiegeTankDecision',
    execute(ctx) {
        const { spatial } = ctx.world.resources.get();
        const nearEnemyGround = [...spatial.unitsInRange(unit, 14, 'enemyGround')];

        if (unit.unitType === SIEGETANK) {
            const closeToTank = [...spatial.unitsInRange(unit, 6.5, 'enemyGround')];
            const supply = totalSupply(nearEnemyGround);
            if (closeToTank.length === 0 && supply >= 4 && nearEnemyGround.length > 3) {
                ctx.order(unit, MORPH_SIEGEMODE);
                return true;
            }
        } else if (unit.unitType === SIEGETANKSIEGED && nearEnemyGround.length === 0) {
            ctx.order(unit, MORPH_UNSIEGE);
            return true;
        }

        return false;
    },
});

export const createBot = () =>
    createAgent({
        settings: { race: Race.TERRAN },
        async onStep({ resources }: World) {
            const { units, map, behaviors } = resources.get();
            const target = map.getLocations().enemy[0];

            await Promise.all(
                units
                    .getById(MARINE_TANK_TYPES)
                    .map((unit) => behaviors.run(plan(customSiegeTankDecision({ unit }), aMove({ unit, target })))),
            );
        },
    });

if (import.meta.main) {
    const engine = createEngine();
    await engine.connect();

    const [, results] = await engine.runGame(
        MAP,
        [createPlayer({ race: Race.TERRAN }, createBot()), createPlayer({ race: Race.ZERG, difficulty })],
        { gameTimeLimit, saveReplayAs: process.env.SAVE_REPLAY },
    );

    console.log(results);
    engine.shutdown();
}
