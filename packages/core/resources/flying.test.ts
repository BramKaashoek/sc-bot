import { describe, expect, it } from 'bun:test';
import { Ability, UnitType } from '../constants/index.ts';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import type { Point2D } from '../types.ts';

const BARRACKS = '4350541825';
const COMMAND_CENTER = '4342677505';
const FLYING: Record<number, number> = {
    [UnitType.BARRACKS]: UnitType.BARRACKSFLYING,
    [UnitType.COMMANDCENTER]: UnitType.COMMANDCENTERFLYING,
};

type Edit = { flying?: boolean; pos?: Point2D; orders?: SC2APIProtocol.UnitOrder[] };

function observation(
    world: TestWorld,
    gameLoop: number,
    edits: Record<string, Edit>,
    extra: SC2APIProtocol.Unit[] = [],
) {
    return observationAt(world, gameLoop, {
        edit: (units) =>
            units.map((raw) => {
                const edit = edits[raw.tag!];
                if (!edit) return raw;
                return {
                    ...raw,
                    ...(edit.flying && { unitType: FLYING[raw.unitType!], isFlying: true }),
                    ...(edit.pos && { pos: { ...edit.pos, z: raw.pos!.z } }),
                    orders: edit.orders ?? [],
                };
            }),
        add: extra,
    });
}

async function step(
    world: TestWorld,
    gameLoop: number,
    edits: Record<string, Edit> = {},
    extra: SC2APIProtocol.Unit[] = [],
) {
    const before = world.client.sent.actions.length;
    await stepTo(world, observation(world, gameLoop, edits, extra));
    return world.client.sent.actions
        .slice(before)
        .flatMap((request) => request.actions!.map((action) => action.actionRaw!.unitCommand!))
        .map(({ abilityId, unitTags, queueCommand, targetWorldSpacePos }) => ({
            abilityId,
            tags: unitTags,
            queue: queueCommand,
            ...(targetWorldSpacePos && { target: targetWorldSpacePos }),
        }));
}

describe('flying structures', () => {
    it('lifts, flies, lands at the destination (re-proposing a rejected landing) and drops the plan', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { flying, units } = world.resources.get();
        const destination = { x: 40.5, y: 30.5 };
        flying.move(units.getByTag(BARRACKS)!, destination);

        expect(await step(world, 900)).toEqual([{ abilityId: Ability.LIFT, tags: [BARRACKS], queue: false }]);
        expect(await step(world, 904, { [BARRACKS]: { flying: true } })).toEqual([
            { abilityId: Ability.MOVE, tags: [BARRACKS], queue: false, target: destination },
        ]);
        const near = { x: 38, y: 29 };
        const land = { abilityId: Ability.LAND, tags: [BARRACKS], queue: false, target: destination };
        expect(await step(world, 908, { [BARRACKS]: { flying: true, pos: near } })).toEqual([land]);
        expect(await step(world, 912, { [BARRACKS]: { flying: true, pos: near } })).toEqual([land]);
        expect(flying.getPlans()).toEqual([expect.objectContaining({ tag: BARRACKS, state: 'landing' })]);

        expect(await step(world, 916, { [BARRACKS]: { pos: destination } })).toEqual([]);
        expect(flying.getPlans()).toEqual([]);
    });

    it('cancels the queue of a busy structure before lifting', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { flying, units } = world.resources.get();
        flying.move(units.getByTag(BARRACKS)!, { x: 40.5, y: 30.5 });
        const training = [{ abilityId: Ability.TRAIN_MARINE, progress: 0.5 }];

        expect(await step(world, 900, { [BARRACKS]: { orders: training } })).toEqual([
            { abilityId: Ability.CANCEL_QUEUE5, tags: [BARRACKS], queue: false },
            { abilityId: Ability.LIFT, tags: [BARRACKS], queue: true },
        ]);
    });

    it('hovers near the destination without landing when land is false', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { flying, units } = world.resources.get();
        const destination = { x: 40.5, y: 30.5 };
        flying.move(units.getByTag(BARRACKS)!, destination, { land: false });

        expect(await step(world, 900, { [BARRACKS]: { flying: true, pos: { x: 40, y: 30 } } })).toEqual([]);
        expect(flying.getPlans()).toHaveLength(1);
    });

    it('swaps two structures, landing each on the other one’s spot', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { flying, units } = world.resources.get();
        const barracks = units.getByTag(BARRACKS)!;
        const commandCenter = units.getByTag(COMMAND_CENTER)!;
        const [barracksPos, centerPos] = [
            { x: 20.5, y: 17.5 },
            { x: 15.5, y: 15.5 },
        ];
        flying.swap(barracks, commandCenter);

        expect(await step(world, 900)).toEqual([
            { abilityId: Ability.LIFT, tags: [BARRACKS, COMMAND_CENTER], queue: false },
        ]);
        const bothFlying = { [BARRACKS]: { flying: true }, [COMMAND_CENTER]: { flying: true } };
        expect(await step(world, 904, bothFlying)).toEqual([
            { abilityId: Ability.LAND, tags: [BARRACKS], queue: false, target: centerPos },
            { abilityId: Ability.LAND, tags: [COMMAND_CENTER], queue: false, target: barracksPos },
        ]);
        await step(world, 908, { [BARRACKS]: { pos: centerPos }, [COMMAND_CENTER]: { pos: barracksPos } });
        expect(flying.getPlans()).toEqual([]);
    });

    it('moves the host to the closest idle reactor and the structure attached to it onto the host spot', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const close = rawUnit({ unitType: UnitType.FACTORYREACTOR, pos: { x: 30, y: 20, z: 12 } });
        const far = rawUnit({ unitType: UnitType.STARPORTREACTOR, pos: { x: 60, y: 60, z: 12 } });
        const factory = rawUnit({ unitType: UnitType.FACTORY, pos: { x: 27.5, y: 20.5, z: 12 }, addOnTag: close.tag });
        const host = rawUnit({ unitType: UnitType.STARPORT, pos: { x: 25.5, y: 30.5, z: 12 } });
        await step(world, 900, {}, [close, far, factory, host]);
        const { flying, units } = world.resources.get();

        expect(flying.addonSwap(UnitType.STARPORT, UnitType.STARPORTTECHLAB)).toBe(false);
        expect(flying.addonSwap(units.getByTag(host.tag)!, UnitType.REACTOR)).toBe(true);
        expect(flying.getPlans().map(({ tag, destination }) => [tag, destination])).toEqual([
            [factory.tag, { x: 25.5, y: 30.5 }],
            [host.tag, { x: 27.5, y: 20.5 }],
        ]);
    });
});
