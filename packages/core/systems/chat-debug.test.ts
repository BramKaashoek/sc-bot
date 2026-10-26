import { describe, expect, it } from 'bun:test';
import { EXTRACTOR, MARINE, ZERGLING } from '../constants/unit-type.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { parseChatCommand } from './chat-debug.ts';
import type { TestWorld } from '../test/create-test-world.ts';

const OWN_PLAYER = 1;

async function chat(world: TestWorld, gameLoop: number, playerId: number, message: string) {
    const { sent } = world.client;
    const [debugBefore, actionsBefore] = [sent.debug.length, sent.actions.length];
    const next = structuredClone(world.client.fixture.observations[896]);
    next.observation!.gameLoop = gameLoop;
    next.chat = [{ playerId, message }];
    await stepTo(world, next);
    return {
        debug: sent.debug.slice(debugBefore).flatMap((request) => request.debug ?? []),
        actions: sent.actions.slice(actionsBefore).flatMap((request) => request.actions ?? []),
    };
}

describe('chat debug', () => {
    it('parses ares aliases case-insensitively, with a plural fallback and errors for bad arguments', () => {
        expect(
            [
                'make 2 Marines',
                'CREATE 1 zergling 2',
                'destroy 3 marine',
                'cooldown',
                'Supply',
                'food',
                'god',
                'money',
                'resources',
                'reveal',
                'show',
                'show-map',
                'tech',
                'tech-tree',
                'upgrades',
            ].map(parseChatCommand),
        ).toEqual([
            { kind: 'create', count: 2, unitType: MARINE },
            { kind: 'create', count: 1, unitType: ZERGLING, playerId: 2 },
            { kind: 'kill', count: 3, unitType: MARINE },
            { kind: 'cooldown' },
            { kind: 'food' },
            { kind: 'food' },
            { kind: 'god' },
            { kind: 'resources' },
            { kind: 'resources' },
            { kind: 'showMap' },
            { kind: 'showMap' },
            { kind: 'showMap' },
            { kind: 'techTree' },
            { kind: 'techTree' },
            { kind: 'upgrades' },
        ]);
        expect(
            [
                'kill 0 marine',
                'kill -1 marine',
                'kill 1.5 marine',
                'create 1 notaunit',
                'create 1',
                'create 1 marine x',
            ].map((message) => 'error' in parseChatCommand(message)!),
        ).toEqual([true, true, true, true, true, true]);
        expect(['gg wp', ''].map(parseChatCommand)).toEqual([null, null]);
    });

    it("runs own chat commands as debug requests, replies to errors and ignores other players' chat", async () => {
        const world = await createTestWorld('blueshift', { loop: 896, config: { features: { chatDebug: true } } });
        const tagsOf = (unitType: number) =>
            world.resources
                .get()
                .units.getAlive()
                .filter((unit) => unit.unitType === unitType)
                .map(({ tag }) => tag);
        const [marines, enemyExtractors] = [tagsOf(MARINE), tagsOf(EXTRACTOR)];

        const results = [
            await chat(world, 900, OWN_PLAYER, 'create 2 marine'),
            await chat(world, 904, 2, 'create 2 marine'),
            await chat(world, 908, OWN_PLAYER, 'kill 1 marine'),
            await chat(world, 912, OWN_PLAYER, 'kill 1 hellion'),
            await chat(world, 916, OWN_PLAYER, 'kill 5 extractor 2'),
            await chat(world, 920, OWN_PLAYER, 'create 1 notaunit'),
        ];
        let loop = 924;
        const gameStates: SC2APIProtocol.DebugCommand[] = [];
        for (const message of ['god', 'cooldown', 'food', 'resources', 'reveal', 'tech', 'upgrades']) {
            loop += 4;
            gameStates.push(...(await chat(world, loop, OWN_PLAYER, message)).debug);
        }

        expect(results.map(({ debug }) => debug as unknown[])).toEqual([
            [{ createUnit: { unitType: MARINE, quantity: 2, owner: OWN_PLAYER, pos: { x: 13.75, y: 14.25 } } }],
            [],
            [{ killUnit: { tag: [marines[0]] } }],
            [],
            [{ killUnit: { tag: enemyExtractors } }],
            [],
        ]);
        expect(gameStates).toEqual([6, 9, 3, 5, 1, 10, 11].map((gameState) => ({ gameState })));
        expect(results.map(({ actions }) => actions.map((action) => action.actionChat?.message))).toEqual([
            [],
            [],
            [],
            ["Can't find any of those"],
            [],
            ['Not a valid UnitTypeId: NOTAUNIT'],
        ]);
        expect(results.flatMap(({ actions }) => actions).filter((action) => action.actionRaw)).toEqual([]);
    });
});
