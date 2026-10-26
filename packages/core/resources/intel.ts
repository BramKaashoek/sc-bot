import { NodeSC2Error } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

const notImplemented = (): never => {
    throw new NodeSC2Error('not implemented');
};

export const intelResource: ResourceDefinition<'intel'> = {
    name: 'intel',
    create: () => ({
        getBaseThreats: notImplemented,
        getMainThreat: notImplemented,
        has: notImplemented,
        detectedAt: notImplemented,
        getProxies: notImplemented,
        configure: notImplemented,
    }),
};
