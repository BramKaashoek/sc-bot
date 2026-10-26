import { NodeSC2Error } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

const notImplemented = (): never => {
    throw new NodeSC2Error('not implemented');
};

export const squadsResource: ResourceDefinition<'squads'> = {
    name: 'squads',
    create: () => ({
        getSquads: notImplemented,
        getMainSquad: notImplemented,
        getMainSquadPosition: notImplemented,
    }),
};
