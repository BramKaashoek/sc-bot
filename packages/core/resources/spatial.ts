import { NodeSC2Error } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

const notImplemented = (): never => {
    throw new NodeSC2Error('not implemented');
};

export const spatialResource: ResourceDefinition<'spatial'> = {
    name: 'spatial',
    create: () => ({
        unitsInRange: notImplemented,
        anyInRange: notImplemented,
        closest: notImplemented,
    }),
};
