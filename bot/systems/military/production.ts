import type { Agent, ResourceManager } from '@sc-bot/core';
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

export const buildProduction = async (agent: Agent, resources: ResourceManager) => {
    const strategy = getStrategy();
    const { units, actions, map } = resources.get();

    for (const { unitType, count, ...addons } of strategy.production) {
        const current = units.getById(unitType).ready.length + agent.alreadyPending(unitType);
        if (current >= count) {
            continue;
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

        // TODO: earmark this entry's cost when it can't be afforded yet, and gate trainArmy with agent.canAfford (agent.train ignores earmarks)
        if (!agent.hasTechFor(unitType) || !agent.canAfford(unitType)) {
            return;
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


export const buildAddons = async (agent: Agent, resources: ResourceManager) => {
    const strategy = getStrategy();
    const { units, actions, map } = resources.get();

    const uniqueTypes = new Set(strategy.production.map(step => step.unitType))

    for (const unitType of uniqueTypes) {
        const currentUnits = units.getById(unitType).ready

        const relevantStepsReversed = strategy.production.filter(step => step.unitType === unitType).toReversed()
        // get the current production step goals
        const currentProductionStep = relevantStepsReversed.reduce((acc, curr) => {
            return currentUnits.length > curr.count ? acc : curr
        }, relevantStepsReversed[0])

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

        if (!currentNoAddon.length || !agent.hasTechFor(addonToBuild) || !agent.canAfford(addonToBuild)) {
            continue
        }

        const ability = addonAbilities[unitType]?.[addonToBuild]
        if (!ability) {
            continue
        }

        await actions.do(ability, currentNoAddon[0].tag)
    }
}