import AbilitiesByUnit from './unit-ability-map.ts';
import * as Ability from './ability.ts';
import * as Buff from './buff.ts';
import Color from './color.ts';
import * as Effect from './effect.ts';
import * as enums from './enums.ts';
import * as groups from './groups.ts';
import * as UnitType from './unit-type.ts';
import * as Upgrade from './upgrade.ts';

const UnitTypeId = Object.entries(UnitType).reduce(
    (UnitTypeId, [unitType, unitTypeId]) => {
        UnitTypeId[unitTypeId] = unitType;
        return UnitTypeId;
    },
    {} as Record<number, string>,
);

const AbilityId = Object.entries(Ability).reduce(
    (AbilityId, [ability, abilityId]) => {
        AbilityId[abilityId] = ability;
        return AbilityId;
    },
    {} as Record<number, string>,
);

const UpgradeId = Object.entries(Upgrade).reduce(
    (UpgradeId, [upgrade, upgradeId]) => {
        UpgradeId[upgradeId] = upgrade;
        return UpgradeId;
    },
    {} as Record<number, string>,
);

const BuffId = Object.entries(Buff).reduce(
    (BuffId, [buff, buffId]) => {
        BuffId[buffId] = buff;
        return BuffId;
    },
    {} as Record<number, string>,
);

const EffectId = Object.entries(Effect).reduce(
    (EffectId, [effect, effectId]) => {
        EffectId[effectId] = effect;
        return EffectId;
    },
    {} as Record<number, string>,
);

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
    Buff,
    BuffId,
    Color,
    Effect,
    EffectId,
    enums,
    groups,
    UnitType,
    UnitTypeId,
    Upgrade,
    UpgradeId,
    WarpUnitAbility,
};
