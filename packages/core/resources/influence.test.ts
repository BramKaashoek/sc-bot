import { describe, expect, it, spyOn } from 'bun:test';
import * as Buff from '../constants/buff.ts';
import * as Effect from '../constants/effect.ts';
import { Alliance, Race } from '../constants/enums.ts';
import { UnitType } from '../constants/index.ts';
import { createTestWorld, loadFixture, observationAt, stepTo } from '../test/create-test-world.ts';
import * as climber from '../utils/map/climber.ts';
import { rawUnit } from '../test/factories.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { InfluenceLayer } from '../types.ts';

const LAYERS: InfluenceLayer[] = ['ground', 'air', 'groundAvoidance', 'airAvoidance'];
const BLOCKED = { x: 5, y: 5 };

async function openWorld(): Promise<TestWorld> {
    const fixture = loadFixture('acropolis');
    fixture.gameInfo.startRaw!.playableArea = { p0: { x: 2, y: 2 }, p1: { x: 138, y: 134 } };
    const world = await createTestWorld(fixture, { loop: 896 });
    const { memory } = world.resources.get();
    memory.getEnemies().forEach((unit) => memory.forget(unit.tag!));
    openPathing(world);
    return world;
}

function openPathing(world: TestWorld, width = 140, height = 136) {
    const { map } = world.resources.get();
    map.setSize({ x: width, y: height });
    map.getGrids().pathing = Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => (x === BLOCKED.x && y === BLOCKED.y ? 1 : 0)),
    );
}

const enemy = (unitType: number, x: number, y: number, overrides: SC2APIProtocol.Unit = {}) =>
    rawUnit({ alliance: Alliance.ENEMY, owner: 2, unitType, pos: { x, y, z: 10 }, ...overrides });

async function observe(
    world: TestWorld,
    gameLoop: number,
    enemies: SC2APIProtocol.Unit[],
    effects: SC2APIProtocol.Effect[] = [],
) {
    const responseObservation = observationAt(world, gameLoop, {
        edit: (units) => [...units.filter((raw) => raw.alliance !== Alliance.ENEMY), ...enemies],
    });
    responseObservation.observation!.rawData!.effects = effects;
    await stepTo(world, responseObservation);
}

const libZone = (effectId: number, x: number, y: number, alliance: number) =>
    ({ effectId, pos: [{ x, y }], alliance }) as SC2APIProtocol.Effect;

const ALL_LAYERS: InfluenceLayer[] = [
    ...LAYERS,
    'climber',
    'airVsGround',
    'groundToAir',
    'priorityGroundAvoidance',
    'tacticalGround',
];

const layerCosts = (world: TestWorld, x: number, y: number, layers = ALL_LAYERS) =>
    layers.map((layer) => world.resources.get().influence.getGrid(layer).get({ x, y }));

const costs = (world: TestWorld, x: number, y: number) =>
    LAYERS.map((layer) => world.resources.get().influence.getGrid(layer).get({ x, y }));

describe('InfluenceResource', () => {
    it('stamps enemy ranges onto pathing and playable-area base layers, ghosts included, changelings skipped', async () => {
        const world = await openWorld();
        const stalker = enemy(UnitType.STALKER, 40.5, 40.5);
        const others = [
            enemy(UnitType.ZERGLING, 70.5, 68.5),
            enemy(UnitType.VIKINGFIGHTER, 100.5, 68.5, { isFlying: true }),
            enemy(UnitType.SIEGETANKSIEGED, 70.5, 100.5),
            enemy(UnitType.CHANGELINGMARINE, 100.5, 100.5),
        ];
        await observe(world, 900, [stalker, ...others]);
        await observe(world, 904, others);
        const { influence, memory } = world.resources.get();
        expect(memory.getGhosts().map((unit) => unit.tag)).toEqual([stalker.tag]);

        expect({
            blocked: layerCosts(world, BLOCKED.x + 0.7, BLOCKED.y + 0.2),
            outsidePlayable: layerCosts(world, 1, 70),
            outOfBounds: influence.getGrid('ground').get({ x: -1, y: 70 }),
            open: layerCosts(world, 20, 120),
            ghost: costs(world, 40, 40).map((cost) => cost > 1),
            melee: [costs(world, 74, 68), costs(world, 75, 68)].map(([ground, air]) => [ground > 1, air]),
            airOnly: costs(world, 100, 68)
                .slice(0, 2)
                .map((cost) => cost > 1),
            siegedTank15Away: costs(world, 85, 100)
                .slice(0, 2)
                .map((cost) => cost > 1),
            changeling: costs(world, 100, 100),
        }).toEqual({
            blocked: [Infinity, 1, Infinity, 1, Infinity, 1, 1, Infinity, Infinity],
            outsidePlayable: [1, Infinity, 1, Infinity, 1, Infinity, Infinity, 1, Infinity],
            outOfBounds: Infinity,
            open: [1, 1, 1, 1, 1, 10, 1, 1, 200],
            ghost: [true, true, false, false],
            melee: [
                [true, 1],
                [false, 1],
            ],
            airOnly: [false, true],
            siegedTank15Away: [true, false],
            changeling: [1, 1, 1, 1],
        });
        for (const layer of LAYERS) expect(influence.getGrid(layer).data.every((cost) => cost >= 1)).toBe(true);
    });

    it('routes ground and air sources into the climber, airVsGround, groundToAir and priority layers', async () => {
        const world = await openWorld();
        await observe(
            world,
            900,
            [
                enemy(UnitType.MARINE, 20.5, 20.5),
                enemy(UnitType.VIKINGFIGHTER, 50.5, 20.5, { isFlying: true }),
                enemy(UnitType.MISSILETURRET, 80.5, 20.5),
                enemy(UnitType.BANELING, 20.5, 60.5),
                enemy(UnitType.DISRUPTORPHASED, 50.5, 60.5),
                enemy(UnitType.THORAP, 20.5, 100.5),
                enemy(UnitType.INTERCEPTOR, 50.5, 100.5, { isFlying: true }),
            ],
            [{ effectId: Effect.PSISTORMPERSISTENT, pos: [{ x: 80.5, y: 60.5 }] }],
        );

        const { influence } = world.resources.get();
        const hit = (x: number, y: number) =>
            ALL_LAYERS.map(
                (layer) => influence.getGrid(layer).get({ x, y }) > influence.getCleanGrid(layer).get({ x, y }),
            );
        expect({
            marine: hit(22, 20),
            viking: hit(52, 20),
            turret: hit(82, 20),
            baneling: hit(22, 60),
            disruptor: hit(52, 60),
            storm: hit(82, 60),
            genericGroundAntiAir: hit(22, 100),
            genericFlyingAntiAir: hit(52, 100),
        }).toEqual({
            // ground, air, groundAvoidance, airAvoidance, climber, airVsGround, groundToAir, priority, tactical
            marine: [true, true, false, false, true, true, true, false, false],
            viking: [false, true, false, false, false, true, false, false, false],
            turret: [false, true, false, false, false, true, true, false, false],
            baneling: [true, false, true, false, true, false, false, true, false],
            disruptor: [true, false, true, false, true, false, false, true, false],
            storm: [true, true, true, true, true, true, false, true, false],
            genericGroundAntiAir: [true, true, false, false, true, true, true, false, false],
            genericFlyingAntiAir: [true, true, false, false, true, true, false, false, false],
        });
    });

    it('marks climbable cliff cells once per game, except under live footprints', async () => {
        const world = await openWorld();
        const { map, influence } = world.resources.get();
        const computeMask = spyOn(climber, 'computeClimberMask');
        const grids = map.getGrids();
        const wall = (x: number) => x === 10 || x === 11;
        grids.pathing = Array.from({ length: 136 }, () => Array.from({ length: 140 }, (_, x) => (wall(x) ? 1 : 0)));
        grids.height = Array.from({ length: 136 }, () => Array.from({ length: 140 }, (_, x) => (x < 10 ? 100 : 120)));
        const rock = rawUnit({
            alliance: Alliance.NEUTRAL,
            owner: 16,
            unitType: UnitType.DESTRUCTIBLEROCK6X6,
            pos: { x: 11, y: 10, z: 10 },
        });
        await observe(world, 900, [rock]);

        const column = () =>
            [8, 10, 11, 14, 40].map((y) => [10, 11].map((x) => influence.getGrid('climber').get({ x, y })));
        expect({ climber: column(), ground: influence.getGrid('ground').get({ x: 10, y: 40 }) }).toEqual({
            climber: [
                [Infinity, Infinity],
                [Infinity, Infinity],
                [Infinity, Infinity],
                [1, 1],
                [1, 1],
            ],
            ground: Infinity,
        });
        await observe(world, 904, [{ ...rock, pos: { x: 11, y: 30, z: 10 } }]);
        const climberAt = (y: number) => influence.getGrid('climber').get({ x: 10, y });
        expect([climberAt(30), climberAt(10)]).toEqual([Infinity, 1]);
        expect(computeMask).toHaveBeenCalledTimes(1);

        await world.engine.setupGame();
        const reset = map.getGrids();
        reset.pathing = grids.pathing;
        reset.height = grids.height.map((row) => row.map(() => 100));
        await observe(world, 896, []);
        expect(influence.getGrid('climber').get({ x: 10, y: 40 })).toBe(Infinity);
        expect(computeMask).toHaveBeenCalledTimes(2);
    });

    it('builds tacticalGround only when enabled: own units lower it, enemies raise it, low health x1.5', async () => {
        const world = await openWorld();
        const { influence } = world.resources.get();
        const unit = (alliance: number, unitType: number, x: number, y: number, overrides: SC2APIProtocol.Unit = {}) =>
            rawUnit({
                alliance,
                owner: alliance === Alliance.SELF ? 1 : 2,
                unitType,
                pos: { x, y, z: 10 },
                radius: 0.5625,
                health: 125,
                ...overrides,
            });
        const marauder = (alliance: number, x: number, health: number) =>
            unit(alliance, UnitType.MARAUDER, x, 100.5, { health });
        const units = [
            ...Array.from({ length: 40 }, () => marauder(Alliance.SELF, 30.5, 125)),
            marauder(Alliance.ENEMY, 60.5, 125),
            marauder(Alliance.ENEMY, 90.5, 100),
            rawUnit({ alliance: Alliance.SELF, unitType: UnitType.DISRUPTOR, pos: { x: 120.5, y: 100.5, z: 10 } }),
        ];
        const tactical = () => [30.5, 60.5, 90.5, 120.5].map((x) => layerCosts(world, x, 100.5, ['tacticalGround'])[0]);

        await observe(world, 900, units);
        expect(tactical()).toEqual([200, 200, 200, 200]);

        influence.configure({ tacticalGround: true });
        await observe(world, 904, units);
        const value = ((100 / 0.9 + 25) * 2) / 50;
        expect(tactical().map((cost) => Math.round(cost * 100) / 100)).toEqual([
            Math.round((200 - 40 * value) * 100) / 100,
            Math.round((200 + value) * 100) / 100,
            Math.round((200 + value * 1.5) * 100) / 100,
            200,
        ]);

        // the stamp is a circle of unit radius + 1.5: the edge cells at distance 2 are in, the diagonal ones are out
        const raised = ([dx, dy]: number[]) => layerCosts(world, 60.5 + dx, 100.5 + dy, ['tacticalGround'])[0] > 200;
        expect(
            [
                [2, 0],
                [0, 2],
                [1, 1],
                [2, 1],
                [1, 2],
                [3, 0],
            ].map(raised),
        ).toEqual([true, true, true, false, false, false]);

        const at = (x: number, y: number) => layerCosts(world, x, y, ['tacticalGround'])[0];
        const army = (alliance: number, unitType: number, x: number, health = 125, overrides = {}) =>
            unit(alliance, unitType, x, 60.5, { health, ...overrides });
        const structures = [
            army(Alliance.ENEMY, UnitType.ZERGLING, 10.5, 35),
            army(Alliance.ENEMY, UnitType.BUNKER, 30.5),
            army(Alliance.ENEMY, UnitType.BUNKER, 50.5, 100),
            army(Alliance.ENEMY, UnitType.PLANETARYFORTRESS, 70.5, 1500, { radius: 3 }),
            army(Alliance.ENEMY, UnitType.PLANETARYFORTRESS, 90.5, 100, { radius: 3 }),
            army(Alliance.ENEMY, UnitType.PHOTONCANNON, 110.5, 150, { isPowered: false }),
            army(Alliance.ENEMY, UnitType.SPINECRAWLER, 125.5),
            army(Alliance.ENEMY, UnitType.BANSHEE, 20.5, 125, { isFlying: true }),
            army(Alliance.SELF, UnitType.BANSHEE, 40.5, 125, { isFlying: true }),
            army(Alliance.SELF, UnitType.BUNKER, 80.5),
            army(Alliance.SELF, UnitType.SPINECRAWLER, 100.5),
        ];
        // structures block their own footprint, so sample just outside it
        const xs = [10.5, 32.5, 52.5, 74.5, 94.5, 112.5, 127.5, 20.5, 40.5, 82.5, 102.5];
        await observe(world, 908, structures);
        expect(xs.map((x) => at(x, 60.5))).toEqual([201.5, 225, 237.5, 265, 277.5, 215, 200, 200, 200, 185, 185]);

        world.agent.race = Race.ZERG;
        await observe(world, 912, structures);
        expect([at(82.5, 60.5), at(102.5, 60.5)]).toEqual([200, 200]);
    });

    it('stamps a baneling on ground with the range buffer and on ground avoidance without it', async () => {
        const world = await openWorld();
        await observe(world, 900, [enemy(UnitType.BANELING, 70.5, 68.5)]);

        expect([70, 73, 74, 77, 78].map((x) => [costs(world, x, 68)[0], costs(world, x, 68)[2]])).toEqual([
            [21, 21],
            [21, 21],
            [21, 1],
            [21, 1],
            [1, 1],
        ]);
    });

    it('stamps effects to their radius plus the effects buffer while present, unrounded', async () => {
        const world = await openWorld();
        const { influence } = world.resources.get();
        await observe(
            world,
            900,
            [],
            [
                { effectId: Effect.PSISTORMPERSISTENT, pos: [{ x: 70.5, y: 68.5 }] },
                { effectId: Effect.RAVAGERCORROSIVEBILECP, pos: [{ x: 40.5, y: 40.5 }] },
                libZone(Effect.LIBERATORTARGETMORPHPERSISTENT, 100.5, 100.5, Alliance.ENEMY),
                libZone(Effect.LIBERATORTARGETMORPHDELAYPERSISTENT, 20.5, 120.5, Alliance.SELF),
            ],
        );

        expect({
            storm: [costs(world, 74, 68), costs(world, 75, 68)],
            bile: costs(world, 40, 40),
            libZone: costs(world, 107, 100),
            ownLibZone: costs(world, 20, 120),
        }).toEqual({
            storm: [
                [601, 601, 601, 601],
                [1, 1, 1, 1],
            ],
            bile: [1, 1, 1, 1],
            libZone: [501, 1, 1, 1],
            ownLibZone: [1, 1, 1, 1],
        });

        await observe(world, 904, []);
        expect(
            [costs(world, 70, 68), costs(world, 40, 40), costs(world, 100, 100)].flat().every((cost) => cost === 1),
        ).toBe(true);
    });

    it('stamps biles and nukes only inside their reaction window, also after they leave the observation', async () => {
        const world = await openWorld();
        const { influence } = world.resources.get();
        influence.configure({
            effects: { [Effect.RAVAGERCORROSIVEBILECP]: { cost: 0.5, range: 3 } },
            delayedEffects: { bile: { reactAfter: 16, duration: 50 }, nuke: { reactAfter: 250, duration: 320 } },
        });
        const effects = [
            { effectId: Effect.RAVAGERCORROSIVEBILECP, pos: [{ x: 40.5, y: 40.5 }] },
            { effectId: Effect.NUKEPERSISTENT, pos: [{ x: 70.5, y: 68.5 }] },
            { effectId: Effect.RAVAGERCORROSIVEBILECP, pos: [{ x: 100.6, y: 100.5 }] },
            { effectId: Effect.RAVAGERCORROSIVEBILECP, pos: [{ x: 101.4, y: 100.5 }] },
        ];
        const sample = () => [costs(world, 40, 40), costs(world, 45, 40), costs(world, 70, 68)];
        const priority = (x: number, y: number) => layerCosts(world, x, y, ['priorityGroundAvoidance', 'climber']);

        await observe(world, 900, [], effects);
        const atFirstSight = sample();
        await observe(world, 915, [], effects);
        const beforeReaction = sample();
        await observe(world, 916, []);
        const bileAtReaction = [sample()[0], costs(world, 44, 40), sample()[1], priority(40, 40)];
        const outerBiles = [costs(world, 96, 100), costs(world, 105, 100)];
        await observe(world, 950, []);
        const bileAtDuration = sample()[0];
        await observe(world, 951, []);
        const bileExpired = sample()[0];
        await observe(world, 1149, []);
        const nukeBefore = sample()[2];
        await observe(world, 1150, []);
        const nukeAtReaction = [sample()[2], priority(70, 68)];
        await observe(world, 1220, []);
        const nukeAtDuration = sample()[2];
        await observe(world, 1221, []);
        const nukeExpired = sample()[2];

        const flat = [1, 1, 1, 1];
        expect({ atFirstSight, beforeReaction }).toEqual({
            atFirstSight: [flat, flat, flat],
            beforeReaction: [flat, flat, flat],
        });
        expect(bileAtReaction).toEqual([[1.5, 1.5, 1.5, 1.5], [1.5, 1.5, 1.5, 1.5], flat, [1.5, 1.5]]);
        expect(outerBiles).toEqual([
            [1.5, 1.5, 1.5, 1.5],
            [1.5, 1.5, 1.5, 1.5],
        ]);
        expect(bileAtDuration).toEqual([1.5, 1.5, 1.5, 1.5]);
        expect(bileExpired).toEqual(flat);
        expect(nukeBefore).toEqual(flat);
        expect(nukeAtReaction).toEqual([
            [1001, 1001, 1001, 1001],
            [1001, 1001],
        ]);
        expect(nukeAtDuration).toEqual([1001, 1001, 1001, 1001]);
        expect(nukeExpired).toEqual(flat);

        await observe(world, 1300, [], effects);
        sample();
        await world.engine.setupGame();
        openPathing(world);
        await observe(world, 1316, [], effects);
        expect(sample()[0]).toEqual(flat);
    });

    it('stamps kd8 charges on ground, parasitic bombs on air layers, and reports forcefields without cost', async () => {
        const world = await openWorld();
        const { influence } = world.resources.get();
        influence.configure({ parasiticBomb: { cost: 17, range: 4 } });
        await observe(
            world,
            900,
            [
                enemy(UnitType.KD8CHARGE, 40.5, 40.5),
                enemy(UnitType.PARASITICBOMBDUMMY, 70.5, 68.5),
                enemy(UnitType.FORCEFIELD, 100.5, 100.5),
                rawUnit({
                    alliance: Alliance.SELF,
                    unitType: UnitType.VIKINGFIGHTER,
                    pos: { x: 20.5, y: 120.5, z: 10 },
                    buffIds: [Buff.PARASITICBOMB],
                }),
                rawUnit({ alliance: Alliance.SELF, unitType: UnitType.KD8CHARGE, pos: { x: 100.5, y: 40.5, z: 10 } }),
                rawUnit({
                    alliance: Alliance.SELF,
                    unitType: UnitType.PARASITICBOMBDUMMY,
                    pos: { x: 60.5, y: 100.5, z: 10 },
                }),
                enemy(UnitType.OVERLORD, 120.5, 40.5, { isFlying: true, buffIds: [Buff.PARASITICBOMB] }),
            ],
            [],
        );
        const layers: InfluenceLayer[] = ['ground', 'climber', 'air', 'airAvoidance', 'groundToAir', 'airVsGround'];

        expect({
            kd8: [layerCosts(world, 45, 40, layers), layerCosts(world, 46, 40, layers)],
            bomb: layerCosts(world, 74, 68, layers),
            ownBomb: layerCosts(world, 24, 120, layers),
            ownKd8: layerCosts(world, 105, 40, layers),
            ownDummy: layerCosts(world, 64, 100, layers),
            enemyBuffed: layerCosts(world, 124, 40, layers),
            forcefield: [layerCosts(world, 100, 100, layers), influence.getForcefieldPositions()],
        }).toEqual({
            kd8: [
                [11, 11, 1, 1, 1, 10],
                [1, 1, 1, 1, 1, 10],
            ],
            bomb: [1, 1, 18, 18, 18, 27],
            ownBomb: [1, 1, 18, 18, 18, 27],
            ownKd8: [11, 11, 1, 1, 1, 10],
            ownDummy: [1, 1, 1, 1, 1, 10],
            enemyBuffed: [1, 1, 1, 1, 1, 10],
            forcefield: [[1, 1, 1, 1, 1, 10], [{ x: 100.5, y: 100.5 }]],
        });

        await observe(world, 904, []);
        expect(influence.getForcefieldPositions()).toEqual([]);
    });

    it('stamps static defense through the structure handlers', async () => {
        const world = await openWorld();
        await observe(world, 900, [
            enemy(UnitType.PHOTONCANNON, 40.5, 40.5, { isPowered: true }),
            enemy(UnitType.PHOTONCANNON, 70.5, 40.5, { isPowered: false }),
            enemy(UnitType.MISSILETURRET, 100.5, 40.5),
        ]);

        expect([costs(world, 42, 40), costs(world, 72, 40), costs(world, 102, 40)]).toEqual([
            [23, 23, 1, 1],
            [1, 1, 1, 1],
            [1, 40, 1, 1],
        ]);
    });

    it('builds once per loop and keeps addCost, clamped to 1, until the next loop', async () => {
        const world = await openWorld();
        const { influence, memory } = world.resources.get();
        const getEnemies = spyOn(memory, 'getEnemies');
        const builds = (query: () => unknown) => {
            const before = getEnemies.mock.calls.length;
            query();
            return getEnemies.mock.calls.length - before;
        };

        const firstLoop = builds(() => {
            influence.addCost(['ground', 'air'], { x: 70.5, y: 68.5 }, 1, 2.5);
            influence.addCost('ground', { x: 20.5, y: 120.5 }, 2, -7);
            influence.addCost('tacticalGround', { x: 20.5, y: 120.5 }, 2, -250);
            influence.getGrid('air');
        });
        expect([
            firstLoop,
            costs(world, 71, 68),
            costs(world, 20, 120),
            layerCosts(world, 20, 120, ['tacticalGround']),
        ]).toEqual([1, [3.5, 3.5, 1, 1], [1, 1, 1, 1], [-50]]);

        await observe(world, 900, []);
        expect([builds(() => influence.getGrid('ground')), costs(world, 71, 68)]).toEqual([1, [1, 1, 1, 1]]);
    });

    it('hands out a clean base copy that can be costed and drawn without touching the layers', async () => {
        const world = await openWorld();
        const { influence, debug } = world.resources.get();
        await observe(world, 900, [
            enemy(UnitType.STALKER, 40.5, 40.5),
            enemy(UnitType.VIKINGFIGHTER, 40.5, 40.5, { isFlying: true }),
        ]);

        const clean = influence.getCleanGrid('ground');
        const cleanAir = influence.getCleanGrid('airAvoidance');
        expect([
            clean.layer,
            clean.get({ x: 41, y: 40 }),
            clean.get(BLOCKED),
            cleanAir.get({ x: 41, y: 40 }),
            cleanAir.get({ x: 0, y: 0 }),
        ]).toEqual(['ground', 1, Infinity, 1, Infinity]);
        expect(influence.getGrid('ground').get({ x: 41, y: 40 })).toBeGreaterThan(1);

        influence.addCost(clean, { x: 70.5, y: 68.5 }, 1, 2.5);
        influence.addCost(clean, { x: 20.5, y: 120.5 }, 2, -7);
        expect([
            clean.get({ x: 71, y: 68 }),
            clean.get({ x: 20, y: 120 }),
            influence.getGrid('ground').get({ x: 71, y: 68 }),
        ]).toEqual([3.5, 1, 1]);

        const setDrawCells = spyOn(debug!, 'setDrawCells');
        influence.drawDebug(clean, { threshold: 1 });
        const [id, cells] = setDrawCells.mock.calls[0];
        expect([id, cells.length, cells[0].text]).toEqual(['influence-ground', 5, '4']);
    });

    it('ignores an adept shade until 120 loops after first sight and restarts the clock on a new game', async () => {
        const world = await openWorld();
        const shade = enemy(UnitType.ADEPTPHASESHIFT, 70.5, 68.5, { tag: '9001' });
        const ground = () => costs(world, 70, 68)[0];

        await observe(world, 900, [shade]);
        const atFirstSight = ground();
        await observe(world, 1019, [shade]);
        const beforeVisible = ground();
        await observe(world, 1020, [shade]);
        const atVisible = ground();

        await world.engine.setupGame();
        openPathing(world);
        await observe(world, 1030, [shade]);
        const afterReset = ground();
        await observe(world, 1150, [shade]);

        expect([atFirstSight, beforeVisible, atVisible, afterReset, ground()]).toEqual([1, 1, 10, 1, 10]);
    });

    it('keeps configured settings across a game reset and reallocates for a new map size', async () => {
        const world = await openWorld();
        const { influence } = world.resources.get();
        influence.configure({ rangeBuffer: 0 });
        const before = influence.getGrid('ground');

        await world.engine.setupGame();
        openPathing(world, 120, 100);
        await observe(world, 896, [enemy(UnitType.STALKER, 70.5, 68.5)]);

        const after = influence.getGrid('ground');
        expect([
            after.width,
            after.data === before.data,
            after.get({ x: 76, y: 68 }),
            after.get({ x: 77, y: 68 }),
        ]).toEqual([120, false, 11, 1]);
    });

    it('draws the cells above the threshold through the debug resource', async () => {
        const world = await openWorld();
        const { influence, debug } = world.resources.get();
        const setDrawCells = spyOn(debug!, 'setDrawCells');
        await observe(world, 900, [enemy(UnitType.BANELING, 70.5, 68.5)]);

        influence.drawDebug('groundAvoidance', { threshold: 1 });

        const [id, cells] = setDrawCells.mock.calls[0];
        expect([id, cells.length, cells[0].text]).toEqual(['influence-groundAvoidance', 29, '21']);
    });
});
