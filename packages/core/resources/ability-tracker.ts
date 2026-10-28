import { NodeSC2Error } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

const stub = (name: string) => (): never => {
    throw new NodeSC2Error(`not implemented: ${name}`);
};

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
