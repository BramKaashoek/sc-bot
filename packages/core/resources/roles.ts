import { NodeSC2Error } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

const notImplemented = (): never => {
    throw new NodeSC2Error('not implemented');
};

export const rolesResource: ResourceDefinition<'roles'> = {
    name: 'roles',
    create: () => ({
        assign: notImplemented,
        clear: notImplemented,
        switchRole: notImplemented,
        get: notImplemented,
        roleOf: notImplemented,
        getTags: notImplemented,
        as: notImplemented,
        mayCommand: notImplemented,
        configure: notImplemented,
    }),
};
