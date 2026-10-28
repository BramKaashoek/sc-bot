import { describe, expect, it } from 'bun:test';
import Bluebird from 'bluebird';
import { plan } from '@sc-bot/core/behaviors';
import { ATTACKING } from '../constants/unit-role.ts';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';
import { currentCommander } from './command-context.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { Behavior, BehaviorContext, CommandResult } from '../types.ts';

const MOVE = 16;
const ATTACK = 3674;
const MARINE_TAG = '4354211841';
const SCV_TAG = '4345823233';

const behavior = (name: string, execute: Behavior['execute']): Behavior => ({ name, execute });

const sentCommands = (world: TestWorld) =>
    world.client.sent.actions.flatMap(({ actions }) => actions ?? []).map(({ actionRaw }) => actionRaw!.unitCommand!);

describe('plan', () => {
    it('stops at the first behavior that returns true, across sync and async behaviors', async () => {
        const ran: string[] = [];
        const step = (name: string, result: boolean, async: false | 'native' | 'bluebird' = false) =>
            behavior(name, () => {
                ran.push(name);
                if (async === 'bluebird') return Bluebird.resolve(result) as unknown as Promise<boolean>;
                return async ? Promise.resolve(result) : result;
            });
        const ctx = {} as BehaviorContext;

        expect(plan(step('a', false), step('b', true), step('c', true)).execute(ctx)).toBe(true);
        expect(
            await plan(
                step('d', false, 'native'),
                step('e', false),
                step('f', true, 'native'),
                step('g', true),
            ).execute(ctx),
        ).toBe(true);
        expect(await plan(step('h', false, 'native'), step('i', false)).execute(ctx)).toBe(false);
        expect(await plan(step('j', false, 'bluebird'), step('k', true)).execute(ctx)).toBe(true);
        expect(ran).toEqual(['a', 'b', 'd', 'e', 'f', 'h', 'i', 'j', 'k']);
    });
});

describe('behaviors', () => {
    it('orders a unit once per owner per loop unless queued, targeting units by tag and points by position', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { behaviors, actions, units } = world.resources.get();
        const marine = units.getByTag(MARINE_TAG)!;
        const scv = units.getByTag(SCV_TAG)!;
        const results: boolean[] = [];
        const record = (ordered: boolean) => {
            results.push(ordered);
            return ordered;
        };

        await behaviors.run(
            behavior('orders', ({ order, hasOrdered }) => {
                results.push(order(marine, ATTACK, scv));
                results.push(order([marine], MOVE, { x: 20, y: 21 }));
                results.push(order(marine, MOVE, { x: 22, y: 23 }, { queue: true }));
                results.push(hasOrdered(MARINE_TAG), hasOrdered(scv));
                return true;
            }),
        );
        await actions.as({ owner: 'other' }, () =>
            behaviors.run(behavior('other', ({ order }) => record(order(marine, MOVE, { x: 1, y: 1 })))),
        );
        await actions.flushQueuedActions();
        await stepTo(world, observationAt(world, 900));
        await behaviors.run(behavior('next loop', ({ order }) => record(order(marine, MOVE, { x: 2, y: 2 }))));
        world.resources.reset(world);
        await behaviors.run(behavior('after reset', ({ order }) => record(order(marine, MOVE, { x: 3, y: 3 }))));

        expect(results).toEqual([true, false, true, true, false, true, true, true]);
        expect(sentCommands(world).slice(0, 2)).toEqual([
            { abilityId: ATTACK, unitTags: [MARINE_TAG], queueCommand: false, targetUnitTag: SCV_TAG },
            { abilityId: MOVE, unitTags: [MARINE_TAG], queueCommand: true, targetWorldSpacePos: { x: 22, y: 23 } },
        ]);
    });

    it('runs under a role owner or a priority override, returns the result, and lets the arbiter pick one owner per unit', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { behaviors, actions, events, units } = world.resources.get();
        const reader = events.createReader();
        const marine = units.getByTag(MARINE_TAG)!;
        const commanders: { owner: string; priority: number }[] = [];
        const ordering = (x: number) =>
            behavior('move', ({ order }) => {
                const { owner, priority } = currentCommander();
                commanders.push({ owner, priority });
                return order(marine, MOVE, { x, y: 1 });
            });

        const results = await actions.as({ owner: 'army', priority: 2 }, async () => [
            await behaviors.run(ordering(1), { role: ATTACKING }),
            await behaviors.run(ordering(2), { priority: 5 }),
            await behaviors.run(behavior('no', () => false)),
        ]);
        await actions.flushQueuedActions();

        expect(results).toEqual([true, true, false]);
        expect(commanders).toEqual([
            { owner: 'role:ATTACKING', priority: 2 },
            { owner: 'army', priority: 5 },
        ]);
        expect(
            events
                .read(reader)
                .flatMap(({ data }) => data as CommandResult[])
                .map(({ owner, outcome }) => ({ owner, outcome })),
        ).toEqual([
            { owner: 'role:ATTACKING', outcome: 'dropped' },
            { owner: 'army', outcome: 'won' },
        ]);
    });
});
