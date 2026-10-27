import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import findP from 'find-process';
import createEngine from '../engine/create-engine.ts';
import createAgent from '../agent/create-agent.ts';
import { findMap, launcher } from '../engine/launcher.ts';
import { Alliance, Difficulty, PlayerType, Race } from '../constants/enums.ts';
import * as Ability from '../constants/ability.ts';
import * as UnitType from '../constants/unit-type.ts';
import { addonHostTypes } from '../constants/groups.ts';
import { spawnUnits } from '../test/spawn-units.ts';
import type { Point2D, World } from '../types.ts';

type Scenario = 'terran' | 'zerg' | 'protoss';

type MapTarget = {
    fixture: string;
    map: string;
    mode: 'fixture' | 'type-abilities';
    race: SC2APIProtocol.Race;
    scenario?: Scenario;
    techTree?: boolean;
    spawnRaces?: SC2APIProtocol.Race[];
    mergeTypeAbilities?: boolean;
    dropBurrowDown?: boolean;
    reverseTypes?: boolean;
};

type QueryRecord = {
    request: SC2APIProtocol.RequestQuery;
    response: SC2APIProtocol.ResponseQuery;
};

type RawUnit = SC2APIProtocol.Unit;
type Client = NodeSC2Proto.ProtoClient & { quit(): Promise<unknown>; leaveGame(): Promise<unknown> };
type XY = { x?: number; y?: number };

const BLUESHIFT = 'Ladder2018Season4/BlueshiftLE';

const typePass = (
    race: SC2APIProtocol.Race,
    spawnRaces: SC2APIProtocol.Race[],
    options: Partial<MapTarget> = {},
): MapTarget => ({
    fixture: 'blueshift',
    map: BLUESHIFT,
    mode: 'type-abilities',
    race,
    spawnRaces,
    mergeTypeAbilities: true,
    ...options,
});

const MAPS: MapTarget[] = [
    { fixture: 'blueshift', map: BLUESHIFT, mode: 'fixture', race: Race.TERRAN },
    typePass(Race.TERRAN, [Race.TERRAN, Race.PROTOSS], { techTree: true, mergeTypeAbilities: false }),
    typePass(Race.PROTOSS, [Race.TERRAN, Race.PROTOSS], { techTree: true, reverseTypes: true }),
    typePass(Race.TERRAN, [Race.TERRAN, Race.PROTOSS]),
    typePass(Race.ZERG, [Race.ZERG]),
    typePass(Race.ZERG, [Race.ZERG], { techTree: true, dropBurrowDown: true }),
    { fixture: 'acropolis', map: 'Ladder2019Season3/AcropolisLE', mode: 'fixture', race: Race.TERRAN },
    { fixture: 'simple64', map: 'Melee/Simple64', mode: 'fixture', race: Race.TERRAN },
    { fixture: 'blueshift-zerg', map: BLUESHIFT, mode: 'fixture', race: Race.ZERG, scenario: 'zerg' },
    { fixture: 'blueshift-protoss', map: BLUESHIFT, mode: 'fixture', race: Race.PROTOSS, scenario: 'protoss' },
];

const PORT = 5077;
const RANDOM_SEED = 4242;
const MID_LOOP = 224;
const LATE_LOOP = 896;
const SCOUT_SPAWN_LOOP = 600;
const LATE_ORDER_LOOP = 480;
const SCOUT_KILL_LOOP = 700;
const MARINE_SPAWN_LOOP = 800;
const ENEMY_SPAWN_LOOP = 888;
const QUERY_CHUNK = 100;
const TYPE_BATCH = 6;
const MIN_SETTLE_STEPS = 4;
const TECH_TREE = 10 as SC2APIProtocol.DebugGameState;
const MAX_SETTLE_STEPS = 40;
const STRUCTURE_ATTRIBUTE = 8 as SC2APIProtocol.Attribute;
const SIZE_WARNING_BYTES = 2 * 1024 * 1024;
const PATHING_PAIRS = 300;
const UNIT_PATHING = 30;
const PATHING_SEED = 1337;
const EXPANSION_GRID = 3;
const SPAWN_STEP_COUNT = 4;
const POWER_GRID = 8;

const FIXTURES_DIR = process.env.CAPTURE_DIR ?? join(import.meta.dir, '..', 'fixtures');

const PLACEMENT_ABILITIES: Record<Scenario, number[]> = {
    terran: [Ability.BUILD_SUPPLYDEPOT, Ability.BUILD_BARRACKS, Ability.BUILD_COMMANDCENTER, Ability.BUILD_PYLON],
    zerg: [Ability.BUILD_SPAWNINGPOOL, Ability.BUILD_EVOLUTIONCHAMBER, Ability.BUILD_HATCHERY],
    protoss: [Ability.BUILD_PYLON, Ability.BUILD_GATEWAY, Ability.BUILD_NEXUS],
};

const TOWNHALL_ABILITY: Record<Scenario, number> = {
    terran: Ability.BUILD_COMMANDCENTER,
    zerg: Ability.BUILD_HATCHERY,
    protoss: Ability.BUILD_NEXUS,
};

const MINERAL_FIELD_NAMES = /MineralField/;
const GEYSER_NAMES = /Geyser/;

function jsonReplacer(this: Record<string, unknown>, key: string, value: unknown) {
    if (key === 'data' && Array.isArray(value) && 'bitsPerPixel' in this) {
        return Buffer.from(value as number[]).toString('base64');
    }
    return value;
}

function writeJson(dir: string, name: string, value: unknown) {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value, jsonReplacer));
    return path;
}

const distance = (from: XY, to: XY) => Math.hypot(from.x! - to.x!, from.y! - to.y!);

const footprintOffset = (abilityId: number) =>
    abilityId === Ability.BUILD_SUPPLYDEPOT || abilityId === Ability.BUILD_PYLON ? 0 : 0.5;

function gridAround(center: Point2D, abilityId: number, radius = 12, step = 3): Point2D[] {
    const offset = footprintOffset(abilityId);
    const baseX = Math.round(center.x!) + offset;
    const baseY = Math.round(center.y!) + offset;
    const points: Point2D[] = [];
    for (let dx = -radius; dx <= radius; dx += step) {
        for (let dy = -radius; dy <= radius; dy += step) {
            points.push({ x: baseX + dx, y: baseY + dy });
        }
    }
    return points;
}

function seededRandom(seed: number) {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

function chunk<T>(items: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(items.length / size) }, (_unused, index) =>
        items.slice(index * size, (index + 1) * size),
    );
}

type ObservationSource = {
    observeDirect: Client['observation'];
    frameResponse: () => SC2APIProtocol.ResponseObservation | undefined;
};

function createCapture(target: MapTarget, dir: string, { observeDirect, frameResponse }: ObservationSource) {
    const scenario = target.scenario ?? 'terran';
    const abilitiesByLoop: Record<number, Record<string, number[]>> = {};
    const typeAbilities: Record<number, number[]> = {};
    const capturedLoops: number[] = [];
    const queriesByLoop: Record<number, QueryRecord[]> = {};

    let client: Client;
    let world: World;
    let done = false;
    let scoutTag: string | undefined;
    let builders: string[] = [];
    let refineryStaffed = false;
    let techLabOrdered = false;
    let researchOrdered = false;
    let pendingBarracks: { builder: string; spot: Point2D } | undefined;
    let typeQueue: number[][] | undefined;
    let pendingTypes: number[] = [];
    let settleSteps = 0;
    let typePhase: 'spawn' | 'settle' | 'query' = 'spawn';
    let knownTags = new Set<string>();
    let raceOpened = false;
    let raceFollowUp = false;
    let raceLateOrders = false;
    let poweredPylonSpot: Point2D | undefined;

    const observe = async () => (await observeDirect()).observation!;
    const ownUnits = (units: RawUnit[]) => units.filter((unit) => unit.alliance === Alliance.SELF);
    const enemyPlayerId = () => (world.agent.playerId === 1 ? 2 : 1);

    const unitCommand = async (abilityId: number, unitTags: string[], goal: { point?: Point2D; tag?: string } = {}) => {
        const response = await client.action({
            actions: [
                {
                    actionRaw: {
                        unitCommand: {
                            abilityId,
                            unitTags,
                            ...(goal.point ? { targetWorldSpacePos: goal.point } : {}),
                            ...(goal.tag ? { targetUnitTag: goal.tag } : {}),
                        },
                    },
                },
            ],
        });
        const failed = (response.result ?? []).filter((result) => result !== 1);
        if (failed.length > 0) console.warn(`[${target.fixture}] ability ${abilityId} failed: ${failed.join(',')}`);
        return failed.length === 0;
    };

    const debugCommands = (debug: SC2APIProtocol.DebugCommand[]) => client.debug({ debug });

    const recordAbilities = async (loop: number, units: RawUnit[]) => {
        const response = await client.query({
            abilities: ownUnits(units).map((unit) => ({ unitTag: unit.tag })),
        });
        abilitiesByLoop[loop] = Object.fromEntries(
            (response.abilities ?? []).map((entry) => [
                entry.unitTag!,
                (entry.abilities ?? []).map((ability) => ability.abilityId!),
            ]),
        );
    };

    const captureObservation = async () => {
        const responseObservation = frameResponse() ?? (await observeDirect());
        const loop = responseObservation.observation!.gameLoop!;
        writeJson(dir, `obs-${loop}.json`, responseObservation);
        await recordAbilities(loop, responseObservation.observation!.rawData!.units!);
        capturedLoops.push(loop);
        console.log(`[${target.fixture}] captured obs-${loop}`);
    };

    const runQuery = async (loop: number, request: SC2APIProtocol.RequestQuery) => {
        const response = await client.query(request);
        (queriesByLoop[loop] ??= []).push({ request, response });
        return response;
    };

    const runPlacements = async (loop: number, placements: SC2APIProtocol.RequestQueryBuildingPlacement[]) => {
        for (const placementChunk of chunk(placements, QUERY_CHUNK)) {
            await runQuery(loop, { placements: placementChunk });
        }
    };

    const randomPathingRequests = async (worker: RawUnit): Promise<SC2APIProtocol.RequestQueryPathing[]> => {
        const { map } = world.resources.get();
        const { p0, p1 } = (await client.gameInfo()).startRaw!.playableArea! as Required<SC2APIProtocol.RectangleI>;
        const random = seededRandom(PATHING_SEED);
        const randomCell = () => ({
            x: Math.floor(p0.x! + random() * (p1.x! - p0.x!)) + 0.5,
            y: Math.floor(p0.y! + random() * (p1.y! - p0.y!)) + 0.5,
        });
        const pathableCell = () => {
            for (;;) {
                const cell = randomCell();
                if (map.isPathable(cell)) return cell;
            }
        };
        const pairs = Array.from({ length: PATHING_PAIRS }, (_unused, index) => ({
            startPos: pathableCell(),
            endPos: index % 10 === 9 ? randomCell() : pathableCell(),
        }));
        const fromWorker = Array.from({ length: UNIT_PATHING }, () => ({
            unitTag: worker.tag,
            endPos: pathableCell(),
        }));
        return [...pairs, ...fromWorker];
    };

    const captureQueries = async (loop: number, units: RawUnit[]) => {
        const { map } = world.resources.get();
        const main = map.getMain().townhallPosition;
        const natural = map.getNatural().townhallPosition;
        const enemyNatural = map.getEnemyNatural().townhallPosition;
        const enemyMain = map.getEnemyMain().townhallPosition;

        await runPlacements(
            loop,
            PLACEMENT_ABILITIES[scenario].flatMap((abilityId) =>
                [main, natural].flatMap((center) =>
                    gridAround(center, abilityId).map((targetPos) => ({ abilityId, targetPos })),
                ),
            ),
        );

        const worker = ownUnits(units).find((unit) =>
            [UnitType.SCV, UnitType.DRONE, UnitType.PROBE].includes(unit.unitType!),
        )!;
        const enemyMainApproach = (map.closestPathable as (point: Point2D, radius: number) => Point2D)(
            { x: enemyMain.x! + (main.x! > enemyMain.x! ? 6 : -6), y: enemyMain.y! },
            6,
        );
        await runQuery(loop, {
            pathing: [
                { unitTag: worker.tag, endPos: natural },
                { unitTag: worker.tag, endPos: enemyNatural },
                { unitTag: worker.tag, endPos: enemyMainApproach },
                { startPos: natural, endPos: enemyNatural },
                { startPos: natural, endPos: enemyMainApproach },
            ],
        });

        const townhallAbility = TOWNHALL_ABILITY[scenario];
        await runPlacements(
            loop,
            map
                .getExpansionLocations()
                .flatMap((location) =>
                    gridAround({ x: location.x - 0.5, y: location.y - 0.5 }, townhallAbility, EXPANSION_GRID, 1).map(
                        (targetPos) => ({ abilityId: townhallAbility, targetPos }),
                    ),
                ),
        );

        const ramp = map.getMainBaseRamp()!;
        await runPlacements(loop, [
            ...[...ramp.cornerDepots, ramp.depotInMiddle]
                .filter((spot) => spot)
                .map((targetPos) => ({ abilityId: Ability.BUILD_SUPPLYDEPOT, targetPos: targetPos! })),
            ...[ramp.barracksInMiddle, ramp.barracksCorrectPlacement]
                .filter((spot) => spot)
                .map((targetPos) => ({ abilityId: Ability.BUILD_BARRACKS, targetPos: targetPos! })),
            ...[ramp.protossWallPylon]
                .filter((spot) => spot)
                .map((targetPos) => ({ abilityId: Ability.BUILD_PYLON, targetPos: targetPos! })),
        ]);

        for (const pathingChunk of chunk(await randomPathingRequests(worker), QUERY_CHUNK)) {
            await runQuery(loop, { pathing: pathingChunk });
        }
    };

    type PlacementSearch = {
        exclude?: Point2D[];
        count?: number;
        minDistance?: number;
        spacing?: number;
        radius?: number;
        addon?: boolean;
    };

    const findPlacements = async (
        center: Point2D,
        abilityId: number,
        { exclude = [], count = 1, minDistance = 6, spacing = 5, radius = 12, addon = true }: PlacementSearch = {},
    ) => {
        const candidates = gridAround(center, abilityId, radius, 1)
            .filter((point) => distance(point, center) >= minDistance)
            .filter((point) => exclude.every((taken) => distance(taken, point) >= spacing))
            .sort((first, second) => distance(first, center) - distance(second, center));
        const chosen: Point2D[] = [];
        for (const candidateChunk of chunk(candidates, QUERY_CHUNK)) {
            const addonSpots = addon ? candidateChunk.map((point) => ({ x: point.x! + 2.5, y: point.y! - 0.5 })) : [];
            const response = await client.query({
                placements: [
                    ...candidateChunk.map((targetPos) => ({ abilityId, targetPos })),
                    ...addonSpots.map((targetPos) => ({ abilityId: Ability.BUILD_SUPPLYDEPOT, targetPos })),
                ],
            });
            const results = response.placements!;
            candidateChunk.forEach((point, index) => {
                const fits =
                    results[index].result === 1 && (!addon || results[index + candidateChunk.length].result === 1);
                if (
                    fits &&
                    chosen.length < count &&
                    [...exclude, ...chosen].every((taken) => distance(taken, point) >= spacing)
                ) {
                    chosen.push(point);
                }
            });
            if (chosen.length >= count) break;
        }
        if (chosen.length < count)
            throw new Error(`could not place ability ${abilityId} near ${JSON.stringify(center)}`);
        return chosen;
    };

    const startOpening = async (units: RawUnit[]) => {
        const { map } = world.resources.get();
        const main = map.getMain().townhallPosition;
        const commandCenter = ownUnits(units).find((unit) => unit.unitType === UnitType.COMMANDCENTER)!;
        const scvs = ownUnits(units).filter((unit) => unit.unitType === UnitType.SCV);
        const minerals = units
            .filter((unit) => MINERAL_FIELD_NAMES.test(world.data.getUnitTypeData(unit.unitType!).name ?? ''))
            .sort((first, second) => distance(first.pos!, main) - distance(second.pos!, main));
        const geyser = units
            .filter((unit) => GEYSER_NAMES.test(world.data.getUnitTypeData(unit.unitType!).name ?? ''))
            .sort((first, second) => distance(first.pos!, main) - distance(second.pos!, main))[0];

        const [depotSpot] = await findPlacements(main, Ability.BUILD_SUPPLYDEPOT);
        const [barracksSpot, spawnedBarracksSpot, engineeringBaySpot] = await findPlacements(
            main,
            Ability.BUILD_BARRACKS,
            { exclude: [depotSpot], count: 3 },
        );

        const [depotBuilder, barracksBuilder, refineryBuilder, ...miners] = scvs;
        builders = [depotBuilder, barracksBuilder, refineryBuilder].map((unit) => unit.tag!);

        await unitCommand(Ability.BUILD_SUPPLYDEPOT, [depotBuilder.tag!], { point: depotSpot });
        pendingBarracks = { builder: barracksBuilder.tag!, spot: barracksSpot };
        await unitCommand(Ability.BUILD_REFINERY, [refineryBuilder.tag!], { tag: geyser.tag });
        await Promise.all(
            miners.map((miner, index) =>
                unitCommand(Ability.HARVEST_GATHER, [miner.tag!], { tag: minerals[index % minerals.length].tag }),
            ),
        );
        await unitCommand(Ability.TRAIN_SCV, [commandCenter.tag!]);

        await debugCommands([
            {
                createUnit: {
                    unitType: UnitType.BARRACKS,
                    owner: world.agent.playerId,
                    pos: spawnedBarracksSpot,
                    quantity: 1,
                },
            },
            {
                createUnit: {
                    unitType: UnitType.ENGINEERINGBAY,
                    owner: world.agent.playerId,
                    pos: engineeringBaySpot,
                    quantity: 1,
                },
            },
        ]);
    };

    const orderProduction = async (units: RawUnit[]) => {
        const barracks = ownUnits(units).find(
            (unit) => unit.unitType === UnitType.BARRACKS && unit.buildProgress === 1,
        );
        const engineeringBay = ownUnits(units).find(
            (unit) => unit.unitType === UnitType.ENGINEERINGBAY && unit.buildProgress === 1,
        );
        if (barracks && !techLabOrdered)
            techLabOrdered = await unitCommand(Ability.BUILD_TECHLAB_BARRACKS, [barracks.tag!]);
        if (engineeringBay && !researchOrdered)
            researchOrdered = await unitCommand(Ability.RESEARCH_TERRANINFANTRYWEAPONSLEVEL1, [engineeringBay.tag!]);
    };

    const startBarracks = async (units: RawUnit[]) => {
        const depotReady = ownUnits(units).some(
            (unit) => unit.unitType === UnitType.SUPPLYDEPOT && unit.buildProgress === 1,
        );
        if (!depotReady || !pendingBarracks) return;
        if (await unitCommand(Ability.BUILD_BARRACKS, [pendingBarracks.builder], { point: pendingBarracks.spot }))
            pendingBarracks = undefined;
    };

    const staffRefinery = async (units: RawUnit[]) => {
        const refinery = ownUnits(units).find(
            (unit) => unit.unitType === UnitType.REFINERY && unit.buildProgress === 1,
        );
        if (!refinery) return;
        const gasWorkers = ownUnits(units)
            .filter((unit) => unit.unitType === UnitType.SCV && !builders.includes(unit.tag!))
            .sort((first, second) => distance(first.pos!, refinery.pos!) - distance(second.pos!, refinery.pos!))
            .slice(0, 3);
        await unitCommand(
            Ability.HARVEST_GATHER,
            gasWorkers.map((unit) => unit.tag!),
            { tag: refinery.tag },
        );
        refineryStaffed = true;
    };

    const spawnScout = async () => {
        const enemyMain = world.resources.get().map.getEnemyMain().townhallPosition;
        await debugCommands([
            {
                createUnit: {
                    unitType: UnitType.MARINE,
                    owner: world.agent.playerId,
                    pos: { x: enemyMain.x! + 4, y: enemyMain.y! + 4 },
                    quantity: 1,
                },
            },
        ]);
    };

    const killScout = async (units: RawUnit[]) => {
        const enemyMain = world.resources.get().map.getEnemyMain().townhallPosition;
        const scout = ownUnits(units)
            .filter((unit) => unit.unitType === UnitType.MARINE)
            .sort((first, second) => distance(first.pos!, enemyMain) - distance(second.pos!, enemyMain))[0];
        scoutTag = scout?.tag;
        if (scoutTag) await debugCommands([{ killUnit: { tag: [scoutTag as unknown as number] } }]);
    };

    const pointFromMain = (fraction: number) => {
        const { map } = world.resources.get();
        const main = map.getMain().townhallPosition;
        const natural = map.getNatural().townhallPosition;
        return { x: main.x! + (natural.x! - main.x!) * fraction, y: main.y! + (natural.y! - main.y!) * fraction };
    };

    const spawnMarines = () =>
        debugCommands([
            {
                createUnit: {
                    unitType: UnitType.MARINE,
                    owner: world.agent.playerId,
                    pos: pointFromMain(-0.15),
                    quantity: 4,
                },
            },
        ]);

    const spawnEnemies = () =>
        debugCommands([
            {
                createUnit: {
                    unitType: UnitType.OVERLORD,
                    owner: enemyPlayerId(),
                    pos: pointFromMain(0.3),
                    quantity: 1,
                },
            },
            {
                createUnit: {
                    unitType: UnitType.ZERGLING,
                    owner: enemyPlayerId(),
                    pos: pointFromMain(0.4),
                    quantity: 2,
                },
            },
        ]);

    const spawnableTypes = () => {
        const unitTypeIds = (world.data.get('units') as SC2APIProtocol.UnitTypeData[])
            .filter((unitType) => unitType?.available && (target.spawnRaces ?? []).includes(unitType.race!))
            .map((unitType) => unitType.unitId!);
        return target.reverseTypes ? unitTypeIds.reverse() : unitTypeIds;
    };

    const typeSlot = (index: number, natural: Point2D) => ({
        x: natural.x! + ((index % 3) - 1) * 8,
        y: natural.y! + (Math.floor(index / 3) * 2 - 1) * 6,
    });

    const isStructureOf = (race: SC2APIProtocol.Race) => (unitTypeId: number) => {
        const unitData = world.data.getUnitTypeData(unitTypeId);
        return unitData.race === race && (unitData.attributes ?? []).includes(STRUCTURE_ATTRIBUTE);
    };
    const isProtossStructure = isStructureOf(Race.PROTOSS);

    const recordTypeAbilities = async (spawned: RawUnit[]) => {
        if (spawned.length === 0) return;
        const response = await client.query({
            abilities: spawned.map((unit) => ({ unitTag: unit.tag })),
            ignoreResourceRequirements: true,
        });
        (response.abilities ?? []).forEach((entry) => {
            const abilityIds = (entry.abilities ?? [])
                .map((ability) => ability.abilityId!)
                .filter(
                    (abilityId) =>
                        !target.dropBurrowDown ||
                        world.data.getAbilityData(abilityId)?.remapsToAbilityId !== Ability.BURROWDOWN,
                );
            typeAbilities[entry.unitTypeId!] = [
                ...new Set([...(typeAbilities[entry.unitTypeId!] ?? []), ...abilityIds]),
            ].sort((first, second) => first - second);
        });
    };

    const stepTypeAbilities = async (units: RawUnit[]) => {
        const natural = world.resources.get().map.getNatural().townhallPosition;
        const spawned = ownUnits(units).filter((unit) => !knownTags.has(unit.tag!));

        if (!typeQueue) {
            typeQueue = chunk(spawnableTypes(), TYPE_BATCH);
            knownTags = new Set(units.map((unit) => unit.tag!));
            await debugCommands([{ gameState: 12 as SC2APIProtocol.DebugGameState }]);
            if (target.techTree) await debugCommands([{ gameState: TECH_TREE }]);
        }

        if (typePhase === 'settle') {
            await recordTypeAbilities(spawned);
            const producers = spawned.filter((unit) => addonHostTypes.includes(unit.unitType!));
            if (producers.length > 0)
                await unitCommand(
                    Ability.BUILD_TECHLAB,
                    producers.map((unit) => unit.tag!),
                );
            typePhase = 'query';
            settleSteps = 0;
            return false;
        }

        if (typePhase === 'query') {
            settleSteps += 1;
            const settling = settleSteps < MIN_SETTLE_STEPS || spawned.some((unit) => (unit.buildProgress ?? 1) < 1);
            if (settling && settleSteps < MAX_SETTLE_STEPS) return false;
            await recordTypeAbilities(spawned);
            if (spawned.length > 0) {
                await debugCommands([{ killUnit: { tag: spawned.map((unit) => unit.tag as unknown as number) } }]);
                spawned.forEach((unit) => knownTags.add(unit.tag!));
            }
            pendingTypes.forEach((unitTypeId) => {
                typeAbilities[unitTypeId] ??= [];
            });
            typePhase = 'spawn';
        }

        if (typeQueue.length === 0) return true;

        pendingTypes = typeQueue.shift()!;
        await debugCommands(
            pendingTypes.flatMap((unitType, index) => {
                const pos = typeSlot(index, natural);
                const create = { createUnit: { unitType, owner: world.agent.playerId, pos, quantity: 1 } };
                const power = [3.5, -3.5].map((offset) => ({
                    createUnit: {
                        unitType: UnitType.PYLON,
                        owner: world.agent.playerId,
                        pos: { x: pos.x, y: pos.y + offset },
                        quantity: 1,
                    },
                }));
                return isProtossStructure(unitType) ? [create, ...power] : [create];
            }),
        );
        typePhase = 'settle';
        return false;
    };

    const spawn = (unitType: number, pos: Point2D, quantity = 1) =>
        spawnUnits(
            {
                debug: (request) => client.debug(request),
                step: (request) => client.step(request),
                observation: observeDirect,
            },
            { unitType, owner: world.agent.playerId!, pos, quantity },
            { stepCount: SPAWN_STEP_COUNT },
        );
    const ofType = (units: RawUnit[], unitType: number) => ownUnits(units).filter((unit) => unit.unitType === unitType);
    const closestTo = (units: RawUnit[], point: Point2D) =>
        [...units].sort((first, second) => distance(first.pos!, point) - distance(second.pos!, point));
    const resourcesNear = (units: RawUnit[], names: RegExp, point: Point2D) =>
        closestTo(
            units.filter((unit) => names.test(world.data.getUnitTypeData(unit.unitType!).name ?? '')),
            point,
        );
    const towardCenter = (from: Point2D, amount: number) => {
        const { x, y } = world.resources.get().map.getCenter();
        const length = distance(from, { x, y });
        return { x: from.x! + ((x - from.x!) / length) * amount, y: from.y! + ((y - from.y!) / length) * amount };
    };
    const gatherAll = (workers: RawUnit[], minerals: RawUnit[]) =>
        Promise.all(
            workers.map((worker, index) =>
                unitCommand(Ability.HARVEST_GATHER, [worker.tag!], { tag: minerals[index % minerals.length].tag }),
            ),
        );

    const zergOpening = async (units: RawUnit[]) => {
        const main = world.resources.get().map.getMain().townhallPosition;
        const [hatchery] = ofType(units, UnitType.HATCHERY);
        const [extractorDrone, chamberDrone, ...miners] = ofType(units, UnitType.DRONE);
        const larva = ofType(units, UnitType.LARVA);
        const [poolSpot, chamberSpot] = await findPlacements(main, Ability.BUILD_SPAWNINGPOOL, {
            count: 2,
            addon: false,
        });

        await unitCommand(Ability.BUILD_EXTRACTOR, [extractorDrone.tag!], {
            tag: resourcesNear(units, GEYSER_NAMES, main)[0].tag,
        });
        await unitCommand(Ability.BUILD_EVOLUTIONCHAMBER, [chamberDrone.tag!], { point: chamberSpot });
        await gatherAll(miners, resourcesNear(units, MINERAL_FIELD_NAMES, main));
        await unitCommand(Ability.TRAIN_DRONE, [larva[0].tag!]);
        await unitCommand(Ability.TRAIN_OVERLORD, [larva[1].tag!]);
        await spawn(UnitType.SPAWNINGPOOL, poolSpot);
        await spawn(UnitType.QUEEN, towardCenter(hatchery.pos as Point2D, 4), 2);
    };

    const zergFollowUp = async (units: RawUnit[]) => {
        const [hatchery] = ofType(units, UnitType.HATCHERY);
        const [injector, tumorLayer] = ofType(units, UnitType.QUEEN);
        const taken = [...ofType(units, UnitType.SPAWNINGPOOL), ...ofType(units, UnitType.EVOLUTIONCHAMBER)].map(
            (unit) => unit.pos as Point2D,
        );
        const [tumorSpot] = await findPlacements(
            towardCenter(hatchery.pos as Point2D, 6),
            Ability.BUILD_CREEPTUMOR_QUEEN,
            { exclude: taken, minDistance: 0, spacing: 3, radius: 3, addon: false },
        );

        await unitCommand(Ability.EFFECT_INJECTLARVA, [injector.tag!], { tag: hatchery.tag });
        await unitCommand(Ability.BUILD_CREEPTUMOR_QUEEN, [tumorLayer.tag!], { point: tumorSpot });
    };

    const zergLateOrders = async (units: RawUnit[]) => {
        const [hatchery] = ofType(units, UnitType.HATCHERY);
        const [larva] = ofType(units, UnitType.LARVA);
        if (larva) await unitCommand(Ability.TRAIN_ZERGLING, [larva.tag!]);
        await unitCommand(Ability.MORPH_LAIR, [hatchery.tag!]);
    };

    const protossOpening = async (units: RawUnit[]) => {
        const main = world.resources.get().map.getMain().townhallPosition;
        const [nexus] = ofType(units, UnitType.NEXUS);
        const [pylonProbe, ...miners] = ofType(units, UnitType.PROBE);
        const [pylonSpot, spawnedPylonSpot] = await findPlacements(main, Ability.BUILD_PYLON, {
            count: 2,
            spacing: 8,
            addon: false,
        });
        poweredPylonSpot = spawnedPylonSpot;

        await unitCommand(Ability.BUILD_PYLON, [pylonProbe.tag!], { point: pylonSpot });
        await gatherAll(miners, resourcesNear(units, MINERAL_FIELD_NAMES, main));
        await unitCommand(Ability.TRAIN_PROBE, [nexus.tag!]);
        await unitCommand(Ability.EFFECT_CHRONOBOOSTENERGYCOST, [nexus.tag!], { tag: nexus.tag });
        await spawn(UnitType.PYLON, spawnedPylonSpot);

        const [gatewaySpot, coreSpot, warpGateSpot] = await findPlacements(spawnedPylonSpot, Ability.BUILD_GATEWAY, {
            count: 3,
            minDistance: 3,
            spacing: 4.5,
            radius: 6,
            addon: false,
        });
        await spawn(UnitType.GATEWAY, gatewaySpot);
        await spawn(UnitType.CYBERNETICSCORE, coreSpot);
        await spawn(UnitType.WARPGATE, warpGateSpot);
    };

    const protossFollowUp = async (units: RawUnit[]) => {
        const [gateway] = ofType(units, UnitType.GATEWAY);
        const [core] = ofType(units, UnitType.CYBERNETICSCORE);
        const [warpGate] = ofType(units, UnitType.WARPGATE);
        await unitCommand(Ability.TRAIN_ZEALOT, [gateway.tag!]);
        await unitCommand(Ability.RESEARCH_WARPGATE, [core.tag!]);
        const occupied = ownUnits(units)
            .filter((unit) => distance(unit.pos!, poweredPylonSpot!) < 8)
            .map((unit) => unit.pos as Point2D);
        const [warpInSpot] = await findPlacements(poweredPylonSpot!, Ability.BUILD_PYLON, {
            exclude: occupied,
            minDistance: 2,
            spacing: 2.5,
            radius: 6,
            addon: false,
        });
        await unitCommand(Ability.TRAINWARP_ZEALOT, [warpGate.tag!], { point: warpInSpot });
    };

    const protossLateQueries = async (loop: number) => {
        await runPlacements(
            loop,
            [Ability.BUILD_GATEWAY, Ability.BUILD_PYLON].flatMap((abilityId) =>
                gridAround(poweredPylonSpot!, abilityId, POWER_GRID, 1).map((targetPos) => ({ abilityId, targetPos })),
            ),
        );
    };

    const raceSteps: Record<
        Exclude<Scenario, 'terran'>,
        {
            opening: (units: RawUnit[]) => Promise<void>;
            followUp: (units: RawUnit[]) => Promise<void>;
            ready: (units: RawUnit[]) => boolean;
            late: (units: RawUnit[]) => Promise<void>;
        }
    > = {
        zerg: {
            opening: zergOpening,
            followUp: zergFollowUp,
            ready: (units) => ofType(units, UnitType.QUEEN).length >= 2,
            late: zergLateOrders,
        },
        protoss: {
            opening: protossOpening,
            followUp: protossFollowUp,
            ready: (units) =>
                ofType(units, UnitType.GATEWAY).length > 0 && ofType(units, UnitType.CYBERNETICSCORE).length > 0,
            late: async () => {},
        },
    };

    const stepRace = async (race: Exclude<Scenario, 'terran'>, loop: number, units: RawUnit[]) => {
        const steps = raceSteps[race];
        if (!raceOpened) {
            raceOpened = true;
            await steps.opening(units);
            return;
        }
        if (!raceFollowUp && steps.ready(units)) {
            raceFollowUp = true;
            await steps.followUp(units);
        }
        if (loop >= MID_LOOP && capturedLoops.length === 1) await captureObservation();
        if (loop >= LATE_ORDER_LOOP && !raceLateOrders) {
            raceLateOrders = true;
            await steps.late(units);
        }
        if (loop >= LATE_LOOP && capturedLoops.length === 2) {
            await captureObservation();
            if (race === 'protoss') await protossLateQueries(capturedLoops[2]);
            await finish();
        }
    };

    const finish = async () => {
        if (target.mode === 'fixture') {
            writeJson(dir, 'abilities.json', abilitiesByLoop);
            writeJson(dir, 'queries.json', queriesByLoop);
        } else {
            const typeAbilitiesPath = join(dir, 'type-abilities.json');
            const merged: Record<number, number[]> =
                target.mergeTypeAbilities && existsSync(typeAbilitiesPath)
                    ? JSON.parse(readFileSync(typeAbilitiesPath, 'utf8'))
                    : {};
            Object.entries(typeAbilities).forEach(([unitTypeId, abilityIds]) => {
                merged[Number(unitTypeId)] = [...new Set([...(merged[Number(unitTypeId)] ?? []), ...abilityIds])].sort(
                    (first, second) => first - second,
                );
            });
            writeJson(dir, 'type-abilities.json', merged);
        }
        done = true;
        await client.leaveGame();
    };

    const agent = createAgent({
        settings: { race: target.race },
        async onGameStart(gameWorld: World) {
            world = gameWorld;
            client = gameWorld.resources.get().actions._client as Client;
            if (target.mode === 'type-abilities') {
                await debugCommands([{ gameState: 5 as SC2APIProtocol.DebugGameState }]);
                return;
            }

            const data = await client.data({
                abilityId: true,
                unitTypeId: true,
                upgradeId: true,
                buffId: true,
                effectId: true,
            });
            writeJson(FIXTURES_DIR, 'data.json', data);
            writeJson(dir, 'gameInfo.json', await client.gameInfo());

            const observation = await observe();
            await captureObservation();
            await captureQueries(observation.gameLoop!, observation.rawData!.units!);
            await debugCommands([{ gameState: 5 as SC2APIProtocol.DebugGameState }]);
        },
        async onStep() {
            if (done) return;
            const observation = await observe();
            const loop = observation.gameLoop!;
            const units = observation.rawData!.units!;

            if (target.mode === 'type-abilities') {
                if (await stepTypeAbilities(units)) await finish();
                return;
            }

            if (scenario !== 'terran') {
                await stepRace(scenario, loop, units);
                return;
            }

            if (builders.length === 0) await startOpening(units);

            await orderProduction(units);
            await startBarracks(units);
            if (!refineryStaffed) await staffRefinery(units);
            if (loop >= MID_LOOP && !capturedLoops.includes(MID_LOOP) && capturedLoops.length === 1)
                await captureObservation();
            if (loop >= SCOUT_SPAWN_LOOP && loop < SCOUT_SPAWN_LOOP + 4) await spawnScout();
            if (loop >= SCOUT_KILL_LOOP && !scoutTag) await killScout(units);
            if (loop >= MARINE_SPAWN_LOOP && loop < MARINE_SPAWN_LOOP + 4) await spawnMarines();
            if (loop >= ENEMY_SPAWN_LOOP && loop < ENEMY_SPAWN_LOOP + 4) await spawnEnemies();
            if (loop >= LATE_LOOP && capturedLoops.length === 2) {
                await captureObservation();
                await finish();
            }
        },
    });

    return {
        agent,
        completed: () => done,
        summary: () => ({ loops: capturedLoops, types: Object.keys(typeAbilities).length }),
    };
}

async function captureMap(target: MapTarget) {
    const fixtureDir = join(FIXTURES_DIR, target.fixture);
    const dir = target.mode === 'fixture' ? `${fixtureDir}.capturing` : fixtureDir;
    if (target.mode === 'fixture') rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const [portOwner] = await findP('port', PORT);
    if (portOwner?.pid)
        throw new Error(`port ${PORT} is in use by ${portOwner.name} (pid ${portOwner.pid}); stop it before capturing`);

    const sc2 = await launcher({ port: PORT });
    const engine = createEngine({ port: PORT, launch: false });
    const client = engine.getWorld().resources.get().actions._client as Client;

    try {
        await engine.connect();
        await engine.createGame(
            await findMap(target.map),
            [
                { type: PlayerType.PARTICIPANT, race: target.race },
                { type: PlayerType.COMPUTER, race: Race.ZERG, difficulty: Difficulty.VERYEASY },
            ],
            false,
            { randomSeed: RANDOM_SEED },
        );
        // SC2 sends actions/errors/chat/deadUnits once, so fixtures keep the response the frame system consumed
        const observeDirect = client.observation.bind(client);
        let frameResponse: SC2APIProtocol.ResponseObservation | undefined;
        client.observation = async (request) => (frameResponse = await observeDirect(request));
        const { agent, completed, summary } = createCapture(target, dir, {
            observeDirect,
            frameResponse: () => frameResponse,
        });
        try {
            await engine.joinGame(agent);
        } catch (error) {
            if (!(error instanceof Error) || !/no longer in game/i.test(error.message)) throw error;
        }
        if (!completed()) throw new Error(`[${target.fixture}] game ended before the capture finished`);
        if (target.mode === 'fixture') {
            rmSync(fixtureDir, { recursive: true, force: true });
            renameSync(dir, fixtureDir);
        }
        console.log(`[${target.fixture}] done`, summary());
        await client.quit().catch(() => {});
    } finally {
        engine.shutdown();
        killProcess(sc2);
        if (target.mode === 'fixture') rmSync(dir, { recursive: true, force: true });
    }
}

function killProcess(sc2: ChildProcess | number | undefined) {
    const pid = typeof sc2 === 'number' ? sc2 : sc2?.pid;
    if (!pid) return;
    try {
        process.kill(pid, 'SIGKILL');
    } catch {}
}

function reportSizes(targets: MapTarget[]) {
    for (const fixture of new Set(targets.map((target) => target.fixture))) {
        const dir = join(FIXTURES_DIR, fixture);
        for (const file of [...new Bun.Glob('*.json').scanSync(dir)].sort()) {
            const { size } = statSync(join(dir, file));
            const warning = size > SIZE_WARNING_BYTES ? '  (> 2MB)' : '';
            console.log(`${fixture}/${file}\t${(size / 1024).toFixed(1)}KB${warning}`);
        }
    }
}

const only = process.argv.slice(2);
const targets = MAPS.filter(
    (map) => only.length === 0 || (only.includes(map.fixture) && (map.mode === 'fixture' || only.includes(map.mode))),
);
for (const target of targets) {
    await captureMap(target);
}
reportSizes(targets);
process.exit(0);
