import type { Agent, ResourceManager } from '@sc-bot/core';
import { Alliance } from '@sc-bot/core/constants/enums';
import { BARRACKS, MARINE } from '@sc-bot/core/constants/unit-type';
import { getStrategy } from '../strategy';
import { UnitType } from '@sc-bot/core/constants/index';

export const trainMarine = (agent: Agent, resources: ResourceManager) => {
    const { units, actions } = resources.get();

    if ((agent.minerals ?? 0) < 500 || !agent.canFeed(MARINE)) return;

    const idleBarracks = units.getById(BARRACKS, {
        noQueue: true,
        alliance: Alliance.SELF,
    }).ready;
    return Promise.all(idleBarracks.map((barracks) => actions.train(MARINE, barracks)));
};

export const trainArmy = async (agent: Agent, resources: ResourceManager) => {
    const { units } = resources.get();
    const strategy = getStrategy();

    const existing: { [key: string]: number } = {};
    for (const [unitType, weight] of Object.entries(strategy.army)) {
        existing[unitType] = (units.getById(Number(unitType)).length + agent.alreadyPending(Number(unitType))) / weight;
    }

    for (const [unitType] of Object.entries(existing).sort((a, b) => a[1] - b[1])) {
        if (!agent.canAfford(Number(unitType))) { continue };
        await agent.train(Number(unitType));
    }
};
