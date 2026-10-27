import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import type { Unit, World } from '@sc-bot/core';
import { dropCargo, keepUnitSafe, pathUnitToTarget, pickUpCargo, plan } from '@sc-bot/core/behaviors';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { MEDIVAC, WIDOWMINE } from '@sc-bot/core/constants/unit-type';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'MEDIUM').toUpperCase() as keyof typeof Difficulty];

const mineDrop = ({ resources }: World, medivac: Unit, minesToPickUp: Unit[]) => {
    const layer = 'air';
    const hasCargo = (medivac.cargoSpaceTaken ?? 0) > 0;

    return plan(
        pickUpCargo({ unit: medivac, targets: minesToPickUp, layer }),
        ...(hasCargo
            ? [
                  // ares' default success distance of 0 never lets the drop run
                  pathUnitToTarget({
                      unit: medivac,
                      target: resources.get().map.getLocations().enemy[0],
                      layer,
                      successAtDistance: 3,
                  }),
                  dropCargo({ unit: medivac }),
              ]
            : [keepUnitSafe({ unit: medivac, layer })]),
    );
};

export const createBot = () =>
    createAgent({
        settings: { race: Race.TERRAN },
        async onStep(world: World) {
            const { units, behaviors } = world.resources.get();
            const minesToPickUp = units.getById(WIDOWMINE);
            await Promise.all(
                units.getById(MEDIVAC).map((medivac) => behaviors.run(mineDrop(world, medivac, minesToPickUp))),
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
