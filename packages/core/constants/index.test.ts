import { describe, expect, it } from 'bun:test';
import { Ability, AbilityId, UnitType, UnitTypeId, Upgrade, UpgradeId } from './index.ts';

describe('reverse id lookups', () => {
    it('map an id back to its constant name', () => {
        expect(UnitTypeId[UnitType.PYLON]).toBe('PYLON');
        expect(AbilityId[Ability.ATTACK_ATTACK]).toBe('ATTACK_ATTACK');
        expect(UpgradeId[Upgrade.STIMPACK]).toBe('STIMPACK');
    });
});
