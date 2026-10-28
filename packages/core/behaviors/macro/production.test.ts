import { describe, expect, it, spyOn } from 'bun:test';
import { Race } from '../../constants/enums.ts';
import { Ability, UnitType } from '../../constants/index.ts';
import { executeBehavior, macroWorld } from '../../test/behavior-helpers.ts';
import { rawUnit } from '../../test/factories.ts';
import type { FlightPlan, TrackedBuild } from '../../types.ts';
import { productionController } from './production.ts';

const base = { x: 16, y: 16 };
const composition = { [UnitType.MARINE]: { proportion: 1, priority: 0 } };

const depot = rawUnit({ tag: 'depot', unitType: UnitType.SUPPLYDEPOT });
const busyRax = (tag: string, progress = 0.1) =>
    rawUnit({ tag, unitType: UnitType.BARRACKS, orders: [{ abilityId: Ability.TRAIN_MARAUDER, progress }] });
const idleRax = rawUnit({ tag: 'idle', unitType: UnitType.BARRACKS });
const raxAt = (buildProgress: number) => rawUnit({ tag: 'new', unitType: UnitType.BARRACKS, buildProgress });

async function setup(
    units: SC2APIProtocol.Unit[],
    {
        minerals = 100,
        vespene = 1000,
        race = Race.TERRAN,
        rate = 1000,
        gasRate = 1000,
        plans = [] as FlightPlan[],
    } = {},
) {
    const world = await macroWorld(units, { minerals, vespene, race });
    const { actions, buildings, flying, frame } = world.resources.get();
    spyOn(frame, 'getScore').mockReturnValue({
        scoreDetails: { collectionRateMinerals: rate, collectionRateVespene: gasRate },
    } as SC2APIProtocol.Score);
    spyOn(flying, 'getPlans').mockReturnValue(plans);
    return {
        world,
        build: spyOn(buildings, 'build').mockReturnValue({} as TrackedBuild),
        queued: spyOn(actions, 'queueAction'),
    };
}

describe('productionController', () => {
    it('adds a barracks when income supports it and none is idle', async () => {
        const { world, build } = await setup([depot, busyRax('rax')]);
        expect(await executeBehavior(world, productionController({ composition, base }))).toBe(true);
        expect(build).toHaveBeenCalledWith(UnitType.BARRACKS, {
            placement: { base, flags: ['production'], findAlternative: true },
        });
    });

    it.each([
        [400, 400, true],
        [399, 400, false],
        [400, 399, false],
    ])('with an idle barracks, banking %d/%d adds one: %p', async (minerals, vespene, built) => {
        const { world, build } = await setup([depot, idleRax], { minerals, vespene, rate: 600 });
        expect(await executeBehavior(world, productionController({ composition, base }))).toBe(built);
        expect(build).toHaveBeenCalledTimes(built ? 1 : 0);
    });

    it.each([
        [0, false],
        [600, true],
    ])('banked reapers at gas income %d add a barracks: %p', async (gasRate, built) => {
        const { world, build } = await setup([depot, idleRax], { minerals: 1000, rate: 600, gasRate });
        expect(
            await executeBehavior(
                world,
                productionController({ composition: { [UnitType.REAPER]: { proportion: 1, priority: 0 } }, base }),
            ),
        ).toBe(built);
        expect(build).toHaveBeenCalledTimes(built ? 1 : 0);
    });

    it('counts only ready barracks plus pending toward banked production', async () => {
        const { world, build } = await setup([depot, idleRax, raxAt(0.5)], { minerals: 1000, rate: 200 });
        expect(await executeBehavior(world, productionController({ composition, base }))).toBe(true);
        expect(build).toHaveBeenCalledTimes(1);
    });

    it.each([
        [25, false],
        [35, true],
    ])('a barracks flying at x=%d (base x=16) lets one be added: %p', async (x, built) => {
        const { world, build } = await setup(
            [depot, busyRax('rax'), rawUnit({ tag: 'flyer', unitType: UnitType.BARRACKSFLYING, pos: { x, y: 16 } })],
            { plans: [{ tag: 'flyer', destination: base, land: true, state: 'flying', startedAt: 0 }] },
        );
        expect(await executeBehavior(world, productionController({ composition, base }))).toBe(built);
        expect(build).toHaveBeenCalledTimes(built ? 1 : 0);
    });

    it('adds nothing once the composition proportion is met', async () => {
        const { world, build } = await setup([
            depot,
            busyRax('rax'),
            rawUnit({ tag: 'marine', unitType: UnitType.MARINE }),
        ]);
        expect(await executeBehavior(world, productionController({ composition, base }))).toBe(false);
        expect(build).not.toHaveBeenCalled();
    });

    it.each([
        [1, 500, false],
        [0.15, 1000, false],
        [0.16, 1000, true],
    ])(
        'with a barracks under construction, proportion %d at income %d adds one: %p',
        async (proportion, rate, built) => {
            const { world, build } = await setup([depot, busyRax('rax'), raxAt(0.5)], { rate });
            expect(
                await executeBehavior(
                    world,
                    productionController({ composition: { [UnitType.MARINE]: { proportion, priority: 0 } }, base }),
                ),
            ).toBe(built);
            expect(build).toHaveBeenCalledTimes(built ? 1 : 0);
        },
    );

    it.each([
        ['order at 0.75', busyRax('soon', 0.75), false],
        ['order at 0.74', busyRax('soon', 0.74), true],
        ['construction at 0.9', raxAt(0.9), false],
        ['construction at 0.89', raxAt(0.89), true],
    ])('a second barracks with %s lets one be added: %p', async (_, rax, built) => {
        const { world, build } = await setup([depot, busyRax('rax'), rax]);
        expect(await executeBehavior(world, productionController({ composition, base }))).toBe(built);
        expect(build).toHaveBeenCalledTimes(built ? 1 : 0);
    });

    it.each([
        ['still morphing', { buildProgress: 0.5 }, false],
        ['busy', { orders: [{ abilityId: Ability.TRAINWARP_ZEALOT, progress: 0.1 }] }, true],
    ])('with a warpgate %s, zealots add a gateway: %p', async (_, warpgate, built) => {
        const { world, build } = await setup(
            [
                rawUnit({ tag: 'nexus', unitType: UnitType.NEXUS }),
                rawUnit({ tag: 'warpgate', unitType: UnitType.WARPGATE, ...warpgate }),
            ],
            { race: Race.PROTOSS },
        );
        expect(
            await executeBehavior(
                world,
                productionController({ composition: { [UnitType.ZEALOT]: { proportion: 1, priority: 0 } }, base }),
            ),
        ).toBe(built);
        expect(build.mock.calls).toEqual(
            built ? [[UnitType.GATEWAY, { placement: { base, flags: ['production'], findAlternative: true } }]] : [],
        );
    });

    it('techs up before adding production', async () => {
        const { world, build, queued } = await setup([depot, idleRax]);
        expect(
            await executeBehavior(
                world,
                productionController({ composition: { [UnitType.MARAUDER]: { proportion: 1, priority: 0 } }, base }),
            ),
        ).toBe(true);
        expect(queued.mock.calls.map(([command]) => command)).toMatchObject([
            { abilityId: Ability.BUILD_TECHLAB_BARRACKS, unitTags: ['idle'] },
        ]);
        expect(build).not.toHaveBeenCalled();
    });

    it('stops at the income cap', async () => {
        const raxes = Array.from({ length: 8 }, (_, i) => busyRax(`rax${i}`));
        const { world, build } = await setup([depot, ...raxes]);
        expect(await executeBehavior(world, productionController({ composition, base }))).toBe(false);
        expect(build).not.toHaveBeenCalled();
    });

    it('stops at maxProductionStructures', async () => {
        const { world, build } = await setup([depot, busyRax('rax')]);
        expect(
            await executeBehavior(world, productionController({ composition, base, maxProductionStructures: 1 })),
        ).toBe(false);
        expect(build).not.toHaveBeenCalled();
    });

    it('skips while the producer tech requirement is below 0.95', async () => {
        const { world, build } = await setup([
            rawUnit({ tag: 'depot', unitType: UnitType.SUPPLYDEPOT, buildProgress: 0.5 }),
            busyRax('rax'),
        ]);
        expect(await executeBehavior(world, productionController({ composition, base }))).toBe(false);
        expect(build).not.toHaveBeenCalled();
    });

    it('treats missing score as zero income instead of throwing', async () => {
        const { world, build } = await setup([depot, busyRax('rax')]);
        spyOn(world.resources.get().frame, 'getScore').mockReturnValue(null as never);
        expect(await executeBehavior(world, productionController({ composition, base }))).toBe(false);
        expect(build).not.toHaveBeenCalled();
    });

    it('returns false for Zerg', async () => {
        const { world, build } = await setup([busyRax('rax')], { race: Race.ZERG });
        expect(await executeBehavior(world, productionController({ composition, base }))).toBe(false);
        expect(build).not.toHaveBeenCalled();
    });
});
