import { afterAll, afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeSC2Error } from './errors.ts';
import { DEFAULT_CONFIG, resolveConfig } from './config.ts';

const dirWith = (contents?: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-bot-config-'));
    if (contents !== undefined) writeFileSync(join(dir, 'sc-bot.config.json'), contents);
    return dir;
};

const fileConfig = {
    gameStep: 8,
    features: { chatDebug: true },
    resources: { mining: { enabled: true, priority: -5 } },
    builds: { opening: ['14 depot'] },
};

describe('resolveConfig', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    afterEach(() => warn.mockClear());
    afterAll(() => warn.mockRestore());

    it('uses the frozen defaults when there is no file', () => {
        const config = resolveConfig(undefined, { env: {}, cwd: dirWith() });

        expect(config).toEqual({
            gameStep: 4,
            features: { chatDebug: false, eagerMapAnalysis: true },
            resources: {},
        });
        expect([config, DEFAULT_CONFIG.features, DEFAULT_CONFIG.resources].every(Object.isFrozen)).toBe(true);
        expect(resolveConfig(undefined, { file: false, env: {}, cwd: dirWith('{') })).toEqual(DEFAULT_CONFIG);
    });

    it('merges defaults, then the file, then inline, then STEP_COUNT, keeping unknown sections verbatim', () => {
        const cwd = dirWith(JSON.stringify(fileConfig));
        const inline = {
            features: { eagerMapAnalysis: false },
            resources: { mining: { priority: -20 }, buildings: { priority: 12 } },
        };

        expect(resolveConfig(inline, { env: {}, cwd })).toEqual({
            gameStep: 8,
            features: { chatDebug: true, eagerMapAnalysis: false },
            resources: { mining: { enabled: true, priority: -20 }, buildings: { priority: 12 } },
            builds: { opening: ['14 depot'] },
        } as never);
        expect(
            resolveConfig({ gameStep: 2, ...({ builds: { opening: [] } } as object) }, { env: {}, cwd }),
        ).toMatchObject({
            gameStep: 2,
            builds: { opening: [] },
        });
        expect(resolveConfig({ gameStep: 2 }, { env: { STEP_COUNT: '6' }, cwd }).gameStep).toBe(6);
        expect(warn).not.toHaveBeenCalled();
    });

    it('reads an explicit path from the option or SC_BOT_CONFIG, and throws when it is missing or malformed', () => {
        const other = join(dirWith(JSON.stringify({ gameStep: 3 })), 'sc-bot.config.json');
        const malformed = join(dirWith('{ nope'), 'sc-bot.config.json');
        const array = join(dirWith('[1]'), 'sc-bot.config.json');
        const cwd = dirWith();
        writeFileSync(join(cwd, 'relative.json'), JSON.stringify({ gameStep: 5 }));

        expect(resolveConfig(undefined, { file: other, env: {}, cwd }).gameStep).toBe(3);
        expect(resolveConfig(undefined, { env: { SC_BOT_CONFIG: other }, cwd }).gameStep).toBe(3);
        expect(() => resolveConfig(undefined, { file: join(cwd, 'missing.json'), env: {}, cwd })).toThrow(NodeSC2Error);
        expect(() => resolveConfig(undefined, { file: malformed, env: {}, cwd })).toThrow(malformed);
        expect(() => resolveConfig(undefined, { file: array, env: {}, cwd })).toThrow(array);
        expect(resolveConfig(undefined, { file: 'relative.json', env: {}, cwd }).gameStep).toBe(5);
    });

    it('rejects a bad gameStep or feature value and warns once per unknown feature', () => {
        const options = { file: false as const, env: {} };

        expect(() => resolveConfig({ gameStep: 0 }, options)).toThrow(NodeSC2Error);
        expect(() => resolveConfig({ gameStep: 1.5 }, options)).toThrow(NodeSC2Error);
        expect(() => resolveConfig({}, { file: false, env: { STEP_COUNT: 'fast' } })).toThrow('STEP_COUNT');
        expect(() => resolveConfig({ features: { chatDebug: 'yes' as never } }, options)).toThrow(NodeSC2Error);
        resolveConfig({ features: { turbo: true, warp: true } as never }, options);

        expect(warn).toHaveBeenCalledTimes(2);
    });
});
