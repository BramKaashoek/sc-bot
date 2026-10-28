import { describe, expect, it } from 'bun:test';
import { EFFECT_AUTOTURRET, EFFECT_GHOSTSNIPE, EFFECT_KD8CHARGE } from '../../constants/ability.ts';
import { Race } from '../../constants/enums.ts';
import { GHOST, HYDRALISK, ROACH, SPINECRAWLER } from '../../constants/unit-type.ts';
import { runBehavior } from '../../test/behavior-helpers.ts';
import { createTestWorld, stepTo } from '../../test/create-test-world.ts';
import { ghostSnipe, placePredictiveAoE, ravenAutoTurret, reaperGrenade } from './spells.ts';
import type { Unit } from '../../types.ts';

const MARINE = '4354211841';
const SCV = '4345823233';
const LINGS = ['4354473985', '4354736129'];

async function fixture(abilities: number[]) {
    const world = await createTestWorld('blueshift', { loop: 896 });
    const next = structuredClone(world.client.fixture.observations[896]);
    next.observation!.gameLoop = 900;
    const place: Record<string, Partial<SC2APIProtocol.Unit>> = {
        [MARINE]: { pos: { x: 38, y: 40, z: 0 }, facing: 0 },
        [LINGS[0]]: { pos: { x: 41, y: 40, z: 0 } },
        [LINGS[1]]: { pos: { x: 42, y: 40, z: 0 } },
        [SCV]: { pos: { x: 5, y: 5, z: 0 } },
    };
    for (const raw of next.observation!.rawData!.units!) Object.assign(raw, place[raw.tag!]);
    await stepTo(world, next);

    const get = (tag: string) => world.resources.get().units.getByTag(tag)!;
    const caster = get(MARINE);
    caster._availableAbilities = abilities;
    world.resources.get().map.isVisible = () => true;
    return { world, get, caster, lings: LINGS.map(get) };
}

const stepDistance = (unit: Unit, gameStep: number) => (unit.realSpeed() / 22.4) * gameStep;

describe('placePredictiveAoE', () => {
    it('lands the spell where the chaser will be after the delay, only when visible and within range', async () => {
        const { world, caster, lings } = await fixture([EFFECT_KD8CHARGE]);
        const [chaser] = lings;
        const opts = {
            unit: caster,
            path: [caster.pos, { x: 20, y: 40 }],
            enemyCenterUnit: chaser,
            aoeAbility: EFFECT_KD8CHARGE,
            abilityDelay: 9,
        };

        const [ok, sent] = await runBehavior(world, placePredictiveAoE(opts));
        expect(ok).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].pos!.x).toBeCloseTo(chaser.pos.x - 3 * stepDistance(chaser, world.config.gameStep), 5);
        expect(sent[0].pos!.y).toBeCloseTo(40, 5);

        expect(await runBehavior(world, placePredictiveAoE({ ...opts, reaperGrenadeRange: 1 }))).toEqual([false, []]);
        expect(await runBehavior(world, placePredictiveAoE({ ...opts, path: [] }))).toEqual([false, []]);
        world.resources.get().map.isVisible = () => false;
        expect(await runBehavior(world, placePredictiveAoE(opts))).toEqual([false, []]);
        world.resources.get().map.isVisible = () => true;
        caster._availableAbilities = [];
        expect(await runBehavior(world, placePredictiveAoE(opts))).toEqual([false, []]);
    });
});

describe('reaperGrenade', () => {
    const base = (caster: Unit, enemyUnits: Unit[]) => ({
        unit: caster,
        enemyUnits,
    });

    it('throws a plain two-target grenade when predictive placement is off', async () => {
        const { world, caster, lings } = await fixture([EFFECT_KD8CHARGE]);
        const plain = { placePredictive: false };

        expect(await runBehavior(world, reaperGrenade({ ...base(caster, lings), ...plain }))).toEqual([
            true,
            [{ abilityId: EFFECT_KD8CHARGE, pos: { x: 41.5, y: 40 } }],
        ]);
        expect(await runBehavior(world, reaperGrenade({ ...base(caster, [lings[0]]), ...plain }))).toEqual([false, []]);
        expect(
            await runBehavior(world, reaperGrenade({ ...base(caster, lings), ...plain, reaperGrenadeRange: 1 })),
        ).toEqual([false, []]);
    });

    it('leads the target when facing a non-worker, falling back to the plain throw otherwise', async () => {
        const { world, caster, lings } = await fixture([EFFECT_KD8CHARGE]);
        world.resources.get().pathing.findPath = (start, goal) => [start, goal];
        const [predicted] = (await runBehavior(world, reaperGrenade(base(caster, [lings[0]]))))[1];

        expect(predicted.pos!.x).toBeLessThan(lings[0].pos.x);
        expect(predicted.pos!.x).toBeGreaterThan(caster.pos.x);

        caster.facing = Math.PI;
        expect(await runBehavior(world, reaperGrenade(base(caster, [lings[0]])))).toEqual([false, []]);
        expect(await runBehavior(world, reaperGrenade(base(caster, lings)))).toEqual([
            true,
            [{ abilityId: EFFECT_KD8CHARGE, pos: { x: 41.5, y: 40 } }],
        ]);
    });

    it('falls through to the plain throw when the closest enemy is a worker', async () => {
        const { world, caster, lings, get } = await fixture([EFFECT_KD8CHARGE]);
        world.resources.get().pathing.findPath = (start, goal) => [start, goal];
        const scv = get(SCV);
        scv.pos = { x: 40, y: 40, z: 0 };

        expect(await runBehavior(world, reaperGrenade(base(caster, [scv, ...lings])))).toEqual([
            true,
            [{ abilityId: EFFECT_KD8CHARGE, pos: { x: 41, y: 40 } }],
        ]);
    });

    it('ignores flying and snapshot enemies when picking the closest', async () => {
        const { world, caster, lings } = await fixture([EFFECT_KD8CHARGE]);
        world.resources.get().pathing.findPath = (start, goal) => [start, goal];
        const [target, decoy] = lings;
        const expected = await runBehavior(world, reaperGrenade(base(caster, [target])));
        expect(expected[0]).toBe(true);
        decoy.pos = { x: 40, y: 40, z: 0 };

        decoy.isFlying = true;
        expect(await runBehavior(world, reaperGrenade(base(caster, [decoy, target])))).toEqual(expected);

        decoy.isFlying = false;
        decoy.isSnapshot = () => true;
        expect(await runBehavior(world, reaperGrenade(base(caster, [decoy, target])))).toEqual(expected);
    });

    it('does nothing without the ability or without targets', async () => {
        const { world, caster, lings } = await fixture([]);
        expect(await runBehavior(world, reaperGrenade(base(caster, lings)))).toEqual([false, []]);

        caster._availableAbilities = [EFFECT_KD8CHARGE];
        expect(await runBehavior(world, reaperGrenade(base(caster, [])))).toEqual([false, []]);
    });
});

describe('ghostSnipe', () => {
    it('snipes the most valuable free non-structure target worth 100+, only versus Zerg', async () => {
        const { world, caster, lings, get } = await fixture([EFFECT_GHOSTSNIPE]);
        caster.unitType = GHOST;
        const [roach, hydra] = lings;
        roach.unitType = ROACH;
        hydra.unitType = HYDRALISK;
        const crawler = get(SCV);
        crawler.unitType = SPINECRAWLER;
        crawler.pos = { x: 40, y: 38, z: 0 };
        const snipe = (enemies: Unit[]) => runBehavior(world, ghostSnipe({ unit: caster, closeEnemy: enemies }));

        world.agent.opponent = { race: Race.TERRAN };
        expect((await snipe([roach, hydra]))[0]).toBe(false);

        world.agent.opponent = { race: Race.ZERG };
        expect(await snipe([roach, hydra, crawler])).toEqual([
            true,
            [{ abilityId: EFFECT_GHOSTSNIPE, target: hydra.tag }],
        ]);
        expect(await snipe([roach, crawler])).toEqual([true, [{ abilityId: EFFECT_GHOSTSNIPE, target: roach.tag }]]);
        expect((await snipe([crawler]))[0]).toBe(false);

        caster.orders = [{ abilityId: EFFECT_GHOSTSNIPE, targetUnitTag: hydra.tag }];
        expect(await snipe([roach, hydra])).toEqual([true, [{ abilityId: EFFECT_GHOSTSNIPE, target: roach.tag }]]);

        caster.orders = [];
        world.resources.get().map.getTerrainHeight = ({ x }) => (x > 41.5 ? 10 : 0);
        expect(await snipe([roach, hydra])).toEqual([true, [{ abilityId: EFFECT_GHOSTSNIPE, target: roach.tag }]]);

        roach.pos = { x: 38 + 11.2, y: 40, z: 0 };
        expect((await snipe([roach]))[0]).toBe(false);
    });
});

describe('ravenAutoTurret', () => {
    it('drops a turret 3 toward the raven from the closest enemy once the enemies are worth more than 3 supply', async () => {
        const { world, caster, lings } = await fixture([EFFECT_AUTOTURRET]);
        const [near, far] = lings;
        near.unitType = ROACH;
        far.unitType = ROACH;
        const drop = (enemies: Unit[]) => runBehavior(world, ravenAutoTurret({ unit: caster, allCloseEnemy: enemies }));
        world.resources.get().map.inPlacementGrid = () => true;

        expect(await drop([near, far])).toEqual([true, [{ abilityId: EFFECT_AUTOTURRET, pos: { x: 38, y: 40 } }]]);
        expect((await drop([near]))[0]).toBe(false);

        far.unitType = SPINECRAWLER;
        expect((await drop([near, far]))[0]).toBe(false);
        expect((await drop([near, far, far]))[0]).toBe(false);

        far.unitType = ROACH;
        world.resources.get().map.inPlacementGrid = () => false;
        expect((await drop([near, far]))[0]).toBe(false);
    });

    it('reports true while a turret is already being cast and the enemies are only small', async () => {
        const { world, caster, lings } = await fixture([EFFECT_AUTOTURRET]);
        const drop = () => runBehavior(world, ravenAutoTurret({ unit: caster, allCloseEnemy: lings }));

        expect(await drop()).toEqual([false, []]);
        caster.orders = [{ abilityId: EFFECT_AUTOTURRET }];
        expect(await drop()).toEqual([true, []]);

        caster._availableAbilities = [];
        expect(await drop()).toEqual([false, []]);
    });
});
