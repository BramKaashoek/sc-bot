import createDebug from 'debug';
import * as Ability from '../../constants/ability.ts';
import * as BuildTarget from '../../constants/build-target.ts';
import { Race } from '../../constants/enums.ts';
import { structureTypes } from '../../constants/groups.ts';
import * as UnitType from '../../constants/unit-type.ts';
import * as Upgrade from '../../constants/upgrade.ts';
import { NodeSC2Error } from '../../engine/errors.ts';
import type { BuildTaskI } from '../../types.ts';

const debugBuildOrder = createDebug('sc2:debug:buildOrder');

export type BuildTargetName = (typeof BuildTarget)[keyof typeof BuildTarget];

export type BuildOrderStep = string | Record<string, string[]>;

export type BuildOrderTask = Omit<BuildTaskI, 'type' | 'opts'> & {
    type: BuildTaskI['type'] | 'scout' | 'addonSwap';
    opts?: BuildTaskI['opts'] & {
        at?: BuildTargetName;
        scout?: 'worker' | 'overlord';
        waypoints?: BuildTargetName[];
        addon?: number;
    };
};

export type ParsedBuildTask = BuildOrderTask | [number, BuildOrderTask];

type RaceUnits = { worker: number; supply: number; gas: number; townhall: number };

const RACE_UNITS: Record<number, RaceUnits> = {
    [Race.TERRAN]: {
        worker: UnitType.SCV,
        supply: UnitType.SUPPLYDEPOT,
        gas: UnitType.REFINERY,
        townhall: UnitType.COMMANDCENTER,
    },
    [Race.PROTOSS]: {
        worker: UnitType.PROBE,
        supply: UnitType.PYLON,
        gas: UnitType.ASSIMILATOR,
        townhall: UnitType.NEXUS,
    },
    [Race.ZERG]: {
        worker: UnitType.DRONE,
        supply: UnitType.OVERLORD,
        gas: UnitType.EXTRACTOR,
        townhall: UnitType.HATCHERY,
    },
};

const MORPHS: Record<number, number> = {
    [UnitType.LAIR]: Ability.MORPH_LAIR,
    [UnitType.HIVE]: Ability.MORPH_HIVE,
};

const SCOUT_DEFAULTS: Record<string, BuildTargetName> = {
    WORKER_SCOUT: BuildTarget.ENEMY_SPAWN,
    OVERLORD_SCOUT: BuildTarget.ENEMY_NAT_VISION,
};

const REPEAT = /^[X*](\d+)$/;

const own = <T>(table: Record<string, T>, key: string): T | undefined =>
    Object.hasOwn(table, key) ? table[key] : undefined;

const fail = (step: string, reason: string): never => {
    throw new NodeSC2Error(`Invalid build order step "${step}": ${reason}`);
};

function parseHead(step: string): [supply: number, command: string, args: string[]] {
    const words = step.split(' ').filter(Boolean);
    if (words.length < 2) fail(step, 'expected "<supply> <command>"');
    let supply = 0;
    if (/^\d+$/.test(words[0])) {
        supply = Number(words[0]);
    } else {
        debugBuildOrder(`"${step}" should begin with an integer supply, found "${words[0]}", using 0`);
    }
    return [supply, words[1].toUpperCase(), words.slice(2)];
}

function buildTarget(step: string, name: string): BuildTargetName {
    if (name === 'ENEMY_NAT_HG_SPOT') fail(step, 'ENEMY_NAT_HG_SPOT is not supported');
    return own<BuildTargetName>(BuildTarget, name) ?? fail(step, `unknown target "${name}"`);
}

function raceUnits(step: string, race: SC2APIProtocol.Race): RaceUnits {
    return RACE_UNITS[race] ?? fail(step, `no race-specific units for race ${race}`);
}

function createTask(step: string, command: string, targets: string[], race: SC2APIProtocol.Race): BuildOrderTask {
    if (command !== 'CHRONO') for (const name of targets) buildTarget(step, name);
    const at = (): { at?: BuildTargetName } => {
        const last = targets.at(-1);
        return last === undefined ? {} : { at: buildTarget(step, last) };
    };

    const unitType = own<number>(UnitType, command);
    if (unitType !== undefined) {
        const morph = MORPHS[unitType];
        if (morph !== undefined) return { type: 'ability', id: morph, qty: 1, opts: {} };
        const type = structureTypes.includes(unitType) ? 'build' : 'train';
        return { type, id: unitType, qty: 1, opts: at() };
    }

    const upgrade = own<number>(Upgrade, command);
    if (upgrade !== undefined) return { type: 'upgrade', id: upgrade, qty: 1 };

    switch (command) {
        case 'WORKER':
            return { type: 'train', id: raceUnits(step, race).worker, qty: 1, opts: at() };
        case 'SUPPLY': {
            const id = raceUnits(step, race).supply;
            return { type: id === UnitType.OVERLORD ? 'train' : 'build', id, qty: 1, opts: at() };
        }
        case 'GAS':
            return { type: 'build', id: raceUnits(step, race).gas, qty: 1, opts: {} };
        case 'EXPAND':
            return { type: 'build', id: raceUnits(step, race).townhall, qty: 1, opts: at() };
        case 'GATE':
            return { type: 'build', id: UnitType.GATEWAY, qty: 1, opts: at() };
        case 'CORE':
            return { type: 'build', id: UnitType.CYBERNETICSCORE, qty: 1, opts: at() };
        case 'ORBITAL':
            return { type: 'ability', id: Ability.MORPH_ORBITALCOMMAND, qty: 1, opts: {} };
        case 'CANCEL_GAS':
            return {
                type: 'ability',
                id: Ability.CANCEL_BUILDINPROGRESS,
                qty: 1,
                opts: { on: raceUnits(step, race).gas },
            };
        case 'CHRONO': {
            const name = targets.at(-1) ?? fail(step, 'CHRONO needs a unit type target, e.g. "16 chrono @ nexus"');
            const target = name === 'CORE' ? UnitType.CYBERNETICSCORE : own<number>(UnitType, name);
            if (target === undefined) fail(step, `unknown target "${name}"`);
            return { type: 'ability', id: Ability.EFFECT_CHRONOBOOSTENERGYCOST, qty: 1, opts: { target } };
        }
        case 'WORKER_SCOUT':
        case 'OVERLORD_SCOUT':
            return scoutTask(step, command, targets);
        default:
            return fail(step, `unknown command "${command}"`);
    }
}

function scoutTask(step: string, command: string, targets: string[]): BuildOrderTask {
    const waypoints: BuildTargetName[] =
        targets.length > 0 ? targets.map((name) => buildTarget(step, name)) : [SCOUT_DEFAULTS[command]];
    return { type: 'scout', opts: { scout: command === 'WORKER_SCOUT' ? 'worker' : 'overlord', waypoints } };
}

function addonSwapTask(step: string, args: string[]): BuildOrderTask {
    if (args.length !== 2)
        fail(step, 'ADDONSWAP needs exactly 2 structures, e.g. "21 addonswap factory barracksreactor"');
    const [host, addon] = args.map((arg) => {
        const id = own<number>(UnitType, arg.toUpperCase());
        return id !== undefined && structureTypes.includes(id) ? id : fail(step, `"${arg}" is not a structure`);
    });
    return { type: 'addonSwap', id: host, qty: 1, opts: { addon } };
}

function parseString(step: string, race: SC2APIProtocol.Race): ParsedBuildTask[] {
    const [supply, command, args] = parseHead(step);
    if (command === 'ADDONSWAP') return [[supply, addonSwapTask(step, args)]];

    let repeat = 1;
    const targets: string[] = [];
    for (const arg of args) {
        if (arg === '@') continue;
        const name = (arg.startsWith('@') ? arg.slice(1) : arg).toUpperCase();
        const count = REPEAT.exec(name);
        if (count) {
            if (Number(count[1]) > 0) repeat = Number(count[1]);
        } else {
            targets.push(name);
        }
    }
    return Array.from({ length: repeat }, () => [supply, createTask(step, command, targets, race)]);
}

function parseDict(step: Record<string, string[]>): ParsedBuildTask[] {
    return Object.entries(step).map(([head, targets]) => {
        const [supply, command] = parseHead(head);
        if (!Object.hasOwn(SCOUT_DEFAULTS, command))
            fail(head, `dict steps only support WORKER_SCOUT and OVERLORD_SCOUT`);
        if (!Array.isArray(targets)) fail(head, 'dict step targets must be a list');
        return [
            supply,
            scoutTask(
                head,
                command,
                targets.map((target) => target.toUpperCase()),
            ),
        ];
    });
}

const isTask = (step: object): step is BuildOrderTask => typeof (step as BuildOrderTask).type === 'string';

export function parseBuildOrder(
    steps: Array<BuildOrderStep | ParsedBuildTask>,
    race: SC2APIProtocol.Race,
): ParsedBuildTask[] {
    return steps.flatMap((step): ParsedBuildTask[] => {
        if (typeof step === 'string') return parseString(step, race);
        if (Array.isArray(step) || isTask(step)) return [step];
        return parseDict(step);
    });
}
