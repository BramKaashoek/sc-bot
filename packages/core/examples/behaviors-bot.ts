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
const HOME_DEFENSE_RANGE = 25;
const ATTACK_SUPPLY = 20;
const RETREAT_SUPPLY = 8;

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

const fight = async (world: World, army: { attacking: boolean }) => {
    const { squads, spatial, behaviors, map, units } = world.resources.get();
    const { foodArmy = 0 } = world.agent;
    if (foodArmy >= ATTACK_SUPPLY) army.attacking = true;
    else if (foodArmy < RETREAT_SUPPLY) army.attacking = false;

    const members = squads.getSquads(ATTACKING).flatMap((squad) => [...squad.units]);
    if (members.length === 0) return;
    const position = squads.getMainSquadPosition(ATTACKING);
    const medivacs = members.filter((unit) => unit.unitType === MEDIVAC);
    const group = members.filter((unit) => unit.unitType !== MEDIVAC);

    const intruders = units
        .getBases()
        .flatMap((base) => [...spatial.unitsInRange(base.pos!, HOME_DEFENSE_RANGE, 'enemyGround')]);
    const nearby = [...spatial.unitsInRange(position, NEARBY_ENEMY_RANGE, 'enemyGround')];
    const enemies = intruders.length > 0 ? intruders : nearby;
    const target =
        intruders.length > 0 ? intruders[0].pos! : army.attacking ? map.getLocations().enemy[0] : map.getCombatRally();

    const winning = enemies.length === 0 || canWinFight(group, enemies) >= VICTORY_CLOSE;
    await behaviors.run(
        !winning
            ? keepGroupSafe({ group, closeEnemy: enemies, layer: 'ground' })
            : army.attacking || intruders.length > 0
              ? plan(
                    stutterGroupForward({ group, groupPosition: position, target, enemies }),
                    aMoveGroup({ group, target }),
                )
              : aMoveGroup({ group, target }),
        { role: ATTACKING },
    );

    for (const medivac of medivacs) {
        await behaviors.run(
            plan(
                medivacHeal({ unit: medivac, allies: group, layer: 'air' }),
                pathUnitToTarget({ unit: medivac, target: position, layer: 'air' }),
            ),
            { role: ATTACKING },
        );
    }
};

export const createBot = () => {
    const army = { attacking: false };
    return createAgent({
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
            await fight(world, army);
        },
    });
};

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
