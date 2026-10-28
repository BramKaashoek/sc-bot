import { describe, expect, it, spyOn } from 'bun:test';
import { Race } from '../../constants/enums.ts';
import { UnitType } from '../../constants/index.ts';
import { executeBehavior, macroWorld } from '../../test/behavior-helpers.ts';
import { rawUnit } from '../../test/factories.ts';
import type { BuildOptions, Placement, PlacementFlag, Point2D, TrackedBuild } from '../../types.ts';
import { distanceSquared } from '../../utils/geometry/point.ts';
import { protossStaticDefence, restorePower } from './protoss.ts';

type Units = SC2APIProtocol.Unit[];

const at = (x: number, y: number) => ({ x, y, z: 10 });
const slot = (
    x: number,
    y: number,
    base: Point2D,
    state: Placement['state'] = 'available',
    ...flags: PlacementFlag[]
) => ({ pos: { x, y }, size: '2x2', base, flags: new Set(flags), state }) as Placement;

async function setup(units: Units, slots: Placement[] = [], race = Race.PROTOSS) {
    const world = await macroWorld(units, { race });
    const { buildings, placement, mining, map } = world.resources.get();
    const build = spyOn(buildings, 'build').mockReturnValue({} as TrackedBuild);
    spyOn(placement, 'getPlacements').mockImplementation((filter = {}) =>
        slots.filter(
            (candidate) =>
                (!filter.base || (candidate.base.x === filter.base.x && candidate.base.y === filter.base.y)) &&
                (!filter.size || candidate.size === filter.size) &&
                (!filter.state || candidate.state === filter.state),
        ),
    );
    spyOn(map, 'getMain').mockReturnValue({ townhallPosition: at(5, 5) } as never);
    const wouldPower = spyOn(placement, 'wouldPower').mockImplementation(
        (pylon, pos) => distanceSquared(pylon, pos) < 6.5 ** 2,
    );
    spyOn(placement, 'isPowered').mockImplementation((pos, { pylonBuildProgress = 1 } = {}) =>
        world.resources
            .get()
            .units.getById(UnitType.PYLON)
            .some((pylon) => pylon.buildProgress! >= pylonBuildProgress && wouldPower(pylon.pos, pos)),
    );
    const canPlace = spyOn(placement, 'canPlace').mockReturnValue(true);
    const selectWorker = spyOn(mining, 'selectWorker').mockReturnValue({} as never);
    return { world, build, canPlace, selectWorker, buildings };
}

const structure = (unitType: number, x: number, y: number, overrides: SC2APIProtocol.Unit = {}) =>
    rawUnit({ unitType, pos: at(x, y), health: 1000, healthMax: 1000, ...overrides });
const tracked = (unitType: number, target: { x: number; y: number }, status: string) =>
    ({ unitType, target, status }) as TrackedBuild;

describe('restorePower', () => {
    const gateway = (x: number, y: number, overrides: SC2APIProtocol.Unit = {}) =>
        structure(UnitType.GATEWAY, x, y, overrides);
    const home = at(20, 20);

    it('builds a pylon on an available slot in range with a close worker for an unfinished structure, ignoring isPowered', async () => {
        const probe = rawUnit({ unitType: UnitType.PROBE });
        const slots = [slot(26.5, 20, home), slot(23, 20, home, 'reserved'), slot(26, 20, home)];
        const { world, build, selectWorker } = await setup(
            [gateway(20, 20, { isPowered: true, buildProgress: 0.3 }), probe],
            slots,
        );
        const worker = world.resources.get().units.getByTag(probe.tag!);
        selectWorker.mockReturnValue(worker);

        expect(await executeBehavior(world, restorePower())).toBe(true);
        expect(selectWorker).toHaveBeenCalledWith({ x: 26, y: 20 }, { forceClose: true });
        expect(build.mock.calls).toEqual([[UnitType.PYLON, { at: { x: 26, y: 20 }, worker }]]);
    });

    it('treats a pylon strictly inside 6.5 as powering, including an unfinished one, but not at 6.5', async () => {
        const slots = [slot(23, 20, home)];
        const unfinished = await setup(
            [gateway(20, 20), structure(UnitType.PYLON, 26.4, 20, { buildProgress: 0.1 })],
            slots,
        );
        expect(await executeBehavior(unfinished.world, restorePower())).toBe(false);
        expect(unfinished.build).not.toHaveBeenCalled();

        const edge = await setup([gateway(20, 20), structure(UnitType.PYLON, 26.5, 20)], slots);
        expect(await executeBehavior(edge.world, restorePower())).toBe(true);
    });

    it('continues to the next unpowered structure after a blocked one and skips ones with a pylon en route', async () => {
        const { world, build } = await setup(
            [gateway(20, 20), gateway(60, 60), gateway(90, 90)],
            [slot(63, 60, at(60, 60)), slot(93, 90, at(90, 90))],
        );
        spyOn(world.resources.get().buildings, 'getTracked').mockReturnValue([
            tracked(UnitType.PYLON, { x: 62, y: 60 }, 'constructing'),
        ]);

        expect(await executeBehavior(world, restorePower())).toBe(true);
        expect(build.mock.calls.map(([, opts]) => opts?.at)).toEqual([{ x: 93, y: 90 }]);
    });

    it('does nothing for exempt structures, without a slot in range, a placeable slot or a worker', async () => {
        const exempt = await setup(
            [
                structure(UnitType.PYLON, 20, 20),
                structure(UnitType.ASSIMILATOR, 22, 20),
                structure(UnitType.NEXUS, 30, 30),
            ],
            [slot(23, 20, home)],
        );
        const far = await setup([gateway(20, 20)], [slot(40, 40, home)]);
        const unplaceable = await setup([gateway(20, 20)], [slot(23, 20, home)]);
        unplaceable.canPlace.mockReturnValue(false);
        const noWorker = await setup([gateway(20, 20)], [slot(23, 20, home)]);
        noWorker.selectWorker.mockReturnValue(undefined);
        const none = await setup([gateway(20, 20)]);

        for (const { world, build } of [exempt, far, unplaceable, noWorker, none]) {
            expect(await executeBehavior(world, restorePower())).toBe(false);
            expect(build).not.toHaveBeenCalled();
        }
    });

    it('returns false for Terran and Zerg', async () => {
        for (const race of [Race.TERRAN, Race.ZERG]) {
            const { world, build } = await setup([gateway(20, 20)], [slot(23, 20, home)], race);
            expect(await executeBehavior(world, restorePower())).toBe(false);
            expect(build).not.toHaveBeenCalled();
        }
    });
});

describe('protossStaticDefence', () => {
    const base = at(30, 30);
    const other = at(60, 60);
    const pylonSlot = (state: Placement['state'] = 'available') => slot(32, 32, base, state);
    const cannonSlot = (state: Placement['state'] = 'available') => slot(28, 28, base, state, 'staticDefence');
    const batterySlot = (state: Placement['state'] = 'available') => slot(34, 30, base, state, 'staticDefence');
    const slots = [pylonSlot(), cannonSlot(), batterySlot()];
    const nexus = (x = 30, y = 30, overrides: SC2APIProtocol.Unit = {}) => structure(UnitType.NEXUS, x, y, overrides);
    const tech = [structure(UnitType.FORGE, 40, 40), structure(UnitType.CYBERNETICSCORE, 42, 40)];
    const call = (unitType: number, at: Point2D = base): [number, BuildOptions] => [
        unitType,
        {
            placement: {
                base: at,
                flags: unitType === UnitType.PYLON ? undefined : ['staticDefence'],
                powered: unitType !== UnitType.PYLON,
                findAlternative: false,
            },
        },
    ];

    it.each([
        ['no defence', slots, [], UnitType.PYLON],
        [
            'a pylon on a taken slot',
            [pylonSlot('taken'), cannonSlot(), batterySlot()],
            [structure(UnitType.PYLON, 32, 32)],
            UnitType.PHOTONCANNON,
        ],
        [
            'a pylon and cannon on taken slots',
            [pylonSlot('taken'), cannonSlot('taken'), batterySlot()],
            [structure(UnitType.PYLON, 32, 32), structure(UnitType.PHOTONCANNON, 28, 28)],
            UnitType.SHIELDBATTERY,
        ],
        [
            'a pylon off the taken slot',
            [pylonSlot('taken'), cannonSlot(), batterySlot()],
            [structure(UnitType.PYLON, 35, 35)],
            UnitType.PYLON,
        ],
        ['a pylon near the base but not on a taken slot', slots, [structure(UnitType.PYLON, 32, 32)], UnitType.PYLON],
    ])('with %s builds %i next', async (_name, layout, defence, next) => {
        const { world, build } = await setup([nexus(), ...tech, ...defence], layout);
        expect(await executeBehavior(world, protossStaticDefence())).toBe(true);
        expect(build.mock.calls).toEqual([call(next)]);
    });

    it('does nothing at full counts, counting under-construction structures on taken slots', async () => {
        const full = await setup(
            [
                nexus(),
                ...tech,
                structure(UnitType.PYLON, 32, 32),
                structure(UnitType.PHOTONCANNON, 28, 28, { buildProgress: 0.4 }),
                structure(UnitType.SHIELDBATTERY, 34, 30),
            ],
            [pylonSlot('taken'), cannonSlot('taken'), batterySlot('taken')],
        );
        expect(await executeBehavior(full.world, protossStaticDefence())).toBe(false);
        expect(full.build).not.toHaveBeenCalled();

        const two = await setup(
            [nexus(), ...tech, structure(UnitType.PHOTONCANNON, 28, 28)],
            [pylonSlot('taken'), cannonSlot('taken'), batterySlot()],
        );
        expect(await executeBehavior(two.world, protossStaticDefence({ photonCannonsPerBase: 2 }))).toBe(true);
        expect(two.build.mock.calls).toEqual([call(UnitType.PYLON)]);
    });

    it('defends a Nexus still under construction, snapping to a base within 5.5 and ignoring one beyond', async () => {
        const building = await setup([nexus(30, 30, { buildProgress: 0.2 }), ...tech], slots);
        expect(await executeBehavior(building.world, protossStaticDefence())).toBe(true);
        expect(building.build.mock.calls).toEqual([call(UnitType.PYLON)]);

        const edge = await setup([nexus(35.5, 30), ...tech], slots);
        expect(await executeBehavior(edge.world, protossStaticDefence())).toBe(true);

        const beyond = await setup([nexus(35.6, 30), ...tech], slots);
        expect(await executeBehavior(beyond.world, protossStaticDefence())).toBe(false);
        expect(beyond.build).not.toHaveBeenCalled();
    });

    it('skips excluded bases and builds once per call across bases', async () => {
        const layout = [...slots, slot(62, 62, other), slot(58, 58, other, 'available', 'staticDefence')];
        const { world, build } = await setup([nexus(30, 30), nexus(60, 60), ...tech], layout);
        expect(await executeBehavior(world, protossStaticDefence({ excludeBaseLocations: [base] }))).toBe(true);
        expect(build.mock.calls).toEqual([call(UnitType.PYLON, other)]);

        const both = await setup([nexus(30, 30), nexus(60, 60), ...tech], layout);
        expect(await executeBehavior(both.world, protossStaticDefence())).toBe(true);
        expect(both.build).toHaveBeenCalledTimes(1);
    });

    it('falls through a blocked step to the next type at the same base', async () => {
        const maxed = await setup([nexus(), ...tech], slots);
        spyOn(maxed.buildings, 'getTracked').mockReturnValue([tracked(UnitType.PYLON, at(32, 32), 'ordered')]);
        expect(await executeBehavior(maxed.world, protossStaticDefence())).toBe(true);
        expect(maxed.build.mock.calls).toEqual([call(UnitType.PHOTONCANNON)]);

        const noSpot = await setup([nexus(), ...tech], slots);
        noSpot.build.mockReturnValueOnce(undefined);
        expect(await executeBehavior(noSpot.world, protossStaticDefence())).toBe(true);
        expect(noSpot.build.mock.calls).toEqual([call(UnitType.PYLON), call(UnitType.PHOTONCANNON)]);

        const nothing = await setup([nexus(), ...tech], slots);
        nothing.build.mockReturnValue(undefined);
        expect(await executeBehavior(nothing.world, protossStaticDefence())).toBe(false);
        expect(nothing.build).toHaveBeenCalledTimes(3);
    });

    it('gates cannons and batteries on 0.85 tech progress while still building the rest', async () => {
        const forge = (buildProgress: number) => structure(UnitType.FORGE, 40, 40, { buildProgress });
        const core = structure(UnitType.CYBERNETICSCORE, 42, 40);
        const layout = [pylonSlot('taken'), cannonSlot(), batterySlot()];
        const pylon = structure(UnitType.PYLON, 32, 32);

        const early = await setup([nexus(), pylon, forge(0.8), core], layout);
        expect(await executeBehavior(early.world, protossStaticDefence())).toBe(true);
        expect(early.build.mock.calls).toEqual([call(UnitType.SHIELDBATTERY)]);

        const late = await setup([nexus(), pylon, forge(0.9), core], layout);
        expect(await executeBehavior(late.world, protossStaticDefence())).toBe(true);
        expect(late.build.mock.calls).toEqual([call(UnitType.PHOTONCANNON)]);
    });

    it('defends the tech base first: techs up there before any defence', async () => {
        const techBase = at(90, 90);
        const missing = await setup([nexus()], slots);
        expect(await executeBehavior(missing.world, protossStaticDefence({ techBaseLocation: techBase }))).toBe(true);
        expect(missing.build.mock.calls).toEqual([
            [
                UnitType.FORGE,
                { placement: { base: techBase, closestTo: undefined, flags: undefined, findAlternative: true } },
            ],
        ]);

        const main = await setup([nexus()], slots);
        const start = at(10, 10);
        spyOn(main.world.resources.get().map, 'getMain').mockReturnValue({ townhallPosition: start } as never);
        await executeBehavior(main.world, protossStaticDefence());
        expect(main.build.mock.calls[0][1]?.placement?.base).toEqual(start);

        const noBatteries = await setup([nexus(), structure(UnitType.FORGE, 40, 40)], slots);
        expect(await executeBehavior(noBatteries.world, protossStaticDefence({ shieldBatteriesPerBase: 0 }))).toBe(
            true,
        );
        expect(noBatteries.build.mock.calls).toEqual([call(UnitType.PYLON)]);

        const noCore = await setup([nexus(), structure(UnitType.GATEWAY, 44, 40)], slots);
        await executeBehavior(noCore.world, protossStaticDefence({ pylonsPerBase: 0, photonCannonsPerBase: 0 }));
        expect(noCore.build.mock.calls[0][0]).toBe(UnitType.CYBERNETICSCORE);
    });

    it('returns false for Terran and Zerg', async () => {
        for (const race of [Race.TERRAN, Race.ZERG]) {
            const { world, build } = await setup([nexus()], slots, race);
            expect(await executeBehavior(world, protossStaticDefence())).toBe(false);
            expect(build).not.toHaveBeenCalled();
        }
    });
});
