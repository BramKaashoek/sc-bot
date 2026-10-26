import { NodeSC2Error } from '../engine/errors.ts';
import type { BuildingSettings, ResourceDefinition } from '../types.ts';

const notImplemented = (): never => {
    throw new NodeSC2Error('not implemented');
};

export const buildingsResource: ResourceDefinition<'buildings'> = {
    name: 'buildings',
    create: () => {
        const settings: BuildingSettings = { priority: 10, timeout: 120, maxAttempts: 5, cancelLowHp: 'tracked' };
        return {
            build: notImplemented,
            buildGas: notImplemented,
            cancel: notImplemented,
            pending: notImplemented,
            getTracked: notImplemented,
            configure: (next) => {
                Object.assign(settings, next);
            },
        };
    },
    reset: () => {},
    onStep: () => {},
};
