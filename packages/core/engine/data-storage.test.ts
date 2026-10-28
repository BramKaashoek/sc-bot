import { describe, expect, it } from 'bun:test';
import { Ability } from '../constants/index.ts';
import createDataManager, { generalAbility } from './data-storage.ts';

describe('generalAbility', () => {
    it('resolves a remapped ability to its general one and leaves other ids as they are', () => {
        const data = createDataManager();
        data.set('abilities', {
            [Ability.HARVEST_GATHER_SCV]: {
                abilityId: Ability.HARVEST_GATHER_SCV,
                remapsToAbilityId: Ability.HARVEST_GATHER,
            },
            [Ability.MOVE]: { abilityId: Ability.MOVE },
        });

        expect(generalAbility(data, Ability.HARVEST_GATHER_SCV)).toBe(Ability.HARVEST_GATHER);
        expect(generalAbility(data, Ability.MOVE)).toBe(Ability.MOVE);
        expect(generalAbility(data, 999999)).toBe(999999);
    });
});
