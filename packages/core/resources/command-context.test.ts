import { describe, expect, it } from 'bun:test';
import Bluebird from 'bluebird';
import { currentCommander, runAsCommander, type CommandContext } from './command-context.ts';

const commander = (owner: string, rank: number): CommandContext => ({ owner, priority: 0, rank });

describe('command context', () => {
    it('defaults to an unknown, lowest-ranked commander outside any run', () => {
        expect(currentCommander()).toEqual({ owner: 'unknown', priority: 0, rank: Infinity });
    });

    it('survives awaits inside concurrent Bluebird.map systems without leaking between them', async () => {
        const seen: string[] = [];
        const system = async (name: string) => {
            const record = (step: string) => seen.push(`${name}:${step}:${currentCommander().owner}`);
            record('start');
            await Promise.resolve();
            record('microtask');
            await Bluebird.delay(2);
            record('delay');
            await Bluebird.resolve().then(() => record('bluebird-then'));
            await Bluebird.map([1, 2], async () => {
                await Bluebird.delay(1);
                record('bluebird-map');
            });
            await new Promise((resolve) => setTimeout(resolve, 1));
            record('timeout');
        };

        await Bluebird.map(['first', 'second'], (name, rank) =>
            runAsCommander(commander(name, rank), () => system(name)),
        );

        expect(seen).toHaveLength(14);
        seen.forEach((entry) => {
            const [name, , owner] = entry.split(':');
            expect(owner).toBe(name);
        });
        expect(currentCommander().owner).toBe('unknown');
    });
});
