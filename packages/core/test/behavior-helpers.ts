import { createTestWorld, loadFixture } from './create-test-world.ts';
import { observation } from './factories.ts';
import type { TestWorld } from './create-test-world.ts';
import type { Behavior, Point2D, Unit } from '../types.ts';

export type Sent = { abilityId?: number; tags?: string[]; target?: string; pos?: Point2D };

export const placeUnit = (unit: Unit, x: number, y: number) => {
    unit.pos = { x, y, z: unit.pos.z };
};

let owner = 0;
export async function runBehavior(
    world: TestWorld,
    behavior: Behavior,
    { tags = false } = {},
): Promise<[boolean, Sent[]]> {
    const { behaviors, actions } = world.resources.get();
    actions.clearQueuedActions();
    const before = world.client.sent.actions.length;
    const result = await actions.as({ owner: `case-${owner++}` }, () => behaviors.run(behavior));
    await actions.flushQueuedActions();
    const sent = world.client.sent.actions
        .slice(before)
        .flatMap(({ actions: list }) => list ?? [])
        .map(({ actionRaw }) => actionRaw!.unitCommand!)
        .map(({ abilityId, unitTags, targetUnitTag, targetWorldSpacePos }) => ({
            abilityId,
            ...(tags && { tags: unitTags?.map(String).sort() }),
            ...(targetUnitTag && { target: targetUnitTag }),
            ...(targetWorldSpacePos && { pos: targetWorldSpacePos as Point2D }),
        }));
    return [result, sent];
}

export const executeBehavior = (world: TestWorld, behavior: Behavior) => world.resources.get().behaviors.run(behavior);

export type MacroWorldOptions = {
    minerals?: number;
    vespene?: number;
    foodCap?: number;
    foodUsed?: number;
    foodWorkers?: number;
    race?: SC2APIProtocol.Race;
};

export async function macroWorld(
    units: SC2APIProtocol.Unit[],
    { minerals = 1000, vespene = 1000, foodCap = 100, foodUsed = 20, foodWorkers, race }: MacroWorldOptions = {},
): Promise<TestWorld> {
    const fixture = loadFixture('blueshift');
    fixture.observations = {
        0: observation({
            mapSize: fixture.gameInfo.startRaw!.mapSize,
            playerCommon: { minerals, vespene, foodCap, foodUsed, ...(foodWorkers !== undefined && { foodWorkers }) },
            units,
        }),
    };
    const world = await createTestWorld(fixture);
    if (race !== undefined) world.agent.race = race;
    return world;
}
