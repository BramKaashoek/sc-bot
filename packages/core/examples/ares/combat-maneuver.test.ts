import { describe, expect, it } from 'bun:test';
import { MOVE, SMART, UNLOADALLAT } from '@sc-bot/core/constants/ability';
import { Alliance } from '@sc-bot/core/constants/enums';
import { MARINE, MEDIVAC, WIDOWMINE, ZERGLING } from '@sc-bot/core/constants/unit-type';
import { createTestWorld, stepWith } from '../../test/create-test-world.ts';
import { rawUnit } from '../../test/factories.ts';
import { createBot } from './combat-maneuver.ts';

const MEDIVAC_TAG = 'medivac';
const MINE_TAG = 'mine';

async function runWith(units: SC2APIProtocol.Unit[]) {
    const world = await createTestWorld('blueshift', { loop: 896, agent: createBot() });
    const before = world.client.sent.actions.length;
    await stepWith(world, 900, units);
    const sent = world.client.sent.actions
        .slice(before)
        .flatMap(({ actions }) => actions ?? [])
        .map(({ actionRaw }) => actionRaw!.unitCommand!)
        .map(({ abilityId, unitTags, targetUnitTag, targetWorldSpacePos }) => ({
            abilityId,
            tags: unitTags?.map(String),
            ...(targetUnitTag && { target: targetUnitTag }),
            ...(targetWorldSpacePos && { pos: targetWorldSpacePos }),
        }));
    return { world, sent };
}

const medivac = (x: number, y: number, cargoSpaceTaken = 0) =>
    rawUnit({
        tag: MEDIVAC_TAG,
        unitType: MEDIVAC,
        isFlying: true,
        pos: { x, y, z: 10 },
        cargoSpaceTaken,
        cargoSpaceMax: 8,
    });

describe('combat-maneuver example', () => {
    it('picks up a mine within reach', async () => {
        const { sent } = await runWith([
            medivac(14.4, 10.8),
            rawUnit({ tag: MINE_TAG, unitType: WIDOWMINE, pos: { x: 16, y: 11, z: 10 } }),
        ]);

        expect(sent).toEqual([{ abilityId: SMART, tags: [MEDIVAC_TAG], target: MINE_TAG }]);
    });

    it('with cargo flies toward the enemy start, and drops once it is there', async () => {
        const probe = await runWith([medivac(14.4, 10.8, 2)]);
        const enemyStart = probe.world.resources.get().map.getLocations().enemy[0];

        expect(probe.sent).toHaveLength(1);
        expect(probe.sent[0].abilityId).toBe(MOVE);
        const [toward] = probe.sent;
        expect(Math.hypot(toward.pos!.x! - enemyStart.x, toward.pos!.y! - enemyStart.y)).toBeLessThan(
            Math.hypot(14.4 - enemyStart.x, 10.8 - enemyStart.y),
        );

        const { world } = probe;
        const { map } = world.resources.get();
        const dropSpot = [
            [2.5, 0],
            [-2.5, 0],
            [0, 2.5],
            [0, -2.5],
        ]
            .map(([dx, dy]) => ({ x: enemyStart.x + dx, y: enemyStart.y + dy }))
            .find((spot) => map.isPathable(spot))!;
        const arrived = await runWith([medivac(dropSpot.x, dropSpot.y, 2)]);

        expect(arrived.sent).toEqual([{ abilityId: UNLOADALLAT, tags: [MEDIVAC_TAG], target: MEDIVAC_TAG }]);
    });

    it('empty with nothing to pick up, stays put when safe or only ground-threatened, and retreats from an anti-air enemy', async () => {
        expect((await runWith([medivac(14.4, 10.8)])).sent).toEqual([]);
        expect(
            (
                await runWith([
                    medivac(14.4, 10.8),
                    rawUnit({
                        tag: 'ling',
                        alliance: Alliance.ENEMY,
                        unitType: ZERGLING,
                        pos: { x: 15, y: 10.8, z: 10 },
                    }),
                ])
            ).sent,
        ).toEqual([]);

        const { sent } = await runWith([
            medivac(14.4, 10.8),
            rawUnit({ tag: 'hostile', alliance: Alliance.ENEMY, unitType: MARINE, pos: { x: 17, y: 10.8, z: 10 } }),
        ]);

        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ abilityId: MOVE, tags: [MEDIVAC_TAG] });
        expect(sent[0].pos!.x!).toBeLessThan(14.4);
    });
});
