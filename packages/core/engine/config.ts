import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import { NodeSC2Error } from './errors.ts';
import type { CoreConfig, CoreConfigInput } from '../types.ts';

export const DEFAULT_CONFIG: Readonly<CoreConfig> = Object.freeze({
    gameStep: 4,
    features: Object.freeze({ chatDebug: false, eagerMapAnalysis: true }),
    resources: Object.freeze({}),
});

const YAML_EXTENSIONS = new Set(['.yml', '.yaml']);
const DEFAULT_FILES = ['sc-bot.config.json', 'sc-bot.config.yml', 'sc-bot.config.yaml'];

function defaultConfigPath(cwd: string): string {
    const found = DEFAULT_FILES.map((name) => join(cwd, name)).filter((path) => existsSync(path));
    if (found.length > 1) throw new NodeSC2Error(`Multiple default config files found, keep one: ${found.join(', ')}`);
    return found[0] ?? join(cwd, DEFAULT_FILES[0]);
}

function readConfigFile(path: string, explicit: boolean): CoreConfigInput {
    if (!existsSync(path)) {
        if (explicit) throw new NodeSC2Error(`Config file not found: ${path}`);
        return {};
    }
    let parsed: unknown;
    try {
        const text = readFileSync(path, 'utf8');
        parsed = YAML_EXTENSIONS.has(extname(path)) ? Bun.YAML.parse(text) : JSON.parse(text);
    } catch (err) {
        throw new NodeSC2Error(`Malformed config file ${path}: ${(err as Error).message}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new NodeSC2Error(`Config file ${path} must contain an object`);
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
    const fromFile = file === false ? {} : readConfigFile(explicitPath ?? defaultConfigPath(cwd), !!explicitPath);

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
