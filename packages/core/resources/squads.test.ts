import { describe, expect, it } from 'bun:test';
import { ATTACKING, DEFENDING } from '../constants/unit-role.ts';
import { MARAUDER, MARINE } from '../constants/unit-type.ts';
import { createTestWorld, stepWith } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import { rawUnit, toyFixture } from '../test/factories.ts';

type Placed = [tag: string, x: number, y: number, unitType?: number];

const stepPlaced = (world: TestWorld, gameLoop: number, placed: Placed[]) =>
    stepWith(
        world,
        gameLoop,
        placed.map(([tag, x, y, unitType = MARINE]) => rawUnit({ tag, unitType, pos: { x, y, z: 10 } })),
    );

async function squadWorld(placed: Placed[]) {
    const world = await createTestWorld('blueshift', { loop: 896 });
    await stepPlaced(world, 900, placed);
    const { roles, squads } = world.resources.get();
    roles.assign(
        placed.map(([tag]) => tag),
        ATTACKING,
    );
    return { world, roles, squads };
}

const summary = (squads: { id: string; tags: ReadonlySet<string>; isMain: boolean }[]) =>
    squads.map(({ id, tags, isMain }) => ({ id, tags: [...tags].sort(), isMain }));

describe('squads', () => {
    it('clusters separate groups once per loop, keeps ids as units leave, join or change role, and picks the biggest as main', async () => {
        const { world, roles, squads } = await squadWorld([
            ['a1', 30, 30],
            ['a2', 31, 30],
            ['a3', 30, 31],
            ['b1', 60, 60],
        ]);

        const first = squads.getSquads(ATTACKING);
        expect(summary(first)).toEqual([
            { id: 'ATTACKING-1', tags: ['a1', 'a2', 'a3'], isMain: true },
            { id: 'ATTACKING-2', tags: ['b1'], isMain: false },
        ]);
        expect(squads.getSquads(ATTACKING)).toBe(first);
        expect(squads.getMainSquadPosition(ATTACKING)).toEqual({ x: 91 / 3, y: 91 / 3 });

        await stepPlaced(world, 904, [
            ['a1', 30, 30],
            ['a2', 31, 30],
            ['a3', 45, 45],
            ['b1', 60, 60],
            ['a4', 32, 31],
        ]);
        roles.assign('a4', ATTACKING);
        roles.assign('a2', DEFENDING);

        expect(summary(squads.getSquads(ATTACKING))).toEqual([
            { id: 'ATTACKING-1', tags: ['a1', 'a4'], isMain: true },
            { id: 'ATTACKING-2', tags: ['b1'], isMain: false },
            { id: 'ATTACKING-3', tags: ['a3'], isMain: false },
        ]);
    });

    it('merges at most one pair per loop, smaller into larger and newer into older on a tie', async () => {
        const { world, squads } = await squadWorld([
            ['a1', 30, 30],
            ['b1', 37, 30],
            ['b2', 38, 30],
            ['c1', 30, 37],
            ['x1', 80, 30],
            ['y1', 80, 37],
        ]);
        squads.getSquads(ATTACKING);
        const converged: Placed[] = [
            ['a1', 31, 31],
            ['b1', 36, 31],
            ['b2', 37, 31],
            ['c1', 32, 36],
            ['x1', 80, 31],
            ['y1', 80, 36],
        ];
        const squadsAt = async (gameLoop: number) => {
            await stepPlaced(world, gameLoop, converged);
            return summary(squads.getSquads(ATTACKING)).map(({ id, tags }) => [id, tags]);
        };

        expect(await squadsAt(904)).toHaveLength(5);
        expect(await squadsAt(908)).toEqual([
            ['ATTACKING-2', ['a1', 'b1', 'b2']],
            ['ATTACKING-3', ['c1']],
            ['ATTACKING-4', ['x1']],
            ['ATTACKING-5', ['y1']],
        ]);
        expect(await squadsAt(912)).toEqual([
            ['ATTACKING-2', ['a1', 'b1', 'b2', 'c1']],
            ['ATTACKING-4', ['x1']],
            ['ATTACKING-5', ['y1']],
        ]);
        expect(await squadsAt(916)).toEqual([
            ['ATTACKING-2', ['a1', 'b1', 'b2', 'c1']],
            ['ATTACKING-4', ['x1', 'y1']],
        ]);
    });

    it('partitions by types and falls back to the last main position, then the main base', async () => {
        const { world, roles, squads } = await squadWorld([
            ['m1', 30, 30],
            ['r1', 60, 60, MARAUDER],
        ]);

        expect(squads.getSquads(ATTACKING, { types: MARAUDER }).map(({ id, tags }) => [id, [...tags]])).toEqual([
            ['ATTACKING-1', ['r1']],
        ]);
        expect(squads.getMainSquadPosition(ATTACKING, { types: MARINE })).toEqual({ x: 30, y: 30 });

        roles.clear('m1');
        await stepPlaced(world, 904, [['r1', 60, 60, MARAUDER]]);
        expect(squads.getMainSquadPosition(ATTACKING, { types: MARINE })).toEqual({ x: 30, y: 30 });
        expect(squads.getMainSquadPosition(DEFENDING)).toEqual(world.resources.get().map.getMain()!.townhallPosition);
    });

    it('throws a clear error when there is no main squad, main expansion or own base', async () => {
        const world = await createTestWorld(toyFixture({ ownTownhall: false }));
        const { map, squads } = world.resources.get();
        map._expansions = [];

        expect(() => squads.getMainSquadPosition(ATTACKING)).toThrow(
            'getMainSquadPosition: no main squad, main expansion or own base',
        );
    });
});
