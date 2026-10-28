import { NodeSC2Error } from '../../engine/errors.ts';
import type { OpeningDefinition, OpeningSettings, PlacementTable } from '../../types.ts';
import { ARES_PLACEMENT_KEYS, IGNORED_PLACEMENT_KEYS } from '../placement/placer.ts';

type Dict = Record<string, unknown>;

const BUILD_KEYS = {
    OpeningBuildOrder: 'buildOrder',
    AutoSupplyAtSupply: 'autoSupplyAtSupply',
    ConstantWorkerProductionTill: 'constantWorkerProductionTill',
    PersistentWorker: 'persistentWorker',
    ShouldHandleGasSteal: 'shouldHandleGasSteal',
} as const;
const TOP_KEYS = ['UseData', 'BuildSelection', 'MinGamesWinrateBased', 'BuildChoices', 'Builds'];
const METHODS: Record<string, OpeningSettings['method']> = { Cycle: 'cycle', WinrateBased: 'winrate' };

const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);

function parseYaml(text: string, what: string): Dict {
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(text);
    } catch (err) {
        throw new NodeSC2Error(`Malformed ares ${what} YAML: ${(err as Error).message}`);
    }
    if (!isDict(parsed)) throw new NodeSC2Error(`Ares ${what} YAML must contain a mapping`);
    return parsed;
}

function section(value: unknown, path: string): Dict {
    if (!isDict(value)) throw new NodeSC2Error(`Ares ${path} must be a mapping`);
    return value;
}

function parseBuild(name: string, raw: unknown): OpeningDefinition {
    const entry = section(raw, `Builds.${name}`);
    const build: Dict = {};
    for (const [key, value] of Object.entries(entry)) {
        const target = BUILD_KEYS[key as keyof typeof BUILD_KEYS];
        if (target) build[target] = value;
        else console.warn(`Unknown key "${key}" in ares build "${name}"`);
    }
    if (!Array.isArray(build.buildOrder)) {
        throw new NodeSC2Error(`Ares build "${name}" needs an OpeningBuildOrder list`);
    }
    return build as OpeningDefinition;
}

export function parseAresBuilds(yamlText: string): Partial<OpeningSettings> {
    const root = parseYaml(yamlText, 'builds');
    const settings: Partial<OpeningSettings> = {};

    Object.keys(root)
        .filter((key) => !TOP_KEYS.includes(key))
        .forEach((key) => console.warn(`Unknown key "${key}" in ares builds`));

    if (root.UseData === true) settings.dataDir = './data';
    if (root.BuildSelection !== undefined) {
        const method = METHODS[String(root.BuildSelection)];
        // ares only honours WinrateBased when UseData is on
        if (method) {
            if (method !== 'winrate' || root.UseData === true) settings.method = method;
        } else console.warn(`Unknown BuildSelection "${root.BuildSelection}"`);
    }
    if (root.MinGamesWinrateBased !== undefined) settings.minGames = Number(root.MinGamesWinrateBased);

    if (root.BuildChoices !== undefined) {
        settings.choices = {};
        for (const [id, raw] of Object.entries(section(root.BuildChoices, 'BuildChoices'))) {
            const { Cycle, ...rest } = section(raw, `BuildChoices.${id}`);
            Object.keys(rest)
                .filter((key) => key !== 'BotName')
                .forEach((key) => console.warn(`Unknown key "${key}" in ares BuildChoices.${id}`));
            if (Array.isArray(Cycle)) settings.choices[id] = Cycle.map(String);
        }
    }
    if (root.Builds !== undefined) {
        settings.builds = Object.fromEntries(
            Object.entries(section(root.Builds, 'Builds')).map(([name, raw]) => [name, parseBuild(name, raw)]),
        );
    }
    return settings;
}

function flattenPoints(value: unknown): Array<[number, number]> {
    if (!Array.isArray(value)) return [];
    if (value.length === 2 && value.every((n) => typeof n === 'number')) return [[value[0], value[1]]];
    return value.flatMap(flattenPoints);
}

export function parseAresPlacements(yamlText: string): PlacementTable {
    const table: PlacementTable = {};
    for (const [map, spawns] of Object.entries(parseYaml(yamlText, 'placements'))) {
        const forMap: PlacementTable[string] = (table[map] = {});
        for (const [spawn, byRace] of Object.entries(section(spawns, map))) {
            if (spawn !== 'UpperSpawn' && spawn !== 'LowerSpawn') {
                console.warn(`Unknown spawn key "${spawn}" in ares placements for "${map}"`);
                continue;
            }
            const forSpawn: Record<string, Record<string, Array<[number, number]>>> = (forMap[spawn] = {});
            for (const [race, keys] of Object.entries(section(byRace, `${map}.${spawn}`))) {
                const forRace: Record<string, Array<[number, number]>> = (forSpawn[race] = {});
                for (const [key, groups] of Object.entries(section(keys, `${map}.${spawn}.${race}`))) {
                    if (IGNORED_PLACEMENT_KEYS.includes(key)) continue;
                    if (key in ARES_PLACEMENT_KEYS) forRace[key] = flattenPoints(groups);
                    else console.warn(`Unknown building placement key "${key}" in ares placements for "${map}"`);
                }
            }
        }
    }
    return table;
}
