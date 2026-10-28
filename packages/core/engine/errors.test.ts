import { describe, expect, it } from 'bun:test';
import { BuildError, ConnectionClosedError, GameEndedError, isFatalGameError, triageError } from './errors.ts';

function record() {
    const calls: string[] = [];
    return {
        calls,
        sinks: {
            expected: (message: string, err: Error) => calls.push(`expected:${message}:${err.message}`),
            unexpected: (message: string, err: Error) => calls.push(`unexpected:${message}:${err.message}`),
        },
    };
}

describe('triageError', () => {
    it.each([new GameEndedError('over'), new ConnectionClosedError('closed')])('rethrows fatal %p', (err) => {
        const { calls, sinks } = record();
        expect(() => triageError(err, 'label', sinks)).toThrow(err);
        expect(isFatalGameError(err)).toBe(true);
        expect(calls).toEqual([]);
    });

    it('sends NodeSC2Error subclasses to the expected sink', () => {
        const { calls, sinks } = record();
        triageError(new BuildError('no room'), 'label', sinks);
        expect(calls).toEqual(['expected:label:no room']);
    });

    it('sends anything else to the unexpected sink', () => {
        const { calls, sinks } = record();
        triageError(new Error('boom'), 'label', sinks);
        expect(isFatalGameError(new Error('boom'))).toBe(false);
        expect(calls).toEqual(['unexpected:label:boom']);
    });
});
