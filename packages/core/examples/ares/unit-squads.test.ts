import { describe, expect, it } from 'bun:test';
import { ATTACK } from '@sc-bot/core/constants/ability';
import { Alliance } from '@sc-bot/core/constants/enums';
import { ATTACKING, CONTROL_GROUP_ONE, GATHERING } from '@sc-bot/core/constants/unit-role';
import { DRONE, MARINE, ROACH, SPINECRAWLER } from '@sc-bot/core/constants/unit-type';
import { createTestWorld, stepWith } from '../../test/create-test-world.ts';
import { rawUnit } from '../../test/factories.ts';
import { createBot } from './unit-squads.ts';
import type { TestWorld } from '../../test/create-test-world.ts';

const AFTER_SIX_MINUTES = 8100;

const roach = (tag: string, x: number, y: number) => rawUnit({ tag, unitType: ROACH, pos: { x, y, z: 10 } });

async function commandsAfter(world: TestWorld, gameLoop: number, units: SC2APIProtocol.Unit[]) {
    const before = world.client.sent.actions.length;
    await stepWith(world, gameLoop, units);
    return world.client.sent.actions
        .slice(before)
        .flatMap(({ actions }) => actions ?? [])
        .map(({ actionRaw }) => actionRaw!.unitCommand!)
        .map(({ abilityId, unitTags, targetWorldSpacePos }) => ({
            abilityId,
            tags: unitTags!.map(String).sort(),
            pos: targetWorldSpacePos,
        }));
}

describe('unit-squads example', () => {
    it('moves roaches to CONTROL_GROUP_ONE once after 360s, then stutters squads near enemies and a-moves the rest', async () => {
        const world = await createTestWorld('blueshift', { loop: 896, agent: createBot() });
        const { roles, map } = world.resources.get();
        const enemyStart = map.getLocations().enemy[0];
        const enemy = rawUnit({
            tag: 'enemy',
            alliance: Alliance.ENEMY,
            unitType: MARINE,
            pos: { x: 37, y: 30, z: 10 },
        });
        const roaches = [roach('a1', 30, 30), roach('a2', 25, 30), roach('b1', 60, 60)];

        await commandsAfter(world, 900, [...roaches, enemy]);
        expect([...roles.getTags(ATTACKING)]).toEqual(expect.arrayContaining(['a1', 'a2', 'b1']));
        expect(roles.getTags(CONTROL_GROUP_ONE).size).toBe(0);

        await commandsAfter(world, 904, [...roaches, enemy]);
        expect(roles.getTags(CONTROL_GROUP_ONE).size).toBe(0);

        await commandsAfter(world, AFTER_SIX_MINUTES, [...roaches, enemy]);
        expect([...roles.getTags(CONTROL_GROUP_ONE)].sort()).toEqual(['a1', 'a2', 'b1']);

        const engaged = await commandsAfter(world, AFTER_SIX_MINUTES + 4, [
            ...roaches,
            enemy,
            roach('late', 60, 61),
            rawUnit({ tag: 'drone', unitType: DRONE, pos: { x: 40, y: 50, z: 10 } }),
            rawUnit({ tag: 'spine', unitType: SPINECRAWLER, pos: { x: 44, y: 50, z: 10 } }),
        ]);
        expect([roles.roleOf('late'), roles.roleOf('drone'), roles.roleOf('spine')]).toEqual([
            ATTACKING,
            GATHERING,
            undefined,
        ]);
        expect(engaged).toHaveLength(2);
        expect(engaged).toContainEqual({ abilityId: ATTACK, tags: ['a1', 'a2'], pos: { x: 37, y: 30 } });
        expect(engaged).toContainEqual({ abilityId: ATTACK, tags: ['b1'], pos: expect.objectContaining(enemyStart) });
    });
});
