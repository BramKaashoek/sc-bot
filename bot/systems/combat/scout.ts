import type { ResourceManager } from '@sc-bot/core';
import { Alliance } from '@sc-bot/core/constants/enums';
import { UnitType, UnitTypeId } from '@sc-bot/core/constants/index';
import { log } from '../log.ts';
import type { CombatState } from './types.ts';
import { getFreeUnits } from './utils.ts';

export const scout = async ({
    resources,
    defenses,
    attacks,
    scout,
    scoutedEmpty,
    setState,
}: {
    resources: ResourceManager;
    attacks: CombatState['attacks'];
    defenses: CombatState['defenses'];
    scout: CombatState['scout'];
    scoutedEmpty: CombatState['scoutedEmpty'];
    setState: (state: Partial<CombatState>) => void;
}) => {
    const TWO_MINUTES = 2688;
    const { units, map, frame, actions } = resources.get();
    const now = frame.getGameLoop();
    let nextScout = scout;
    const nextScoutedEmpty = { ...scoutedEmpty };

    if (scout.tag && !units.getCombatUnits().tagsIn([scout.tag])[0]) {
        nextScout = { tag: undefined, lastDiedAt: now };
        log({ resources }, 'scout: died', 'red');
    }

    // get a new scout if there hasnt been one yet, or last died more than 2 min ago
    if (!nextScout.tag && (nextScout.lastDiedAt === undefined || now - nextScout.lastDiedAt > TWO_MINUTES)) {
        const freeUnits = getFreeUnits({ resources, attacks, defenses, scoutTag: undefined });
        const availableScout = freeUnits.ofType(UnitType.REAPER)[0] ?? freeUnits.ofType(UnitType.MARINE)[0];
        if (availableScout) {
            nextScout = { ...nextScout, tag: availableScout.tag };
            log({ resources }, `scout: assigned ${UnitTypeId[availableScout.unitType]}`, 'magenta');
        }
    }

    if (nextScout !== scout) {
        setState({ scout: nextScout });
    }

    const scoutUnit = nextScout.tag ? units.getCombatUnits().tagsIn([nextScout.tag])[0] : undefined;
    if (!scoutUnit) {
        return;
    }

    const enemyOccupied = map.getOccupiedExpansions(Alliance.ENEMY);
    const selfOccupied = map.getOccupiedExpansions();

    // if scout is in an empty expansion base, register it
    const nearestExpansion = map.getClosestExpansion(scoutUnit.pos);
    if (
        scoutUnit.isIdle() &&
        !selfOccupied.includes(nearestExpansion) &&
        scoutUnit.distanceTo(nearestExpansion.townhallPosition) < 10 &&
        !units.getEnemyStructures().closerThan(25, nearestExpansion.townhallPosition).length
    ) {
        nextScoutedEmpty[map.getExpansions().indexOf(nearestExpansion)] = frame.getGameLoop();
        setState({ scoutedEmpty: nextScoutedEmpty });
        log({ resources }, `scout: expansion ${map.getExpansions().indexOf(nearestExpansion)} is empty`, 'magenta');
    }

    // look for next expansion to scout
    const expansionsToScout = map
        .getExpansions()
        .filter((expansion) => {
            if (enemyOccupied.includes(expansion)) {
                return false;
            }
            if (selfOccupied.includes(expansion)) {
                return false;
            }
            if (units.getEnemyStructures().closerThan(25, expansion.townhallPosition).length) {
                return false;
            }
            const lastScouted = nextScoutedEmpty[map.getExpansions().indexOf(expansion)];
            if (lastScouted !== undefined && frame.getGameLoop() - lastScouted < TWO_MINUTES) {
                return false;
            }

            return true;
        })
        .sort(
            (a, b) =>
                (nextScoutedEmpty[map.getExpansions().indexOf(a)] ?? -Infinity) -
                (nextScoutedEmpty[map.getExpansions().indexOf(b)] ?? -Infinity),
        );

    // move the scout
    if (!scoutUnit.isIdle()) {
        return;
    }

    const home = map.getMain();
    if (expansionsToScout[0]) {
        await actions.move(scoutUnit, expansionsToScout[0].townhallPosition);
        log(
            { resources },
            `scout: heading to expansion ${map.getExpansions().indexOf(expansionsToScout[0])} | dist ${scoutUnit.distanceTo(expansionsToScout[0].townhallPosition).toFixed(1)} | nearest ${map.getExpansions().indexOf(nearestExpansion)} | enemy structures ${units.getEnemyStructures().closerThan(25, expansionsToScout[0].townhallPosition).length}`,
            'magenta',
        );
    } else if (home && scoutUnit.distanceTo(home.townhallPosition) > 10) {
        await actions.move(scoutUnit, home.townhallPosition);
        log({ resources }, 'scout: nothing left to scout, returning to main', 'magenta');
    }
};
