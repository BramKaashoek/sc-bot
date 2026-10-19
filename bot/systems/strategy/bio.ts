import {
    BARRACKS,
    ENGINEERINGBAY,
    FACTORY,
    MARAUDER,
    MARINE,
    MEDIVAC,
    STARPORT,
} from '@sc-bot/core/constants/unit-type';
import { SHIELDWALL, STIMPACK, TERRANINFANTRYWEAPONSLEVEL1 } from '@sc-bot/core/constants/upgrade';
import type { Strategy } from './types.ts';

export const bio: Strategy = {
    name: 'bio',
    production: [
        { unitType: BARRACKS, count: 1, reactors: 1 },
        { unitType: BARRACKS, count: 3, reactors: 2, techLabs: 1 },
        { unitType: FACTORY, count: 1 },
        { unitType: STARPORT, count: 1, reactors: 1 },
        { unitType: BARRACKS, count: 5, reactors: 3, techLabs: 2 },
        { unitType: ENGINEERINGBAY, count: 1 },
    ],
    army: {
        [MARINE]: 6,
        [MARAUDER]: 3,
        [MEDIVAC]: 1,
    },
    upgrades: [STIMPACK, SHIELDWALL, TERRANINFANTRYWEAPONSLEVEL1],
};
