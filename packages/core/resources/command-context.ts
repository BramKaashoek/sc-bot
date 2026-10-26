import { AsyncLocalStorage } from 'node:async_hooks';
import Bluebird from 'bluebird';

export type CommandContext = { owner: string; priority: number; rank: number };

// Without this Bluebird drains its callback queue in whichever context scheduled the drain, leaking one system's commander into another's.
Bluebird.config({ asyncHooks: true });

const storage = new AsyncLocalStorage<CommandContext>();

const DEFAULT_COMMANDER: CommandContext = { owner: 'unknown', priority: 0, rank: Infinity };

export function runAsCommander<T>(context: CommandContext, fn: () => T): T {
    return storage.run(context, fn);
}

export function currentCommander(): CommandContext {
    return storage.getStore() ?? { ...DEFAULT_COMMANDER };
}
