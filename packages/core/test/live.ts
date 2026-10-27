import { spawnSync } from 'node:child_process';
import createEngine from '../engine/create-engine.ts';
import { Difficulty, PlayerType, Race } from '../constants/enums.ts';
import type { World } from '../types.ts';

export type LiveClient = NodeSC2Proto.ProtoClient & {
    step: (request: { count: number }) => Promise<unknown>;
    debug: (request: SC2APIProtocol.RequestDebug) => Promise<unknown>;
    observation: () => Promise<SC2APIProtocol.ResponseObservation>;
};

// SC2 renames its main thread, so -x SC2_x64 never matches a running instance
export const sc2Pids = () =>
    new Set(
        spawnSync('pgrep', ['-f', '[V]ersions/Base[0-9]*/SC2_x64'])
            .stdout.toString()
            .split('\n')
            .filter((line) => line.trim())
            .map(Number),
    );

// the engine doesn't expose its SC2 pid, so live suites must not run in parallel with other SC2 sessions
export const killNewSc2 = (before: Set<number>) =>
    [...sc2Pids()]
        .filter((pid) => !before.has(pid))
        .forEach((pid) => {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {}
        });

export const clientOf = (world: World) => world.resources.get().actions._client as unknown as LiveClient;

export const veryEasyZerg = () => ({
    type: PlayerType.COMPUTER,
    race: Race.ZERG,
    difficulty: Difficulty.VERYEASY,
});

export const newLiveEngine = (port: number, gameStep?: number) =>
    createEngine({ port, ...(gameStep ? { config: { gameStep } } : {}) });

export { Race };
