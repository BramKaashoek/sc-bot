import AbilitiesByUnit from './unit-ability-map.ts';
import * as Ability from './ability.ts';
import Color from './color.ts';
import * as enums from './enums.ts';
import * as groups from './groups.ts';
import * as UnitType from './unit-type.ts';
import * as Upgrade from './upgrade.ts';

const UnitTypeId = Object.entries(UnitType).reduce((UnitTypeId, [unitType, unitTypeId]) => {
    UnitTypeId[unitTypeId] = unitType;
    return UnitTypeId;
}, {} as Record<number, string>);

const AbilityId = Object.entries(Ability).reduce((AbilityId, [ability, abilityId]) => {
    AbilityId[abilityId] = ability;
    return AbilityId;
}, {} as Record<number, string>);

const UpgradeId = Object.entries(Upgrade).reduce((UpgradeId, [upgrade, upgradeId]) => {
    UpgradeId[upgradeId] = upgrade;
    return UpgradeId;
}, {} as Record<number, string>);

const WarpUnitAbility: Record<number, number> = {
    [UnitType.ZEALOT]: Ability.TRAINWARP_ZEALOT,
    [UnitType.STALKER]: Ability.TRAINWARP_STALKER,
    [UnitType.SENTRY]: Ability.TRAINWARP_SENTRY,
    [UnitType.ADEPT]: Ability.TRAINWARP_ADEPT,
    [UnitType.HIGHTEMPLAR]: Ability.TRAINWARP_HIGHTEMPLAR,
    [UnitType.DARKTEMPLAR]: Ability.TRAINWARP_DARKTEMPLAR,
};

export {
    Ability,
    AbilityId,
    AbilitiesByUnit,
    Color,
    enums,
    groups,
    UnitType,
    UnitTypeId,
    Upgrade,
    UpgradeId,
    WarpUnitAbility,
};
