import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { NodeSC2Error } from './errors.ts';
import type { CoreConfig, CoreConfigInput } from '../types.ts';

export const DEFAULT_CONFIG: Readonly<CoreConfig> = Object.freeze({
    gameStep: 4,
    features: Object.freeze({ chatDebug: false, eagerMapAnalysis: true }),
    resources: Object.freeze({}),
});

function readConfigFile(path: string, explicit: boolean): CoreConfigInput {
    if (!existsSync(path)) {
        if (explicit) throw new NodeSC2Error(`Config file not found: ${path}`);
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
        throw new NodeSC2Error(`Malformed config file ${path}: ${(err as Error).message}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new NodeSC2Error(`Config file ${path} must contain a JSON object`);
    }
    return parsed as CoreConfigInput;
}

function merge(base: CoreConfig, next: CoreConfigInput): CoreConfig {
    const resources = { ...base.resources } as Record<string, object>;
    Object.entries(next.resources ?? {}).forEach(([name, section]) => {
        resources[name] = { ...resources[name], ...section };
    });
    return {
        ...base,
        ...next,
        features: { ...base.features, ...next.features },
        resources,
    } as CoreConfig;
}

function validate(config: CoreConfig): void {
    if (!Number.isInteger(config.gameStep) || config.gameStep < 1) {
        throw new NodeSC2Error(`Config gameStep must be a positive integer, got ${config.gameStep}`);
    }
    Object.entries(config.features).forEach(([key, value]) => {
        if (!(key in DEFAULT_CONFIG.features)) {
            console.warn(`Unknown config feature "${key}"`);
        } else if (typeof value !== 'boolean') {
            throw new NodeSC2Error(`Config feature "${key}" must be a boolean, got ${value}`);
        }
    });
}

export function resolveConfig(
    inline: CoreConfigInput = {},
    {
        file,
        env = process.env,
        cwd = process.cwd(),
    }: { file?: string | false; env?: Record<string, string | undefined>; cwd?: string } = {},
): Readonly<CoreConfig> {
    const named = file === false ? undefined : (file ?? env.SC_BOT_CONFIG);
    const explicitPath = named && !isAbsolute(named) ? join(cwd, named) : named;
    const fromFile =
        file === false ? {} : readConfigFile(explicitPath ?? join(cwd, 'sc-bot.config.json'), !!explicitPath);

    const config = merge(merge(DEFAULT_CONFIG, fromFile), inline);
    if (env.STEP_COUNT) {
        const stepCount = Number(env.STEP_COUNT);
        if (!Number.isInteger(stepCount) || stepCount < 1) {
            throw new NodeSC2Error(`STEP_COUNT must be a positive integer, got "${env.STEP_COUNT}"`);
        }
        config.gameStep = stepCount;
    }
    validate(config);

    return Object.freeze(config);
}
