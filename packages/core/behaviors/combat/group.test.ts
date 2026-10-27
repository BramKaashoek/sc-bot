import { describe, expect, it } from 'bun:test';
import { ATTACK, MOVE } from '../../constants/ability.ts';
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
import type { Behavior, Point2D, Unit } from '../../types.ts';

const MARINE = '4354211841';
const SCV = '4345823233';
const LING = '4354473985';

type Sent = { abilityId?: number; tags?: string[]; pos?: Point2D };

async function fixture() {
    const world = await createTestWorld('blueshift', { loop: 896 });
    const get = (tag: string) => world.resources.get().units.getByTag(tag)!;
    const [marine, scv, ling] = [MARINE, SCV, LING].map(get);
    place(marine, 14.4, 10.8);
    place(scv, 14.4, 12.3);
    place(ling, 40, 40);
    return { world, marine, scv, ling, group: [marine, scv], position: { x: 14.4, y: 11.5 } };
}

const place = (unit: Unit, x: number, y: number) => {
    unit.pos = { x, y, z: unit.pos.z };
};

let owner = 0;
async function run(world: TestWorld, behavior: Behavior): Promise<[boolean, Sent[]]> {
    const { behaviors, actions } = world.resources.get();
    actions.clearQueuedActions();
    const before = world.client.sent.actions.length;
    const result = await actions.as({ owner: `case-${owner++}` }, () => behaviors.run(behavior));
    await actions.flushQueuedActions();
    const sent = world.client.sent.actions
        .slice(before)
        .flatMap(({ actions: list }) => list ?? [])
        .map(({ actionRaw }) => actionRaw!.unitCommand!)
        .map(({ abilityId, unitTags, targetWorldSpacePos }) => ({
            abilityId,
            tags: unitTags?.map(String).sort(),
            ...(targetWorldSpacePos && { pos: targetWorldSpacePos as Point2D }),
        }));
    return [result, sent];
}

const tagsOf = (group: Unit[]) => group.map(({ tag }) => tag!).sort();

describe('group combat behaviors', () => {
    it('aMoveGroup issues one multi-tag attack and suppresses it once the farthest unit is already on it', async () => {
        const { world, marine, group } = await fixture();
        const target = { x: 30, y: 30 };

        expect(await run(world, aMoveGroup({ group, target }))).toEqual([
            true,
            [{ abilityId: ATTACK, tags: tagsOf(group), pos: target }],
        ]);
        marine.orders = [{ abilityId: ATTACK, targetWorldSpacePos: target }];
        expect(await run(world, aMoveGroup({ group, target }))).toEqual([false, []]);
    });

    it('pathGroupToTarget moves the group together, stops within successAtDistance and suppresses a repeat', async () => {
        const { world, marine, group, position } = await fixture();
        const target = { x: 14.4, y: 30 };

        const [moved, [command]] = await run(world, pathGroupToTarget({ start: position, group, target }));
        expect([moved, command.abilityId, command.tags]).toEqual([true, MOVE, tagsOf(group)]);

        marine.orders = [{ abilityId: MOVE, targetWorldSpacePos: command.pos }];
        expect(await run(world, pathGroupToTarget({ start: position, group, target }))).toEqual([false, []]);
        expect(await run(world, pathGroupToTarget({ start: position, group, target, successAtDistance: 40 }))).toEqual([
            false,
            [],
        ]);
    });

    it('keepGroupSafe moves only the endangered units and false when all are safe', async () => {
        const { world, marine, group } = await fixture();

        expect(await run(world, keepGroupSafe({ group, closeEnemy: [] }))).toEqual([false, []]);

        world.resources.get().influence.addCost('ground', marine.pos, 1.5, 50);
        const [moved, [command]] = await run(world, keepGroupSafe({ group, closeEnemy: [] }));
        expect([moved, command.abilityId, command.tags]).toEqual([true, MOVE, [MARINE]]);
    });

    it('stutterGroupBack attacks the target when weapons are ready, holds while cooling and safe, retreats away from the target when endangered', async () => {
        const { world, marine, group, position } = await fixture();
        const target = { x: 14.4, y: 20 };

        expect(await run(world, stutterGroupBack({ group, groupPosition: position, target }))).toEqual([
            true,
            [{ abilityId: ATTACK, tags: tagsOf(group), pos: target }],
        ]);
        marine.orders = [{ abilityId: ATTACK, targetWorldSpacePos: target }];
        expect(await run(world, stutterGroupBack({ group, groupPosition: position, target }))).toEqual([true, []]);
        marine.orders = [];

        group.forEach((unit) => {
            unit.weaponCooldown = 10;
        });
        expect(await run(world, stutterGroupBack({ group, groupPosition: position, target }))).toEqual([true, []]);

        world.resources.get().influence.addCost('ground', position, 3, 50);
        const [handled, [retreat]] = await run(world, stutterGroupBack({ group, groupPosition: position, target }));
        expect([handled, retreat.abilityId, retreat.tags]).toEqual([true, MOVE, tagsOf(group)]);
        expect(distance(retreat.pos!, target)).toBeGreaterThan(distance(position, target));
    });

    it('stutterGroupForward attacks the enemy centre in range or when ready, moves in while cooling, and no-ops without enemies', async () => {
        const { world, scv, ling, group, position } = await fixture();
        const behavior = () =>
            stutterGroupForward({ group, groupPosition: position, target: ling.pos, enemies: [ling] });
        const centre = { x: 14.4, y: 14.8 };
        place(ling, centre.x, centre.y);

        expect(await run(world, behavior())).toEqual([true, [{ abilityId: ATTACK, tags: tagsOf(group), pos: centre }]]);
        scv.orders = [{ abilityId: ATTACK, targetWorldSpacePos: centre }];
        expect(await run(world, behavior())).toEqual([true, []]);
        scv.orders = [];

        place(ling, 14.4, 25);
        group.forEach((unit) => {
            unit.weaponCooldown = 10;
        });
        const [, [advance]] = await run(world, behavior());
        expect([advance.abilityId, advance.pos]).toEqual([MOVE, { x: 14.4, y: 25 }]);

        expect(
            await run(world, stutterGroupForward({ group, groupPosition: position, target: ling.pos, enemies: [] })),
        ).toEqual([false, []]);
    });

    it('groupUseAbility orders the whole group when every (sync) or any unit has the ability', async () => {
        const { world, scv, group } = await fixture();
        const target = { x: 20, y: 20 };
        scv.abilityAvailable = () => false;

        expect(await run(world, groupUseAbility({ abilityId: MOVE, group, target }))).toEqual([false, []]);
        expect(await run(world, groupUseAbility({ abilityId: MOVE, group, target, syncCommand: false }))).toEqual([
            true,
            [{ abilityId: MOVE, tags: tagsOf(group), pos: target }],
        ]);
    });
});
