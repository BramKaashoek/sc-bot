import { NodeSC2Error } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

const notImplemented = (): never => {
    throw new NodeSC2Error('not implemented');
};

export const influenceResource: ResourceDefinition<'influence'> = {
    name: 'influence',
    create: () => ({
        getGrid: notImplemented,
        addCost: notImplemented,
        configure: notImplemented,
        drawDebug: notImplemented,
    }),
};
