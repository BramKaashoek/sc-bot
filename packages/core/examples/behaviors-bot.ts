import { canWinFight, createAgent, createEngine, createPlayer } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import {
    aMoveGroup,
    autoSupply,
    buildWorkers,
    expansionController,
    gasBuildingController,
    keepGroupSafe,
    medivacHeal,
    pathUnitToTarget,
    plan,
    productionController,
    spawnController,
    stutterGroupForward,
    upgradeCCs,
    upgradeController,
} from '@sc-bot/core/behaviors';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';
import { VICTORY_CLOSE } from '@sc-bot/core/constants/engagement-result';
import { ATTACKING, GATHERING } from '@sc-bot/core/constants/unit-role';
import { MARAUDER, MARINE, MEDIVAC, MULE, ORBITALCOMMAND } from '@sc-bot/core/constants/unit-type';
import { SHIELDWALL, STIMPACK, TERRANINFANTRYWEAPONSLEVEL1 } from '@sc-bot/core/constants/upgrade';

const MAP = process.env.MAP ?? 'Melee/Simple64';
const gameTimeLimit = process.env.GAME_TIME_LIMIT ? Number(process.env.GAME_TIME_LIMIT) : undefined;
const difficulty = Difficulty[(process.env.DIFFICULTY ?? 'EASY').toUpperCase() as keyof typeof Difficulty];

export const MACRO_OWNER = 'behaviors-bot:macro';
const NEARBY_ENEMY_RANGE = 14;

export const composition = {
    [MARINE]: { proportion: 0.7, priority: 2 },
    [MARAUDER]: { proportion: 0.2, priority: 1 },
    [MEDIVAC]: { proportion: 0.1, priority: 0 },
};

const macro = ({ resources }: World) => {
    const base = resources.get().map.getLocations().self;
    return plan(
        autoSupply({ base }),
        buildWorkers({ toCount: 66 }),
        gasBuildingController({ toCount: 4 }),
        expansionController({ toCount: 3 }),
        upgradeCCs({ to: ORBITALCOMMAND }),
        upgradeController({ upgrades: [STIMPACK, SHIELDWALL, TERRANINFANTRYWEAPONSLEVEL1], base }),
        productionController({ composition, base }),
        spawnController({ composition }),
    );
};

const fight = async ({ resources }: World) => {
    const { squads, spatial, behaviors, map } = resources.get();
    const target = map.getLocations().enemy[0];

    for (const squad of squads.getSquads(ATTACKING)) {
        const members = [...squad.units];
        const medivacs = members.filter((unit) => unit.unitType === MEDIVAC);
        const group = members.filter((unit) => unit.unitType !== MEDIVAC);
        const enemies = [...spatial.unitsInRange(squad.position, NEARBY_ENEMY_RANGE, 'enemyGround')];

        const winning = enemies.length === 0 || canWinFight(group, enemies) >= VICTORY_CLOSE;
        await behaviors.run(
            winning
                ? plan(
                      stutterGroupForward({ group, groupPosition: squad.position, target, enemies }),
                      aMoveGroup({ group, target }),
                  )
                : keepGroupSafe({ group, closeEnemy: enemies, layer: 'ground' }),
            { role: ATTACKING },
        );

        for (const medivac of medivacs) {
            await behaviors.run(
                plan(
                    medivacHeal({ unit: medivac, allies: group, layer: 'air' }),
                    pathUnitToTarget({ unit: medivac, target: squad.position, layer: 'air' }),
                ),
                { role: ATTACKING },
            );
        }
    }
};

export const createBot = () =>
    createAgent({
        settings: { race: Race.TERRAN },
        async onGameStart({ resources }: World) {
            const { mining, roles } = resources.get();
            mining.configure({ enabled: true });
            roles.configure({
                defaultRole: (unit) =>
                    unit.unitType === MULE || unit.isStructure() ? undefined : unit.isWorker() ? GATHERING : ATTACKING,
            });
        },
        async onStep(world: World) {
            const { actions, behaviors } = world.resources.get();
            await actions.as({ owner: MACRO_OWNER }, () => behaviors.run(macro(world)));
            await fight(world);
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
