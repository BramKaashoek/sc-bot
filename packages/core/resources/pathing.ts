import { NodeSC2Error } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

const notImplemented = (): never => {
    throw new NodeSC2Error('not implemented');
};

export const pathingResource: ResourceDefinition<'pathing'> = {
    name: 'pathing',
    create: () => ({
        findPath: notImplemented,
        nextPoint: notImplemented,
        closestSafeSpot: notImplemented,
        isPositionSafe: notImplemented,
    }),
};
