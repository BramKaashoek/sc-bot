import createDebug from 'debug';
import createTransport from '@node-sc2/proto';
import root from '@node-sc2/proto/root';
import { ConnectionClosedError } from './errors.ts';

type Pending = {
    name: string;
    resolve(response: unknown): void;
    reject(err: Error): void;
};

type ConnectOptions = { host?: string; port?: number };

const debugClient = createDebug('sc2:debug:client');
const Request = root.lookupType('Request');
const Response = root.lookupType('Response');
const requestNames = Response.oneofs.response.oneof;
const WS_OPEN = 1;

// the upstream client matches responses by type only, so an error response (which carries no type) or a closed socket
// leaves its promise pending forever; SC2 answers strictly in request order, so a FIFO settles every request
function createClient(base: NodeSC2Proto.ProtoClient = createTransport()): NodeSC2Proto.ProtoClient {
    const pending: Pending[] = [];
    let closedError: Error | null = null;

    const rejectAll = (err: Error) => {
        pending.splice(0).forEach((entry) => entry.reject(err));
    };

    const takePending = (name: string | undefined) => {
        const index = name ? pending.findIndex((entry) => entry.name === name) : 0;
        if (index === -1) return undefined;
        if (index > 0) debugClient(`response ${name} arrived ahead of ${index} earlier request(s)`);
        return pending.splice(index, 1)[0];
    };

    const client = {
        get _ws() {
            return base._ws;
        },
        status: base.status,
        _protoApiQueue: base._protoApiQueue,
        _promiseQueue: base._promiseQueue,
        _request(requestBuffer: Buffer) {
            base._request(requestBuffer);
        },
        async connect(opts: ConnectOptions) {
            const pingRes = await (base.connect as (opts: ConnectOptions) => Promise<SC2APIProtocol.ResponsePing>)(
                opts,
            );
            const ws = base._ws;
            client.status = base.status;
            closedError = null;

            ws.removeAllListeners('message');
            ws.on('message', (message: Uint8Array) => {
                const response = Response.toObject(Response.decode(message), {
                    bytes: Array,
                    longs: String,
                    defaults: true,
                }) as Record<string, unknown> & { status?: SC2APIProtocol.Status; error?: string[] };

                if (response.status) client.status = response.status;

                const name = requestNames.find((type) => response[type]);
                if (name === 'leaveGame') ws.emit('leftGame');

                const entry = takePending(name);
                if (!entry) {
                    debugClient('response with no pending request: ', response);
                    return;
                }

                if (response.error && response.error.length > 0) {
                    entry.reject(
                        Object.assign(new Error(`Response Error: ${JSON.stringify(response.error, null, 2)}`), {
                            err: response.error,
                        }),
                    );
                } else {
                    entry.resolve(response[entry.name]);
                }
            });
            ws.on('close', () => {
                closedError = new ConnectionClosedError('SC2 connection closed');
                rejectAll(closedError);
            });

            return pingRes;
        },
        close() {
            (base as unknown as { close(): void }).close();
        },
    };

    const send = (name: string, request: object = {}) =>
        new Promise((resolve, reject) => {
            const ws = base._ws;
            if (closedError) return reject(closedError);
            if (!ws || ws.readyState !== WS_OPEN)
                return reject(new Error(`SC2 connection not open for ${name} request`));

            pending.push({ name, resolve, reject });
            ws.send(Request.encode(Request.create({ [name]: request })).finish());
        });

    requestNames.forEach((name) => {
        Object.assign(client, { [name]: (request?: object) => send(name, request) });
    });

    return client as unknown as NodeSC2Proto.ProtoClient;
}

export default createClient;
