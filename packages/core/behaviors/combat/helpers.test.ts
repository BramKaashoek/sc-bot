import { describe, expect, it } from 'bun:test';
import { ATTACK, ATTACK_ATTACK, MOVE } from '../../constants/ability.ts';
import { placeUnit } from '../../test/behavior-helpers.ts';
import { createTestWorld } from '../../test/create-test-world.ts';
import { attackReady, duplicateOrSimilarOrder } from './helpers.ts';

const MARINE = '4354211841';
const SCV = '4345823233';
const LINGS = ['4354473985', '4354736129'];
const OVERLORD = '4353949698';

async function fixture() {
    const world = await createTestWorld('blueshift', { loop: 896 });
    const get = (tag: string) => world.resources.get().units.getByTag(tag)!;
    return { world, get };
}

describe('combat helpers', () => {
    it('attackReady: ready, or cooling but at least the weapon-ready distance from range; never for an unhittable target', async () => {
        const { get } = await fixture();
        const [marine, ling, scv, overlord] = [get(MARINE), get(LINGS[0]), get(SCV), get(OVERLORD)];
        placeUnit(marine, 14.4, 10.8);
        const readyAt = (cooldown: number, lingY: number) => {
            marine.weaponCooldown = cooldown;
            placeUnit(ling, 14.4, lingY);
            return attackReady(marine, ling);
        };

        expect([readyAt(0, 14.8), readyAt(10, 20), readyAt(10, 14.8), attackReady(scv, overlord)]).toEqual([
            true,
            true,
            false,
            false,
        ]);
    });

    it('duplicateOrSimilarOrder matches general ability ids with the same tag or rounded point, or a target already reached', async () => {
        const { world, get } = await fixture();
        const [marine, ling, otherLing] = [get(MARINE), get(LINGS[0]), get(LINGS[1])];

        marine.orders = [{ abilityId: ATTACK_ATTACK, targetWorldSpacePos: { x: 30.2, y: 29.8 } }];
        const pointChecks = [
            duplicateOrSimilarOrder(world, marine, { x: 30, y: 30 }, ATTACK),
            duplicateOrSimilarOrder(world, marine, { x: 30, y: 30 }, MOVE),
            duplicateOrSimilarOrder(world, marine, { x: 31, y: 30 }, ATTACK),
        ];
        marine.orders = [{ abilityId: ATTACK, targetUnitTag: ling.tag }];
        const unitChecks = [
            duplicateOrSimilarOrder(world, marine, ling, ATTACK_ATTACK),
            duplicateOrSimilarOrder(world, marine, otherLing, ATTACK),
        ];
        marine.orders = [];
        const reached = duplicateOrSimilarOrder(world, marine, { x: marine.pos.x + 1, y: marine.pos.y }, MOVE);

        expect([...pointChecks, ...unitChecks, reached]).toEqual([true, false, false, true, false, true]);
    });
});
