import { describe, expect, it } from 'bun:test';
import { ATTACK, MOVE } from '../../constants/ability.ts';
import { placeUnit, runBehavior } from '../../test/behavior-helpers.ts';
import { createTestWorld } from '../../test/create-test-world.ts';
import { distance } from '../../utils/geometry/point.ts';
import {
    aMoveGroup,
    groupUseAbility,
    keepGroupSafe,
    pathGroupToTarget,
    stutterGroupBack,
    stutterGroupForward,
} from './group.ts';
import type { TestWorld } from '../../test/create-test-world.ts';
import type { Behavior, Unit } from '../../types.ts';

const MARINE = '4354211841';
const SCV = '4345823233';
const LING = '4354473985';

async function fixture() {
    const world = await createTestWorld('blueshift', { loop: 896 });
    const get = (tag: string) => world.resources.get().units.getByTag(tag)!;
    const [marine, scv, ling] = [MARINE, SCV, LING].map(get);
    placeUnit(marine, 14.4, 10.8);
    placeUnit(scv, 14.4, 12.3);
    placeUnit(ling, 40, 40);
    return { world, marine, scv, ling, group: [marine, scv], position: { x: 14.4, y: 11.5 } };
}

const runGroup = (world: TestWorld, behavior: Behavior) => runBehavior(world, behavior, { tags: true });

const tagsOf = (group: Unit[]) => group.map(({ tag }) => tag!).sort();

describe('group combat behaviors', () => {
    it('aMoveGroup issues one multi-tag attack and suppresses it once the farthest unit is already on it', async () => {
        const { world, marine, group } = await fixture();
        const target = { x: 30, y: 30 };

        expect(await runGroup(world, aMoveGroup({ group, target }))).toEqual([
            true,
            [{ abilityId: ATTACK, tags: tagsOf(group), pos: target }],
        ]);
        marine.orders = [{ abilityId: ATTACK, targetWorldSpacePos: target }];
        expect(await runGroup(world, aMoveGroup({ group, target }))).toEqual([false, []]);
    });

    it('pathGroupToTarget moves the group together, stops within successAtDistance and suppresses a repeat', async () => {
        const { world, marine, group, position } = await fixture();
        const target = { x: 14.4, y: 30 };

        const [moved, [command]] = await runGroup(world, pathGroupToTarget({ start: position, group, target }));
        expect([moved, command.abilityId, command.tags]).toEqual([true, MOVE, tagsOf(group)]);

        marine.orders = [{ abilityId: MOVE, targetWorldSpacePos: command.pos }];
        expect(await runGroup(world, pathGroupToTarget({ start: position, group, target }))).toEqual([false, []]);
        expect(
            await runGroup(world, pathGroupToTarget({ start: position, group, target, successAtDistance: 40 })),
        ).toEqual([false, []]);
    });

    it('pathGroupToTarget follows a custom grid instead of the world layer', async () => {
        const { world, marine, group, position } = await fixture();
        const { influence } = world.resources.get();
        const target = { x: 14.4, y: 30 };
        const clean = influence.getCleanGrid('ground');
        const walled = influence.getCleanGrid('ground');
        influence.addCost(walled, { x: 14.4, y: 14 }, 2, 500);

        const [, [direct]] = await runGroup(
            world,
            pathGroupToTarget({
                start: position,
                group,
                target,
                layer: clean,
                sensitivity: 3,
                preventDuplicate: false,
            }),
        );
        const [, [around]] = await runGroup(
            world,
            pathGroupToTarget({
                start: position,
                group,
                target,
                layer: walled,
                sensitivity: 3,
                preventDuplicate: false,
            }),
        );
        expect(around.pos).not.toEqual(direct.pos);
        expect(walled.get(around.pos!)).toBe(1);

        const [, [smooth]] = await runGroup(
            world,
            pathGroupToTarget({
                start: position,
                group,
                target,
                layer: walled,
                sensitivity: 3,
                smoothing: true,
                preventDuplicate: false,
            }),
        );
        expect(smooth.pos).not.toEqual(around.pos);
    });

    it('keepGroupSafe moves only the endangered units and false when all are safe', async () => {
        const { world, marine, group } = await fixture();

        expect(await runGroup(world, keepGroupSafe({ group, closeEnemy: [] }))).toEqual([false, []]);

        world.resources.get().influence.addCost('ground', marine.pos, 1.5, 50);
        const [moved, [command]] = await runGroup(world, keepGroupSafe({ group, closeEnemy: [] }));
        expect([moved, command.abilityId, command.tags]).toEqual([true, MOVE, [MARINE]]);
    });

    it('stutterGroupBack attacks the target when weapons are ready, holds while cooling and safe, retreats away from the target when endangered', async () => {
        const { world, marine, group, position } = await fixture();
        const target = { x: 14.4, y: 20 };

        expect(await runGroup(world, stutterGroupBack({ group, groupPosition: position, target }))).toEqual([
            true,
            [{ abilityId: ATTACK, tags: tagsOf(group), pos: target }],
        ]);
        marine.orders = [{ abilityId: ATTACK, targetWorldSpacePos: target }];
        expect(await runGroup(world, stutterGroupBack({ group, groupPosition: position, target }))).toEqual([true, []]);
        marine.orders = [];

        group.forEach((unit) => {
            unit.weaponCooldown = 10;
        });
        expect(await runGroup(world, stutterGroupBack({ group, groupPosition: position, target }))).toEqual([true, []]);

        const custom = world.resources.get().influence.getCleanGrid('ground');
        world.resources.get().influence.addCost(custom, position, 3, 50);
        for (const [x, y] of [
            [14.4, 8.5],
            [11.4, 8.5],
            [17.4, 8.5],
        ])
            world.resources.get().influence.addCost(custom, { x, y }, 1.5, Number.POSITIVE_INFINITY);
        expect(await runGroup(world, stutterGroupBack({ group, groupPosition: position, target }))).toEqual([true, []]);
        const [onCustom, [customRetreat]] = await runGroup(
            world,
            stutterGroupBack({ group, groupPosition: position, target, layer: custom }),
        );
        expect([onCustom, customRetreat.abilityId, customRetreat.tags, customRetreat.pos]).toEqual([
            true,
            MOVE,
            tagsOf(group),
            { x: 12.5, y: 11.5 },
        ]);

        world.resources.get().influence.addCost('ground', position, 3, 50);
        const [handled, [retreat]] = await runGroup(
            world,
            stutterGroupBack({ group, groupPosition: position, target }),
        );
        expect([handled, retreat.abilityId, retreat.tags]).toEqual([true, MOVE, tagsOf(group)]);
        expect(distance(retreat.pos!, target)).toBeGreaterThan(distance(position, target));
    });

    it('stutterGroupForward attacks the enemy centre in range or when ready, moves in while cooling, and no-ops without enemies', async () => {
        const { world, scv, ling, group, position } = await fixture();
        const behavior = () =>
            stutterGroupForward({ group, groupPosition: position, target: ling.pos, enemies: [ling] });
        const centre = { x: 14.4, y: 14.8 };
        placeUnit(ling, centre.x, centre.y);

        expect(await runGroup(world, behavior())).toEqual([
            true,
            [{ abilityId: ATTACK, tags: tagsOf(group), pos: centre }],
        ]);
        scv.orders = [{ abilityId: ATTACK, targetWorldSpacePos: centre }];
        expect(await runGroup(world, behavior())).toEqual([true, []]);
        scv.orders = [];

        placeUnit(ling, 14.4, 25);
        group.forEach((unit) => {
            unit.weaponCooldown = 10;
        });
        const [, [advance]] = await runGroup(world, behavior());
        expect([advance.abilityId, advance.pos]).toEqual([MOVE, { x: 14.4, y: 25 }]);

        expect(
            await runGroup(
                world,
                stutterGroupForward({ group, groupPosition: position, target: ling.pos, enemies: [] }),
            ),
        ).toEqual([false, []]);
    });

    it('groupUseAbility orders the whole group when every (sync) or any unit has the ability', async () => {
        const { world, scv, group } = await fixture();
        const target = { x: 20, y: 20 };
        scv.abilityAvailable = () => false;

        expect(await runGroup(world, groupUseAbility({ abilityId: MOVE, group, target }))).toEqual([false, []]);
        expect(await runGroup(world, groupUseAbility({ abilityId: MOVE, group, target, syncCommand: false }))).toEqual([
            true,
            [{ abilityId: MOVE, tags: tagsOf(group), pos: target }],
        ]);
    });
});
