import type { Agent, DataStorage, ResourceManager } from '@sc-bot/core';
import { buildAnchor } from '../anchor.ts';
import { getStrategy } from '../strategy/index.ts';
import { BARRACKS, FACTORY, REACTOR, STARPORT, TECHLAB } from '@sc-bot/core/constants/unit-type';
import { getWallBarracksPosition } from './wall.ts';
import {
    BUILD_REACTOR_BARRACKS,
    BUILD_REACTOR_FACTORY,
    BUILD_REACTOR_STARPORT,
    BUILD_TECHLAB_BARRACKS,
    BUILD_TECHLAB_FACTORY,
    BUILD_TECHLAB_STARPORT,
} from '@sc-bot/core/constants/ability';

const addonAbilities: Record<number, Record<typeof TECHLAB | typeof REACTOR, number>> = {
    [BARRACKS]: { [TECHLAB]: BUILD_TECHLAB_BARRACKS, [REACTOR]: BUILD_REACTOR_BARRACKS },
    [FACTORY]: { [TECHLAB]: BUILD_TECHLAB_FACTORY, [REACTOR]: BUILD_REACTOR_FACTORY },
    [STARPORT]: { [TECHLAB]: BUILD_TECHLAB_STARPORT, [REACTOR]: BUILD_REACTOR_STARPORT },
};

export const buildProduction = async (agent: Agent, resources: ResourceManager, data: DataStorage) => {
    const strategy = getStrategy();
    const { units, actions, map } = resources.get();
    data.settleEarmark('production')

    for (const { unitType, count, minArmy, ...addons } of strategy.production) {
        const current = units.getById(unitType).ready.length + agent.alreadyPending(unitType);
        if (current >= count) {
            continue;
        }

        const armyCount = units.getCombatUnits().length
        if (armyCount < minArmy) {
            return
        }

        // if there is NO barracks at wall position yet
        if (unitType === BARRACKS) {
            const wallPosition = getWallBarracksPosition(map, strategy);
            if (
                wallPosition &&
                !units.getById(BARRACKS).closerThan(1, wallPosition).length &&
                !units.getPendingAt(BARRACKS, wallPosition).length
            ) {
                return;
            }
        }

        if (!agent.hasTechFor(unitType)) {
            return;
        }

        if (!agent.canAfford(unitType, { earmark: 'production' })) {
            const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType)
            data.addEarmark({ name: 'production', minerals: mineralCost ?? 0, vespene: vespeneCost ?? 0 })
            return
        }


        const position = await actions.findPlacement(unitType, buildAnchor(map, 10), {
            addonPlace: (addons.reactors ?? 0) + (addons.techLabs ?? 0) > 0,
        });
        if (position) {
            await actions.build(unitType, position);
        }
        return;
    }
};


export const buildAddons = async (agent: Agent, resources: ResourceManager, data: DataStorage) => {
    const strategy = getStrategy();
    const { units, actions, map } = resources.get();

    const uniqueTypes = new Set(strategy.production.map(step => step.unitType))
    data.settleEarmark('addons')

    for (const unitType of uniqueTypes) {
        const currentUnits = units.getById(unitType).ready

        const armyCount = units.getCombatUnits().length
        const eligibleSteps = strategy.production.filter(
            (step) => step.unitType === unitType && armyCount >= step.minArmy,
        )
        if (!eligibleSteps.length) {
            continue
        }

        const targetCount = eligibleSteps.find((step) => step.count >= currentUnits.length)?.count
        const currentProductionStep = eligibleSteps.findLast(
            (step) => targetCount === undefined || step.count === targetCount,
        )!

        const { reactors, techLabs } = currentProductionStep
        const currentReactors = currentUnits.filter((unit) => unit.hasReactor()).length
        const currentTechLabs = currentUnits.filter((unit) => unit.hasTechLab()).length
        const currentNoAddon = currentUnits.filter(unit => !unit.hasTechLab() && !unit.hasReactor() && unit.isIdle())


        const techLabDiff = (techLabs ?? 0) - currentTechLabs
        const reactorDiff = (reactors ?? 0) - currentReactors

        if (reactorDiff <= 0 && techLabDiff <= 0) {
            continue
        }

        const addonToBuild = techLabDiff > 0 ? TECHLAB : REACTOR

        if (!currentNoAddon.length || !agent.hasTechFor(addonToBuild)) {
            continue
        }
        if (!agent.canAfford(addonToBuild)) {
            const { mineralCost, vespeneCost } = data.getUnitTypeData(addonToBuild)
            data.addEarmark({ name: 'addons', minerals: mineralCost ?? 0, vespene: vespeneCost ?? 0 })
        }

        const ability = addonAbilities[unitType]?.[addonToBuild]
        if (!ability) {
            continue
        }

        await actions.do(currentNoAddon[0].tag, ability)
    }
}