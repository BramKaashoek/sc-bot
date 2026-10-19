import { createAgent, createEngine } from '@sc-bot/core';
import type { Unit, World } from '@sc-bot/core';

const replayPath = process.argv[2];
if (!replayPath) throw new Error('usage: bun run examples/watch-replay.ts <path-to.SC2Replay> [observedPlayerId]');

const LOG_EVERY_LOOPS = 224;

const observer = createAgent({
    async onGameStart() {
        console.log('replay started');
    },
    async onStep({ resources }: World) {
        const { frame } = resources.get();
        const loop = frame.getGameLoop();
        if (loop % LOG_EVERY_LOOPS < 4) console.log(`${frame.timeFormatted()} (loop ${loop})`);
    },
    async onUnitCreated(_world: World, unit: Unit) {
        console.log(`unit ${unit.unitType} created`);
    },
});

const engine = createEngine();
await engine.connect();

await engine.runReplay(observer, replayPath, {
    observedPlayerId: Number(process.argv[3] ?? 1),
});

engine.shutdown();
