import { NodeSC2Error } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

const notImplemented = (): never => {
    throw new NodeSC2Error('not implemented');
};

export const flyingResource: ResourceDefinition<'flying'> = {
    name: 'flying',
    create: () => {
        const settings = { priority: 10 };
        return {
            move: notImplemented,
            swap: notImplemented,
            addonSwap: notImplemented,
            cancel: notImplemented,
            getPlans: notImplemented,
            configure: (next) => {
                Object.assign(settings, next);
            },
        };
    },
    reset: () => {},
    onStep: () => {},
};
