import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import createEngine from './create-engine.ts';
import * as clientModule from './create-client.ts';
import * as launcherModule from './launcher.ts';
import { ConnectionClosedError, GameEndedError, NodeSC2Error } from './errors.ts';
import createAgent from '../agent/create-agent.ts';
import { Ability } from '../constants/index.ts';
import { GameResult, PlayerType, Race } from '../constants/enums.ts';
import { createFakeClient } from '../test/fake-client.ts';
import { createTestWorld, loadFixture, stepTo } from '../test/create-test-world.ts';
import { observation, toyFixture } from '../test/factories.ts';
import type { FakeClient } from '../test/fake-client.ts';
import type { GamePlayer, StepTime } from '../types.ts';

declare module '@sc-bot/core/types' {
    interface ResourceContainer {
        testGameEndFirst?: object;
        testGameEndThrows?: object;
        testGameEndLast?: object;
    }
}

const LAUNCHED = 1 as SC2APIProtocol.Status;
const MAP = 'Fake.SC2Map';
const REPLAY_BYTES = [1, 2, 3];

const createLobbyClient = () => {
    const fixture = loadFixture('blueshift');
    const client = createFakeClient({ fixture });
    const observationRequests: (SC2APIProtocol.RequestObservation | undefined)[] = [];
    const { observation, saveReplay } = client;

    client.setObservation(fixture.observations[896]);
    (client as FakeClient & { status: SC2APIProtocol.Status }).status = LAUNCHED;
    client.observation = async (request?: SC2APIProtocol.RequestObservation) => {
        observationRequests.push(request);
        return observation();
    };
    client.saveReplay = async (request) => ({ ...(await saveReplay(request)), data: Uint8Array.from(REPLAY_BYTES) });

    return { client, observationRequests };
};

const participant = (agent: ReturnType<typeof createAgent>) => [
    { type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent },
    { type: PlayerType.COMPUTER, race: Race.ZERG },
];

describe('engine game loop', () => {
    it('in realtime observes once per step at the target loop without stepping, and a surrender or a raw leaveGame saves the replay and ends the game as a silent defeat', async () => {
        const { client, observationRequests } = createLobbyClient();
        const replayDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
        const replayPath = join(replayDir, 'surrender.SC2Replay');
        const leftReplayPath = join(replayDir, 'left.SC2Replay');
        let steps = 0;
        const agent = createAgent({
            async onStep({ resources }) {
                steps += 1;
                if (steps === 2) await resources.get().actions.surrender();
                if (steps === 4) await resources.get().actions._client!.leaveGame();
            },
        });
        const reported: SC2APIProtocol.PlayerResult[][] = [];
        const engine = createEngine({ client, launch: false, onGameEnd: (results) => reported.push(results) });
        const warn = spyOn(console, 'warn').mockImplementation(() => {});

        try {
            const [, results] = await engine.runGame(MAP, participant(agent), {
                realtime: true,
                saveReplayAs: replayPath,
            });

            expect(results).toEqual([{ playerId: agent.playerId, result: GameResult.DEFEAT }]);
            const [, leftResults] = await engine.runGame(MAP, participant(agent), {
                realtime: true,
                saveReplayAs: leftReplayPath,
            });
            expect(leftResults).toEqual([{ playerId: agent.playerId, result: GameResult.DEFEAT }]);
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
        const defeat = [{ playerId: agent.playerId, result: GameResult.DEFEAT }];
        expect(reported).toEqual([defeat, defeat]);
        expect([...readFileSync(replayPath)]).toEqual(REPLAY_BYTES);
        expect([...readFileSync(leftReplayPath)]).toEqual(REPLAY_BYTES);
        const gameRequests = [undefined, { gameLoop: 900 }, { gameLoop: 900 }];
        expect(observationRequests).toEqual([...gameRequests, ...gameRequests]);
        expect(client.sent.step).toEqual([]);
        expect(client.sent.leaveGame).toHaveLength(2);
    });

    it('starts each game on a reused engine with its own create request, fresh step times, its own time-limit result and no actions queued during the previous one, leaving the first game to readers made before it', async () => {
        const { client } = createLobbyClient();
        const engine = createEngine({ client, launch: false });
        const { events } = engine.getWorld().resources.get();
        const preSetupReader = events.createReader();
        const leftover = { abilityId: Ability.STOP, unitTags: ['4342677505'] };
        let secondGameStartStepTime: StepTime | undefined;

        const firstPlayers = participant(createAgent({ async onStep() {} }));
        const secondPlayers = participant(
            createAgent({
                async onGameStart({ resources }) {
                    secondGameStartStepTime = resources.get().frame.getStepTime();
                },
            }),
        );
        await engine.runGame(MAP, firstPlayers, { gameTimeLimit: 1, randomSeed: 4242, disableFog: true });
        expect(events.read(preSetupReader)[0]).toMatchObject({ name: 'gameStart' });
        engine.getWorld().resources.get().actions.queueAction(leftover);
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const [, secondResults] = await engine.runGame('Nowhere LE', secondPlayers, { gameTimeLimit: 1 });
            expect(secondResults).toEqual([{ playerId: secondPlayers[0].agent!.playerId, result: GameResult.TIE }]);
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }

        expect(secondGameStartStepTime).toEqual({ min: 0, avg: 0, max: 0, last: 0 });
        expect(client.sent.actions.flatMap((request) => request.actions ?? [])).toEqual([]);
        expect(client.sent.createGame).toEqual([
            {
                realtime: false,
                playerSetup: firstPlayers,
                randomSeed: 4242,
                disableFog: true,
                localMap: { mapPath: MAP },
            },
            { realtime: false, playerSetup: secondPlayers, battlenetMapName: 'Nowhere LE' },
        ]);
    });

    it('steps host and bot-vs-bot guest by the configured gameStep and adds the chat debug system only when chatDebug is on', async () => {
        const { client } = createLobbyClient();
        const { client: guestClient } = createLobbyClient();
        Object.assign(guestClient, { quit: async () => ({}) });
        const createClient = spyOn(clientModule, 'default').mockImplementation(() => guestClient);
        const launch = spyOn(launcherModule, 'launcher').mockImplementation(async () => undefined as never);
        const engine = createEngine({
            client,
            launch: false,
            configFile: false,
            config: { gameStep: 2, features: { chatDebug: true } },
        });
        const systemNames = (target: typeof engine) => target.systems.map((system) => system._system.name);
        const players: [GamePlayer, GamePlayer] = [
            { type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent: createAgent() },
            { type: PlayerType.PARTICIPANT, race: Race.ZERG, agent: createAgent() },
        ];

        try {
            await engine.runBotVsBot(MAP, players, { gameTimeLimit: 1 });
        } finally {
            createClient.mockRestore();
            launch.mockRestore();
        }

        expect(client.sent.step.length).toBeGreaterThan(0);
        expect(guestClient.sent.step.length).toBeGreaterThan(0);
        expect([...client.sent.step, ...guestClient.sent.step].every((request) => request.count === 2)).toBe(true);
        expect(systemNames(engine)).toContain('ChatDebugSystem');
        expect(systemNames(createEngine({ client, launch: false, configFile: false }))).not.toContain(
            'ChatDebugSystem',
        );
    });

    it('runs resource game-end hooks in registration order past a throwing one, before the engine onGameEnd option', async () => {
        const { client } = createLobbyClient();
        const calls: string[] = [];
        const engine = createEngine({
            client,
            launch: false,
            configFile: false,
            onGameEnd: (results) => calls.push(`engine:${results.length}`),
        });
        const { resources } = engine.getWorld();
        resources.register({
            name: 'testGameEndFirst',
            create: () => ({}),
            onGameEnd: (_, __, results) => calls.push(`first:${results.length}`),
        });
        resources.register({
            name: 'testGameEndThrows',
            create: () => ({}),
            onGameEnd: () => {
                throw new Error('boom');
            },
        });
        resources.register({ name: 'testGameEndLast', create: () => ({}), onGameEnd: () => calls.push('last') });

        await engine.runGame(MAP, participant(createAgent()), { gameTimeLimit: 1 });

        expect(calls).toEqual(['first:1', 'last', 'engine:1']);
    });

    it('runs a ladder-managed game without creating it, resyncing to the game already in progress as the player the observation belongs to, keeping a preset opponent id under a ladder manager that passes no --OpponentId', async () => {
        const client = createFakeClient({ fixture: toyFixture() });
        const playerResult = [
            { playerId: 2, result: GameResult.VICTORY },
            { playerId: 1, result: GameResult.DEFEAT },
        ];
        client.setObservation({ ...observation({ playerCommon: { playerId: 2 } }), playerResult });
        const agent = createAgent();
        agent.opponent = { id: 'ladder-42' };
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        const { argv } = process;
        process.argv = [...argv.slice(0, 2), '--LadderServer', '127.0.0.1'];

        try {
            const engine = createEngine({ client, launch: false });
            process.argv = argv;
            const [, results] = await engine.runGame(MAP, participant(agent));

            expect([agent.playerId, results, agent.opponent?.id]).toEqual([2, playerResult, 'ladder-42']);
            expect(warn.mock.calls).toEqual([
                ['cannot join lobby for a game already in progress, attemping to resync to existing game...'],
            ]);
        } finally {
            process.argv = argv;
            warn.mockRestore();
        }
    });

    it('rejects a realtime game whose SC2 connection closes instead of reporting it as ended', async () => {
        const { client } = createLobbyClient();
        const { observation } = client;
        let observations = 0;
        client.observation = async (request) => {
            observations += 1;
            if (observations > 1) throw new ConnectionClosedError('SC2 connection closed');
            return observation(request);
        };
        const warn = spyOn(console, 'warn').mockImplementation(() => {});

        try {
            await expect(
                createEngine({ client, launch: false }).runGame(MAP, participant(createAgent()), {
                    realtime: true,
                    gameTimeLimit: 1,
                }),
            ).rejects.toThrow('SC2 connection closed');
        } finally {
            warn.mockRestore();
        }
    });

    it('rejects runGame with the error SC2 gives for a game it could not create, telling a failure apart by status rather than the decoded error', async () => {
        const created = createLobbyClient().client;
        const { createGame } = created;
        created.createGame = async (request) => ({ ...(await createGame(request)), error: 1 });
        const [, createdResults] = await createEngine({ client: created, launch: false }).runGame(
            MAP,
            participant(createAgent()),
            { gameTimeLimit: 1 },
        );
        expect(createdResults).toHaveLength(1);

        const { client } = createLobbyClient();
        client.createGame = async () => ({ error: 4, errorDetails: 'Battle.net map not found' });

        await expect(
            createEngine({ client, launch: false }).runGame('Nowhere LE', participant(createAgent()), {
                gameTimeLimit: 1,
            }),
        ).rejects.toThrow('Could not create a game on "Nowhere LE" (InvalidMapName): Battle.net map not found');
    });

    it('rejects runGame without an agent player, and createGame throws on a refused game but returns the response of a created one', async () => {
        const computers = [
            { type: PlayerType.COMPUTER, race: Race.TERRAN },
            { type: PlayerType.COMPUTER, race: Race.ZERG },
        ];
        await expect(
            createEngine({ client: createLobbyClient().client, launch: false }).runGame(MAP, computers),
        ).rejects.toBeInstanceOf(NodeSC2Error);

        const { client } = createLobbyClient();
        const created = await createEngine({ client, launch: false }).createGame(MAP, computers);
        expect(created).toBeDefined();

        const refused = createLobbyClient().client;
        refused.createGame = async () => ({ error: 4, errorDetails: 'Battle.net map not found' });
        const error = await createEngine({ client: refused, launch: false })
            .createGame('Nowhere LE', computers)
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NodeSC2Error);
        expect((error as Error).message).toBe(
            'Could not create a game on "Nowhere LE" (InvalidMapName): Battle.net map not found',
        );
    });

    it('rejects dispatch with a fatal error thrown by an agent handler but logs and survives any other', async () => {
        let failure: Error = new Error('boom');
        const agent = createAgent({
            async onStep() {
                throw failure;
            },
        });
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const world = await createTestWorld(toyFixture(), { agent });
            await stepTo(world, observation({ gameLoop: 8 }));
            expect(warn).toHaveBeenCalledWith('Agent handler error: onStep: ', failure);

            failure = new GameEndedError('over');
            await expect(stepTo(world, observation({ gameLoop: 16 }))).rejects.toBe(failure);
        } finally {
            warn.mockRestore();
        }
    });
});
