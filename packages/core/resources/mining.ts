import { NodeSC2Error } from '../engine/errors.ts';
import type { MiningSettings, ResourceDefinition } from '../types.ts';

const notImplemented = (): never => {
    throw new NodeSC2Error('not implemented');
};

export const miningResource: ResourceDefinition<'mining'> = {
    name: 'mining',
    create: () => {
        const settings: MiningSettings = {
            enabled: false,
            priority: -10,
            workersPerGas: 3,
            speedMining: true,
            townhallDistanceFactor: 1.08,
            keepSafe: true,
            fleeAtHealth: 0.5,
            weightSafetyLimit: 12,
            selfDefence: true,
            longDistanceMine: true,
        };
        return {
            selectWorker: notImplemented,
            release: notImplemented,
            getAssignment: notImplemented,
            getWorkersOn: notImplemented,
            getMineralTarget: notImplemented,
            configure: (next) => {
                Object.assign(settings, next);
            },
        };
    },
    reset: () => {},
    onStep: () => {},
};
