import { describe, expect, it } from 'bun:test';
import {
    BUILD_CREEPTUMOR,
    BUILD_CREEPTUMOR_QUEEN,
    BUILD_CREEPTUMOR_TUMOR,
    EFFECT_TRANSFUSION,
    MOVE,
    SMART,
} from '../../constants/ability.ts';
import { CREEPTUMORQUEEN } from '../../constants/unit-type.ts';
import { placeUnit, runBehavior } from '../../test/behavior-helpers.ts';
import { createTestWorld } from '../../test/create-test-world.ts';
import { nydusPathUnitToTarget, queenSpreadCreep, tumorSpreadCreep, useTransfuse } from './zerg.ts';
import type { Point2D, Unit } from '../../types.ts';

const MARINE = '4354211841';
const OTHERS = ['4354473985', '4354736129', '4353949698'];

async function fixture() {
    const world = await createTestWorld('blueshift', { loop: 896 });
    const get = (tag: string) => world.resources.get().units.getByTag(tag)!;
    const [unit, ...rest] = [MARINE, ...OTHERS].map(get);
    [unit, ...rest].forEach((u, i) => placeUnit(u, 14 + i, 10));
    return { world, unit, rest };
}

describe('zerg individual behaviors', () => {
    it('tumorSpreadCreep builds at the furthest edge, falls back to a random creep spot, and respects its guards', async () => {
        const { world, unit } = await fixture();
        const { creep } = world.resources.get();
        const edgeCalls: unknown[] = [];
        let spread = true;
        let edge: Point2D | undefined = { x: 20, y: 11 };
        let random: Point2D | undefined = { x: 12, y: 9 };
        creep.shouldSpreadTumors = () => spread;
        creep.findEdgePosition = (...args) => (edgeCalls.push(args), edge);
        creep.randomPosition = () => random;
        const run = () => runBehavior(world, tumorSpreadCreep({ unit }));

        expect(await run()).toEqual([false, []]);

        unit._availableAbilities = [BUILD_CREEPTUMOR_TUMOR];
        expect(await run()).toEqual([true, [{ abilityId: BUILD_CREEPTUMOR, pos: { x: 20, y: 11 } }]]);
        expect(edgeCalls[0]).toEqual([unit.pos, { radius: 10.2, closest: false, spreadDistance: 1 }]);

        edge = undefined;
        expect(await run()).toEqual([true, [{ abilityId: BUILD_CREEPTUMOR, pos: { x: 12, y: 9 } }]]);

        random = undefined;
        expect(await run()).toEqual([false, []]);

        edge = { x: 20, y: 11 };
        spread = false;
        expect(await run()).toEqual([false, []]);
    });

    it('queenSpreadCreep keeps safe, waits on a running tumor, pre-moves with the cached edge, and places or walks to the spot', async () => {
        const { world, unit } = await fixture();
        const { creep, map, influence, units } = world.resources.get();
        const edgeCalls: unknown[] = [];
        const pathCalls: unknown[] = [];
        let edge: Point2D | undefined = { x: 30, y: 10 };
        let path: Point2D | undefined = { x: 16, y: 10 };
        let coverage = 50;
        creep.findEdgePosition = (...args) => (edgeCalls.push(args), edge);
        creep.getCoverage = () => coverage;
        creep.nextTumorOnPath = (...args) => (pathCalls.push(args), path);
        map.hasCreep = () => true;
        const natural = map.getEnemyNatural()!.townhallPosition;
        const run = (opts: { cancelIfCloseEnemy?: boolean; preMove?: boolean } = {}) =>
            runBehavior(world, queenSpreadCreep({ unit, ...opts }));

        expect(await run()).toEqual([true, [{ abilityId: MOVE, pos: { x: 30, y: 10 } }]]);
        expect(edgeCalls[0]).toEqual([unit.pos, { radius: 200, unitTag: unit.tag, cache: true }]);

        expect(await run({ preMove: false })).toEqual([true, [{ abilityId: MOVE, pos: { x: 30, y: 10 } }]]);
        expect(pathCalls).toEqual([]);

        unit._availableAbilities = [BUILD_CREEPTUMOR_QUEEN];
        expect(await run()).toEqual([true, [{ abilityId: MOVE, pos: { x: 30, y: 10 } }]]);
        expect(edgeCalls[2]).toEqual([unit.pos, { radius: 200, unitTag: unit.tag, cache: false }]);

        placeUnit(unit, 28, 10);
        expect(await run()).toEqual([true, [{ abilityId: BUILD_CREEPTUMOR_QUEEN, pos: { x: 30, y: 10 } }]]);

        coverage = 20;
        expect(await run()).toEqual([true, [{ abilityId: MOVE, pos: { x: 16, y: 10 } }]]);
        expect(pathCalls[0]).toEqual([unit.pos, natural, { layer: 'ground', findAlternative: true }]);

        map.hasCreep = () => false;
        await run();
        expect(pathCalls[1]).toEqual([unit.pos, map.getCenter(), { layer: 'ground', findAlternative: true }]);

        map.hasCreep = () => true;
        const getNatural = map.getEnemyNatural;
        map.getEnemyNatural = () => undefined;
        await run();
        expect(pathCalls[2]).toEqual([unit.pos, map.getCenter(), { layer: 'ground', findAlternative: true }]);
        map.getEnemyNatural = getNatural;

        path = undefined;
        expect(await run()).toEqual([false, []]);

        edge = undefined;
        unit._availableAbilities = [];
        expect(await run()).toEqual([true, []]);

        unit.orders = [{ abilityId: BUILD_CREEPTUMOR, targetWorldSpacePos: { x: 40, y: 40 } }];
        unit._availableAbilities = [BUILD_CREEPTUMOR_QUEEN];
        expect(await run()).toEqual([true, []]);

        const tumor = units.getByTag(OTHERS[0])!;
        units.getById = (type) => (type === CREEPTUMORQUEEN ? [tumor] : []) as never;
        placeUnit(tumor, 40, 41);
        expect(await run()).toEqual([false, []]);

        unit._availableAbilities = [];
        edge = { x: 29, y: 10 };
        placeUnit(unit, 28, 10);
        expect(await run()).toEqual([true, []]);

        influence.addCost('ground', unit.pos, 3, 50);
        const [moved, [retreat]] = await run();
        expect([moved, retreat.abilityId]).toEqual([true, MOVE]);
        expect((await run({ preMove: false }))[1][0].abilityId).toBe(MOVE);
        expect((await run({ cancelIfCloseEnemy: false }))[1][0].abilityId).toBe(MOVE);
        expect(await run({ cancelIfCloseEnemy: false, preMove: false })).toEqual([false, []]);
    });

    it('useTransfuse picks the first hurt in-range target, never twice in a loop, and respects its guards', async () => {
        const { world, unit, rest } = await fixture();
        const [first, second, third] = rest;
        const targets = [unit, first, second, third];
        const setHealth = (target: Unit, health: number, healthMax = 100) => {
            target.health = health;
            target.healthMax = healthMax;
        };
        targets.forEach((target) => setHealth(target, 100));
        let loop = 1;
        world.resources.get().frame.getGameLoop = () => loop;
        const transfuse = (extraRange?: number) => runBehavior(world, useTransfuse({ unit, targets, extraRange }));

        expect(await transfuse()).toEqual([false, []]);

        unit._availableAbilities = [EFFECT_TRANSFUSION];
        expect(await transfuse()).toEqual([false, []]);

        setHealth(unit, 10);
        setHealth(first, 40);
        setHealth(second, 10, 49);
        placeUnit(third, 14 + 7 + unit.radius! + third.radius! + 1, 10);
        setHealth(third, 10);
        expect(await transfuse()).toEqual([false, []]);

        expect(await transfuse(2)).toEqual([true, [{ abilityId: EFFECT_TRANSFUSION, target: third.tag }]]);
        expect(await transfuse(2)).toEqual([false, []]);

        loop++;
        setHealth(first, 39);
        placeUnit(third, 20, 10);
        expect(await transfuse()).toEqual([true, [{ abilityId: EFFECT_TRANSFUSION, target: first.tag }]]);
        expect(await transfuse()).toEqual([true, [{ abilityId: EFFECT_TRANSFUSION, target: third.tag }]]);

        unit.orders = [{ abilityId: EFFECT_TRANSFUSION, targetUnitTag: first.tag }];
        expect(await transfuse()).toEqual([true, []]);
    });

    it('nydusPathUnitToTarget enters the nydus only for a safe, unbanned exit and otherwise walks the path', async () => {
        const { world, unit, rest } = await fixture();
        const { nydus, influence } = world.resources.get();
        const entry = rest[0];
        placeUnit(entry, 30.5, 10.5);
        const nextCalls: unknown[] = [];
        const travellers: unknown[] = [];
        const exitTowards = { x: 18.5, y: 10.5 };
        let result: ReturnType<typeof nydus.nextPoint> = {
            point: { x: 30.5, y: 10.5 },
            exitTowards,
            nydusTags: [entry.tag!, 'exit'],
        };
        let banned = false;
        nydus.nextPoint = (...args) => (nextCalls.push(args), result);
        nydus.addTraveller = (...args) => void travellers.push(args.map((arg) => (arg === unit ? 'unit' : arg)));
        nydus.isBanned = () => banned;
        const target = { x: 80, y: 80 };
        const run = (opts: { successAtDistance?: number; exitMaxInfluence?: number } = {}) =>
            runBehavior(world, nydusPathUnitToTarget({ unit, target, smoothing: true, ...opts }));

        expect(await run({ successAtDistance: 1000 })).toEqual([false, []]);
        expect(nextCalls).toEqual([]);

        expect(await run()).toEqual([true, [{ abilityId: SMART, target: entry.tag }]]);
        expect(nextCalls[0]).toEqual([unit.pos, target, { layer: 'ground', sensitivity: 5, smoothing: true }]);
        expect(travellers).toEqual([['unit', entry.tag, 'exit', exitTowards]]);

        result = { ...result, point: { x: 24.5, y: 10.5 } };
        expect(await run()).toEqual([true, [{ abilityId: MOVE, pos: { x: 24.5, y: 10.5 } }]]);
        expect(travellers).toHaveLength(2);

        banned = true;
        expect(await run()).toEqual([true, [{ abilityId: MOVE, pos: { x: 24.5, y: 10.5 } }]]);
        banned = false;

        result = { point: target, exitTowards };
        expect(await run()).toEqual([true, [{ abilityId: MOVE, pos: target }]]);
        expect(travellers).toHaveLength(2);

        result = { ...result, point: { x: 24.5, y: 10.5 }, nydusTags: [entry.tag!, 'exit'] };
        influence.addCost('ground', exitTowards, 3, 50);
        expect(await run()).toEqual([true, [{ abilityId: MOVE, pos: { x: 24.5, y: 10.5 } }]]);
        expect(await run({ exitMaxInfluence: 100 })).toEqual([true, [{ abilityId: MOVE, pos: { x: 24.5, y: 10.5 } }]]);
        expect(travellers).toHaveLength(3);

        result = { point: target };
        expect(await run()).toEqual([true, [{ abilityId: MOVE, pos: target }]]);
        expect(travellers).toHaveLength(3);
    });
});
