import { describe, expect, it, spyOn } from 'bun:test';
import { Race } from '../../constants/enums.ts';
import { Ability, UnitType } from '../../constants/index.ts';
import { executeBehavior, macroWorld } from '../../test/behavior-helpers.ts';
import { rawUnit } from '../../test/factories.ts';
import type { Behavior, TrackedBuild } from '../../types.ts';
import { autoSupply, buildStructure, expansionController, gasBuildingController, upgradeCCs } from './structures.ts';

type Units = SC2APIProtocol.Unit[];

async function setup(units: Units, { minerals = 1000, foodUsed = 20, foodCap = 23, race = Race.TERRAN } = {}) {
    const world = await macroWorld(units, { minerals, foodCap, foodUsed, race });
    const { buildings } = world.resources.get();
    const build = spyOn(buildings, 'build').mockReturnValue({} as TrackedBuild);
    const buildGas = spyOn(buildings, 'buildGas').mockReturnValue({} as TrackedBuild);
    return { world, build, buildGas };
}

const structures = (unitType: number, count: number, overrides: SC2APIProtocol.Unit = {}) =>
    Array.from({ length: count }, (_, index) => rawUnit({ tag: `${unitType}-${index}`, unitType, ...overrides }));

describe('buildStructure', () => {
    it('requests through the tracker with the placement options', async () => {
        const { world, build } = await setup([...structures(UnitType.SUPPLYDEPOT, 1)]);
        const closestTo = { x: 10, y: 20 };
        expect(
            await executeBehavior(
                world,
                buildStructure({ structureType: UnitType.BARRACKS, closestTo, flags: ['production'] }),
            ),
        ).toBe(true);
        expect(build).toHaveBeenCalledWith(UnitType.BARRACKS, {
            placement: { closestTo, flags: ['production'], findAlternative: true },
        });
    });

    it('returns false at maxOnRoute, at toCount counting pending, and below the tech check', async () => {
        const depot = structures(UnitType.SUPPLYDEPOT, 1);
        const onRoute = await setup(depot);
        spyOn(onRoute.world.resources.get().buildings, 'getTracked').mockReturnValue([
            { unitType: UnitType.BARRACKS, status: 'ordered' },
            { unitType: UnitType.BARRACKS, status: 'constructing' },
        ] as never);
        const barracks = buildStructure({ structureType: UnitType.BARRACKS });
        expect(await executeBehavior(onRoute.world, barracks)).toBe(false);
        expect(
            await executeBehavior(onRoute.world, buildStructure({ structureType: UnitType.BARRACKS, maxOnRoute: 2 })),
        ).toBe(true);

        const counted = await setup([
            ...depot,
            ...structures(UnitType.BARRACKS, 1),
            ...structures(UnitType.BARRACKS, 1),
        ]);
        spyOn(counted.world.agent, 'alreadyPending').mockReturnValue(1);
        expect(
            await executeBehavior(counted.world, buildStructure({ structureType: UnitType.BARRACKS, toCount: 2 })),
        ).toBe(false);
        expect(counted.build).not.toHaveBeenCalled();

        const noTech = await setup([]);
        expect(await executeBehavior(noTech.world, barracks)).toBe(false);
        expect(noTech.build).not.toHaveBeenCalled();
    });

    it('returns false for Zerg', async () => {
        const { world, build } = await setup([], { race: Race.ZERG });
        expect(await executeBehavior(world, buildStructure({ structureType: UnitType.SPAWNINGPOOL }))).toBe(false);
        expect(build).not.toHaveBeenCalled();
    });
});

describe('autoSupply', () => {
    const cases: Array<[string, Units, { foodUsed: number; foodCap: number }, boolean]> = [
        ['no production, supply left 2', [], { foodUsed: 21, foodCap: 23 }, true],
        ['no production, supply left 3', [], { foodUsed: 20, foodCap: 23 }, false],
        ['1 production, supply left 5', structures(UnitType.BARRACKS, 1), { foodUsed: 18, foodCap: 23 }, true],
        ['1 production, supply left 6', structures(UnitType.BARRACKS, 1), { foodUsed: 17, foodCap: 23 }, false],
        ['3 production, supply left 6', structures(UnitType.BARRACKS, 3), { foodUsed: 17, foodCap: 23 }, true],
        ['3 production, supply left 7', structures(UnitType.BARRACKS, 3), { foodUsed: 16, foodCap: 23 }, false],
        ['at the 200 cap', structures(UnitType.BARRACKS, 3), { foodUsed: 199, foodCap: 200 }, false],
    ];

    it.each(cases)('%s', async (_name, units, food, requested) => {
        const { world, build } = await setup(units, food);
        expect(await executeBehavior(world, autoSupply())).toBe(requested);
        expect(build.mock.calls).toEqual(
            requested ? [[UnitType.SUPPLYDEPOT, { placement: { flags: ['supplyDepot'], findAlternative: true } }]] : [],
        );
    });

    it('does not stack depots while enough are pending', async () => {
        const { world, build } = await setup(
            [...structures(UnitType.BARRACKS, 3), ...structures(UnitType.SUPPLYDEPOT, 2, { buildProgress: 0.5 })],
            { foodUsed: 21, foodCap: 23 },
        );
        expect(await executeBehavior(world, autoSupply())).toBe(false);
        expect(build).not.toHaveBeenCalled();
    });

    it('trains an overlord for Zerg and falls back to returnTrueIfSupplyRequired when it cannot', async () => {
        const { world } = await setup(structures(UnitType.HATCHERY, 1), { race: Race.ZERG, foodUsed: 23 });
        const train = spyOn(world.agent, 'train').mockResolvedValue(1);
        expect(await executeBehavior(world, autoSupply({ returnTrueIfSupplyRequired: false }))).toBe(true);
        expect(train).toHaveBeenCalledWith(UnitType.OVERLORD, 1);

        train.mockResolvedValue(0);
        expect(await executeBehavior(world, autoSupply({ returnTrueIfSupplyRequired: false }))).toBe(false);
        expect(await executeBehavior(world, autoSupply())).toBe(true);
    });
});

describe('expansionController', () => {
    const [first, second, third] = [10, 20, 30].map((x) => ({ townhallPosition: { x, y: 0 } }));

    async function setupExpansions(options?: Parameters<typeof setup>[1]) {
        const result = await setup([], options);
        const { map, pathing, placement } = result.world.resources.get();
        spyOn(map, 'getAvailableExpansions').mockReturnValue([first, second, third] as never);
        const safe = spyOn(pathing, 'isPositionSafe').mockReturnValue(true);
        const canPlace = spyOn(placement, 'canPlace').mockReturnValue(true);
        return { ...result, safe, canPlace };
    }

    it('skips an unsafe or blocked expansion and builds at the next one', async () => {
        const { world, build, safe } = await setupExpansions();
        safe.mockImplementation((point) => point !== first.townhallPosition);
        expect(await executeBehavior(world, expansionController({ toCount: 3 }))).toBe(true);
        expect(build).toHaveBeenLastCalledWith(UnitType.COMMANDCENTER, {
            at: second.townhallPosition,
        });

        await executeBehavior(world, expansionController({ toCount: 3, checkLocationIsSafe: false }));
        expect(build).toHaveBeenLastCalledWith(UnitType.COMMANDCENTER, {
            at: first.townhallPosition,
        });
    });

    it('respects toCount, maxPending and affordability', async () => {
        const ready = await setupExpansions();
        expect(await executeBehavior(ready.world, expansionController({ toCount: 1 }))).toBe(true);
        expect(await executeBehavior(ready.world, expansionController({ toCount: 0 }))).toBe(false);

        const pending = await setupExpansions();
        spyOn(pending.world.agent, 'alreadyPending').mockReturnValue(1);
        expect(await executeBehavior(pending.world, expansionController({ toCount: 3 }))).toBe(false);

        const poor = await setupExpansions({ minerals: 100 });
        expect(await executeBehavior(poor.world, expansionController({ toCount: 2 }))).toBe(false);
        expect(poor.build).not.toHaveBeenCalled();
        expect(await executeBehavior(poor.world, expansionController({ toCount: 2, prioritize: true }))).toBe(true);
    });
});

describe('gasBuildingController', () => {
    it('counts pending gas builds and stops at toCount, maxPending and under 35 minerals', async () => {
        const gas = structures(UnitType.REFINERY, 1);
        const open = await setup(gas);
        expect(await executeBehavior(open.world, gasBuildingController({ toCount: 2 }))).toBe(true);
        expect(open.buildGas).toHaveBeenCalledTimes(1);

        const atCount = await setup(gas);
        spyOn(atCount.world.resources.get().buildings, 'getTracked').mockReturnValue([
            { unitType: UnitType.REFINERY, status: 'ordered' },
        ] as never);
        expect(await executeBehavior(atCount.world, gasBuildingController({ toCount: 2 }))).toBe(false);

        const atMaxPending = await setup([]);
        spyOn(atMaxPending.world.resources.get().buildings, 'pending').mockReturnValue(1);
        expect(await executeBehavior(atMaxPending.world, gasBuildingController({ toCount: 4 }))).toBe(false);
        expect(await executeBehavior(atMaxPending.world, gasBuildingController({ toCount: 4, maxPending: 2 }))).toBe(
            true,
        );

        const poor = await setup([], { minerals: 34 });
        expect(await executeBehavior(poor.world, gasBuildingController({ toCount: 2 }))).toBe(false);
        expect(poor.buildGas).not.toHaveBeenCalled();

        const underConstruction = await setup([
            ...structures(UnitType.REFINERY, 1),
            rawUnit({ tag: 'unfinished', unitType: UnitType.REFINERY, buildProgress: 0.5 }),
        ]);
        spyOn(underConstruction.world.resources.get().buildings, 'getTracked').mockReturnValue([
            { unitType: UnitType.REFINERY, structureTag: 'unfinished', status: 'constructing' },
        ] as never);
        expect(
            await executeBehavior(underConstruction.world, gasBuildingController({ toCount: 3, maxPending: 2 })),
        ).toBe(true);
        expect(underConstruction.buildGas).toHaveBeenCalledWith({ max: 2 });
    });
});

describe('upgradeCCs', () => {
    const orbitalRequirements = [...structures(UnitType.BARRACKS, 1)];
    const orderedFor = (world: Awaited<ReturnType<typeof setup>>['world']) =>
        spyOn(world.resources.get().actions, 'queueAction');

    it('morphs the first ready idle command center and deducts the cost', async () => {
        const { world } = await setup([
            ...orbitalRequirements,
            rawUnit({ tag: 'busy', unitType: UnitType.COMMANDCENTER, orders: [{ abilityId: Ability.TRAIN_SCV }] }),
            rawUnit({ tag: 'building', unitType: UnitType.COMMANDCENTER, buildProgress: 0.5 }),
            rawUnit({ tag: 'idle', unitType: UnitType.COMMANDCENTER }),
        ]);
        const queued = orderedFor(world);
        expect(await executeBehavior(world, upgradeCCs({ to: UnitType.ORBITALCOMMAND }))).toBe(true);
        expect(queued).toHaveBeenCalledTimes(1);
        expect(queued.mock.calls[0][0]).toMatchObject({ abilityId: Ability.MORPH_ORBITALCOMMAND, unitTags: ['idle'] });
        expect(world.agent.minerals).toBe(850);

        const failed = await setup([...orbitalRequirements, rawUnit({ tag: 'cc', unitType: UnitType.COMMANDCENTER })]);
        const repeated: Behavior = {
            name: 'repeated',
            execute(ctx) {
                ctx.order(failed.world.resources.get().units.getById(UnitType.COMMANDCENTER), Ability.STOP);
                return upgradeCCs({ to: UnitType.ORBITALCOMMAND }).execute(ctx);
            },
        };
        expect(await executeBehavior(failed.world, repeated)).toBe(false);
        expect(failed.world.agent.minerals).toBe(1000);
    });

    it('holds the bank with prioritize and does nothing without', async () => {
        const units = [...orbitalRequirements, ...structures(UnitType.COMMANDCENTER, 1)];
        const poor = await setup(units, { minerals: 100 });
        const queued = orderedFor(poor.world);
        expect(await executeBehavior(poor.world, upgradeCCs({ to: UnitType.ORBITALCOMMAND }))).toBe(false);
        expect(await executeBehavior(poor.world, upgradeCCs({ to: UnitType.ORBITALCOMMAND, prioritize: true }))).toBe(
            true,
        );
        expect(queued).not.toHaveBeenCalled();
    });
});
