import type { ResourceManager, Units } from '@sc-bot/core';
import type { CombatState, Tag } from './types.ts';

export const getFreeUnits = ({
    resources,
    attacks,
    defenses,
    scoutTag,
}: {
    resources: ResourceManager;
    attacks: CombatState['attacks'];
    defenses: CombatState['defenses'];
    scoutTag: Tag | undefined;
}) => {
    const { units, map } = resources.get();
    return units
        .getCombatUnits()
        .closerThan(10, map.getCombatRally())
        .tagsNotIn([
            ...Object.values(defenses).flatMap((defense) => defense.unitTags),
            ...Object.values(attacks).flatMap((attack) => attack.unitTags),
            ...(scoutTag ? [scoutTag] : []),
        ]);
};

export const getUnitsCost = (units: Units) =>
    units.reduce((acc, curr) => {
        return acc + (curr.data().mineralCost ?? 0) + (curr.data().vespeneCost ?? 0);
    }, 0);
