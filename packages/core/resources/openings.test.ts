import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameResult, Race, Status } from '../constants/enums.ts';
import { createTestWorld } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { OpeningRecord, OpeningSettings } from '../types.ts';

const BUILDS = { a: { buildOrder: [] }, b: { buildOrder: [] }, c: { buildOrder: [] } };

let dir: string;
let world: TestWorld;

beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'openings-'));
    world = await createTestWorld('blueshift', { loop: 896 });
    world.agent.opponent = { id: 'opp', race: Race.ZERG };
    world.resources.get().openings.configure({ builds: BUILDS, dataDir: dir });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const historyFile = () => join(dir, 'opp-terran.json');
const ARES_RESULT = { defeat: 0, tie: 1, undecided: 1, victory: 2 };
const games = (...entries: [string, OpeningRecord['result']][]) =>
    entries.map(([opening, result]) => ({
        EnemyRace: 'Race.Zerg',
        Duration: 300,
        StrategyUsed: opening,
        Result: ARES_RESULT[result],
    }));

function choose(history?: unknown[] | string, settings: Partial<OpeningSettings> = {}, available?: string[]) {
    rmSync(historyFile(), { force: true });
    if (history !== undefined)
        writeFileSync(historyFile(), typeof history === 'string' ? history : JSON.stringify(history));
    const { openings } = world.resources.get();
    openings.configure(settings);
    world.resources.reset(world);
    return openings.choose(available);
}

describe('openings', () => {
    it('cycles: keeps the last opening after a victory, advances with wrap otherwise, else starts at the first', () => {
        expect([
            choose(),
            choose(games(['a', 'defeat'], ['b', 'victory'])),
            choose(games(['b', 'defeat'])),
            choose(games(['c', 'tie'])),
            choose(games(['z', 'defeat'])),
        ]).toEqual(['a', 'b', 'c', 'a', 'a']);
    });

    it('takes choices by opponent id, then race, Random for unknown races, else every available build', () => {
        const choices = { opp: ['c', 'missing'], Zerg: ['b'], Random: ['a'] };
        expect(choose(undefined, { choices })).toBe('c');
        world.agent.opponent = { id: 'other', race: Race.ZERG };
        expect(choose(undefined, { choices })).toBe('b');
        world.agent.opponent = { id: 'other', race: Race.RANDOM };
        expect(choose(undefined, { choices })).toBe('a');
        expect(choose(undefined, { choices: {} }, ['c', 'b'])).toBe('c');
        expect(choose(undefined, { choices: { Random: ['missing'] } })).toBeUndefined();
    });

    it('picks by winrate over the last 10 games once every build has minGames, cycling ties after the last used', () => {
        const winrate = { method: 'winrate', minGames: 2 } as const;
        const losses = (build: string, count: number) => games(...Array(count).fill([build, 'defeat']));

        const wins = (build: string, count: number) => games(...Array(count).fill([build, 'victory']));

        expect(choose([...losses('a', 1), ...wins('b', 2), ...losses('c', 2)], winrate)).toBe('a');
        expect(choose([...wins('a', 2), ...losses('b', 2), ...losses('c', 2)], winrate)).toBe('a');
        expect(
            choose(
                [...wins('a', 1), ...losses('a', 2), ...wins('b', 9), ...losses('b', 10), ...losses('c', 2)],
                winrate,
            ),
        ).toBe('a');
        expect(choose([...losses('a', 2), ...losses('c', 2), ...losses('b', 2)], winrate)).toBe('c');
        expect(
            choose([...losses('a', 2), ...losses('b', 2), ...losses('c', 2), ...games(['z', 'defeat'])], winrate),
        ).toBe('a');
        expect(choose(losses('b', 1), { method: 'winrate', minGames: 0 })).toBe('c');
        expect(
            choose([...losses('a', 11), ...wins('b', 11), ...losses('c', 11)], { method: 'winrate', minGames: 11 }),
        ).toBe('a');
    });

    it('memoizes the choice and records the game end synchronously, creating the directory', () => {
        const { openings } = world.resources.get();
        const nested = join(dir, 'nested');
        expect(choose(undefined, { dataDir: nested })).toBe('a');
        expect(openings.choose(['b'])).toBe('a');

        world.resources.endGame(world, [{ playerId: world.agent.playerId, result: GameResult.VICTORY }]);

        expect(JSON.parse(readFileSync(join(nested, 'opp-terran.json'), 'utf8'))).toEqual([
            {
                EnemyRace: 'Race.Zerg',
                Duration: Math.floor(world.resources.get().frame.time()),
                StrategyUsed: 'a',
                Result: 2,
            },
        ]);
    });

    it('treats a malformed history as empty with a warning', () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        expect(choose('{not json')).toBe('a');
        expect(warn).toHaveBeenCalledTimes(1);

        choose([...games(['b', 'defeat']), 'x', { StrategyUsed: 5, Result: 2 }, { StrategyUsed: 'a', Result: 7 }]);
        expect(world.resources.get().openings.getHistory()).toEqual([
            { race: 'Zerg', duration: 300, opening: 'b', result: 'defeat' },
        ]);
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });

    it('reads and writes nothing without dataDir or in a replay', () => {
        const { openings } = world.resources.get();
        const record = () =>
            world.resources.endGame(world, [{ playerId: world.agent.playerId, result: GameResult.DEFEAT }]);
        writeFileSync(historyFile(), JSON.stringify(games(['b', 'victory'])));

        openings.configure({ dataDir: undefined });
        world.resources.reset(world);
        expect(openings.choose()).toBe('a');
        record();

        openings.configure({ dataDir: dir });
        world.resources.reset(world);
        openings.choose();
        world.client.status = Status.IN_REPLAY;
        world.resources.step(world);
        world.client.status = Status.ENDED;
        record();

        expect(JSON.parse(readFileSync(historyFile(), 'utf8'))).toEqual(games(['b', 'victory']));
        expect(existsSync(join(dir, 'unknown-terran.json'))).toBe(false);
    });

    it('keeps settings across a game reset but not the choice or history', () => {
        const { openings } = world.resources.get();
        expect(choose(games(['b', 'victory']), { minGames: 5 })).toBe('b');

        world.resources.reset(world);

        expect([openings.getChosen(), openings.getHistory(), openings.getDefinitions()]).toEqual([
            undefined,
            [],
            BUILDS,
        ]);
        rmSync(historyFile());
        expect(openings.choose()).toBe('a');
    });
});
