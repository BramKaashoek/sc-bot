import * as Ability from '../ability.ts';
import { GAME_LOOPS_PER_SECOND } from '../time.ts';

// ares truncates seconds * 22.4 (int()), then pads; locusts pad 8 instead of 6.
const loops = (seconds: number, pad = 6) => Math.trunc(GAME_LOOPS_PER_SECOND * seconds) + pad;

export const abilityCooldown: Record<number, number> = {
    [Ability.EFFECT_ADEPTPHASESHIFT]: loops(11),
    [Ability.BEHAVIOR_PULSARBEAMON]: loops(4),
    [Ability.EFFECT_BLINK_STALKER]: loops(7),
    [Ability.EFFECT_PURIFICATIONNOVA]: loops(21.4),
    [Ability.EFFECT_SHADOWSTRIDE]: loops(14),
    [Ability.EFFECT_VOIDRAYPRISMATICALIGNMENT]: loops(42.9),
    [Ability.EFFECT_ORACLEREVELATION]: loops(10),
    [Ability.EFFECT_MEDIVACIGNITEAFTERBURNERS]: loops(14),
    [Ability.EFFECT_TACTICALJUMP]: loops(71),
    [Ability.EFFECT_LOCKON]: loops(4.3),
    [Ability.EFFECT_KD8CHARGE]: loops(14),
    [Ability.EFFECT_NUKECALLDOWN]: loops(14),
    [Ability.EFFECT_WIDOWMINEATTACK]: loops(29),
    [Ability.EFFECT_YAMATOGUN]: loops(71),
    [Ability.EFFECT_CAUSTICSPRAY]: loops(32.14),
    [Ability.EFFECT_CORROSIVEBILE]: loops(7),
    [Ability.EFFECT_SPAWNLOCUSTS]: loops(43, 8),
};
