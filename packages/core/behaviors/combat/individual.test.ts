import { describe, expect, it } from 'bun:test';
import { ATTACK, HARVEST_GATHER, MOVE } from '../../constants/ability.ts';
import { CloakState } from '../../constants/enums.ts';
import { CHANGELINGZERGLING, LARVA } from '../../constants/unit-type.ts';
import { placeUnit, runBehavior } from '../../test/behavior-helpers.ts';
import { createTestWorld } from '../../test/create-test-world.ts';
import {
    aMove,
    attackTarget,
    keepUnitSafe,
    moveToSafeTarget,
    pathUnitToTarget,
    shootAndMoveToTarget,
    shootTargetInRange,
    stutterUnitBack,
    stutterUnitForward,
    useAbility,
    workerKiteBack,
} from './individual.ts';
import type { TestWorld } from '../../test/create-test-world.ts';
import type { Point2D } from '../../types.ts';

const MARINE = '4354211841';
const SCV = '4345823233';
const LINGS = ['4354473985', '4354736129'];
const OVERLORD = '4353949698';
const MAIN_CLOSEST_MINERAL = '4302045185';

async function fixture() {
    const world = await createTestWorld('blueshift', { loop: 896 });
    const get = (tag: string) => world.resources.get().units.getByTag(tag)!;
    const marine = get(MARINE);
    const lings = LINGS.map(get);
    placeUnit(marine, 14.4, 10.8);
    lings.forEach((ling) => placeUnit(ling, 40, 40));
    return { world, get, marine, lings };
}

const danger = (world: TestWorld, layer: 'ground' | 'air', at: Point2D, radius = 3) =>
    world.resources.get().influence.addCost(layer, at, radius, 50);

const isSafe = (world: TestWorld, point: Point2D, layer: 'ground' | 'air' = 'ground') =>
    world.resources.get().pathing.isPositionSafe(point, { layer });

describe('individual combat behaviors', () => {
    it('aMove attacks toward a target until within successAtDistance; attackTarget always attacks', async () => {
        const { world, marine, lings } = await fixture();

        expect(await runBehavior(world, aMove({ unit: marine, target: { x: 40, y: 40 } }))).toEqual([
            true,
            [{ abilityId: ATTACK, pos: { x: 40, y: 40 } }],
        ]);
        expect(await runBehavior(world, aMove({ unit: marine, target: { x: 15, y: 13 } }))).toEqual([false, []]);
        expect(await runBehavior(world, attackTarget({ unit: marine, target: lings[0] }))).toEqual([
            true,
            [{ abilityId: ATTACK, target: lings[0].tag }],
        ]);
    });

    it('shootTargetInRange attacks the weakest visible target, keeps a running in-range shot and skips cloaked ones', async () => {
        const { world, marine, lings } = await fixture();
        const [strong, weak] = lings;
        placeUnit(strong, 14.4, 14.8);
        placeUnit(weak, 15, 14.5);
        weak.health = 10;

        expect(await runBehavior(world, shootTargetInRange({ unit: marine, targets: lings }))).toEqual([
            true,
            [{ abilityId: ATTACK, target: weak.tag }],
        ]);

        marine.orders = [{ abilityId: ATTACK, targetUnitTag: strong.tag }];
        expect(await runBehavior(world, shootTargetInRange({ unit: marine, targets: lings }))).toEqual([true, []]);
        marine.orders = [];

        placeUnit(strong, 40, 40);
        weak.cloak = CloakState.CLOAKED;
        expect(await runBehavior(world, shootTargetInRange({ unit: marine, targets: lings }))).toEqual([false, []]);
    });

    it('useAbility orders only an available ability', async () => {
        const { world, marine } = await fixture();
        const target = { x: 20, y: 20 };

        expect(await runBehavior(world, useAbility({ unit: marine, abilityId: MOVE, target }))).toEqual([
            true,
            [{ abilityId: MOVE, pos: target }],
        ]);
        expect(await runBehavior(world, useAbility({ unit: marine, abilityId: 386, target }))).toEqual([false, []]);
    });

    it('stutters forward or back: attack when ready, else close in or retreat out of danger', async () => {
        const { world, get, marine, lings } = await fixture();
        const [ling] = lings;
        placeUnit(ling, 14.4, 14.8);

        expect(await runBehavior(world, stutterUnitForward({ unit: marine, target: ling }))).toEqual([
            true,
            [{ abilityId: ATTACK, target: ling.tag }],
        ]);
        marine.weaponCooldown = 10;
        expect(await runBehavior(world, stutterUnitForward({ unit: marine, target: ling }))).toEqual([
            true,
            [{ abilityId: MOVE, pos: { x: 14.4, y: 14.8 } }],
        ]);

        const harmless = get(OVERLORD);
        placeUnit(ling, 40, 40);
        placeUnit(harmless, 14.4, 14.8);
        expect(await runBehavior(world, stutterUnitBack({ unit: marine, target: harmless }))).toEqual([false, []]);

        danger(world, 'ground', marine.pos);
        const [retreated, [retreat]] = await runBehavior(world, stutterUnitBack({ unit: marine, target: harmless }));
        expect([retreated, retreat.abilityId]).toEqual([true, MOVE]);
    });

    it('keepUnitSafe returns false when safe and otherwise moves toward safety on the layer of its flying state', async () => {
        const { world, marine } = await fixture();

        danger(world, 'air', marine.pos);
        expect(await runBehavior(world, keepUnitSafe({ unit: marine }))).toEqual([false, []]);

        marine.isFlying = true;
        const [moved, [command]] = await runBehavior(world, keepUnitSafe({ unit: marine }));
        expect([moved, command.abilityId]).toEqual([true, MOVE]);
    });

    it('pathUnitToTarget stops within successAtDistance and otherwise paths around danger', async () => {
        const { world, marine } = await fixture();
        const target = { x: 14.4, y: 20 };

        expect(await runBehavior(world, pathUnitToTarget({ unit: marine, target, successAtDistance: 10 }))).toEqual([
            false,
            [],
        ]);

        danger(world, 'ground', { x: 14.4, y: 14 });
        const [moved, [command]] = await runBehavior(world, pathUnitToTarget({ unit: marine, target }));
        expect([moved, command.abilityId, isSafe(world, command.pos!)]).toEqual([true, MOVE, true]);

        const [, [raw]] = await runBehavior(world, pathUnitToTarget({ unit: marine, target, sensitivity: 8 }));
        const [, [smooth]] = await runBehavior(
            world,
            pathUnitToTarget({ unit: marine, target, sensitivity: 8, smoothing: true }),
        );
        const [, [viaSafe]] = await runBehavior(
            world,
            moveToSafeTarget({ unit: marine, target, sensitivity: 8, smoothing: true }),
        );
        expect(smooth.pos).not.toEqual(raw.pos);
        expect(viaSafe.pos).toEqual(smooth.pos);
    });

    it('keepUnitSafe and pathUnitToTarget follow a custom grid instead of the world layer', async () => {
        const { world, marine } = await fixture();
        const { influence } = world.resources.get();
        const target = { x: 14.4, y: 20 };

        const custom = influence.getCleanGrid('ground');
        influence.addCost(custom, marine.pos, 1.5, 50);
        expect(await runBehavior(world, keepUnitSafe({ unit: marine }))).toEqual([false, []]);
        const [moved, [escape]] = await runBehavior(world, keepUnitSafe({ unit: marine, layer: custom }));
        expect([moved, escape.abilityId, custom.get(escape.pos!)]).toEqual([true, MOVE, 1]);

        const clean = influence.getCleanGrid('ground');
        const walled = influence.getCleanGrid('ground');
        influence.addCost(walled, { x: 14.4, y: 14 }, 2, 500);
        const [, [direct]] = await runBehavior(world, pathUnitToTarget({ unit: marine, target, layer: clean }));
        const [, [around]] = await runBehavior(world, pathUnitToTarget({ unit: marine, target, layer: walled }));
        expect(around.pos).not.toEqual(direct.pos);
        expect(walled.get(around.pos!)).toBe(1);
    });

    it('moveToSafeTarget moves to the safe spot nearest a dangerous target, directly or via pathing', async () => {
        const { world, marine } = await fixture();
        const target = { x: 20, y: 20 };
        danger(world, 'ground', target, 4);

        expect(await runBehavior(world, moveToSafeTarget({ unit: marine, target: { x: 14.9, y: 10.8 } }))).toEqual([
            false,
            [],
        ]);

        const [direct, [spot]] = await runBehavior(
            world,
            moveToSafeTarget({ unit: marine, target, usePathing: false }),
        );
        expect([direct, spot.abilityId, isSafe(world, spot.pos!), isSafe(world, target)]).toEqual([
            true,
            MOVE,
            true,
            false,
        ]);

        const [pathed, [step]] = await runBehavior(world, moveToSafeTarget({ unit: marine, target }));
        expect([pathed, step.abilityId]).toEqual([true, MOVE]);
    });

    it('shootAndMoveToTarget shoots enemies in range, else paths to the target until distToTarget', async () => {
        const { world, marine, lings } = await fixture();
        const target = { x: 14.4, y: 20 };
        placeUnit(lings[0], 14.4, 14.8);

        expect(await runBehavior(world, shootAndMoveToTarget({ unit: marine, enemies: lings, target }))).toEqual([
            true,
            [{ abilityId: ATTACK, target: lings[0].tag }],
        ]);
        const [moved, [command]] = await runBehavior(
            world,
            shootAndMoveToTarget({ unit: marine, enemies: [], target }),
        );
        expect([moved, command.abilityId]).toEqual([true, MOVE]);
        expect(
            await runBehavior(world, shootAndMoveToTarget({ unit: marine, enemies: [], target: { x: 14.4, y: 12 } })),
        ).toEqual([false, []]);
    });

    it('workerKiteBack attacks when ready, else mineral-walks away from real enemies, ignoring larva and changelings', async () => {
        const { world, get } = await fixture();
        const scv = get(SCV);
        const lings = LINGS.map(get);
        placeUnit(scv, 15, 22.3);
        placeUnit(lings[0], 15, 23);
        placeUnit(lings[1], 14.7, 24.4);

        expect(await runBehavior(world, workerKiteBack({ unit: scv, target: lings[0] }))).toEqual([
            true,
            [{ abilityId: ATTACK, target: lings[0].tag }],
        ]);

        const [, [escape]] = await runBehavior(
            world,
            workerKiteBack({ unit: scv, target: lings[0], shouldAttack: false }),
        );
        expect(escape.abilityId).toBe(HARVEST_GATHER);
        expect(escape.target).not.toBe(MAIN_CLOSEST_MINERAL);

        lings[0].unitType = LARVA;
        lings[1].unitType = CHANGELINGZERGLING;
        expect(await runBehavior(world, workerKiteBack({ unit: scv, target: lings[0], shouldAttack: false }))).toEqual([
            true,
            [{ abilityId: HARVEST_GATHER, target: MAIN_CLOSEST_MINERAL }],
        ]);

        world.resources
            .get()
            .units.getMineralFields()
            .forEach((mineral) => {
                mineral.lastSeen = -1;
            });
        expect(await runBehavior(world, workerKiteBack({ unit: scv, target: lings[0], shouldAttack: false }))).toEqual([
            false,
            [],
        ]);
    });
});
