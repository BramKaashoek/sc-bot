import { describe, expect, it, spyOn } from 'bun:test';
import { Ability, UnitType, Upgrade } from '../../constants/index.ts';
import { executeBehavior, macroWorld } from '../../test/behavior-helpers.ts';
import { rawUnit } from '../../test/factories.ts';
import type { TrackedBuild } from '../../types.ts';
import { techUp, upgradeController } from './tech.ts';

async function setup(units: SC2APIProtocol.Unit[], minerals = 1000) {
    const world = await macroWorld(units, { minerals });
    const { actions, buildings } = world.resources.get();
    return {
        world,
        build: spyOn(buildings, 'build').mockReturnValue({} as TrackedBuild),
        queued: spyOn(actions, 'queueAction'),
    };
}

const unit = (tag: string, unitType: number, overrides: SC2APIProtocol.Unit = {}) =>
    rawUnit({ tag, unitType, ...overrides });

describe('techUp', () => {
    it('builds a techlab on an idle addon-less barracks for a marauder and deducts its cost', async () => {
        const { world, queued } = await setup([
            unit('busy', UnitType.BARRACKS, { orders: [{ abilityId: Ability.TRAIN_MARINE }] }),
            unit('rax', UnitType.BARRACKS),
        ]);
        expect(await executeBehavior(world, techUp({ desired: { unit: UnitType.MARAUDER } }))).toBe(true);
        expect(queued.mock.calls.map(([command]) => command)).toMatchObject([
            { abilityId: Ability.BUILD_TECHLAB_BARRACKS, unitTags: ['rax'] },
        ]);
        expect(world.agent.minerals).toBe(950);
    });

    it('does nothing when an idle barracks already has a techlab', async () => {
        const { world, queued } = await setup([
            unit('rax', UnitType.BARRACKS, { addOnTag: 'lab' }),
            unit('lab', UnitType.BARRACKSTECHLAB),
        ]);
        expect(await executeBehavior(world, techUp({ desired: { unit: UnitType.MARAUDER } }))).toBe(false);
        expect(queued).not.toHaveBeenCalled();
    });

    it('builds the missing research structure through buildStructure', async () => {
        const { world, build } = await setup([unit('factory', UnitType.FACTORY)]);
        expect(await executeBehavior(world, techUp({ desired: { upgrade: Upgrade.TERRANVEHICLEWEAPONSLEVEL1 } }))).toBe(
            true,
        );
        expect(build).toHaveBeenCalledWith(UnitType.ARMORY, { placement: { findAlternative: true } });
    });
});

describe('upgradeController', () => {
    const stim = [unit('rax', UnitType.BARRACKS, { addOnTag: 'lab' }), unit('lab', UnitType.BARRACKSTECHLAB)];

    it('researches stim from an idle techlab', async () => {
        const { world, queued } = await setup(stim);
        expect(await executeBehavior(world, upgradeController({ upgrades: [Upgrade.STIMPACK] }))).toBe(true);
        expect(queued.mock.calls.map(([command]) => command)).toMatchObject([
            { abilityId: Ability.RESEARCH_STIMPACK, unitTags: ['lab'] },
        ]);
    });

    it('skips an upgrade just queued on another structure at progress 0', async () => {
        const { world, queued } = await setup([
            unit('ebay1', UnitType.ENGINEERINGBAY, {
                orders: [{ abilityId: Ability.RESEARCH_TERRANINFANTRYWEAPONSLEVEL1, progress: 0 }],
            }),
            unit('ebay2', UnitType.ENGINEERINGBAY),
        ]);
        expect(
            await executeBehavior(world, upgradeController({ upgrades: [Upgrade.TERRANINFANTRYWEAPONSLEVEL1] })),
        ).toBe(false);
        expect(queued).not.toHaveBeenCalled();
    });

    it('techs to an armory for +2 weapons', async () => {
        const { world, build } = await setup([
            unit('ebay', UnitType.ENGINEERINGBAY),
            unit('factory', UnitType.FACTORY),
        ]);
        expect(
            await executeBehavior(world, upgradeController({ upgrades: [Upgrade.TERRANINFANTRYWEAPONSLEVEL2] })),
        ).toBe(true);
        expect(build.mock.calls[0][0]).toBe(UnitType.ARMORY);
    });

    it('bank-holds only with prioritize when it cannot afford the research', async () => {
        const { world, queued } = await setup(stim, 50);
        expect(await executeBehavior(world, upgradeController({ upgrades: [Upgrade.STIMPACK] }))).toBe(false);
        expect(
            await executeBehavior(world, upgradeController({ upgrades: [Upgrade.STIMPACK], prioritize: true })),
        ).toBe(true);
        expect(queued).not.toHaveBeenCalled();
    });
});
