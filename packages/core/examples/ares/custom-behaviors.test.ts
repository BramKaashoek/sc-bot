import { describe, expect, it } from 'bun:test';
import { createAgent } from '@sc-bot/core';
import { ATTACK, MORPH_SIEGEMODE, MORPH_UNSIEGE } from '@sc-bot/core/constants/ability';
import { Alliance } from '@sc-bot/core/constants/enums';
import { MARAUDER, MARINE, SIEGETANK, SIEGETANKSIEGED, ZERGLING } from '@sc-bot/core/constants/unit-type';
import { createTestWorld, stepWith } from '../../test/create-test-world.ts';
import { rawUnit } from '../../test/factories.ts';
import { createBot, customSiegeTankDecision } from './custom-behaviors.ts';
import type { Agent } from '@sc-bot/core';

const TANK = 'tank';
const TANK_POS = { x: 30, y: 30 };

const tank = (unitType: number) => rawUnit({ tag: TANK, unitType, pos: { ...TANK_POS, z: 10 } });
const enemiesAt = (unitType: number, ...distances: number[]) =>
    distances.map((distance, index) =>
        rawUnit({
            tag: `enemy-${unitType}-${index}`,
            alliance: Alliance.ENEMY,
            unitType,
            pos: { x: TANK_POS.x + distance, y: TANK_POS.y, z: 10 },
        }),
    );
const marinesAt = (...distances: number[]) => enemiesAt(MARINE, ...distances);

async function runWith(agent: Agent, units: SC2APIProtocol.Unit[]) {
    const world = await createTestWorld('blueshift', { loop: 896, agent });
    const before = world.client.sent.actions.length;
    await stepWith(world, 900, units);
    return { world, before };
}

const sentSince = ({ client }: Awaited<ReturnType<typeof runWith>>['world'], before: number) =>
    client.sent.actions
        .slice(before)
        .flatMap(({ actions }) => actions ?? [])
        .map(({ actionRaw }) => actionRaw!.unitCommand!)
        .map(({ abilityId, unitTags, targetWorldSpacePos }) => ({
            abilityId,
            tags: unitTags!.map(String),
            ...(targetWorldSpacePos && { pos: targetWorldSpacePos }),
        }));

async function decide(units: SC2APIProtocol.Unit[]) {
    const { world } = await runWith(createAgent(), units);
    const { units: store, behaviors, actions } = world.resources.get();
    const before = world.client.sent.actions.length;
    const result = await behaviors.run(customSiegeTankDecision({ unit: store.getByTag(TANK)! }));
    await actions.flushQueuedActions();
    return [result, sentSince(world, before)];
}

describe('custom-behaviors example', () => {
    it.each([
        ['4 enemies, 4 supply, none within 6.5', SIEGETANK, marinesAt(8, 9, 10, 11), true],
        ['an enemy within 6.5', SIEGETANK, marinesAt(6, 9, 10, 11), false],
        ['only 3 enemies, 6 supply', SIEGETANK, enemiesAt(MARAUDER, 8, 9, 10), false],
        ['4 enemies, 3 supply', SIEGETANK, [...marinesAt(8, 9), ...enemiesAt(ZERGLING, 10, 11)], false],
        ['only 3 enemies within 14', SIEGETANK, marinesAt(8, 9, 10, 15), false],
    ])('siege: %s', async (_, unitType, enemies, siege) => {
        const [result, sent] = await decide([tank(unitType), ...enemies]);

        expect([result, sent]).toEqual(siege ? [true, [{ abilityId: MORPH_SIEGEMODE, tags: [TANK] }]] : [false, []]);
    });

    it.each([
        ['no enemy within 14', marinesAt(20), true],
        ['an enemy within 14', marinesAt(13), false],
    ])('unsiege: %s', async (_, enemies, unsiege) => {
        const [result, sent] = await decide([tank(SIEGETANKSIEGED), ...enemies]);

        expect([result, sent]).toEqual(unsiege ? [true, [{ abilityId: MORPH_UNSIEGE, tags: [TANK] }]] : [false, []]);
    });

    it('runs the decision before a-moving each marine and tank toward the enemy start', async () => {
        const sentFor = async (units: SC2APIProtocol.Unit[]) => {
            const { world, before } = await runWith(createBot(), units);
            const enemyStart = world.resources.get().map.getLocations().enemy[0];
            return { enemyStart, sent: sentSince(world, before).filter(({ tags }) => tags.includes(TANK)) };
        };

        const declined = await sentFor([tank(SIEGETANK)]);
        expect(declined.sent).toEqual([
            {
                abilityId: ATTACK,
                tags: expect.arrayContaining([TANK]),
                pos: { x: declined.enemyStart.x, y: declined.enemyStart.y },
            },
        ]);
        expect((await sentFor([tank(SIEGETANK), ...marinesAt(8, 9, 10, 11)])).sent).toEqual([
            { abilityId: MORPH_SIEGEMODE, tags: [TANK] },
        ]);
        expect((await sentFor([tank(SIEGETANKSIEGED)])).sent).toEqual([{ abilityId: MORPH_UNSIEGE, tags: [TANK] }]);
    });
});
