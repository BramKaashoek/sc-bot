import { describe, expect, it } from 'bun:test';
import * as Ability from '../ability.ts';
import { abilityCooldown } from './ability-cooldown.ts';

describe('abilityCooldown', () => {
    it('matches ares ABILITY_FRAME_COOL_DOWN', () => {
        expect(abilityCooldown[Ability.EFFECT_ADEPTPHASESHIFT]).toBe(252);
        expect(abilityCooldown[Ability.EFFECT_PURIFICATIONNOVA]).toBe(485);
        expect(abilityCooldown[Ability.EFFECT_SPAWNLOCUSTS]).toBe(971);
        expect(abilityCooldown[Ability.EFFECT_CAUSTICSPRAY]).toBe(725);
        expect(Object.keys(abilityCooldown)).toHaveLength(17);
    });
});
