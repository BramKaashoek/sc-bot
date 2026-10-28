import { NodeSC2Error } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

const stub = (name: string) => (): never => {
    throw new NodeSC2Error(`not implemented: ${name}`);
};

export const nydusResource: ResourceDefinition<'nydus'> = {
    name: 'nydus',
    create() {
        return {
            findNydusAtLocation: stub('findNydusAtLocation'),
            getEnemyMainNydusPoints: stub('getEnemyMainNydusPoints'),
            getOwnMainNydusPoints: stub('getOwnMainNydusPoints'),
            nextPoint: stub('nextPoint'),
            addTraveller: stub('addTraveller'),
            removeTraveller: stub('removeTraveller'),
            getTravellers: stub('getTravellers'),
            isBanned: stub('isBanned'),
        };
    },
};
