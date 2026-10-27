import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import createEngine from './create-engine.ts';
import { Alliance, Difficulty, PlayerType, Race } from '../constants/enums.ts';
import { ATTACKING, BUILDING, GATHERING } from '../constants/unit-role.ts';
import { createBot, MACRO_OWNER } from '../examples/behaviors-bot.ts';
import type { CommandResult, World } from '../types.ts';

const GAME_SECONDS = 8 * 60;
const MIN_SUPPLY = 60;
const MIN_TOWNHALLS = 2;
const OWNERS = [MACRO_OWNER, `role:${ATTACKING}`, `role:${BUILDING}`, `role:${GATHERING}`];

let engine: ReturnType<typeof createEngine> | undefined;
let sc2PidsBefore = new Set<number>();

const sc2Pids = () =>
    new Set(
        spawnSync('pgrep', ['-f', '[V]ersions/Base[0-9]*/SC2_x64'])
            .stdout.toString()
            .split('\n')
            .filter((line) => line.trim())
            .map(Number),
    );

beforeEach(() => {
    sc2PidsBefore = sc2Pids();
});

afterEach(() => {
    try {
        engine?.shutdown();
    } catch {}
    [...sc2Pids()]
        .filter((pid) => !sc2PidsBefore.has(pid))
        .forEach((pid) => {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {}
        });
});

describe.skipIf(!process.env.SC2PATH)('live behaviors sample bot', () => {
    it('macros to 60 supply, expands and upgrades vs Easy AI, every command owned by a controller or behavior', async () => {
        const bot = createBot();
        const owners = new Set<string>();
        let reader: string | undefined;
        let last = { supply: 0, townhalls: 0, upgrades: 0 };
        const seen = new Map<string, number>();
        let lost = 0;
        const onStep = bot.onStep!.bind(bot);
        bot.onStep = async (world: World) => {
            const { events, units } = world.resources.get();
            reader ??= events.createReader();
            await onStep(world);
            events
                .read(reader)
                .filter(({ name }) => name === 'commandResults')
                .flatMap(({ data }) => data as CommandResult[])
                .forEach(({ owner }) => owners.add(owner));
            const alive = new Set<string>();
            units.getAlive(Alliance.SELF).forEach((u) => {
                alive.add(u.tag);
                if (!u.isStructure() && !u.isWorker()) seen.set(u.tag, u.unitType!);
            });
            seen.forEach((_, tag) => {
                if (!alive.has(tag)) {
                    lost += 1;
                    seen.delete(tag);
                }
            });
            last = {
                supply: bot.foodUsed ?? 0,
                townhalls: units.getBases().length,
                upgrades: bot.upgradeIds?.length ?? 0,
            };
        };

        engine = createEngine({ port: 5400 });
        await engine.connect();
        await engine.runGame(
            'Melee/Simple64',
            [
                { type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent: bot },
                { type: PlayerType.COMPUTER, race: Race.ZERG, difficulty: Difficulty.EASY },
            ],
            { gameTimeLimit: GAME_SECONDS },
        );

        console.log(`LIVE ${JSON.stringify({ ...last, owners: [...owners], lost })}`);
        expect(last.supply).toBeGreaterThanOrEqual(MIN_SUPPLY);
        expect(last.townhalls).toBeGreaterThanOrEqual(MIN_TOWNHALLS);
        expect(last.upgrades).toBeGreaterThanOrEqual(1);
        expect([...owners].filter((owner) => !OWNERS.includes(owner))).toEqual([]);
    }, 900_000);
});
