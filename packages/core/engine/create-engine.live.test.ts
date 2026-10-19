import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import createEngine from './create-engine.ts';
import createAgent from '../agent/create-agent.ts';
import { Ability } from '../constants/index.ts';
import { AIBuild, Alliance, Difficulty, GameResult, PlayerType, Race } from '../constants/enums.ts';
import * as UnitType from '../constants/unit-type.ts';
import { loadFixture } from '../test/create-test-world.ts';
import { pathingKey, placementKey } from '../test/fake-client.ts';
import type { Point2D, World } from '../types.ts';

type Client = NodeSC2Proto.ProtoClient & { step: (request: { count: number }) => Promise<unknown> };

const MAP = 'Melee/Simple64';
const FIXTURE_MAPS: Record<string, string> = {
    simple64: MAP,
    blueshift: 'Ladder2018Season4/BlueshiftLE',
    acropolis: 'Ladder2019Season3/AcropolisLE',
};
const TICKS_PER_SECOND = 22.4;
const FIXTURE_SEED = 4242;
const SNAPSHOT_LOOP = 200;
const SURRENDER_LOOP = 40;
const SUCCESS = 1;
const CANT_BUILD_LOCATION_INVALID = 44;

const workDir = mkdtempSync(join(tmpdir(), 'sc-bot-live-'));
let nextPort = 5300;
let engines: ReturnType<typeof createEngine>[] = [];
let sc2PidsBefore = new Set<number>();

// SC2 renames its main thread, so -x SC2_x64 never matches a running instance
const sc2Pids = () =>
    new Set(
        spawnSync('pgrep', ['-f', '[V]ersions/Base[0-9]*/SC2_x64'])
            .stdout.toString()
            .split('\n')
            .filter((line) => line.trim())
            .map(Number),
    );

const newEngine = () => {
    nextPort += 2;
    const engine = createEngine({ port: nextPort });
    engines.push(engine);
    return engine;
};

const computer = (options: Record<string, unknown> = {}) => ({
    type: PlayerType.COMPUTER,
    race: Race.ZERG,
    difficulty: Difficulty.VERYEASY,
    ...options,
});

const clientOf = (world: World) => world.resources.get().actions._client as unknown as Client;

beforeEach(() => {
    sc2PidsBefore = sc2Pids();
});

afterEach(() => {
    engines.forEach((engine) => {
        try {
            engine.shutdown();
        } catch {}
    });
    engines = [];
    [...sc2Pids()]
        .filter((pid) => !sc2PidsBefore.has(pid))
        .forEach((pid) => {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {}
        });
});

describe.skipIf(!process.env.SC2PATH)('live engine: python-sc2 run_game / run_replay parity', () => {
    it('runGame replays identically under the same random seed', async () => {
        const snapshotSeeded = async () => {
            let snapshot: string[] | undefined;
            const agent = createAgent({
                settings: { race: Race.TERRAN },
                async onGameStart(world: World) {
                    await world.resources.get().actions.train(UnitType.SCV);
                },
                async onStep({ resources }: World) {
                    const { frame, units } = resources.get();
                    if (snapshot === undefined && frame.getGameLoop() >= SNAPSHOT_LOOP) {
                        snapshot = units
                            .getAll()
                            .map(
                                (unit) =>
                                    `${unit.tag}:${unit.unitType}@${unit.pos.x.toFixed(2)},${unit.pos.y.toFixed(2)}`,
                            )
                            .sort();
                    }
                },
            });
            const engine = newEngine();
            await engine.connect();
            await engine.runGame(
                MAP,
                [{ type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent }, computer({ aiBuild: AIBuild.RUSH })],
                { randomSeed: FIXTURE_SEED, disableFog: true, gameTimeLimit: 10 },
            );
            return snapshot;
        };

        const first = await snapshotSeeded();
        const second = await snapshotSeeded();

        expect(first?.length).toBeGreaterThan(0);
        expect(second).toEqual(first);
    }, 180_000);

    it("runBotVsBot plays two agents in one call, maps a surrender to each player's result and saves the replay", async () => {
        let started = 0;
        const stepped = { surrendering: 0, winning: 0 };
        const surrendering = createAgent({
            settings: { race: Race.TERRAN },
            async onGameStart() {
                started += 1;
            },
            async onStep({ resources }: World) {
                stepped.surrendering += 1;
                if (resources.get().frame.getGameLoop() >= SURRENDER_LOOP) await resources.get().actions.surrender();
            },
        });
        const winning = createAgent({
            settings: { race: Race.PROTOSS },
            async onGameStart() {
                started += 1;
            },
            async onStep() {
                stepped.winning += 1;
            },
        });
        const engine = newEngine();
        const replayPath = join(workDir, 'bot-vs-bot.SC2Replay');

        const [hostOutcome, guestOutcome] = await engine.runBotVsBot(
            MAP,
            [
                { type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent: surrendering },
                { type: PlayerType.PARTICIPANT, race: Race.PROTOSS, agent: winning },
            ],
            { saveReplayAs: replayPath },
        );

        expect(started).toBe(2);
        expect([surrendering.playerId, winning.playerId].sort()).toEqual([1, 2]);
        expect(stepped.surrendering).toBeGreaterThan(0);
        expect(stepped.winning).toBeGreaterThan(0);
        expect(hostOutcome[1]).toEqual(
            [
                { playerId: surrendering.playerId, result: GameResult.DEFEAT },
                { playerId: winning.playerId, result: GameResult.VICTORY },
            ].sort((left, right) => left.playerId! - right.playerId!),
        );
        expect(guestOutcome[1]).toEqual(hostOutcome[1]);
        expect(statSync(replayPath).size).toBeGreaterThan(0);
    }, 180_000);

    it("runReplay steps a saved replay from the observed player's perspective", async () => {
        const replayPath = join(workDir, 'observed.SC2Replay');
        const engine = newEngine();
        await engine.connect();
        await engine.runGame(
            MAP,
            [
                {
                    type: PlayerType.PARTICIPANT,
                    race: Race.TERRAN,
                    agent: createAgent({ settings: { race: Race.TERRAN } }),
                },
                computer(),
            ],
            { gameTimeLimit: 15, saveReplayAs: replayPath },
        );

        const observe = async (options?: { observedPlayerId: number }) => {
            const stepLoops: number[] = [];
            const createdTypes = new Set<number>();
            let started = 0;
            const observer = createAgent({
                async onGameStart() {
                    started += 1;
                },
                async onStep({ resources }: World) {
                    stepLoops.push(resources.get().frame.getGameLoop());
                },
                async onUnitCreated(_world: World, unit: { unitType: number }) {
                    createdTypes.add(unit.unitType);
                },
            });
            const replayEngine = newEngine();
            await replayEngine.connect();
            await replayEngine.runReplay(observer, replayPath, options);
            return {
                started,
                stepLoops,
                createdWorker: [UnitType.SCV, UnitType.DRONE].filter((worker) => createdTypes.has(worker)),
            };
        };

        const asTerran = await observe();
        const asZerg = await observe({ observedPlayerId: 2 });

        expect([asTerran.started, asZerg.started]).toEqual([1, 1]);
        expect(asTerran.stepLoops).toEqual([...asTerran.stepLoops].sort((first, second) => first - second));
        expect(asTerran.stepLoops[asTerran.stepLoops.length - 1]).toBeGreaterThanOrEqual(
            Math.floor(15 * TICKS_PER_SECOND) - 8,
        );
        expect([asTerran.createdWorker, asZerg.createdWorker]).toEqual([[UnitType.SCV], [UnitType.DRONE]]);
    }, 180_000);

    it.each(Object.keys(FIXTURE_MAPS))(
        'the live engine still gives the recorded %s fixture answers and accepts its expansion and ramp wall spots',
        async (fixtureName) => {
            const fixture = loadFixture(fixtureName);
            const changed: string[] = [];
            const spots: {
                expansions: (number | undefined)[];
                wall: (number | undefined)[];
                expectedExpansions: number[];
            } = { expansions: [], wall: [], expectedExpansions: [] };
            const agent = createAgent({
                settings: { race: Race.TERRAN },
                async onGameStart(world: World) {
                    const client = clientOf(world);
                    for (const { request, response } of fixture.queries![0]) {
                        const live = await client.query(request);
                        (request.placements ?? []).forEach((placement, index) => {
                            if (live.placements![index].result !== response.placements![index].result)
                                changed.push(placementKey(placement));
                        });
                        (request.pathing ?? []).forEach((path, index) => {
                            if (live.pathing![index].distance !== response.pathing![index].distance)
                                changed.push(pathingKey(path));
                        });
                    }

                    const { map } = world.resources.get();
                    const ramp = map.getMainBaseRamp()!;
                    const ownMain = map.getMain().townhallPosition;
                    const placementsOf = async (abilityId: number, targets: Point2D[]) =>
                        (
                            await client.query({ placements: targets.map((targetPos) => ({ abilityId, targetPos })) })
                        ).placements!.map((placement) => placement.result);
                    spots.expansions = await placementsOf(Ability.BUILD_COMMANDCENTER, map.getExpansionLocations());
                    spots.expectedExpansions = map
                        .getExpansionLocations()
                        .map((location) =>
                            location.x === ownMain.x + 0.5 && location.y === ownMain.y + 0.5
                                ? CANT_BUILD_LOCATION_INVALID
                                : SUCCESS,
                        );
                    spots.wall = [
                        ...(await placementsOf(Ability.BUILD_SUPPLYDEPOT, [...ramp.cornerDepots, ramp.depotInMiddle!])),
                        ...(await placementsOf(Ability.BUILD_BARRACKS, [
                            ramp.barracksInMiddle!,
                            ramp.barracksCorrectPlacement!,
                        ])),
                        ...(await placementsOf(Ability.BUILD_PYLON, [ramp.protossWallPylon!])),
                    ];
                },
            });
            const engine = newEngine();
            await engine.connect();

            await engine.runGame(
                FIXTURE_MAPS[fixtureName],
                [{ type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent }, computer()],
                { randomSeed: FIXTURE_SEED, gameTimeLimit: 1 },
            );

            expect(changed).toEqual([]);
            expect(spots.expansions).toEqual(spots.expectedExpansions);
            expect(spots.wall).toEqual(Array(6).fill(SUCCESS));
        },
        120_000,
    );
});
