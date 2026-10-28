import { describe, expect, it, spyOn } from 'bun:test';
import * as Effect from '../constants/effect.ts';
import { Alliance } from '../constants/enums.ts';
import { UnitType } from '../constants/index.ts';
import { createTestWorld, loadFixture, stepTo } from '../test/create-test-world.ts';
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
    const responseObservation = structuredClone(world.client.fixture.observations[896]);
    const { rawData } = responseObservation.observation!;
    responseObservation.observation!.gameLoop = gameLoop;
    rawData!.units = [...rawData!.units!.filter((raw) => raw.alliance !== Alliance.ENEMY), ...enemies];
    rawData!.effects = effects;
    await stepTo(world, responseObservation);
}

const libZone = (effectId: number, x: number, y: number, alliance: number) =>
    ({ effectId, pos: [{ x, y }], alliance }) as SC2APIProtocol.Effect;

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
            blocked: costs(world, BLOCKED.x + 0.7, BLOCKED.y + 0.2),
            outsidePlayable: costs(world, 1, 70),
            outOfBounds: influence.getGrid('ground').get({ x: -1, y: 70 }),
            open: costs(world, 20, 120),
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
            blocked: [Infinity, 1, Infinity, 1],
            outsidePlayable: [1, Infinity, 1, Infinity],
            outOfBounds: Infinity,
            open: [1, 1, 1, 1],
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

        const groundBase = [...influence.getCleanGrid('ground').data];
        const airBase = [...influence.getCleanGrid('air').data];
        expect({
            climber: [...influence.getGrid('climber').data],
            priorityGroundAvoidance: [...influence.getGrid('priorityGroundAvoidance').data],
            airVsGround: [...influence.getGrid('airVsGround').data],
            groundToAir: [...influence.getGrid('groundToAir').data],
            tacticalGround: [...influence.getGrid('tacticalGround').data],
        }).toEqual({
            climber: groundBase,
            priorityGroundAvoidance: groundBase,
            airVsGround: airBase,
            groundToAir: airBase,
            tacticalGround: airBase,
        });
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
        influence.configure({ effects: { [Effect.RAVAGERCORROSIVEBILECP]: { cost: 0.5, range: 3 } } });
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
            bile: [1.5, 1.5, 1.5, 1.5],
            libZone: [501, 1, 1, 1],
            ownLibZone: [1, 1, 1, 1],
        });

        await observe(world, 904, []);
        expect(
            [costs(world, 70, 68), costs(world, 40, 40), costs(world, 100, 100)].flat().every((cost) => cost === 1),
        ).toBe(true);
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
            influence.getGrid('air');
        });
        expect([firstLoop, costs(world, 71, 68), costs(world, 20, 120)]).toEqual([1, [3.5, 3.5, 1, 1], [1, 1, 1, 1]]);

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
