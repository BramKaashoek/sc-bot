import { describe, expect, it, spyOn } from 'bun:test';
import * as T from '../../constants/build-target.ts';
import { Alliance } from '../../constants/enums.ts';
import { COMMANDCENTER, MARINE, REFINERY, SUPPLYDEPOT } from '../../constants/unit-type.ts';
import { createTestWorld, stepTo } from '../../test/create-test-world.ts';
import { rawUnit } from '../../test/factories.ts';
import { distance } from '../geometry/point.ts';
import { resolveTarget, scoutWaypoints, structurePlacement } from './targets.ts';
import type { TestWorld } from '../../test/create-test-world.ts';
import type { Point2D } from '../../types.ts';

const blueshift = () => createTestWorld('blueshift', { loop: 224 });

async function withEnemyAt(world: TestWorld, pos: Point2D) {
    const next = structuredClone(world.client.fixture.observations[224]);
    next.observation!.gameLoop = 228;
    next.observation!.rawData!.units!.push(
        rawUnit({ unitType: MARINE, alliance: Alliance.ENEMY, owner: 2, pos: { ...pos, z: 10 } }),
    );
    await stepTo(world, next);
}

describe('build targets', () => {
    it('resolves every target to its point', async () => {
        const world = await blueshift();
        const { map, mapAnalysis } = world.resources.get();
        const own = map.getExpansions();
        const enemy = map.getExpansions(Alliance.ENEMY);
        const start = map.getLocations().self!;

        const expected: Record<string, Point2D> = {
            [T.SPAWN]: own[0].townhallPosition,
            [T.NAT]: own[1].townhallPosition,
            [T.THIRD]: own[2].townhallPosition,
            [T.FOURTH]: own[3].townhallPosition,
            [T.FIFTH]: own[4].townhallPosition,
            [T.SIXTH]: own[5].townhallPosition,
            [T.ENEMY_SPAWN]: map.getEnemyMain()!.townhallPosition,
            [T.ENEMY_NAT]: map.getEnemyNatural()!.townhallPosition,
            [T.ENEMY_THIRD]: enemy[2].townhallPosition,
            [T.ENEMY_FOURTH]: enemy[3].townhallPosition,
            [T.RAMP]: map.getMainBaseRamp()!.topCenter,
            [T.ENEMY_RAMP]: mapAnalysis.getEnemyMainRamp()!.topCenter,
            [T.MAP_CENTER]: map.getCenter(true),
            [T.NAT_WALL]: own[1].townhallPosition,
            [T.REAPER_WALL]: start,
            [T.SUPPLY]: start,
            [T.PRODUCTION]: start,
            [T.UPGRADE]: start,
            [T.BUNKER]: start,
        };

        Object.entries(expected).forEach(([target, point]) => {
            expect(resolveTarget(world, target as never)).toEqual(point);
        });
        const vision = resolveTarget(world, T.ENEMY_NAT_VISION);
        expect(distance(vision, map.getEnemyNatural()!.townhallPosition)).toBeCloseTo(10, 5);
        expect(distance(vision, map.getCenter(true))).toBeLessThan(
            distance(map.getEnemyNatural()!.townhallPosition, map.getCenter(true)),
        );
    });

    it('turns structure targets into placement requests, townhall spots, proxies or nothing', async () => {
        const world = await blueshift();
        const { map } = world.resources.get();
        const natural = map.getNatural()!.townhallPosition;

        expect(structurePlacement(world, SUPPLYDEPOT, T.RAMP)).toEqual({ placement: { flags: ['wall'] } });
        expect(structurePlacement(world, SUPPLYDEPOT, T.NAT_WALL)).toEqual({
            placement: { base: natural, flags: ['wall'] },
        });
        expect(structurePlacement(world, SUPPLYDEPOT, T.REAPER_WALL)).toEqual({ placement: { flags: ['reaperWall'] } });
        expect(structurePlacement(world, SUPPLYDEPOT, T.SUPPLY)).toEqual({ placement: { flags: ['supplyDepot'] } });
        expect(structurePlacement(world, SUPPLYDEPOT, T.PRODUCTION)).toEqual({ placement: { flags: ['production'] } });
        expect(structurePlacement(world, SUPPLYDEPOT, T.UPGRADE)).toEqual({
            placement: { flags: ['upgradeStructure'] },
        });
        expect(structurePlacement(world, SUPPLYDEPOT, T.BUNKER)).toEqual({ placement: { flags: ['bunker'] } });
        expect(structurePlacement(world, SUPPLYDEPOT, T.THIRD)).toEqual({
            placement: { base: map.getThirds()[0].townhallPosition },
        });
        expect(structurePlacement(world, COMMANDCENTER, T.NAT)).toEqual({ at: natural });
        expect(structurePlacement(world, COMMANDCENTER)).toBeUndefined();
        expect(structurePlacement(world, COMMANDCENTER, T.RAMP)).toBeUndefined();
        expect(structurePlacement(world, COMMANDCENTER, T.SUPPLY)).toBeUndefined();
        expect(structurePlacement(world, COMMANDCENTER, T.MAP_CENTER)).toEqual({ near: map.getCenter(true) });
        expect(structurePlacement(world, REFINERY, T.NAT)).toBeUndefined();
        expect(structurePlacement(world, SUPPLYDEPOT, T.ENEMY_NAT)).toEqual({
            near: map.getEnemyNatural()!.townhallPosition,
        });
        expect(structurePlacement(world, SUPPLYDEPOT, T.MAP_CENTER)).toEqual({ near: map.getCenter(true) });

        await withEnemyAt(world, map.getMainBaseRamp()!.topCenter);
        expect(structurePlacement(world, SUPPLYDEPOT, T.RAMP)).toEqual({ placement: {} });
    });

    it('scouts the enemy main from its ramp around the perimeter, the natural behind its minerals, and lists in order', async () => {
        const world = await blueshift();
        const { map, mapAnalysis } = world.resources.get();
        const enemyMain = map.getEnemyMain()!.townhallPosition;
        const region = mapAnalysis.getRegion(enemyMain)!;
        const rampTop = mapAnalysis.getEnemyMainRamp()!.topCenter;
        const perimeter = mapAnalysis.getPerimeter(region).filter((point) => distance(point, rampTop) > 8);
        const outward = (point: Point2D) => {
            const length = distance(point, enemyMain);
            return {
                x: point.x + ((point.x - enemyMain.x) / length) * 2,
                y: point.y + ((point.y - enemyMain.y) / length) * 2,
            };
        };
        const closestTo = (points: Point2D[], target: Point2D) =>
            points.reduce((best, point) => (distance(point, target) < distance(best, target) ? point : best));

        const waypoints = scoutWaypoints(world, [T.ENEMY_SPAWN]);
        const sources = waypoints.map(outward).map((point) => closestTo(perimeter, point));

        expect(waypoints.length).toBeGreaterThan(1);
        expect(waypoints.every((point) => mapAnalysis.getRegion(point)?.id === region.id)).toBe(true);
        expect(sources.every((source) => distance(source, rampTop) > 8)).toBe(true);
        sources.forEach((source, index) => {
            expect(distance(outward(waypoints[index]), source)).toBeLessThan(1e-6);
            if (index > 0) expect(distance(source, sources[index - 1])).toBeGreaterThanOrEqual(4);
        });
        expect(
            distance(sources[0], rampTop) - Math.min(...perimeter.map((point) => distance(point, rampTop))),
        ).toBeLessThanOrEqual(0.5);
        expect(scoutWaypoints(world, [T.NAT, T.MAP_CENTER])).toEqual([
            ...map.getNatural()!.areas!.behindMineralLine,
            map.getCenter(true),
        ]);

        const noRegion = spyOn(mapAnalysis, 'getRegion').mockReturnValue(undefined);
        expect(scoutWaypoints(world, [T.ENEMY_SPAWN])).toEqual([enemyMain]);
        noRegion.mockRestore();
    });
});
