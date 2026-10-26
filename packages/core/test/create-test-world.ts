import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import createEngine from '../engine/create-engine.ts';
import createAgent from '../agent/create-agent.ts';
import { createFakeClient } from './fake-client.ts';
import type { FakeClient, FakeClientOptions, Fixture } from './fake-client.ts';
import type { Agent, CoreConfigInput, Engine, World } from '../types.ts';

export type TestWorld = World & { client: FakeClient; engine: Engine };

export type TestWorldOptions = {
    loop?: number;
    agent?: Agent;
    onQuery?: FakeClientOptions['onQuery'];
    config?: CoreConfigInput;
};

const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures');

const readJson = (path: string) =>
    JSON.parse(readFileSync(path, 'utf8'), (key, value) =>
        key === 'data' && typeof value === 'string' ? Uint8Array.from(Buffer.from(value, 'base64')) : value,
    );

export function loadFixture(mapName: string): Fixture {
    const dir = join(FIXTURES_DIR, mapName);
    const files = readdirSync(dir);
    const observations = Object.fromEntries(
        files
            .map((file) => /^obs-(\d+)\.json$/.exec(file))
            .filter((match) => match !== null)
            .map((match) => [Number(match[1]), readJson(join(dir, match[0]))]),
    );

    return {
        gameInfo: readJson(join(dir, 'gameInfo.json')),
        data: readJson(join(FIXTURES_DIR, 'data.json')),
        observations,
        abilities: files.includes('abilities.json') ? readJson(join(dir, 'abilities.json')) : undefined,
        queries: files.includes('queries.json') ? readJson(join(dir, 'queries.json')) : undefined,
    };
}

export async function stepTo(world: TestWorld, next: SC2APIProtocol.ResponseObservation | number): Promise<void> {
    const { client, engine } = world;
    const responseObservation = typeof next === 'number' ? client.fixture.observations[next] : next;
    if (!responseObservation) throw new Error(`fixture has no observation for loop ${next}`);

    client.setObservation(responseObservation);
    await client.step({ count: 1 });

    world.resources.get().events.write({
        name: 'step',
        type: 'all',
        data: responseObservation.observation!.gameLoop,
    });

    await engine.dispatch();
}

export async function createTestWorld(
    fixtureOrMapName: Fixture | string,
    { loop, agent = createAgent(), onQuery, config }: TestWorldOptions = {},
): Promise<TestWorld> {
    const fixture = typeof fixtureOrMapName === 'string' ? loadFixture(fixtureOrMapName) : fixtureOrMapName;
    const startLoop = loop ?? Math.min(...Object.keys(fixture.observations).map(Number));
    const responseObservation = fixture.observations[startLoop];
    if (!responseObservation) throw new Error(`fixture has no observation for loop ${startLoop}`);

    const client = createFakeClient({ fixture, onQuery });
    client.setObservation(responseObservation);

    const engine = createEngine({ client, launch: false, configFile: false, config });
    const world: TestWorld = Object.assign(engine.getWorld(), { client, engine });
    world.agent = agent;
    agent.playerId ??= responseObservation.observation?.playerCommon?.playerId;

    await engine.setupGame();
    await stepTo(world, responseObservation);

    return world;
}
