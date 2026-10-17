import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import createEngine from '../engine/create-engine.ts';
import createAgent from '../agent/create-agent.ts';
import { launcher, findMap } from '../engine/launcher.ts';
import { Alliance, Difficulty, PlayerType, Race } from '../constants/enums.ts';
import * as Ability from '../constants/ability.ts';
import * as UnitType from '../constants/unit-type.ts';
import type { Point2D, World } from '../types.ts';

type MapTarget = {
    fixture: string;
    map: string;
    captureTypeAbilities?: boolean;
};

type QueryRecord = {
    request: SC2APIProtocol.RequestQuery;
    response: SC2APIProtocol.ResponseQuery;
};

type RawUnit = SC2APIProtocol.Unit;
type Client = NodeSC2Proto.ProtoClient & { quit(): Promise<unknown> };

const MAPS: MapTarget[] = [
    { fixture: 'blueshift', map: 'Ladder2018Season4/BlueshiftLE', captureTypeAbilities: true },
    { fixture: 'acropolis', map: 'Ladder2019Season3/AcropolisLE' },
    { fixture: 'simple64', map: 'Melee/Simple64' },
];

const PORT = 5077;
const RANDOM_SEED = 4242;
const MID_LOOP = 224;
const LATE_LOOP = 896;
const SCOUT_SPAWN_LOOP = 600;
const SCOUT_KILL_LOOP = 700;
const ENEMY_SPAWN_LOOP = 872;
const QUERY_CHUNK = 100;
const TYPE_BATCH = 6;
const SIZE_WARNING_BYTES = 2 * 1024 * 1024;

const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures');

const PLACEMENT_ABILITIES = [
    Ability.BUILD_SUPPLYDEPOT,
    Ability.BUILD_BARRACKS,
    Ability.BUILD_COMMANDCENTER,
    Ability.BUILD_PYLON,
];

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

const distance = (from: Point2D, to: Point2D) => Math.hypot(from.x! - to.x!, from.y! - to.y!);

const footprintOffset = (abilityId: number) => (
    abilityId === Ability.BUILD_SUPPLYDEPOT || abilityId === Ability.BUILD_PYLON ? 0 : 0.5
);

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

function chunk<T>(items: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(items.length / size) }, (_unused, index) => items.slice(index * size, (index + 1) * size));
}

function createCapture(target: MapTarget, dir: string) {
    const abilitiesByTag: Record<string, number[]> = {};
    const typeAbilities: Record<number, number[]> = {};
    const capturedLoops: number[] = [];
    const queries: QueryRecord[] = [];

    let client: Client;
    let world: World;
    let done = false;
    let scoutTag: string | undefined;
    let builders: string[] = [];
    let refineryStaffed = false;
    let productionOrdered = false;
    let typeQueue: number[] | undefined;
    let pendingTypes: number[] = [];
    let knownTags = new Set<string>();

    const observe = async () => (await client.observation()).observation!;
    const ownUnits = (units: RawUnit[]) => units.filter(unit => unit.alliance === Alliance.SELF);
    const enemyPlayerId = () => (world.agent.playerId === 1 ? 2 : 1);

    const unitCommand = (abilityId: number, unitTags: string[], target: { point?: Point2D; tag?: string } = {}) => client.action({
        actions: [{
            actionRaw: {
                unitCommand: {
                    abilityId,
                    unitTags,
                    ...(target.point ? { targetWorldSpacePos: target.point } : {}),
                    ...(target.tag ? { targetUnitTag: target.tag } : {}),
                },
            },
        }],
    });

    const debugCommands = (debug: SC2APIProtocol.DebugCommand[]) => client.debug({ debug });

    const recordAbilities = async (units: RawUnit[]) => {
        const response = await client.query({
            abilities: ownUnits(units).map(unit => ({ unitTag: unit.tag })),
        });
        (response.abilities ?? []).forEach((entry) => {
            abilitiesByTag[entry.unitTag!] = (entry.abilities ?? []).map(ability => ability.abilityId!);
        });
    };

    const captureObservation = async () => {
        const responseObservation = await client.observation();
        const loop = responseObservation.observation!.gameLoop!;
        writeJson(dir, `obs-${loop}.json`, responseObservation);
        await recordAbilities(responseObservation.observation!.rawData!.units!);
        capturedLoops.push(loop);
        console.log(`[${target.fixture}] captured obs-${loop}`);
    };

    const runQuery = async (request: SC2APIProtocol.RequestQuery) => {
        const response = await client.query(request);
        queries.push({ request, response });
        return response;
    };

    const captureQueries = async (units: RawUnit[]) => {
        const { map } = world.resources.get();
        const main = map.getMain().townhallPosition;
        const natural = map.getNatural().townhallPosition;
        const enemyNatural = map.getEnemyNatural().townhallPosition;
        const enemyMain = map.getEnemyMain().townhallPosition;

        const placements = PLACEMENT_ABILITIES.flatMap(abilityId => [main, natural].flatMap(center => (
            gridAround(center, abilityId).map(targetPos => ({ abilityId, targetPos }))
        )));
        for (const placementChunk of chunk(placements, QUERY_CHUNK)) {
            await runQuery({ placements: placementChunk });
        }

        const worker = ownUnits(units).find(unit => unit.unitType === UnitType.SCV)!;
        const enemyMainApproach = map.closestPathable({ x: enemyMain.x! + (main.x! > enemyMain.x! ? 6 : -6), y: enemyMain.y! }, 6);
        await runQuery({
            pathing: [
                { unitTag: worker.tag, endPos: natural },
                { unitTag: worker.tag, endPos: enemyNatural },
                { unitTag: worker.tag, endPos: enemyMainApproach },
                { startPos: natural, endPos: enemyNatural },
                { startPos: natural, endPos: enemyMainApproach },
            ],
        });
    };

    const findPlacements = async (center: Point2D, abilityId: number, exclude: Point2D[], count: number) => {
        const candidates = gridAround(center, abilityId, 12, 1)
            .filter(point => distance(point, center) >= 6)
            .filter(point => exclude.every(taken => distance(taken, point) >= 5))
            .sort((first, second) => distance(first, center) - distance(second, center));
        const chosen: Point2D[] = [];
        for (const candidateChunk of chunk(candidates, QUERY_CHUNK)) {
            const addonSpots = candidateChunk.map(point => ({ x: point.x! + 2.5, y: point.y! - 0.5 }));
            const response = await client.query({
                placements: [
                    ...candidateChunk.map(targetPos => ({ abilityId, targetPos })),
                    ...addonSpots.map(targetPos => ({ abilityId: Ability.BUILD_SUPPLYDEPOT, targetPos })),
                ],
            });
            const results = response.placements!;
            candidateChunk.forEach((point, index) => {
                const fits = results[index].result === 1 && results[index + candidateChunk.length].result === 1;
                if (fits && chosen.length < count && [...exclude, ...chosen].every(taken => distance(taken, point) >= 5)) {
                    chosen.push(point);
                }
            });
            if (chosen.length >= count) break;
        }
        if (chosen.length < count) throw new Error(`could not place ability ${abilityId} near ${JSON.stringify(center)}`);
        return chosen;
    };

    const startOpening = async (units: RawUnit[]) => {
        const { map } = world.resources.get();
        const main = map.getMain().townhallPosition;
        const commandCenter = ownUnits(units).find(unit => unit.unitType === UnitType.COMMANDCENTER)!;
        const scvs = ownUnits(units).filter(unit => unit.unitType === UnitType.SCV);
        const minerals = units
            .filter(unit => MINERAL_FIELD_NAMES.test(world.data.getUnitTypeData(unit.unitType!).name ?? ''))
            .sort((first, second) => distance(first.pos!, main) - distance(second.pos!, main));
        const geyser = units
            .filter(unit => GEYSER_NAMES.test(world.data.getUnitTypeData(unit.unitType!).name ?? ''))
            .sort((first, second) => distance(first.pos!, main) - distance(second.pos!, main))[0];

        await debugCommands([
            { gameState: 7 as SC2APIProtocol.DebugGameState },
            { gameState: 8 as SC2APIProtocol.DebugGameState },
        ]);

        const [depotSpot] = await findPlacements(main, Ability.BUILD_SUPPLYDEPOT, [], 1);
        const [barracksSpot, spawnedBarracksSpot, engineeringBaySpot] = await findPlacements(main, Ability.BUILD_BARRACKS, [depotSpot], 3);

        const [depotBuilder, barracksBuilder, refineryBuilder, ...miners] = scvs;
        builders = [depotBuilder, barracksBuilder, refineryBuilder].map(unit => unit.tag!);

        await unitCommand(Ability.BUILD_SUPPLYDEPOT, [depotBuilder.tag!], { point: depotSpot });
        await unitCommand(Ability.BUILD_BARRACKS, [barracksBuilder.tag!], { point: barracksSpot });
        await unitCommand(Ability.BUILD_REFINERY, [refineryBuilder.tag!], { tag: geyser.tag });
        await Promise.all(miners.map((miner, index) => unitCommand(Ability.HARVEST_GATHER, [miner.tag!], { tag: minerals[index % minerals.length].tag })));
        await unitCommand(Ability.TRAIN_SCV, [commandCenter.tag!]);

        await debugCommands([
            { createUnit: { unitType: UnitType.BARRACKS, owner: world.agent.playerId, pos: spawnedBarracksSpot, quantity: 1 } },
            { createUnit: { unitType: UnitType.ENGINEERINGBAY, owner: world.agent.playerId, pos: engineeringBaySpot, quantity: 1 } },
        ]);
    };

    const orderProduction = async (units: RawUnit[]) => {
        const barracks = ownUnits(units).find(unit => unit.unitType === UnitType.BARRACKS && unit.buildProgress === 1);
        const engineeringBay = ownUnits(units).find(unit => unit.unitType === UnitType.ENGINEERINGBAY && unit.buildProgress === 1);
        if (!barracks || !engineeringBay) return;
        await unitCommand(Ability.BUILD_TECHLAB_BARRACKS, [barracks.tag!]);
        await unitCommand(Ability.RESEARCH_TERRANINFANTRYWEAPONSLEVEL1, [engineeringBay.tag!]);
        productionOrdered = true;
    };

    const staffRefinery = async (units: RawUnit[]) => {
        const refinery = ownUnits(units).find(unit => unit.unitType === UnitType.REFINERY && unit.buildProgress === 1);
        if (!refinery) return;
        const gasWorkers = ownUnits(units)
            .filter(unit => unit.unitType === UnitType.SCV && !builders.includes(unit.tag!))
            .sort((first, second) => distance(first.pos!, refinery.pos!) - distance(second.pos!, refinery.pos!))
            .slice(0, 3);
        await unitCommand(Ability.HARVEST_GATHER, gasWorkers.map(unit => unit.tag!), { tag: refinery.tag });
        refineryStaffed = true;
    };

    const spawnScout = async () => {
        const enemyMain = world.resources.get().map.getEnemyMain().townhallPosition;
        await debugCommands([{ createUnit: { unitType: UnitType.MARINE, owner: world.agent.playerId, pos: { x: enemyMain.x! + 4, y: enemyMain.y! + 4 }, quantity: 1 } }]);
    };

    const killScout = async (units: RawUnit[]) => {
        const enemyMain = world.resources.get().map.getEnemyMain().townhallPosition;
        const scout = ownUnits(units)
            .filter(unit => unit.unitType === UnitType.MARINE)
            .sort((first, second) => distance(first.pos!, enemyMain) - distance(second.pos!, enemyMain))[0];
        scoutTag = scout?.tag;
        if (scoutTag) await debugCommands([{ killUnit: { tag: [scoutTag as unknown as number] } }]);
    };

    const spawnArmies = async () => {
        const { map } = world.resources.get();
        const main = map.getMain().townhallPosition;
        const natural = map.getNatural().townhallPosition;
        const towardNatural = { x: main.x! + (natural.x! - main.x!) * 0.3, y: main.y! + (natural.y! - main.y!) * 0.3 };
        await debugCommands([
            { createUnit: { unitType: UnitType.MARINE, owner: world.agent.playerId, pos: towardNatural, quantity: 4 } },
            { createUnit: { unitType: UnitType.OVERLORD, owner: enemyPlayerId(), pos: towardNatural, quantity: 1 } },
            { createUnit: { unitType: UnitType.ZERGLING, owner: enemyPlayerId(), pos: { x: towardNatural.x + 3, y: towardNatural.y + 3 }, quantity: 2 } },
        ]);
    };

    const spawnableTypes = () => world.data.get('units')
        .filter(unitType => unitType?.available && [Race.TERRAN, Race.ZERG, Race.PROTOSS].includes(unitType.race!))
        .map(unitType => unitType.unitId!);

    const stepTypeAbilities = async (units: RawUnit[]) => {
        const natural = world.resources.get().map.getNatural().townhallPosition;
        if (!typeQueue) {
            typeQueue = spawnableTypes();
            knownTags = new Set(units.map(unit => unit.tag!));
            await debugCommands([
                { gameState: 10 as SC2APIProtocol.DebugGameState },
                { createUnit: { unitType: UnitType.PYLON, owner: world.agent.playerId, pos: natural, quantity: 1 } },
            ]);
            return false;
        }

        const spawned = ownUnits(units).filter(unit => !knownTags.has(unit.tag!));
        if (spawned.length > 0) {
            const response = await client.query({ abilities: spawned.map(unit => ({ unitTag: unit.tag })), ignoreResourceRequirements: true });
            (response.abilities ?? []).forEach((entry) => {
                const abilityIds = (entry.abilities ?? []).map(ability => ability.abilityId!);
                typeAbilities[entry.unitTypeId!] = [...new Set([...(typeAbilities[entry.unitTypeId!] ?? []), ...abilityIds])].sort((first, second) => first - second);
            });
            const removable = spawned.filter(unit => unit.unitType !== UnitType.PYLON);
            if (removable.length > 0) await debugCommands([{ killUnit: { tag: removable.map(unit => unit.tag as unknown as number) } }]);
            spawned.filter(unit => unit.unitType === UnitType.PYLON).forEach(unit => knownTags.add(unit.tag!));
        }
        pendingTypes.forEach((unitTypeId) => {
            typeAbilities[unitTypeId] ??= [];
        });

        if (typeQueue.length === 0) return true;

        pendingTypes = typeQueue.splice(0, TYPE_BATCH);
        await debugCommands(pendingTypes.map((unitType, index) => ({
            createUnit: {
                unitType,
                owner: world.agent.playerId,
                pos: { x: natural.x! + ((index % 3) - 1) * 5, y: natural.y! + (Math.floor(index / 3) * 2 - 1) * 4 },
                quantity: 1,
            },
        })));
        return false;
    };

    const finish = async () => {
        writeJson(dir, 'abilities.json', abilitiesByTag);
        writeJson(dir, 'queries.json', { loop: capturedLoops[0], queries });
        if (target.captureTypeAbilities) writeJson(dir, 'type-abilities.json', typeAbilities);
        done = true;
        await client.leaveGame();
    };

    const agent = createAgent({
        settings: { race: Race.TERRAN },
        async onGameStart(gameWorld: World) {
            world = gameWorld;
            client = gameWorld.resources.get().actions._client as Client;

            const data = await client.data({ abilityId: true, unitTypeId: true, upgradeId: true, buffId: true, effectId: true });
            writeJson(dir, 'data.json', data);
            writeJson(dir, 'gameInfo.json', await client.gameInfo());

            const observation = await observe();
            await captureObservation();
            await captureQueries(observation.rawData!.units!);
            await startOpening(observation.rawData!.units!);
        },
        async onStep() {
            if (done) return;
            const observation = await observe();
            const loop = observation.gameLoop!;
            const units = observation.rawData!.units!;

            if (!productionOrdered) await orderProduction(units);
            if (!refineryStaffed) await staffRefinery(units);
            if (loop >= MID_LOOP && !capturedLoops.includes(MID_LOOP) && capturedLoops.length === 1) await captureObservation();
            if (loop >= SCOUT_SPAWN_LOOP && loop < SCOUT_SPAWN_LOOP + 4) await spawnScout();
            if (loop >= SCOUT_KILL_LOOP && !scoutTag) await killScout(units);
            if (loop >= ENEMY_SPAWN_LOOP && loop < ENEMY_SPAWN_LOOP + 4) await spawnArmies();
            if (loop >= LATE_LOOP && capturedLoops.length === 2) {
                await captureObservation();
                if (!target.captureTypeAbilities) await finish();
                return;
            }
            if (capturedLoops.length === 3 && target.captureTypeAbilities && await stepTypeAbilities(units)) await finish();
        },
    });

    return { agent, summary: () => ({ loops: capturedLoops, types: Object.keys(typeAbilities).length }) };
}

async function captureMap(target: MapTarget) {
    const dir = join(FIXTURES_DIR, target.fixture);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const sc2 = await launcher({ port: PORT });
    const engine = createEngine({ port: PORT, launch: false });
    const client = engine.getWorld().resources.get().actions._client as Client;

    try {
        await engine.connect();
        await client.createGame({
            localMap: { mapPath: await findMap(target.map) },
            playerSetup: [
                { type: PlayerType.PARTICIPANT, race: Race.TERRAN },
                { type: PlayerType.COMPUTER, race: Race.ZERG, difficulty: Difficulty.VERYEASY },
            ],
            randomSeed: RANDOM_SEED,
            realtime: false,
        });
        const { agent, summary } = createCapture(target, dir);
        try {
            await engine.joinGame(agent);
        } catch (error) {
            if (!(error instanceof Error) || !/no longer in game/i.test(error.message)) throw error;
        }
        console.log(`[${target.fixture}] done`, summary());
        await client.quit().catch(() => {});
    } finally {
        engine.shutdown();
        killProcess(sc2);
    }
}

function killProcess(sc2: ChildProcess | number | undefined) {
    const pid = typeof sc2 === 'number' ? sc2 : sc2?.pid;
    if (!pid) return;
    try {
        process.kill(pid, 'SIGKILL');
    } catch {}
}

function reportSizes() {
    for (const target of MAPS) {
        const dir = join(FIXTURES_DIR, target.fixture);
        for (const file of new Bun.Glob('*.json').scanSync(dir)) {
            const { size } = statSync(join(dir, file));
            const warning = size > SIZE_WARNING_BYTES ? '  (> 2MB)' : '';
            console.log(`${target.fixture}/${file}\t${(size / 1024).toFixed(1)}KB${warning}`);
        }
    }
}

const only = process.argv.slice(2);
for (const target of MAPS.filter(map => only.length === 0 || only.includes(map.fixture))) {
    await captureMap(target);
}
reportSizes();
process.exit(0);
