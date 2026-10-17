import { describe, expect, it } from 'bun:test';
import { Ability } from '../constants/index.ts';
import { createTestWorld } from './create-test-world.ts';
import { toyFixture } from './factories.ts';

describe('fake client', () => {
    it('records actions sent through the action manager', async () => {
        const world = await createTestWorld(toyFixture());
        const { actions, units } = world.resources.get();
        const [worker] = units.getWorkers();

        await actions.do(Ability.MOVE, worker.tag!, { target: { x: 10, y: 10 } });

        expect(world.client.sent.actions).toEqual([{
            actions: [{
                actionRaw: {
                    unitCommand: {
                        abilityId: Ability.MOVE,
                        unitTags: [worker.tag!],
                        queueCommand: false,
                        targetWorldSpacePos: { x: 10, y: 10 },
                    },
                },
            }],
        }]);
    });

    it('answers placement from grid and footprints, pathing by path length', async () => {
        const world = await createTestWorld(toyFixture());
        const { actions } = world.resources.get();

        const { placements, pathing } = await actions.sendQuery({
            placements: [
                { abilityId: Ability.BUILD_SUPPLYDEPOT, targetPos: { x: 16, y: 16 } },
                { abilityId: Ability.BUILD_SUPPLYDEPOT, targetPos: { x: 9, y: 17 } },
                { abilityId: Ability.BUILD_SUPPLYDEPOT, targetPos: { x: 1, y: 16 } },
            ],
            pathing: [{ startPos: { x: 12, y: 4 }, endPos: { x: 20, y: 4 } }],
        });

        expect(placements!.map(placement => placement.result)).toEqual([1, 44, 44]);
        expect(pathing![0].distance).toBe(8);
    });
});
