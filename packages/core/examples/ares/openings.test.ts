import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { Race } from '@sc-bot/core/constants/enums';
import { parseBuildOrder } from '@sc-bot/core';
import { resolveConfig } from '../../engine/config.ts';
import { createTestWorld } from '../../test/create-test-world.ts';
import { YAML } from './openings.expected.ts';

const TASKS_PER_OPENING = {
    terran: {
        race: Race.TERRAN,
        tasks: { FastCC: 13, ThreeRax: 23, OneOneOneStandard: 18, OneOneOneMineDrop: 18, ReaperOpening: 9 },
    },
    protoss: {
        race: Race.PROTOSS,
        tasks: { BasicOpener: 19, AdeptOracle: 20, AggressiveStalker: 17, OneBaseTempests: 23, PhoenixEconomic: 26 },
    },
    zerg: {
        race: Race.ZERG,
        tasks: { OneBaseMuta: 22, BroRush: 13, LingDroneRush: 5, ProxyHatch: 5, RavagerRush: 17, Ultras: 25 },
    },
};

describe('translated openings', () => {
    for (const [name, { race, tasks }] of Object.entries(TASKS_PER_OPENING)) {
        it(`loads ${name}.config.json through the config file and parses every opening for its race`, async () => {
            const config = resolveConfig(
                {},
                { file: join(import.meta.dir, 'openings', `${name}.config.json`), env: {} },
            );
            const world = await createTestWorld('blueshift', { config });
            const { openings } = world.resources.get();
            expect<unknown>(config.resources.openings).toEqual(YAML[name as keyof typeof YAML]);
            const builds = openings.getDefinitions();

            expect(
                Object.fromEntries(
                    Object.entries(builds).map(([build, { buildOrder }]) => [
                        build,
                        parseBuildOrder(buildOrder, race).length,
                    ]),
                ),
            ).toEqual(tasks);

            const choices = config.resources.openings!.choices!;
            for (const cycle of Object.values(choices)) {
                expect(cycle.filter((build) => !(build in builds))).toEqual([]);
            }
        });
    }
});
