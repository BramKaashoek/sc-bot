import createDebug from 'debug';
import Bluebird from 'bluebird';
import yargs from 'yargs';
import pascalCase from 'pascal-case';
import hrtimeH from 'convert-hrtime';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { createServer } from 'node:net';
import root from '@node-sc2/proto/root';
import type { AddressInfo, Server } from 'node:net';
import { launcher, findMap, resolveSc2Install } from './launcher.ts';
import World, { resetGameState } from './create-world.ts';
import createDebugSystem from '../systems/debug.ts';
import createFrameSystem from '../systems/frame.ts';
import createUnitSystem from '../systems/unit.ts';
import createMapSystem from '../systems/map.ts';
import createChatDebugSystem from '../systems/chat-debug.ts';
import { resolveConfig } from './config.ts';
import { runAsCommander } from '../resources/command-context.ts';
import { GameResult, PlayerType, Race, Status, StatusId } from '../constants/enums.ts';
import { NodeSC2Error, GameEndedError, ConnectionClosedError } from './errors.ts';
import type {
    Agent,
    CreateGameOptions,
    Engine,
    EngineOptions,
    EventHandler,
    GameResult as GameOutcome,
    ReplayOptions,
} from '../types.ts';

type LoopOptions = {
    realtime?: boolean;
    gameTimeLimit?: number;
    replay?: boolean;
};

type PlayOptions = LoopOptions & {
    joinOptions?: SC2APIProtocol.RequestJoinGame;
    saveReplayAs?: string;
};

type RunnerClient = NodeSC2Proto.ProtoClient & {
    observation(request?: SC2APIProtocol.RequestObservation): Promise<SC2APIProtocol.ResponseObservation>;
    saveReplay(request?: SC2APIProtocol.RequestSaveReplay): Promise<SC2APIProtocol.ResponseSaveReplay>;
    leaveGame(request?: SC2APIProtocol.RequestLeaveGame): Promise<SC2APIProtocol.ResponseLeaveGame>;
    startReplay(request: SC2APIProtocol.RequestStartReplay): Promise<SC2APIProtocol.ResponseStartReplay>;
    replayInfo(request: SC2APIProtocol.RequestReplayInfo): Promise<SC2APIProtocol.ResponseReplayInfo>;
    quit(request?: SC2APIProtocol.RequestQuit): Promise<SC2APIProtocol.ResponseQuit>;
};

type EngineInstance = Engine & {
    _playGame(agent: Agent, options: PlayOptions): Promise<GameOutcome>;
    shutdown(): void;
} & ThisType<EngineInstance>;

const debugEngine = createDebug('sc2:debug:engine');
const debugSilly = createDebug('sc2:silly:engine');
const LOOPS_PER_SECOND = 22.4;
const CreateGameErrorId: Record<number, string> = root.lookupEnum('ResponseCreateGame.Error').valuesById;

const NOOP = () => {};

// SC2 resolves a replay's relative map path under `maps/`, which misses installs that ship `Maps/`
function readReplayMap(localMapPath?: string) {
    if (!localMapPath) return undefined;
    try {
        const mapPath = isAbsolute(localMapPath)
            ? localMapPath
            : join(resolveSc2Install().basePath, 'Maps', localMapPath);
        return existsSync(mapPath) ? readFileSync(mapPath) : undefined;
    } catch {
        return undefined;
    }
}

// the joining SC2 answers MapDoesNotExist for a host map path containing whitespace; a relative path avoids that, and
// SC2 resolves it under a lowercase maps/ (distinct from Maps/ on Linux). Staged copies stay so their replays remain playable.
function whitespaceFreeMapPath(mapPath: string) {
    if (!/\s/.test(mapPath) || !existsSync(mapPath)) return mapPath;

    const { basePath } = resolveSc2Install();
    const resolvable = ['maps', 'Maps']
        .map((mapsDir) => relative(join(basePath, mapsDir), mapPath))
        .find(
            (inMapsDir) =>
                !inMapsDir.startsWith('..') &&
                !isAbsolute(inMapsDir) &&
                !/\s/.test(inMapsDir) &&
                existsSync(join(basePath, 'maps', inMapsDir)),
        );
    if (resolvable) return resolvable;

    const stagedPath = join('node-sc2', basename(mapPath).replace(/\s/g, ''));
    mkdirSync(join(basePath, 'maps', 'node-sc2'), { recursive: true });
    copyFileSync(mapPath, join(basePath, 'maps', stagedPath));
    return stagedPath;
}

const pidOf = (sc2: Awaited<ReturnType<typeof launcher>>) => (typeof sc2 === 'number' ? sc2 : sc2?.pid);

async function pickFreePorts(count: number) {
    const servers: Server[] = Array.from({ length: count }, () => createServer());
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))));
    const ports = servers.map((server) => (server.address() as AddressInfo).port);
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    return ports;
}

function createEngine({ client, ...options }: EngineOptions = {}): Engine & { shutdown(): void } {
    const argv = yargs(process.argv.slice(2))
        .number('StartPort')
        .number('GamePort')
        .string('LadderServer')
        .string('OpponentId').argv;

    const isManaged = argv.GamePort || argv.StartPort || argv.LadderServer;

    const opts = {
        port: 5000,
        host: '127.0.0.1',
        launch: true,
        ...options,
    };

    // the ladder manager is launching this agent and it should override anything else
    if (isManaged) {
        opts.port = argv.GamePort!;
        opts.host = argv.LadderServer!;
    }
    // a local map path only means something to an SC2 on this machine's install
    const launchesSc2 = opts.launch && !isManaged;

    const world = World(client, resolveConfig(options.config, { file: options.configFile }));
    const debugSystem = createDebugSystem();
    const _client = world.resources.get().actions._client!;
    const runnerClient = _client as RunnerClient;
    let loopOptions: LoopOptions = {};
    let unsavedReplayPath: string | undefined;
    let gameSetUpBefore = false;

    const saveReplay = async () => {
        const replayPath = unsavedReplayPath!;
        unsavedReplayPath = undefined;
        const { data } = await runnerClient.saveReplay();
        writeFileSync(replayPath, Buffer.from(data!));
    };

    const { actions } = world.resources.get();

    // leaving yields no playerResult, so a deliberate leave has to be remembered to report the defeat
    const leaveGame = runnerClient.leaveGame;
    runnerClient.leaveGame = async function leaveGameAndRecord(this: RunnerClient, ...args) {
        // SC2 refuses saveReplay once the game is left
        if (unsavedReplayPath) await saveReplay();
        engine._gameLeft = true;
        return leaveGame.apply(this, args);
    };

    // decoding fills `error` with its first enum value even on success, so only the status tells a failed create apart
    const assertGameCreated = (map: string, response?: SC2APIProtocol.ResponseCreateGame) => {
        if (!response || _client.status === Status.INIT_GAME) return;
        throw new Error(
            `Could not create a game on "${map}" (${CreateGameErrorId[response.error!]}): ${response.errorDetails}`,
        );
    };

    const timeLimitResults = (): SC2APIProtocol.PlayerResult[] =>
        (world.resources.get().frame._gameInfo?.playerInfo ?? [])
            .filter((info) => info.type === PlayerType.PARTICIPANT)
            .map((info) => ({ playerId: info.playerId, result: GameResult.TIE }));

    const engine: EngineInstance = {
        getWorld() {
            return world;
        },
        _totalLoopDelay: 0,
        _gameLeft: false,
        launcher,
        use(sys) {
            if (Array.isArray(sys)) {
                sys.forEach((s) => this.systems.push(s));
            } else {
                this.systems.push(sys);
            }
        },
        systems: [],
        async connect() {
            if (launchesSc2) {
                await launcher(opts);
            }

            const pingRes = await _client.connect(opts);
            world.baseBuild = pingRes.baseBuild;

            // @TODO: @node-sc2/proto should be throwing a custom error type here

            _client._ws.on('error', (e) => {
                // @ts-ignore
                debugEngine('Received error from transport layer:', e);
            });

            _client._ws.on('leftGame', () => {
                this._gameLeft = true;
            });

            return pingRes;
        },
        async runGame(map = '', players = [], options = {}) {
            const player = players.find((p) => !!p.agent)!;
            player.agent!.settings.race = player.race;

            const { realtime = false, randomSeed, disableFog, gameTimeLimit, saveReplayAs } = options;
            assertGameCreated(map, await this.createGame(map, players, realtime, { randomSeed, disableFog }));
            return this._playGame(player.agent!, { realtime, gameTimeLimit, saveReplayAs });
        },
        async runBotVsBot(map, players, options = {}) {
            const { realtime = false, randomSeed, disableFog, gameTimeLimit, saveReplayAs } = options;
            players.forEach((player) => {
                player.agent!.settings.race = player.race;
            });

            const [guestPort, serverGamePort, serverBasePort, clientGamePort, clientBasePort] = await pickFreePorts(5);
            const guest = createEngine({
                host: opts.host,
                port: guestPort,
                launch: false,
                config: world.config,
                configFile: false,
            }) as unknown as EngineInstance;
            const guestClient = guest.getWorld().resources.get().actions._client as RunnerClient;
            const joinOptions: SC2APIProtocol.RequestJoinGame = {
                serverPorts: { gamePort: serverGamePort, basePort: serverBasePort },
                clientPorts: [{ gamePort: clientGamePort, basePort: clientBasePort }],
            };

            let guestPid: number | undefined;
            const killGuest = () => {
                if (!guestPid) return;
                try {
                    process.kill(guestPid, 'SIGKILL');
                } catch {}
            };
            // SC2 is spawned detached, so it outlives an interrupted parent unless killed here
            const onInterrupt = () => {
                killGuest();
                if (process.listenerCount('SIGINT') === 0) process.kill(process.pid, 'SIGINT');
            };
            process.once('SIGINT', onInterrupt);

            const guestLaunch = !isManaged
                ? launcher({ port: guestPort }).then((sc2) => {
                      guestPid = pidOf(sc2);
                  })
                : Promise.resolve();

            try {
                const mapPath = map.includes('SC2Map') || !launchesSc2 ? map : await findMap(map).catch(() => map);
                const hostMapPath = whitespaceFreeMapPath(mapPath);

                await Promise.all([_client._ws ? undefined : this.connect(), guestLaunch.then(() => guest.connect())]);
                assertGameCreated(
                    map,
                    await this.createGame(hostMapPath, players, realtime, { randomSeed, disableFog }),
                );
                const agents = [players[0].agent!, players[1].agent!];
                const games = await Promise.all([
                    this._playGame(agents[0], { joinOptions, realtime, gameTimeLimit, saveReplayAs }),
                    guest._playGame(agents[1], { joinOptions, realtime, gameTimeLimit }),
                ]);
                await guestClient.quit().catch(NOOP);

                // playerIds follow the concurrent join order, and a leaving engine only reports its own defeat
                const resultOf = ({ playerId }: Agent, index: number) =>
                    games[index][1]?.find((result) => result.playerId === playerId) ??
                    games[1 - index][1]?.find((result) => result.playerId === playerId);
                const results = agents
                    .map(resultOf)
                    .filter((result): result is SC2APIProtocol.PlayerResult => result !== undefined)
                    .sort((left, right) => left.playerId! - right.playerId!);
                return games.map(([gameWorld]) => [gameWorld, results]) as [GameOutcome, GameOutcome];
            } catch (err) {
                await guestLaunch.catch(NOOP);
                killGuest();
                throw err;
            } finally {
                process.removeListener('SIGINT', onInterrupt);
                if (guestClient._ws) guest.shutdown();
            }
        },
        async runReplay(agent, replayPath, { observedPlayerId = 1, realtime = false }: ReplayOptions = {}) {
            world.agent = agent;
            loopOptions = { realtime, replay: true };

            try {
                const { localMapPath } = await runnerClient.replayInfo({ replayPath });
                const { error, errorDetails } = await runnerClient.startReplay({
                    replayPath,
                    mapData: readReplayMap(localMapPath),
                    observedPlayerId,
                    realtime,
                    options: agent.interface,
                });
                if (_client.status !== Status.IN_REPLAY)
                    throw new Error(`Could not start replay (error ${error}): ${errorDetails}`);

                agent.playerId = observedPlayerId;
                return await this.firstRun();
            } finally {
                loopOptions = {};
            }
        },
        async _playGame(agent, { joinOptions, saveReplayAs, ...options }) {
            loopOptions = options;
            unsavedReplayPath = saveReplayAs;
            const gameResult = await this.joinGame(agent, joinOptions).finally(() => {
                loopOptions = {};
            });

            if (unsavedReplayPath) await saveReplay();

            if (options.gameTimeLimit !== undefined && _client.status === Status.IN_GAME) {
                await runnerClient.leaveGame().catch((err: Error) => debugEngine(`Leave game failed: ${err.message}`));
            }

            return gameResult;
        },
        async createGame(map = '', playerSetup = [], realtime = false, { randomSeed, disableFog } = {}) {
            if (isManaged) {
                debugEngine(`Engine tried to create a game, but is being managed by a ladder manager - skipping...`);
                return;
            }

            if (_client.status !== 1 && _client.status !== 5) {
                console.warn(
                    `cannot create a game unless in "launched" or "ended" status, current status is ${StatusId[_client.status]}`,
                );
                return;
            }

            let mapPath, battlenetMapName;

            if (map.includes('SC2Map')) {
                mapPath = map;
            } else if (!launchesSc2) {
                battlenetMapName = map;
            } else {
                try {
                    mapPath = await findMap(map);
                } catch (e) {
                    console.warn(`${(e as Error).message}; asking SC2 for the Battle.net map "${map}" instead`);
                    battlenetMapName = map;
                }
            }

            const game: SC2APIProtocol.RequestCreateGame = {
                realtime,
                playerSetup,
            };

            if (randomSeed !== undefined) game.randomSeed = randomSeed;
            if (disableFog !== undefined) game.disableFog = disableFog;

            if (mapPath) {
                game.localMap = { mapPath };
            } else {
                game.battlenetMapName = battlenetMapName;
            }

            debugEngine('CREATE GAME REQUEST: ', game);

            return _client.createGame(game);
        },
        async joinGame(agent, options = {}) {
            world.agent = agent;

            if (!agent.interface.raw) {
                throw new Error('`raw` is currently the only interface supported by this engine.');
            }

            switch (_client.status) {
                case 1:
                case 2: {
                    let participant: SC2APIProtocol.RequestJoinGame = {
                        race: (agent.settings && agent.settings.race) || Race.RANDOM,
                        options: agent.interface,
                        ...options,
                    };

                    if (isManaged) {
                        let sPort = argv.StartPort! + 1;

                        participant = {
                            ...participant,
                            sharedPort: sPort++,
                            serverPorts: {
                                gamePort: sPort++,
                                basePort: sPort++,
                            },
                            clientPorts: [
                                {
                                    gamePort: sPort++,
                                    basePort: sPort++,
                                },
                                {
                                    gamePort: sPort++,
                                    basePort: sPort++,
                                },
                            ],
                        };
                    }

                    const joinGame = await _client.joinGame(participant);
                    debugEngine('JOIN GAME RES: ', joinGame);

                    agent.playerId = joinGame.playerId;

                    return this.firstRun();
                }

                case 3: {
                    console.warn(
                        `cannot join lobby for a game already in progress, attemping to resync to existing game...`,
                    );

                    const { observation } = await runnerClient.observation();
                    agent.playerId = observation!.playerCommon!.playerId;

                    return this.firstRun();
                }

                default: {
                    throw new Error(
                        `cannot join a game this engine didn't create unless in "launched" status, current status is ${StatusId[_client.status]}`,
                    );
                }
            }
        },
        async firstRun() {
            await this.setupGame();
            return this.runLoop();
        },
        async setupGame() {
            const { data, resources, agent } = world;
            const { frame } = resources.get();

            this._gameLeft = false;
            this._totalLoopDelay = 0;
            if (gameSetUpBefore) resetGameState(world);
            gameSetUpBefore = true;

            if (isManaged) {
                agent.opponent = agent.opponent || {};
                if (argv.OpponentId !== undefined) agent.opponent.id = argv.OpponentId;
            }

            const gameData: SC2APIProtocol.ResponseData = await _client.data({
                abilityId: true,
                unitTypeId: true,
                upgradeId: true,
                buffId: true,
                effectId: true,
            });

            (['abilities', 'units', 'upgrades', 'buffs', 'effects'] as const).forEach((dataType) => {
                if (gameData[dataType]) data.set(dataType, gameData[dataType]);
            });

            [...this.systems, ...agent.systems, agent, debugSystem].forEach((system) => system.setup(world));

            const { events } = resources.get();

            events.write({
                name: 'gameStart',
                type: 'all',
            });

            await this.dispatch();
        },
        onGameEnd(observed) {
            const results = this._gameLeft ? [{ playerId: world.agent.playerId, result: GameResult.DEFEAT }] : observed;
            if (!results || results.length <= 0) {
                console.warn('The game ended but there is no result data');
            }
            debugEngine(
                `Average step delay for this game: ${this._totalLoopDelay! / world.resources.get().frame.getGameLoop()}`,
            );
            world.resources.endGame(world, results ?? []);
            options.onGameEnd?.(results);
            // @TODO: have some option to configure auto-saving of replays
            return [world, results];
        },
        async runLoop() {
            const { events, frame } = world.resources.get();

            const inReplay = loopOptions.replay && _client.status === Status.IN_REPLAY;
            if (_client.status !== 3 && !inReplay) {
                debugEngine('exiting loop, status no longer in game');
                const gameResult = this.onGameEnd(frame._result!);
                if (this._gameLeft || loopOptions.replay) return gameResult;
                // @TODO: check the frame to see if there happens to be some result data?
                throw new GameEndedError('Status no longer in game');
            }

            if (this._lastRequest) {
                this._loopDelay = hrtimeH(process.hrtime(this._lastRequest)).milliseconds;

                // @TODO: maybe allow this to be configurable? not off... per se, but some threshhold.
                if (this._loopDelay / world.config.gameStep > 44.6) {
                    // console.warn(`WARNING! loop delay is ${this._loopDelay / world.config.gameStep}ms, greater than realtime`);
                }

                this._totalLoopDelay! += this._loopDelay / world.config.gameStep;
            }

            this._lastRequest = process.hrtime();

            if (process.env.DELAY) {
                await Bluebird.delay(parseInt(process.env.DELAY, 10));
            }

            if (!loopOptions.realtime) {
                await _client.step({ count: world.config.gameStep });
            }

            events.write({
                name: 'step',
                type: 'all',
                data: frame.getGameLoop() + world.config.gameStep,
            });

            try {
                await this.dispatch();
            } catch (e) {
                // @FIXME: this really shouldn't be branched via an error... but it was a quick fix
                if (e instanceof GameEndedError) {
                    return this.onGameEnd((e as unknown as { data: SC2APIProtocol.PlayerResult[] }).data);
                } else {
                    console.warn('An error of an unknown type has propegated up to the game loop', e);
                    throw e;
                }
            }

            if (
                loopOptions.gameTimeLimit !== undefined &&
                frame.getGameLoop() / LOOPS_PER_SECOND > loopOptions.gameTimeLimit
            ) {
                return this.onGameEnd(timeLimitResults());
            }

            return this.runLoop();
        },
        async dispatch() {
            const engineSystems = this.systems;
            await Bluebird.mapSeries(engineSystems, (system) => system(world)); // concurrency: 1
            world.resources.step(world);

            // @FIXME: this duplicates logic from the system wrapper

            const { agent, resources } = world;
            const { events, frame } = resources.get();
            const agentHandlers = agent as unknown as Record<string, EventHandler>;
            const agentCommander = { owner: 'agent', priority: agent.settings?.commandPriority ?? 0, rank: -1 };
            const eventsWithHandlers = events
                .read(agent.readerId!)
                .filter((event) => agentHandlers[`on${pascalCase(event.name)}`]);
            const handlerPromises =
                eventsWithHandlers.length > 0
                    ? eventsWithHandlers.map((event) => {
                          const startedAt = performance.now();
                          const handler = agentHandlers[`on${pascalCase(event.name)}`];
                          return runAsCommander(agentCommander, () => handler.call(agent, world, event.data, event))
                              .catch((err: Error) => {
                                  if (err instanceof NodeSC2Error) {
                                      debugSilly(`Agent handler error: on${pascalCase(event.name)}: `, err);
                                  } else {
                                      console.warn(`Agent handler error: on${pascalCase(event.name)}: `, err);
                                  }
                              })
                              .then(() => {
                                  if (event.name === 'step') frame.recordStepTime(performance.now() - startedAt);
                              });
                      })
                    : [];

            await Promise.all(handlerPromises);

            // @TODO: Should agent systems always be run concurrently?
            const {
                agent: { systems },
            } = world;
            await Bluebird.map(systems, (system, rank) =>
                runAsCommander(
                    { owner: system._system.name ?? 'unknown', priority: system.commandPriority, rank },
                    () => system(world),
                ),
            );

            await actions.flushQueuedActions().catch((err: Error) => {
                if (err instanceof GameEndedError || err instanceof ConnectionClosedError) throw err;
                debugEngine(`Queued actions failed: ${err.message}`);
            });

            // debug system runs last because it updates the in-client debug display
            return debugSystem(world);
        },
        shutdown() {
            _client.close();
        },
        _lastRequest: null,
    };

    engine.use([
        createFrameSystem({ isRealtime: () => !!loopOptions.realtime }),
        createUnitSystem(),
        createMapSystem(),
    ]);
    if (world.config.features.chatDebug) engine.use(createChatDebugSystem());

    return engine;
}

export default createEngine;
