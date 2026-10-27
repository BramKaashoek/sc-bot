import { describe, expect, it } from 'bun:test';
import { ATTACK } from '@sc-bot/core/constants/ability';
import { ATTACKING, HARASSING } from '@sc-bot/core/constants/unit-role';
import { ROACH, ZERGLING } from '@sc-bot/core/constants/unit-type';
import { createTestWorld, stepTo } from '../../test/create-test-world.ts';
import { rawUnit } from '../../test/factories.ts';
import { createBot } from './assigning-unit-roles.ts';
import type { TestWorld } from '../../test/create-test-world.ts';

type Placed = [tag: string, unitType: number];

async function stepWith(world: TestWorld, gameLoop: number, placed: Placed[]) {
    const responseObservation = structuredClone(world.client.fixture.observations[896]);
    responseObservation.observation!.gameLoop = gameLoop;
    responseObservation.observation!.rawData!.units!.push(
        ...placed.map(([tag, unitType], index) => rawUnit({ tag, unitType, pos: { x: 30 + index, y: 30, z: 10 } })),
    );
    await stepTo(world, responseObservation);
}

const attacksSince = (world: TestWorld, before: number) =>
    world.client.sent.actions
        .slice(before)
        .flatMap(({ actions }) => actions ?? [])
        .map(({ actionRaw }) => actionRaw!.unitCommand!)
        .filter(({ abilityId }) => abilityId === ATTACK)
        .map(({ unitTags, targetWorldSpacePos }) => ({
            tags: unitTags!.map(String).sort(),
            pos: targetWorldSpacePos,
        }));

describe('assigning-unit-roles example', () => {
    it('gives lings and roaches ATTACKING, then sends every second ling to the enemy third exactly once', async () => {
        const world = await createTestWorld('blueshift', { loop: 896, agent: createBot() });
        const { roles, units, map } = world.resources.get();
        const lings = () => units.getById(ZERGLING).map(({ tag }) => tag!);

        const placed: Placed[] = [
            ['r1', ROACH],
            ['z1', ZERGLING],
            ['z2', ZERGLING],
            ['z3', ZERGLING],
        ];
        await stepWith(world, 900, placed);
        expect([...roles.getTags(ATTACKING)].sort()).toEqual(['r1', 'z1', 'z2', 'z3']);

        const before = world.client.sent.actions.length;
        await stepWith(world, 904, placed);
        const harassers = lings().filter((_, index) => index % 2 === 0);
        expect(harassers).toHaveLength(2);
        expect([...roles.getTags(HARASSING)].sort()).toEqual([...harassers].sort());
        expect(roles.roleOf('r1')).toBe(ATTACKING);
        expect(attacksSince(world, before)).toContainEqual({
            tags: [...harassers].sort(),
            pos: map.getEnemyThirds()[0].townhallPosition,
        });

        await stepWith(world, 908, [...placed, ['z4', ZERGLING]]);
        expect(roles.roleOf('z4')).toBe(ATTACKING);
        expect([...roles.getTags(HARASSING)].sort()).toEqual([...harassers].sort());
    });
});
