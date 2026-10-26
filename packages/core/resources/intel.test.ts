import { beforeAll, describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { Alliance } from '../constants/enums.ts';
import * as UnitType from '../constants/unit-type.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import type { EnemyStrategyDetected, IntelFlag, Point2D } from '../types.ts';
import { intelResource } from './intel.ts';

const LOOPS_PER_SECOND = 22.4;
const OWN_CC = { x: 15.5, y: 15.5 };
const OWN_START = { x: 15, y: 15 };
const OWN_NATURAL = { x: 14, y: 43 };
const ENEMY_START = { x: 120.5, y: 120.5 };
const ENEMY_NATURAL = { x: 121, y: 92 };
const NEAR_ENEMY = { x: 115, y: 115 };
const OUTSIDE = { x: 68, y: 68 };

const enemies = (unitType: number, at: Point2D, count = 1, overrides: SC2APIProtocol.Unit = {}) =>
    Array.from({ length: count }, (_, i) =>
        rawUnit({
            alliance: Alliance.ENEMY,
            owner: 2,
            unitType,
            pos: { x: at.x + (i % 4) * 0.5, y: at.y + Math.floor(i / 4) * 0.5, z: 10 },
            ...overrides,
        }),
    );

function observation(
    world: TestWorld,
    seconds: number,
    units: SC2APIProtocol.Unit[],
    { own = [], fog = [] }: { own?: SC2APIProtocol.Unit[]; fog?: Point2D[] } = {},
): SC2APIProtocol.ResponseObservation {
    const responseObservation = structuredClone(world.client.fixture.observations[896]);
    const raw = responseObservation.observation!;
    raw.gameLoop = Math.round(seconds * LOOPS_PER_SECOND);
    raw.rawData!.units = [...raw.rawData!.units!.filter((unit) => unit.alliance !== Alliance.ENEMY), ...units, ...own];
    const { data, size } = raw.rawData!.mapState!.visibility!;
    fog.forEach(({ x, y }) => {
        for (let dy = -3; dy <= 3; dy++)
            for (let dx = -3; dx <= 3; dx++) data![(Math.floor(y) + dy) * size!.x! + Math.floor(x) + dx] = 1;
    });
    return responseObservation;
}

const at = (point: Point2D, dx: number) => ({ x: point.x + dx, y: point.y });

const FLAG_CASES: [IntelFlag, boolean, number, SC2APIProtocol.Unit[]][] = [
    ['lingRush', true, 140, enemies(UnitType.ZERGLING, at(OWN_START, 10), 3)],
    ['lingRush', false, 160, enemies(UnitType.ZERGLING, at(OWN_START, 10), 3)],
    ['roachRush', true, 170, enemies(UnitType.ROACH, NEAR_ENEMY, 3)],
    ['roachRush', false, 190, enemies(UnitType.ROACH, NEAR_ENEMY, 3)],
    ['ravagerRush', true, 200, enemies(UnitType.RAVAGER, NEAR_ENEMY)],
    ['ravagerRush', false, 250, enemies(UnitType.RAVAGER, NEAR_ENEMY)],
    ['marineRush', true, 170, enemies(UnitType.BARRACKS, NEAR_ENEMY, 3)],
    [
        'marineRush',
        false,
        170,
        [...enemies(UnitType.BARRACKS, NEAR_ENEMY, 3), ...enemies(UnitType.FACTORY, at(NEAR_ENEMY, -6))],
    ],
    ['marauderRush', true, 150, enemies(UnitType.MARAUDER, NEAR_ENEMY)],
    ['marauderRush', false, 230, enemies(UnitType.MARAUDER, NEAR_ENEMY)],
    ['fourGate', true, 190, enemies(UnitType.GATEWAY, NEAR_ENEMY, 3)],
    ['fourGate', false, 190, enemies(UnitType.GATEWAY, NEAR_ENEMY, 2)],
    ['proxyZealot', true, 140, enemies(UnitType.ZEALOT, at(OWN_START, 20))],
    ['proxyZealot', false, 160, enemies(UnitType.ZEALOT, at(OWN_START, 20))],
    ['workerRush', true, 60, enemies(UnitType.DRONE, at(OWN_START, 5), 7)],
    ['workerRush', false, 60, enemies(UnitType.DRONE, at(OWN_START, 5), 6)],
    ['reaper', true, 100, enemies(UnitType.REAPER, NEAR_ENEMY)],
    ['reaper', false, 100, enemies(UnitType.MARINE, NEAR_ENEMY)],
    ['expanded', true, 300, enemies(UnitType.COMMANDCENTER, ENEMY_NATURAL)],
    ['expanded', false, 300, enemies(UnitType.COMMANDCENTER, ENEMY_START)],
    ['baseOutsideNatural', true, 300, enemies(UnitType.COMMANDCENTER, OUTSIDE)],
    ['baseOutsideNatural', false, 300, enemies(UnitType.COMMANDCENTER, ENEMY_NATURAL)],
    ['proxy', true, 200, enemies(UnitType.BARRACKS, at(OWN_START, 10))],
    ['proxy', false, 250, enemies(UnitType.BARRACKS, at(OWN_START, 10))],
    [
        'greedy',
        true,
        60,
        [
            ...enemies(UnitType.COMMANDCENTER, ENEMY_START),
            ...enemies(UnitType.COMMANDCENTER, ENEMY_NATURAL, 1, { buildProgress: 0.1 }),
        ],
    ],
    [
        'greedy',
        true,
        80,
        [
            ...enemies(UnitType.HATCHERY, ENEMY_START),
            ...enemies(UnitType.HATCHERY, ENEMY_NATURAL, 1, { buildProgress: 0.1 }),
            ...enemies(UnitType.HATCHERY, OUTSIDE, 1, { buildProgress: 0.1 }),
        ],
    ],
    [
        'greedy',
        false,
        100,
        [
            ...enemies(UnitType.COMMANDCENTER, ENEMY_START),
            ...enemies(UnitType.COMMANDCENTER, ENEMY_NATURAL, 1, { buildProgress: 0.1 }),
        ],
    ],
    ['rushed', true, 100, enemies(UnitType.ZERGLING, NEAR_ENEMY)],
    ['rushed', false, 110, enemies(UnitType.ZERGLING, NEAR_ENEMY)],
];

describe('intel flags', () => {
    let world: TestWorld;
    beforeAll(async () => {
        world = await createTestWorld('blueshift', { loop: 896 });
    });

    it.each(FLAG_CASES.map(([flag, expected, seconds, units]) => [flag, expected, seconds, units] as const))(
        '%s is %p at %ds',
        async (flag, expected, seconds, units) => {
            const { intel, memory } = world.resources.get();
            memory.getEnemies().forEach((enemy) => memory.forget(enemy.tag!));
            intelResource.reset!(intel, world);

            await stepTo(world, observation(world, seconds, units));

            expect(intel.has(flag)).toBe(expected);
        },
    );
});

describe('intel', () => {
    it('tracks ground threats with hysteresis and air threats by their own distance', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { intel } = world.resources.get();
        const ling = enemies(UnitType.ZERGLING, at(OWN_CC, 14))[0];
        const overlord = enemies(UnitType.OVERLORD, { x: OWN_CC.x, y: OWN_CC.y + 18 }, 1, { isFlying: true })[0];
        const lingAt = (dx: number) => ({ ...ling, pos: { ...ling.pos!, x: OWN_CC.x + dx } });
        const threatTags = () =>
            intel
                .getBaseThreats()
                .map(({ ground, air }) => ({ ground: ground.map((u) => u.tag), air: air.map((u) => u.tag) }));

        await stepTo(world, observation(world, 300, [ling, overlord]));
        expect(threatTags()).toEqual([{ ground: [ling.tag], air: [overlord.tag] }]);
        expect(intel.getMainThreat('air')).toBeUndefined();

        await stepTo(world, observation(world, 301, [lingAt(20)]));
        expect(threatTags()).toEqual([{ ground: [ling.tag], air: [] }]);

        await stepTo(world, observation(world, 302, [lingAt(25)]));
        expect(intel.getBaseThreats()).toEqual([]);

        await stepTo(world, observation(world, 303, [lingAt(14)]));
        await stepTo(world, observation(world, 304, [], { fog: [at(OWN_CC, 14)] }));
        expect(intel.getBaseThreats()).toEqual([]);
    });

    it('picks the base with the most supply of a kind as the main threat', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { intel } = world.resources.get();
        const natural = rawUnit({ unitType: UnitType.COMMANDCENTER, pos: { ...OWN_NATURAL, z: 10 } });
        const units = [
            ...enemies(UnitType.ZERGLING, at(OWN_CC, 6), 2),
            ...enemies(UnitType.MUTALISK, at(OWN_CC, -6), 1, { isFlying: true }),
            ...enemies(UnitType.ROACH, at(OWN_NATURAL, 5)),
        ];

        await stepTo(world, observation(world, 300, units, { own: [natural] }));

        expect(intel.getMainThreat('ground')?.townhall.tag).toBe(natural.tag);
        expect(intel.getMainThreat('ground')?.groundSupply).toBe(2);
        expect(intel.getMainThreat('air')?.townhall.tag).toBe('4342677505');
    });

    it('fires enemyStrategyDetected once in the detecting step and keeps the flag and its first loop', async () => {
        const seen: { flag: IntelFlag; gameLoop: number; stepLoop: number }[] = [];
        const agent = createAgent({
            async onEnemyStrategyDetected(world, data: EnemyStrategyDetected) {
                seen.push({ ...data, stepLoop: world.resources.get().frame.getGameLoop() });
            },
        });
        const world = await createTestWorld('blueshift', { loop: 896, agent });
        const { intel } = world.resources.get();
        const reaper = enemies(UnitType.REAPER, NEAR_ENEMY);

        await stepTo(world, observation(world, 100, reaper));
        await stepTo(world, observation(world, 101, reaper));
        await stepTo(world, observation(world, 102, []));

        const firstLoop = Math.round(100 * LOOPS_PER_SECOND);
        expect(seen.filter(({ flag }) => flag === 'reaper')).toEqual([
            { flag: 'reaper', gameLoop: firstLoop, stepLoop: firstLoop },
        ]);
        expect([intel.has('reaper'), intel.detectedAt('reaper')]).toEqual([true, firstLoop]);
    });

    it('lists proxy structures near the own start, ghosts included, but not creep tumors or gas buildings', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { intel } = world.resources.get();
        const [barracks] = enemies(UnitType.BARRACKS, at(OWN_START, 30));
        const excluded = [
            ...enemies(UnitType.CREEPTUMORBURROWED, at(OWN_START, 12)),
            ...enemies(UnitType.EXTRACTOR, at(OWN_START, 14)),
        ];

        await stepTo(world, observation(world, 200, [barracks, ...excluded]));
        await stepTo(world, observation(world, 201, excluded, { fog: [at(OWN_START, 30)] }));

        expect(intel.getProxies().map((unit) => unit.tag)).toEqual([barracks.tag]);
    });

    it('keeps settings across a game reset but forgets flags and threats', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { intel } = world.resources.get();
        intel.configure({ groundNearBase: 5 });
        await stepTo(world, observation(world, 100, enemies(UnitType.REAPER, NEAR_ENEMY)));

        world.client.setObservation(world.client.fixture.observations[896]);
        await world.engine.setupGame();
        await stepTo(world, observation(world, 300, enemies(UnitType.ZERGLING, at(OWN_CC, 10))));

        expect(intel.has('reaper')).toBe(false);
        expect(intel.getBaseThreats()).toEqual([]);
    });
});
