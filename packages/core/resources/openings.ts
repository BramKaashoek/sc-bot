import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GameResult, Race, Status } from '../constants/enums.ts';
import type { OpeningRecord, OpeningSettings, OpeningsResource, ResourceDefinition, World } from '../types.ts';

const RECENT_GAMES = 10;

const RACE_NAMES: Record<number, string> = {
    [Race.TERRAN]: 'Terran',
    [Race.ZERG]: 'Zerg',
    [Race.PROTOSS]: 'Protoss',
};

const RESULTS: Record<number, OpeningRecord['result']> = {
    [GameResult.VICTORY]: 'victory',
    [GameResult.DEFEAT]: 'defeat',
    [GameResult.TIE]: 'tie',
};

type OpeningsState = {
    settings: OpeningSettings;
    decided: boolean;
    chosen?: string;
    history: OpeningRecord[];
    inReplay: boolean;
};

const stateByOpenings = new WeakMap<OpeningsResource, OpeningsState>();

const raceName = (race: SC2APIProtocol.Race | undefined) => RACE_NAMES[race ?? Race.NORACE] ?? 'Random';

function historyPath({ agent }: World, dataDir: string) {
    const ownRace = (RACE_NAMES[agent.race ?? Race.NORACE] ?? 'Random').toLowerCase();
    return join(dataDir, `${agent.opponent?.id ?? 'unknown'}-${ownRace}.json`);
}

const ARES_RESULTS: Record<OpeningRecord['result'], number> = { defeat: 0, tie: 1, undecided: 1, victory: 2 };
const FROM_ARES_RESULT: OpeningRecord['result'][] = ['defeat', 'tie', 'victory'];

function toRecord(entry: unknown): OpeningRecord | undefined {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const { StrategyUsed, Result, EnemyRace, Duration } = entry as Record<string, unknown>;
    if (typeof StrategyUsed !== 'string' || typeof Result !== 'number' || !FROM_ARES_RESULT[Result]) return undefined;
    return {
        race: String(EnemyRace ?? '').replace(/^Race\./, ''),
        duration: Number(Duration) || 0,
        opening: StrategyUsed,
        result: FROM_ARES_RESULT[Result],
    };
}

const toAres = ({ race, duration, opening, result }: OpeningRecord) => ({
    EnemyRace: `Race.${race}`,
    Duration: Math.floor(duration),
    StrategyUsed: opening,
    Result: ARES_RESULTS[result],
});

function readHistory(path: string): OpeningRecord[] {
    let raw: string;
    try {
        raw = readFileSync(path, 'utf8');
    } catch {
        return [];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {}
    if (!Array.isArray(parsed)) {
        console.warn(`Malformed opening history at ${path}, treating it as empty`);
        return [];
    }
    const records = parsed.flatMap((entry) => toRecord(entry) ?? []);
    if (records.length < parsed.length) {
        console.warn(`Dropped ${parsed.length - records.length} malformed opening history entries at ${path}`);
    }
    return records;
}

function chooseCycle(cycle: string[], history: OpeningRecord[]) {
    const last = history.at(-1);
    const index = last ? cycle.indexOf(last.opening) : -1;
    if (!last || index === -1) return cycle[0];
    return last.result === 'victory' ? cycle[index] : cycle[(index + 1) % cycle.length];
}

function chooseWinrate(cycle: string[], history: OpeningRecord[], minGames: number) {
    const resultsOf = (build: string) => history.filter(({ opening }) => opening === build).map(({ result }) => result);
    if (minGames > RECENT_GAMES || !cycle.every((build) => resultsOf(build).length >= minGames)) {
        return chooseCycle(cycle, history);
    }

    const winrates = cycle.map((build) => {
        const recent = resultsOf(build).slice(-RECENT_GAMES);
        return recent.length === 0 ? 0 : recent.filter((result) => result === 'victory').length / recent.length;
    });
    const best = Math.max(...winrates);
    const tied = cycle.filter((_, index) => winrates[index] === best);
    const lastIndex = tied.indexOf(history.at(-1)?.opening ?? '');
    return lastIndex === -1 ? tied[0] : tied[(lastIndex + 1) % tied.length];
}

export const openingsResource: ResourceDefinition<'openings'> = {
    name: 'openings',
    create(world) {
        const state: OpeningsState = {
            settings: { builds: {}, choices: {}, method: 'cycle', minGames: 3 },
            decided: false,
            history: [],
            inReplay: false,
        };

        const openings: OpeningsResource = {
            configure(next) {
                Object.assign(state.settings, next);
            },
            getDefinitions() {
                return state.settings.builds;
            },
            choose(available = Object.keys(state.settings.builds)) {
                if (state.decided) return state.chosen;
                state.decided = true;

                const { choices, dataDir, method, minGames } = state.settings;
                const { opponent } = world.agent;
                const listed =
                    (opponent?.id !== undefined && choices[opponent.id]) || choices[raceName(opponent?.race)];
                const cycle = (listed ?? available).filter((name) => available.includes(name));
                if (cycle.length === 0) return undefined;

                if (dataDir !== undefined) state.history = readHistory(historyPath(world, dataDir));
                state.chosen =
                    method === 'winrate'
                        ? chooseWinrate(cycle, state.history, minGames)
                        : chooseCycle(cycle, state.history);
                return state.chosen;
            },
            getChosen() {
                return state.chosen;
            },
            getHistory() {
                return state.history;
            },
        };
        stateByOpenings.set(openings, state);
        return openings;
    },
    reset(openings) {
        const state = stateByOpenings.get(openings)!;
        state.decided = false;
        state.chosen = undefined;
        state.history = [];
        state.inReplay = false;
    },
    onStep(openings, world) {
        const state = stateByOpenings.get(openings)!;
        state.inReplay ||= world.resources.get().actions._client.status === Status.IN_REPLAY;
    },
    onGameEnd(openings, world, results) {
        const state = stateByOpenings.get(openings)!;
        const { dataDir } = state.settings;
        const replay = state.inReplay || world.resources.get().actions._client.status === Status.IN_REPLAY;
        if (dataDir === undefined || state.chosen === undefined || replay) return;

        const { agent, resources } = world;
        const own = results.find(({ playerId }) => playerId === agent.playerId)?.result;
        state.history.push({
            race: raceName(agent.opponent?.race),
            duration: resources.get().frame.time(),
            opening: state.chosen,
            result: RESULTS[own ?? GameResult.UNDECIDED] ?? 'undecided',
        });
        const path = historyPath(world, dataDir);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(state.history.map(toAres)));
    },
};
