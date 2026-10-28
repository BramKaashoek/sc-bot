import { describe, expect, it } from 'bun:test';
import { Alliance, Attribute } from '../constants/enums.ts';
import { Ability, UnitType } from '../constants/index.ts';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';
import { packBits, rawUnit, toyWorld } from '../test/factories.ts';
import { createCreepResource, creepResource } from './creep.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { ToyOptions } from '../test/factories.ts';
import type { Point2D } from '../types.ts';

const MAP = { x: 32, y: 32 };
const TYPES = Object.fromEntries(
    [UnitType.LAIR, UnitType.CREEPTUMORBURROWED, UnitType.QUEEN, UnitType.OVERLORD].map((id) => [id, {}]),
);

// toy expansions sit at (8, 17) and (23, 15); the block's bottom rows fall inside the first one's 5-radius
const block = (x0: number, x1: number) => (x: number, y: number) => x >= x0 && x <= x1 && y >= 20 && y <= 28;

const creepWorld = (hasCreep: (x: number, y: number) => boolean, options: ToyOptions = {}) =>
    toyWorld({ hasCreep, unitTypes: TYPES, ...options });

function stepCreep(
    world: TestWorld,
    loop: number,
    hasCreep: (x: number, y: number) => boolean,
    add: SC2APIProtocol.Unit[] = [],
) {
    const next = observationAt(world, loop, { base: 0, add });
    next.observation!.rawData!.mapState!.creep = packBits(MAP, hasCreep);
    return stepTo(world, next);
}

const tumor = (x: number, y: number) => rawUnit({ unitType: UnitType.CREEPTUMORBURROWED, pos: { x, y, z: 10 } });
const queen = (target: Point2D, pos = { x: 28, y: 28 }, abilityId = Ability.BUILD_CREEPTUMOR_QUEEN) =>
    rawUnit({
        unitType: UnitType.QUEEN,
        pos: { ...pos, z: 10 },
        orders: [{ abilityId, targetWorldSpacePos: target }],
    });

describe('CreepResource', () => {
    it('reads tiles, coverage and the creep rim, clearing every own townhall type, on a toy and a real zerg map', async () => {
        const lair = rawUnit({ unitType: UnitType.LAIR, pos: { x: 10.5, y: 21.5, z: 10 } });
        const world = await creepWorld(block(3, 12), { units: [lair] });
        const { creep } = world.resources.get();

        const edges = creep.getEdges();
        expect({
            tiles: creep.getTiles().length,
            coverage: creep.getCoverage(),
            edges: edges.length,
            nearLair: edges.filter((e) => (e.x - 10.5) ** 2 + (e.y - 21.5) ** 2 < 2.5 ** 2),
            closest: creep.closestTile({ x: 20, y: 24.5 }),
        }).toEqual({ tiles: 90, coverage: (81 / 833) * 100, edges: 26, nearLair: [], closest: { x: 12, y: 24 } });

        const real = (await createTestWorld('blueshift-zerg')).resources.get();
        const grid = real.map._mapState.creep;
        const bare = (x: number, y: number) =>
            [-1, 0, 1]
                .flatMap((dy) => [-1, 0, 1].map((dx) => (grid[y + dy]?.[x + dx] ? 0 : 1)))
                .reduce((a: number, b) => a + b, 0);
        const realEdges = real.creep.getEdges();
        expect({
            count: realEdges.length,
            allRim: realEdges.every(({ x, y }) => !!grid[y][x] && bare(x, y) >= 2),
            clearOfHatchery: realEdges.every(({ x, y }) => (x - 15.5) ** 2 + (y - 15.5) ** 2 >= 2.5 ** 2),
            coverage: Math.round(real.creep.getCoverage() * 1e4) / 1e4,
        }).toEqual({ count: 64, allRim: true, clearOfHatchery: true, coverage: 3.1064 });
    });

    it('refreshes edges every 16 loops and coverage every 112 loops whatever the game step', async () => {
        const grow = (loop: number) => block(4, 4 + (loop % 13));
        const refreshes: Record<number, { edges: number[]; coverage: number[] }> = {};

        for (const gameStep of [1, 4, 8, 10, 16]) {
            const world = await creepWorld(grow(0));
            const { creep } = world.resources.get();
            const seen = { edges: [] as number[], coverage: [] as number[] };
            let previous = { edges: -1, coverage: -1 };
            for (let loop = 0; loop <= 120; loop += gameStep) {
                await stepCreep(world, loop, grow(loop));
                const now = { edges: creep.getEdges().length, coverage: creep.getCoverage() };
                if (now.edges !== previous.edges) seen.edges.push(loop);
                if (now.coverage !== previous.coverage) seen.coverage.push(loop);
                previous = now;
            }
            refreshes[gameStep] = { edges: seen.edges.filter((loop) => loop <= 48), coverage: seen.coverage };
        }

        const every = { edges: [0, 16, 32, 48], coverage: [0, 112] };
        expect(refreshes).toEqual({
            1: every,
            4: every,
            8: every,
            10: { edges: [0, 20, 40], coverage: [0, 120] },
            16: every,
        });
    });

    it('recomputes from scratch after reset', async () => {
        const dense =
            (to: number, rows = 32) =>
            (x: number, y: number) =>
                x >= 1 && x <= to && y < rows;
        const world = await creepWorld(dense(16));
        const { creep, map } = world.resources.get();
        const near = { x: 3, y: 12 };
        const spot = { x: 8, y: 17 };
        creep.getEdges();
        const firedBefore = creep.shouldSpreadTumors();
        const cachedEdge = creep.findEdgePosition(near, { unitTag: 'q', cache: true });
        const maskedBefore = creep.blocksExpansion(spot);
        await stepCreep(world, 4, dense(16, 28), [tumor(16.5, 12.5)]);
        const blockedBefore = !creep.shouldSpreadTumors();
        const stale = creep.getEdges().length;
        map._expansions = [];
        creepResource.reset!(creep, world);

        expect({
            firedBefore,
            blockedBefore,
            maskedBefore,
            stale,
            fresh: creep.getEdges().length,
            spreadAfter: creep.shouldSpreadTumors(),
            maskedAfter: creep.blocksExpansion(spot),
            edgeAfter: creep.findEdgePosition(near, { unitTag: 'q', cache: true }),
            cachedEdge,
        }).toEqual({
            firedBefore: true,
            blockedBefore: true,
            maskedBefore: true,
            stale: 28,
            fresh: 40,
            spreadAfter: true,
            maskedAfter: false,
            edgeAfter: { x: 16, y: 9 },
            cachedEdge: { x: 16, y: 12 },
        });
    });

    it('finds edge spots by radius and direction, away from tumors and queen targets, outside the expansion mask', async () => {
        const world = await creepWorld(block(3, 12), { units: [tumor(3.5, 24.5)] });
        const { creep } = world.resources.get();
        const near = { x: 3, y: 24 };
        const queenTarget = { x: 3.5, y: 21.5 };

        const withTumor = creep.findEdgePosition(near);
        const furthest = creep.findEdgePosition(near, { closest: false });
        const tight = creep.findEdgePosition(near, { spreadDistance: 0.5 });
        const outOfRadius = creep.findEdgePosition({ x: 20, y: 24 }, { radius: 5 });
        const underMask = creep.findEdgePosition({ x: 8, y: 21 });
        await stepCreep(world, 1, block(3, 12), [
            tumor(3.5, 24.5),
            queen(queenTarget),
            queen({ x: 3.5, y: 27.5 }, { x: 27, y: 27 }, Ability.BUILD_CREEPTUMOR),
        ]);
        const withQueenTarget = creep.findEdgePosition(near);

        expect({ withTumor, furthest, tight, outOfRadius, underMask, withQueenTarget }).toEqual({
            withTumor: { x: 3, y: 21 },
            furthest: { x: 12, y: 20 },
            tight: { x: 3, y: 24 },
            outOfRadius: undefined,
            underMask: { x: 12, y: 21 },
            withQueenTarget: { x: 7, y: 28 },
        });
    });

    it('keeps a queen`s cached edge spot for 64 loops unless it asks without the cache', async () => {
        const world = await creepWorld(block(3, 12));
        const { creep } = world.resources.get();
        const cached = creep.findEdgePosition({ x: 3, y: 24 }, { unitTag: 'q', cache: true });
        const occupy = [tumor(3.5, 24.5)];

        await stepCreep(world, 40, block(3, 12), occupy);
        const stillCached = creep.findEdgePosition({ x: 3, y: 24 }, { unitTag: 'q', cache: true });
        await stepCreep(world, 64, block(3, 12), occupy);
        const expired = creep.findEdgePosition({ x: 3, y: 24 }, { unitTag: 'q', cache: true });
        const afterExpiry = creep.findEdgePosition({ x: 3, y: 24 }, { unitTag: 'q', cache: true });
        const cleared = creep.findEdgePosition({ x: 3, y: 24 }, { unitTag: 'q' });
        await stepCreep(world, 65, block(3, 12), []);
        const lostEntry = creep.findEdgePosition({ x: 3, y: 24 }, { unitTag: 'q', cache: true });

        expect({ cached, stillCached, expired, afterExpiry, cleared, lostEntry }).toEqual({
            cached: { x: 3, y: 24 },
            stillCached: { x: 3, y: 24 },
            expired: { x: 3, y: 21 },
            afterExpiry: { x: 3, y: 21 },
            cleared: { x: 3, y: 21 },
            lostEntry: { x: 3, y: 24 },
        });
    });

    it('picks the next tumor on a path to the creep rim, with an alternative when crowded', async () => {
        const world = await creepWorld(block(3, 12));
        const { creep } = world.resources.get();
        const from = { x: 5.5, y: 22.5 };
        const to = { x: 28.5, y: 22.5 };

        const open = creep.nextTumorOnPath(from, to);
        const tooFar = creep.nextTumorOnPath(from, to, { maxDistance: 3 });
        const tooNear = creep.nextTumorOnPath(from, to, { minDistance: 7 });
        await stepCreep(world, 1, block(3, 12), [tumor(12.5, 22.5)]);
        const crowded = creep.nextTumorOnPath(from, to);
        const unchecked = creep.nextTumorOnPath(from, to, { findAlternative: false });
        await stepCreep(world, 2, block(3, 12), [tumor(12.5, 22.5), tumor(12.5, 26.5)]);
        const boxedIn = creep.nextTumorOnPath(from, to);
        const crossing = (await creepWorld(block(3, 20))).resources
            .get()
            .creep.nextTumorOnPath({ x: 3.5, y: 22.5 }, to);
        const nearTownhall = async (unitType: number, x: number, alliance = Alliance.SELF) =>
            (
                await creepWorld(block(3, 12), {
                    unitTypes: { ...TYPES, [unitType]: { attributes: [Attribute.STRUCTURE] } },
                    units: [tumor(12.5, 24.5), rawUnit({ unitType, alliance, pos: { x, y: 19.5, z: 10 } })],
                })
            ).resources
                .get()
                .creep.nextTumorOnPath(from, to, { minSeparation: 0 });

        const townhalls = {
            enemyNear: await nearTownhall(UnitType.NEXUS, 25, Alliance.ENEMY),
            enemyFar: await nearTownhall(UnitType.NEXUS, 28.5, Alliance.ENEMY),
            lairNear: await nearTownhall(UnitType.LAIR, 14),
            hatcheryFar: await nearTownhall(UnitType.HATCHERY, 15.5),
        };

        expect({ open, tooFar, tooNear, crowded, unchecked, boxedIn, crossing, townhalls }).toEqual({
            open: { x: 12, y: 22 },
            tooFar: undefined,
            tooNear: undefined,
            crowded: { x: 12, y: 26 },
            unchecked: { x: 12, y: 22 },
            boxedIn: undefined,
            crossing: { x: 20, y: 22 },
            townhalls: {
                enemyNear: undefined,
                enemyFar: { x: 12, y: 22 },
                lairNear: undefined,
                hatcheryFar: { x: 12, y: 22 },
            },
        });
    });

    it('draws random spots 6 to 9 away from an injected rng, skipping the border and bare ground', async () => {
        const world = await creepWorld(block(3, 12));
        const rolls = [0.5, 0, 0.75, 0, 0, 0.5];
        const random = createCreepResource(world, () => rolls.shift() ?? 0);
        const spot = random.randomPosition({ x: 3, y: 24 });

        const starved = createCreepResource(world, () => 0.5).randomPosition({ x: 3, y: 24 }, 2);

        expect({ spot, starved }).toEqual({ spot: { x: 10.5, y: 24 }, starved: undefined });
    });

    it('moves a tumor to the furthest cost-free creep cell outside its own influence', async () => {
        const world = await creepWorld(block(3, 12), { units: [tumor(12.5, 28.5)] });
        const { creep } = world.resources.get();

        expect(creep.tumorLowestCostPosition({ x: 7.5, y: 24.5 })).toEqual({ x: 12.5, y: 20.5 });
    });

    it('gates tumor spreading by coverage on loops since the last firing, shared within a loop', async () => {
        const sparse = await creepWorld(block(3, 12));
        const dense = await creepWorld((x) => x >= 1 && x <= 16);
        const results: Record<string, boolean[]> = {};

        for (const [name, world] of [
            ['sparse', sparse],
            ['dense', dense],
        ] as const) {
            const { creep } = world.resources.get();
            results[name] = [];
            for (let loop = 0; loop <= 60; loop += 10) {
                await stepCreep(world, loop, name === 'dense' ? (x) => x >= 1 && x <= 16 : block(3, 12));
                results[name].push(creep.shouldSpreadTumors(), creep.shouldSpreadTumors());
            }
        }

        expect(results).toEqual({
            sparse: Array(14).fill(true),
            dense: [true, true, false, false, false, false, true, true, false, false, false, false, true, true],
        });
    });

    it('assigns spotters from the rim, away from the enemy start, parking idle overlords that are close', async () => {
        const idle = rawUnit({ unitType: UnitType.OVERLORD, pos: { x: 3.5, y: 24.5, z: 10 } });
        const moving = rawUnit({
            unitType: UnitType.OVERLORD,
            pos: { x: 20.5, y: 24.5, z: 10 },
            orders: [{ abilityId: Ability.MOVE, targetWorldSpacePos: { x: 20.5, y: 22.5 } }],
        });
        const near = await creepWorld(block(3, 28), { units: [idle, moving], enemyStart: false });
        const hostile = await creepWorld(block(3, 28), { units: [idle, moving] });
        const spotters = (world: TestWorld) => {
            const { creep, units } = world.resources.get();
            return creep.overlordSpotterPositions(units.getById(UnitType.OVERLORD), { x: 3, y: 24 });
        };

        expect({ near: spotters(near), hostile: spotters(hostile) }).toEqual({
            near: new Map([
                [idle.tag, { x: 3.5, y: 24.5 }],
                [moving.tag, { x: 21, y: 20 }],
            ]),
            hostile: new Map(),
        });
    });
});
