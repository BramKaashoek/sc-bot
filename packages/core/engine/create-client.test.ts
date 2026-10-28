import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'bun:test';
import root from '@node-sc2/proto/root';
import createClient from './create-client.ts';
import { ConnectionClosedError, NodeSC2Error } from './errors.ts';

const Request = root.lookupType('Request');
const Response = root.lookupType('Response');

function createFakeBase() {
    const ws = Object.assign(new EventEmitter(), {
        readyState: 1,
        sent: [] as Record<string, unknown>[],
        send(buffer: Uint8Array) {
            ws.sent.push(Request.toObject(Request.decode(buffer)));
        },
        respond(response: object) {
            ws.emit('message', Response.encode(Response.create(response)).finish());
        },
    });
    const base = {
        _ws: null as unknown as typeof ws,
        status: 99,
        async connect() {
            base._ws = ws;
            base.status = 1;
            return { gameVersion: 'fake' };
        },
        close() {
            ws.emit('close');
        },
    };
    return { base, ws };
}

async function connectedClient() {
    const { base, ws } = createFakeBase();
    const client = createClient(base as unknown as NodeSC2Proto.ProtoClient) as unknown as Record<
        string,
        (request?: object) => Promise<unknown>
    > &
        NodeSC2Proto.ProtoClient;
    await client.connect({});
    return { client, ws };
}

describe('createClient', () => {
    test('settles a typed response with its own request and an untyped error response with the oldest, announcing a left game', async () => {
        const { client, ws } = await connectedClient();
        let leftGame = false;
        ws.on('leftGame', () => {
            leftGame = true;
        });

        const action = client.action({ actions: [] });
        const observation = client.observation();
        const leaveGame = client.leaveGame();
        expect(ws.sent.map((request) => Object.keys(request)[0])).toEqual(['action', 'observation', 'leaveGame']);

        ws.respond({ observation: { observation: { gameLoop: 7 } }, status: 5 });
        ws.respond({ error: ['Game has already ended'], status: 5 });
        ws.respond({ leaveGame: {}, status: 1 });

        const actionError = await action.catch((err: Error) => err);
        expect(actionError).toBeInstanceOf(NodeSC2Error);
        expect(actionError).toMatchObject({
            name: 'NodeSC2Error',
            err: ['Game has already ended'],
            message: `Response Error: ${JSON.stringify(['Game has already ended'], null, 2)}`,
        });
        expect(await observation).toMatchObject({ observation: { gameLoop: 7 } });
        expect([await leaveGame, leftGame, client.status]).toEqual([{}, true, 1 as SC2APIProtocol.Status]);
    });

    test('rejects pending and later requests once the socket closes, until it reconnects', async () => {
        const { client, ws } = await connectedClient();

        const step = client.step({ count: 1 });
        ws.emit('close');
        const afterClose = client.ping();

        expect(await step.catch((err: Error) => err)).toBeInstanceOf(ConnectionClosedError);
        expect(await afterClose.catch((err: Error) => err)).toBeInstanceOf(ConnectionClosedError);

        await client.connect({});
        const ping = client.ping();
        ws.respond({ ping: { gameVersion: 'reconnected' } });
        expect(await ping).toMatchObject({ gameVersion: 'reconnected' });
    });

    test('rejects a send on a socket that is not open with a NodeSC2Error naming the request, not a fatal closed error', async () => {
        const { client, ws } = await connectedClient();
        ws.readyState = 0;

        const err = await client.ping().catch((e: Error) => e);

        expect(err).toBeInstanceOf(NodeSC2Error);
        expect(err).not.toBeInstanceOf(ConnectionClosedError);
        expect((err as Error).message).toBe('SC2 connection not open for ping request');
    });
});
