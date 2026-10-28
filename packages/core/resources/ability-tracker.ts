import { stub } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

export const abilityTrackerResource: ResourceDefinition<'abilityTracker'> = {
    name: 'abilityTracker',
    create() {
        return {
            used: stub('used'),
            ready: stub('ready'),
            readyAt: stub('readyAt'),
            setCooldown: stub('setCooldown'),
        };
    },
};
