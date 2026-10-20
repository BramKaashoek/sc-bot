import { Units, type ResourceManager } from '@sc-bot/core';
import { Alliance } from '@sc-bot/core/constants/enums';
import { log } from '../log.ts';
import type { CombatState, OffenseTarget, Tag } from './types.ts';
import { getFreeUnits, getMopUpTargets, getUnitsCost, toPoint } from './utils.ts';
import { runMicro } from './micro/index.ts';

export const getOffenseTargets = ({
    resources,
    scoutedEmpty,
}: {
    resources: ResourceManager;
    scoutedEmpty: CombatState['scoutedEmpty'];
}): OffenseTarget[] => {
    const TOWN_SIZE_LIMIT = 25;
    const MEMORY_SECONDS = 60;
    const DEFENDER_COST_OFFSET = 100;

    const { units, map } = resources.get();
    const enemyArmy = units
        .getAll(Alliance.ENEMY)
        .filter(
            (unit) => unit.isCombatUnit() && (unit.isCurrent() || (unit.isMemory() && unit.age() < MEMORY_SECONDS)),
        );

    const enemyBases = map.getOccupiedExpansions(Alliance.ENEMY).map((expansion) => ({
        pos: expansion.townhallPosition,
        buildings: units.getEnemyStructures().closerThan(TOWN_SIZE_LIMIT, expansion.townhallPosition),
        units: enemyArmy.closerThan(TOWN_SIZE_LIMIT, expansion.townhallPosition),
    }));

    // TODO: cluster scattered and score appropriately
    const enemyScatteredBuildings = units
        .getEnemyStructures()
        .filter((building) => !building.isFlying || map.isPathable(building.pos))
        .filter((building) => !enemyBases.some((base) => building.distanceTo(base.pos) < TOWN_SIZE_LIMIT))
        .map((building) => ({
            pos: building.pos,
            buildings: new Units(building),
            units: enemyArmy.closerThan(TOWN_SIZE_LIMIT, building.pos),
        }));

    const offenseTargets = [...enemyBases, ...enemyScatteredBuildings]
        .map((target) => ({
            ...target,
            // add offset so every undefended target does not outrank every defended one
            score: getUnitsCost(target.buildings) / (getUnitsCost(target.units) + DEFENDER_COST_OFFSET),
        }))
        .sort((a, b) => b.score - a.score);
    if (offenseTargets.length > 0) {
        return offenseTargets;
    }

    if (scoutedEmpty[map.getExpansions().indexOf(map.getEnemyMain())] === undefined) {
        return [{ pos: map.getEnemyMain().townhallPosition, buildings: new Units(), units: new Units(), score: 1 }];
    }

    return [];
};

export const attackTargets = async ({
    resources,
    offenseTargets,
    attacks,
    retreats,
    defenses,
    scoutedEmpty,
    scoutTag,
    setState,
}: {
    resources: ResourceManager;
    offenseTargets: OffenseTarget[];
    attacks: CombatState['attacks'];
    retreats: CombatState['retreats'];
    defenses: CombatState['defenses'];
    scoutedEmpty: CombatState['scoutedEmpty'];
    scoutTag: Tag | undefined;
    setState: (state: Partial<CombatState>) => void;
}) => {
    const MIN_ATTACK_SIZE = 9;
    const RETREAT_WINDOW = 1344;
    const { units, actions, map, frame } = resources.get();
    const now = frame.getGameLoop();
    const nextAttacks = { ...attacks };
    const nextRetreats = { ...retreats };
    const nextScoutedEmpty = { ...scoutedEmpty };

    // clean up retreats; keep an arrived retreat for its enemyCost until the window passes
    for (const [positionString, retreat] of Object.entries(retreats)) {
        const stillRetreating = units
            .getCombatUnits()
            .tagsIn(retreat.unitTags)
            .filter((unit) => unit.distanceTo(map.getCombatRally()) > 10);

        if (!stillRetreating.length && now - retreat.at > RETREAT_WINDOW) {
            delete nextRetreats[positionString];
            continue;
        }
        nextRetreats[positionString] = { ...retreat, unitTags: stillRetreating.map((unit) => unit.tag) };
    }

    // clean up failed or complete attacks
    for (const attack of Object.entries(attacks)) {
        const [positionString, { unitTags }] = attack;
        const alive = units.getCombatUnits().tagsIn(unitTags);

        if (!alive.length) {
            delete nextAttacks[positionString];
        }
    }

    // retreat if necessary
    for (const attack of Object.entries(nextAttacks)) {
        const [positionString, { unitTags }] = attack;
        const alive = units.getCombatUnits().tagsIn(unitTags);
        const aliveCost = getUnitsCost(alive);
        const enemies = units.getCombatUnits(Alliance.ENEMY).closerThan(15, alive.center);
        const enemiesCost = getUnitsCost(enemies);

        if (enemiesCost < aliveCost * 1.2) {
            continue;
        }

        delete nextAttacks[positionString];
        nextRetreats[positionString] = {
            unitTags: [...(nextRetreats[positionString]?.unitTags ?? []), ...alive.map((unit) => unit.tag)],
            enemyCost: enemiesCost,
            at: now,
        };
        log(
            { resources },
            `attack: retreating from ${positionString} | ${alive.length} units | cost ${aliveCost} vs enemy ${enemiesCost}`,
            'red',
        );
    }

    // continue ongoing attacks
    for (const attack of Object.entries(nextAttacks)) {
        const [positionString, attackState] = attack;
        const alive = units.getCombatUnits().tagsIn(attackState.unitTags);

        if (!alive.every((unit) => unit.isIdle())) continue;

        if (getMopUpTargets(resources, toPoint(positionString)).length) continue;

        // no enemies left
        const expansionIndex = map
            .getExpansions()
            .findIndex(
                (expansion) => `${expansion.townhallPosition.x},${expansion.townhallPosition.y}` === positionString,
            );
        if (expansionIndex !== -1) {
            nextScoutedEmpty[expansionIndex] = frame.getGameLoop();
        }

        // go home
        await actions.attackMove(alive, map.getCombatRally());
        delete nextAttacks[positionString];
        log({ resources }, `attack: done at ${positionString}, ${alive.length} units returning`, 'green');
    }

    // reinforce existing attacks if necessary
    for (const attack of Object.entries(nextAttacks)) {
        const [positionString, attackState] = attack;
        const alive = units.getCombatUnits().tagsIn(attackState.unitTags);
        const availableUnits = getFreeUnits({ resources, attacks: nextAttacks, defenses, scoutTag: scoutTag });

        if (!alive.every((unit) => unit.isIdle()) && availableUnits.length > MIN_ATTACK_SIZE) {
            nextAttacks[positionString] = {
                ...attackState,
                unitTags: [...attackState.unitTags, ...availableUnits.map((unit) => unit.tag)],
            };
            log({ resources }, `attack: reinforcing ${positionString} with ${availableUnits.length} units`, 'yellow');
        }
    }

    // start new attack if none currently exist
    if (!Object.keys(nextAttacks).length && offenseTargets.length) {
        const firstTargetPos = offenseTargets[0].pos;
        const targetKey = `${firstTargetPos.x},${firstTargetPos.y}`;
        const availableUnits = getFreeUnits({ resources, attacks: nextAttacks, defenses, scoutTag: scoutTag });
        const isRetreating = Object.values(nextRetreats).some((retreat) => retreat.unitTags.length);
        const recentRetreat = nextRetreats[targetKey];
        const enemyCost = Math.max(
            getUnitsCost(offenseTargets[0].units),
            recentRetreat && now - recentRetreat.at < RETREAT_WINDOW ? recentRetreat.enemyCost : 0,
        );

        // TODO: compare to required amount of units instead of flat value
        if (
            !isRetreating &&
            availableUnits.length > MIN_ATTACK_SIZE &&
            getUnitsCost(availableUnits) > 1.2 * enemyCost
        ) {
            nextAttacks[targetKey] = {
                unitTags: availableUnits.map((unit) => unit.tag),
            };
            log(
                { resources },
                `attack: launching at ${targetKey} | ${availableUnits.length} units | cost ${getUnitsCost(availableUnits)} vs enemy ${enemyCost}`,
                'yellow',
            );
        }
    }

    for (const [positionString, { unitTags }] of Object.entries(nextAttacks)) {
        const group = units.getCombatUnits().tagsIn(unitTags);
        if (group.length) {
            await runMicro({ resources, group, target: toPoint(positionString), intent: 'attack' });
        }
    }

    for (const { unitTags } of Object.values(nextRetreats)) {
        const group = units.getCombatUnits().tagsIn(unitTags);
        if (group.length) {
            await runMicro({ resources, group, target: map.getCombatRally(), intent: 'retreat' });
        }
    }

    setState({ attacks: nextAttacks, retreats: nextRetreats, scoutedEmpty: nextScoutedEmpty });
};
