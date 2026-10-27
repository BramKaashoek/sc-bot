import { describe, expect, it } from 'bun:test';
import { Ability } from '../../constants/index.ts';
import { createTestWorld } from '../../test/create-test-world.ts';
import type { TestWorld } from '../../test/create-test-world.ts';
import { observation, rawUnit, toyFixture } from '../../test/factories.ts';
import { selectBuilder } from './select-builder.ts';

const NEAR = { x: 10, y: 10 };
const GATHER = [{ abilityId: Ability.HARVEST_GATHER, targetUnitTag: 'mineral' }];
const MOVE = [{ abilityId: Ability.MOVE, targetWorldSpacePos: { x: 20, y: 20 } }];
const BUILD = [{ abilityId: Ability.BUILD_SUPPLYDEPOT, targetWorldSpacePos: { x: 20, y: 20 } }];

type Case = {
    close?: SC2APIProtocol.UnitOrder[];
    far?: SC2APIProtocol.UnitOrder[];
    setup?: (world: TestWorld) => void;
    exclude?: ReadonlySet<string>;
};

async function pick({ close = GATHER, far = GATHER, setup, exclude }: Case) {
    const fixture = toyFixture();
    fixture.observations[0] = observation({
        units: [
            rawUnit({ tag: 'close', pos: { x: 10, y: 11, z: 10 }, orders: close }),
            rawUnit({ tag: 'far', pos: { x: 10, y: 15, z: 10 }, orders: far }),
        ],
    });
    const world = await createTestWorld(fixture);
    setup?.(world);
    return selectBuilder(world, NEAR, { exclude })?.tag;
}

describe('selectBuilder', () => {
    it('takes the closest available worker, skipping stuck, constructing, already ordered and excluded ones, idle or gathering before busy', async () => {
        const cases: Record<string, Case> = {
            closest: {},
            stuck: { setup: (world) => world.resources.get().units.getByTag('close')!.labels.set('stuck', true) },
            constructing: { close: BUILD, far: MOVE },
            orderedThisStep: {
                setup: (world) =>
                    world.resources.get().actions.queueAction({ abilityId: Ability.STOP, unitTags: ['close'] }),
            },
            excluded: { exclude: new Set(['close']) },
            idleBeforeMoving: { close: MOVE, far: [] },
            movingWhenNoneIdle: { close: MOVE, far: MOVE },
        };

        const picked = Object.fromEntries(
            await Promise.all(Object.entries(cases).map(async ([name, setup]) => [name, await pick(setup)])),
        );

        expect(picked).toEqual({
            closest: 'close',
            stuck: 'far',
            constructing: 'far',
            orderedThisStep: 'far',
            excluded: 'far',
            idleBeforeMoving: 'far',
            movingWhenNoneIdle: 'close',
        });
    });
});
