import { describe, expect, it, spyOn } from 'bun:test';
import {
    EFFECT_CORROSIVEBILE,
    EFFECT_EMP,
    EFFECT_FUNGALGROWTH,
    EFFECT_KD8CHARGE,
    EFFECT_PARASITICBOMB,
    EFFECT_PSISTORM,
} from '../../constants/ability.ts';
import { PARASITICBOMB } from '../../constants/buff.ts';
import { PSISTORMPERSISTENT } from '../../constants/effect.ts';
import { Race } from '../../constants/enums.ts';
import { runBehavior } from '../../test/behavior-helpers.ts';
import { createTestWorld, stepTo } from '../../test/create-test-world.ts';
import { autoUseAOEAbility, useAOEAbility } from './aoe.ts';
import type { Point2D, Unit } from '../../types.ts';

const MARINE = '4354211841';
const SCV = '4345823233';
const LINGS = ['4354473985', '4354736129'];
const MID = { x: 41, y: 40 };

async function fixture(abilities: number[], scv: { pos: Point2D; isFlying?: boolean } = { pos: { x: 5, y: 5 } }) {
    const world = await createTestWorld('blueshift', { loop: 896 });
    const next = structuredClone(world.client.fixture.observations[896]);
    next.observation!.gameLoop = 900;
    const place: Record<string, Partial<SC2APIProtocol.Unit>> = {
        [MARINE]: { pos: { x: 38, y: 40, z: 0 } },
        [LINGS[0]]: { pos: { x: 40, y: 40, z: 0 } },
        [LINGS[1]]: { pos: { x: 42, y: 40, z: 0 } },
        [SCV]: { pos: { ...scv.pos, z: 0 }, isFlying: scv.isFlying ?? false },
    };
    for (const raw of next.observation!.rawData!.units!) Object.assign(raw, place[raw.tag!]);
    await stepTo(world, next);

    const get = (tag: string) => world.resources.get().units.getByTag(tag)!;
    const caster = get(MARINE);
    caster._availableAbilities = abilities;
    return { world, get, caster, lings: LINGS.map(get) };
}

describe('useAOEAbility', () => {
    it('casts at the best spot, on the closest target for unit-targeted spells, and rejects unsupported ids', async () => {
        const { world, caster, lings } = await fixture([EFFECT_PSISTORM, EFFECT_PARASITICBOMB]);
        const opts = { unit: caster, targets: lings, minTargets: 2 };

        expect(await runBehavior(world, useAOEAbility({ ...opts, abilityId: EFFECT_PSISTORM }))).toEqual([
            true,
            [{ abilityId: EFFECT_PSISTORM, pos: MID }],
        ]);
        expect(await runBehavior(world, useAOEAbility({ ...opts, abilityId: EFFECT_PARASITICBOMB }))).toEqual([
            true,
            [{ abilityId: EFFECT_PARASITICBOMB, target: LINGS[0] }],
        ]);
        expect(await runBehavior(world, useAOEAbility({ ...opts, abilityId: EFFECT_PSISTORM, minTargets: 3 }))).toEqual(
            [false, []],
        );
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        expect(await runBehavior(world, useAOEAbility({ ...opts, abilityId: 386 }))).toEqual([false, []]);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('does not cast unless the unit has the ability available', async () => {
        const { world, caster, lings } = await fixture([]);

        expect(
            await runBehavior(
                world,
                useAOEAbility({ unit: caster, abilityId: EFFECT_PSISTORM, targets: lings, minTargets: 2 }),
            ),
        ).toEqual([false, []]);
    });

    it('refuses when own ground or flying units would be hit and the matching flag is set', async () => {
        const ground = await fixture([EFFECT_PSISTORM], { pos: { x: 41, y: 41 } });
        const air = await fixture([EFFECT_PSISTORM], { pos: { x: 41, y: 41 }, isFlying: true });

        const attempt = ({ world, caster, lings }: typeof ground, flags: object) =>
            runBehavior(
                world,
                useAOEAbility({ unit: caster, abilityId: EFFECT_PSISTORM, targets: lings, minTargets: 2, ...flags }),
            );

        expect((await attempt(ground, {}))[0]).toBe(true);
        expect((await attempt(ground, { avoidOwnGround: true }))[0]).toBe(false);
        expect((await attempt(ground, { avoidOwnFlying: true }))[0]).toBe(true);
        expect((await attempt(air, { avoidOwnGround: true }))[0]).toBe(true);
        expect((await attempt(air, { avoidOwnFlying: true }))[0]).toBe(false);
    });

    it('does not stack an active effect or buff unless stackSameSpell is set', async () => {
        const { world, caster, lings } = await fixture([EFFECT_PSISTORM, EFFECT_PARASITICBOMB]);
        world.resources.get().map._activeEffects = [{ effectId: PSISTORMPERSISTENT, pos: [MID] }];
        const storm = { unit: caster, abilityId: EFFECT_PSISTORM, targets: lings, minTargets: 2 };

        expect((await runBehavior(world, useAOEAbility(storm)))[0]).toBe(false);
        expect((await runBehavior(world, useAOEAbility({ ...storm, stackSameSpell: true })))[0]).toBe(true);

        lings[0].buffIds = [PARASITICBOMB];
        const bomb = { ...storm, abilityId: EFFECT_PARASITICBOMB };
        expect((await runBehavior(world, useAOEAbility(bomb)))[0]).toBe(false);
        expect((await runBehavior(world, useAOEAbility({ ...bomb, stackSameSpell: true })))[0]).toBe(true);
    });

    it('keeps an already-casting order without recomputing while its spot is valid', async () => {
        const { world, caster, lings } = await fixture([EFFECT_PSISTORM]);
        const storm = { unit: caster, abilityId: EFFECT_PSISTORM, targets: lings, minTargets: 2 };
        caster.orders = [{ abilityId: EFFECT_PSISTORM, targetWorldSpacePos: { x: 41.5, y: 40 } }];

        expect(await runBehavior(world, useAOEAbility(storm))).toEqual([true, []]);
        expect(await runBehavior(world, useAOEAbility({ ...storm, recalculate: true }))).toEqual([
            true,
            [{ abilityId: EFFECT_PSISTORM, pos: MID }],
        ]);

        caster.orders = [{ abilityId: EFFECT_PSISTORM, targetWorldSpacePos: { x: 60, y: 60 } }];
        expect(await runBehavior(world, useAOEAbility(storm))).toEqual([
            true,
            [{ abilityId: EFFECT_PSISTORM, pos: MID }],
        ]);
    });
});

describe('autoUseAOEAbility', () => {
    it('casts the first table ability with targets in reach, at its own minTargets', async () => {
        const bile = await fixture([EFFECT_FUNGALGROWTH, EFFECT_CORROSIVEBILE]);
        expect(await runBehavior(bile.world, autoUseAOEAbility({ unit: bile.caster, targets: bile.lings }))).toEqual([
            true,
            [{ abilityId: EFFECT_CORROSIVEBILE, pos: { x: 40, y: 40 } }],
        ]);

        const fungal = await fixture([EFFECT_FUNGALGROWTH]);
        expect(
            await runBehavior(fungal.world, autoUseAOEAbility({ unit: fungal.caster, targets: fungal.lings })),
        ).toEqual([false, []]);

        const far = await fixture([EFFECT_CORROSIVEBILE]);
        far.lings[0].pos = { x: 70, y: 40, z: 0 };
        expect(await runBehavior(far.world, autoUseAOEAbility({ unit: far.caster, targets: [far.lings[0]] }))).toEqual([
            false,
            [],
        ]);
    });

    it('only EMPs targets with more than 48 shield or energy and needs two of them, four against Protoss', async () => {
        const { world, caster, lings } = await fixture([EFFECT_EMP]);
        const auto = () => runBehavior(world, autoUseAOEAbility({ unit: caster, targets: lings }));
        lings.forEach((ling) => Object.assign(ling, { shield: 48, energy: 48 }));
        expect((await auto())[0]).toBe(false);

        lings[0].shield = 49;
        expect((await auto())[0]).toBe(false);
        lings[1].energy = 49;
        expect(await auto()).toEqual([true, [{ abilityId: EFFECT_EMP, pos: MID }]]);

        world.agent.opponent = { race: Race.PROTOSS };
        expect((await auto())[0]).toBe(false);
    });

    it('uses the higher-priority table ability when several can be cast', async () => {
        const { world, caster, lings } = await fixture([EFFECT_EMP, EFFECT_CORROSIVEBILE]);
        lings.forEach((ling) => Object.assign(ling, { shield: 60 }));

        expect(await runBehavior(world, autoUseAOEAbility({ unit: caster, targets: lings }))).toEqual([
            true,
            [{ abilityId: EFFECT_CORROSIVEBILE, pos: { x: 40, y: 40 } }],
        ]);
    });

    it('only targets within the ability range plus the caster radius and 0.5', async () => {
        const { world, caster, lings } = await fixture([EFFECT_CORROSIVEBILE]);
        const reach = 9 + caster.radius! + 0.5;
        const auto = () => runBehavior(world, autoUseAOEAbility({ unit: caster, targets: [lings[0]] }));

        lings[0].pos = { x: caster.pos.x + reach - 0.05, y: caster.pos.y, z: 0 };
        expect((await auto())[0]).toBe(true);
        lings[0].pos = { x: caster.pos.x + reach + 0.05, y: caster.pos.y, z: 0 };
        expect((await auto())[0]).toBe(false);
    });

    it('storm avoids own ground and flying units, KD8 own ground units but not its caster', async () => {
        const stormers = [0, 1, 2, 3].map((i) => ({ tag: `s${i}`, pos: { x: 41 + i * 0.2, y: 40, z: 0 } }) as Unit);
        const storm = (scv: Parameters<typeof fixture>[1]) =>
            fixture([EFFECT_PSISTORM], scv).then(({ world, caster }) =>
                runBehavior(world, autoUseAOEAbility({ unit: caster, targets: stormers })).then(([cast]) => cast),
            );
        const nearby = { x: 41, y: 41 };
        expect(await storm(undefined)).toBe(true);
        expect(await storm({ pos: nearby })).toBe(false);
        expect(await storm({ pos: nearby, isFlying: true })).toBe(false);

        const kd8 = (scv: Parameters<typeof fixture>[1]) =>
            fixture([EFFECT_KD8CHARGE], scv).then(({ world, caster, lings }) =>
                runBehavior(world, autoUseAOEAbility({ unit: caster, targets: [lings[0]] })),
            );
        expect(await kd8(undefined)).toEqual([true, [{ abilityId: EFFECT_KD8CHARGE, pos: { x: 40, y: 40 } }]]);
        expect((await kd8({ pos: nearby }))[0]).toBe(false);
    });

    it('only considers the 40 targets nearest the caster', async () => {
        const target = (tag: string, x: number, y: number) =>
            ({ tag, pos: { x, y, z: 0 }, hasBuff: () => false }) as unknown as Unit;
        const decoys = Array.from({ length: 40 }, (_, i) => target(`d${i}`, 38 + 10 * (i + 1), 60));
        const pair = (x: number) => [target('p1', x, 40), target('p2', x + 1, 40)];
        const near = await fixture([EFFECT_PSISTORM]);
        const storm = (f: typeof near, targets: Unit[]) =>
            runBehavior(f.world, useAOEAbility({ unit: f.caster, abilityId: EFFECT_PSISTORM, targets, minTargets: 2 }));

        expect((await storm(near, [...decoys, ...pair(41)]))[0]).toBe(true);
        expect((await storm(near, [...decoys, ...pair(500)]))[0]).toBe(false);
    });
});
