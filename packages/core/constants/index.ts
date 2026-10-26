import AbilitiesByUnit from './unit-ability-map.ts';
import * as Ability from './ability.ts';
import * as Buff from './buff.ts';
import * as BuildTarget from './build-target.ts';
import Color from './color.ts';
import * as Effect from './effect.ts';
import * as EngagementResult from './engagement-result.ts';
import * as enums from './enums.ts';
import * as groups from './groups.ts';
import * as UnitRole from './unit-role.ts';
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
    BuildTarget,
    Color,
    Effect,
    EffectId,
    EngagementResult,
    enums,
    groups,
    UnitRole,
    UnitType,
    UnitTypeId,
    Upgrade,
    UpgradeId,
    WarpUnitAbility,
};
export {
    DEFAULT_EFFECT_COSTS,
    EFFECT_INFLUENCE,
    INFLUENCE_DEFAULTS,
    STATIC_DEFENSE,
    UNIT_AVOIDANCE,
    WEIGHT_COSTS,
} from './influence.ts';
export type { EffectInfluence, InfluenceSource, StaticDefenseSource, WeightCost } from './influence.ts';
