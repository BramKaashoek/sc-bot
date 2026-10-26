import { NodeSC2Error } from '../engine/errors.ts';
import type { PlacementSettings, ResourceDefinition } from '../types.ts';

const notImplemented = (): never => {
    throw new NodeSC2Error('not implemented');
};

export const placementResource: ResourceDefinition<'placement'> = {
    name: 'placement',
    create: () => {
        const settings: PlacementSettings = { reservationTimeout: 60 };
        return {
            request: notImplemented,
            reserve: notImplemented,
            release: notImplemented,
            canPlace: notImplemented,
            getPlacements: notImplemented,
            add: notImplemented,
            configure: (next) => {
                Object.assign(settings, next);
            },
            drawDebug: notImplemented,
        };
    },
    reset: () => {},
    onStep: () => {},
};
