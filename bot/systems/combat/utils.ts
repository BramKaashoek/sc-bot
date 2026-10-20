import type { Point2D, ResourceManager, Units } from '@sc-bot/core';
import { Alliance } from '@sc-bot/core/constants/enums';
import type { CombatState, StringPosition, Tag } from './types.ts';

export const MOP_UP_RADIUS = 25;

export const toPoint = (position: StringPosition): Point2D => {
    const [x, y] = position.split(',');
    return { x: Number(x), y: Number(y) };
};

export const getMopUpTargets = (resources: ResourceManager, target: Point2D) => {
    const { units, map } = resources.get();
    return units
        .getAlive(Alliance.ENEMY)
        .closerThan(MOP_UP_RADIUS, target)
        .filter((enemy) => !enemy.isFlying || map.isPathable(enemy.pos));
};

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
