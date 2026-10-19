import type { Agent, ResourceManager } from '@sc-bot/core';
import { buildAnchor } from '../anchor.ts';
import { getStrategy } from '../strategy/index.ts';
import { BARRACKS } from '@sc-bot/core/constants/unit-type';
import { getWallBarracksPosition } from './wall.ts';

export const buildProduction = async (agent: Agent, resources: ResourceManager) => {
    const strategy = getStrategy();
    const { units, actions, map } = resources.get();

    for (const { unitType, count, ...addons } of strategy.production) {
        const current = units.getById(unitType).ready.length + agent.alreadyPending(unitType);

        // if there is NO barracks at wall position yet
        if (unitType === BARRACKS) {
            const wallPosition = getWallBarracksPosition(map, strategy);
            if (wallPosition && !units.getById(BARRACKS).closerThan(1, wallPosition).length && !units.getPendingAt(BARRACKS, wallPosition).length) {
                continue
            }
        }

        if (agent.hasTechFor(unitType) && agent.canAfford(unitType) && current < count) {
            const position = await actions.findPlacement(unitType, buildAnchor(map, 10), {
                addonPlace: (addons.reactors ?? 0) + (addons.techLabs ?? 0) > 0,
            });

            if (position) {
                await actions.build(unitType, position);
                return;
            }
        }
    }
};
