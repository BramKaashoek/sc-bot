import { describe, expect, it } from 'bun:test';
import * as Ability from '../constants/ability.ts';
import { abilityCooldown } from '../constants/dicts/ability-cooldown.ts';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';

const TAG = '4354473985';
const KD8 = Ability.EFFECT_KD8CHARGE;

describe('AbilityTracker', () => {
    it('blocks an ability until its table cooldown elapsed, and untracked pairs stay ready', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { abilityTracker } = world.resources.get();

        abilityTracker.used(TAG, KD8);

        expect(abilityTracker.readyAt(TAG, KD8)).toBe(896 + abilityCooldown[KD8]);
        expect(abilityTracker.ready(TAG, KD8)).toBe(false);
        expect(abilityTracker.ready('other', KD8)).toBe(true);
        expect(abilityTracker.readyAt(TAG, Ability.EFFECT_BLINK_STALKER)).toBeUndefined();

        await stepTo(world, observationAt(world, 896 + abilityCooldown[KD8] - 1));
        expect(abilityTracker.ready(TAG, KD8)).toBe(false);
        await stepTo(world, observationAt(world, 896 + abilityCooldown[KD8]));
        expect(abilityTracker.ready(TAG, KD8)).toBe(true);
    });

    it('applies setCooldown to later uses only, and forgets everything on a game reset', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { abilityTracker } = world.resources.get();

        abilityTracker.used(TAG, KD8);
        abilityTracker.setCooldown(KD8, 4);
        expect(abilityTracker.readyAt(TAG, KD8)).toBe(896 + abilityCooldown[KD8]);

        abilityTracker.used('b', KD8);
        expect(abilityTracker.readyAt('b', KD8)).toBe(900);
        await stepTo(world, observationAt(world, 900));
        expect(abilityTracker.ready('b', KD8)).toBe(true);

        await world.engine.setupGame();

        expect(abilityTracker.readyAt(TAG, KD8)).toBeUndefined();
        abilityTracker.used(TAG, KD8);
        expect(abilityTracker.readyAt(TAG, KD8)! - world.resources.get().frame.getGameLoop()).toBe(
            abilityCooldown[KD8],
        );
    });
});
