import { describe, expect, it } from 'bun:test';
import { MORPH_SUPPLYDEPOT_LOWER, MORPH_SUPPLYDEPOT_RAISE } from '@sc-bot/core/constants/ability';
import { Alliance } from '@sc-bot/core/constants/enums';
import { MARINE, SUPPLYDEPOT, SUPPLYDEPOTLOWERED } from '@sc-bot/core/constants/unit-type';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import { createBot } from './ramp-wall.ts';

const depot = (tag: string, unitType: number, x: number, y: number) =>
    rawUnit({ tag, unitType, pos: { x, y, z: 10 }, buildProgress: 1 });

const marine = (x: number, y: number, tag = 'enemy') =>
    rawUnit({ tag, alliance: Alliance.ENEMY, unitType: MARINE, pos: { x, y, z: 10 } });

async function commands(enemy: SC2APIProtocol.Unit[]) {
    const world = await createTestWorld('blueshift', { loop: 896, agent: createBot() });
    const responseObservation = structuredClone(world.client.fixture.observations[896]);
    responseObservation.observation!.gameLoop = 900;
    responseObservation.observation!.rawData!.units!.push(
        depot('raised', SUPPLYDEPOT, 30, 30),
        depot('lowered', SUPPLYDEPOTLOWERED, 60, 60),
        ...enemy,
    );
    const before = world.client.sent.actions.length;
    await stepTo(world, responseObservation);
    return world.client.sent.actions
        .slice(before)
        .flatMap(({ actions }) => actions ?? [])
        .map(({ actionRaw }) => actionRaw!.unitCommand!)
        .filter(({ abilityId }) => abilityId === MORPH_SUPPLYDEPOT_LOWER || abilityId === MORPH_SUPPLYDEPOT_RAISE)
        .map(({ abilityId, unitTags }) => ({ abilityId, tags: unitTags!.map(String) }));
}

describe('ramp-wall example', () => {
    it('lowers a raised depot with no ground enemy within 15 and raises a lowered one with an enemy within 10', async () => {
        expect(await commands([marine(68, 60)])).toEqual([
            { abilityId: MORPH_SUPPLYDEPOT_LOWER, tags: ['raised'] },
            { abilityId: MORPH_SUPPLYDEPOT_RAISE, tags: ['lowered'] },
        ]);
    });

    it('keeps depots as they are with the enemy between the raise and lower distances', async () => {
        expect(await commands([marine(30, 42), marine(60, 48, 'enemy2')])).toEqual([]);
    });
});
