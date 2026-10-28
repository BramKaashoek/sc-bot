import { stub } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

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
