import { describe, expect, it } from 'bun:test';
import { Attribute, Race } from '../constants/enums.ts';
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

describe('earmarks', () => {
    it('replaces an earmark re-added under the same name and keeps one for an identical re-add', () => {
        const data = createDataManager();
        data.addEarmark({ name: 'x', minerals: 100, vespene: 0 });
        data.addEarmark({ name: 'x', minerals: 100, vespene: 0 });
        expect(data.get('earmarks')).toEqual([{ name: 'x', minerals: 100, vespene: 0 }]);

        data.addEarmark({ name: 'x', minerals: 150, vespene: 25 });
        data.addEarmark({ name: 'y', minerals: 10, vespene: 0 });
        expect(data.get('earmarks')).toEqual([
            { name: 'x', minerals: 150, vespene: 25 },
            { name: 'y', minerals: 10, vespene: 0 },
        ]);
        expect(data.getEarmarkTotals('other')).toEqual({ minerals: 160, vespene: 25 });
    });
});

describe('getUnitTypeData', () => {
    it('returns Zerg structure data raw, without the consumed-drone discount', () => {
        const data = createDataManager();
        const hatchery = { unitId: 86, race: Race.ZERG, attributes: [Attribute.STRUCTURE], mineralCost: 300 };
        data.set('units', { 86: hatchery });

        expect(data.getUnitTypeData(86)).toBe(hatchery);
        expect(data.mineralCost(86)).toBe(300);
    });
});
