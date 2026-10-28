import { describe, expect, it } from 'bun:test';
import { createTestWorld } from '../test/create-test-world.ts';
import type { EventType } from '../types.ts';

describe('EventChannel', () => {
    it.each(['build', 'unit'] as const)(
        'delivers a %s event to build/unit and agent readers, keeping its type',
        async (type) => {
            const world = await createTestWorld('blueshift', { loop: 896 });
            const { events } = world.resources.get();
            const readers = (['build', 'unit', 'agent'] as EventType[]).map((t) => events.createReader(t));
            const engineReader = events.createReader('engine');

            events.write({ name: 'x', type });

            for (const reader of readers) {
                expect(events.read(reader).map((event) => [event.name, event.type])).toEqual([['x', type]]);
            }
            expect(events.read(engineReader)).toHaveLength(0);
        },
    );

    it('delivers engine events to engine readers only and all events to everyone', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { events } = world.resources.get();
        const engineReader = events.createReader('engine');
        const agentReader = events.createReader('agent');

        events.write({ name: 'e', type: 'engine' });
        events.write({ name: 'a', type: 'all' });

        expect(events.read(engineReader).map((event) => event.name)).toEqual(['e', 'a']);
        expect(events.read(agentReader).map((event) => event.name)).toEqual(['a']);
    });
});
