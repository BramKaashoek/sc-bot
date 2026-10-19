import type { ResourceManager } from '@sc-bot/core';
import type { CombatState, DefenseTarget } from './types.ts';

export const getDefenseTargets = (resources: ResourceManager): DefenseTarget[] => {
    const { units } = resources.get();
    const enemies = units.getEnemyUnits();
    const attackedBases = units
        .getBases()
        .map((base) => ({ base, enemies: enemies.closerThan(15, base.pos) }))
        .filter((e) => e.enemies.exists);

    const defenseTargets = attackedBases.sort((a, b) => {
        return (
            b.enemies.filter((enemy) => enemy.isCombatUnit()).length -
            a.enemies.filter((enemy) => enemy.isCombatUnit()).length
        );
    });

    return defenseTargets;
};

export const defendTargets = async ({
    resources,
    defenseTargets,
    defenses,
    setState,
}: {
    resources: ResourceManager;
    defenseTargets: DefenseTarget[];
    defenses: CombatState['defenses'];
    setState: (state: Partial<CombatState>) => void;
}) => {
    const { units, actions, map } = resources.get();

    for (const target of defenseTargets) {
        // take worker rush into account
        // remove dead units from tag list
        // determine appropriate response size based on number of enemies and their type
        // select appropriate defenders for enemy composition
        // send them on their way to defend the base
        const defenders = units.getCombatUnits().closerThan(30, target.base.pos);
        // supplement with workers if needed
        // supplement with main army if needed
        // update state
    }

    // const bases = units.getBases()
    // const enemies = units.getEnemyUnits().notFlying
    // const offenses = bases.map(base => ({ base, enemies: enemies.closerThan(15, base.pos) })).filter(e => e.enemies.exists)

    // const combatUnitDefenders = units.getCombatUnits().closerThan(30, map.getCombatRally())
    // const defenders = [...combatUnitDefenders]
    // const enemyCombatUnits = enemies.filter(enemy => enemy.isCombatUnit())

    // if (defenders.length < 2 && Boolean(intruder.isCombatUnit)) {
    //     const workers = units.getMineralWorkers().closerThan(15, intruder.pos)
    //     defenders.push(...workers.slice(0, Math.min(workers.length - 3, enemyCombatUnits.length)))
    // }

    // if (intruder && defenders.length > 0) {
    //     await actions.attackMove(defenders, intruder.pos,);
    //     await actions.attackMove(combatUnitDefenders, map.getCombatRally(), true)
    // }
};
