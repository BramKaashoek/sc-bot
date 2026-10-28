import { describe, expect, it } from 'bun:test';
import { createTestWorld } from '../test/create-test-world.ts';
import { resetGameState } from './create-world.ts';

describe('core resource reset', () => {
    it('resetGameState drops queued actions and frame step times', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { units, actions, frame } = world.resources.get();
        const worker = units.getWorkers()[0];
        actions.queueAction({ abilityId: 1, unitTags: [worker.tag!] });
        frame.recordStepTime(12);

        resetGameState(world);

        expect(await actions.flushQueuedActions()).toBeUndefined();
        expect(frame.getStepTime()).toEqual({ min: 0, avg: 0, max: 0, last: 0 });
    });
});
