import * as Ability from './ability.ts';
import * as Buff from './buff.ts';
import * as Effect from './effect.ts';

export type AoeAbility = { radius: number; range: number; effectId?: number; buffId?: number };

// a Map: autoUseAOEAbility tries abilities in this order, which an integer-keyed object would reorder (ares dicts/aoe_ability_to_range.py)
export const AOE_ABILITIES: ReadonlyMap<number, AoeAbility> = new Map([
    [Ability.EFFECT_BLINDINGCLOUD, { radius: 2, range: 10, effectId: Effect.BLINDINGCLOUDCP }],
    [Ability.EFFECT_CORROSIVEBILE, { radius: 0.25, range: 9, effectId: Effect.RAVAGERCORROSIVEBILECP }],
    [Ability.EFFECT_ANTIARMORMISSILE, { radius: 2.88, range: 10, buffId: Buff.RAVENSHREDDERMISSILEARMORREDUCTION }],
    [Ability.EFFECT_EMP, { radius: 1.5, range: 10 }],
    [Ability.EFFECT_FUNGALGROWTH, { radius: 2.25, range: 10, buffId: Buff.FUNGALGROWTH }],
    [Ability.EFFECT_KD8CHARGE, { radius: 5, range: 2 }],
    [Ability.EFFECT_PARASITICBOMB, { radius: 3, range: 8, buffId: Buff.PARASITICBOMB }],
    [Ability.EFFECT_PSISTORM, { radius: 2, range: 8, effectId: Effect.PSISTORMPERSISTENT }],
    [Ability.EFFECT_NUKECALLDOWN, { radius: 12, range: 9, effectId: Effect.NUKEPERSISTENT }],
]);
