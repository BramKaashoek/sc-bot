import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { Ability } from '../constants/index.ts';
import { PlayerType, Race } from '../constants/enums.ts';
import { clientOf, killNewSc2, newLiveEngine, sc2Pids, veryEasyZerg } from '../test/live.ts';
import type { World } from '../types.ts';

const MAPS: Record<string, string> = {
    simple64: 'Melee/Simple64',
    blueshift: 'Ladder2018Season4/BlueshiftLE',
};
const MAX_REJECTED = 0.02;
const ADDON_OFFSET = { x: 2.5, y: -0.5 };
const SUCCESS = 1;

type Spot = { label: string; abilityId: number; targetPos: { x: number; y: number } };

let engine: ReturnType<typeof newLiveEngine> | undefined;
let sc2PidsBefore = new Set<number>();

beforeEach(() => {
    sc2PidsBefore = sc2Pids();
});

afterEach(() => {
    try {
        engine?.shutdown();
    } catch {}
    killNewSc2(sc2PidsBefore);
});

const spotsOf = (world: World): Spot[] =>
    world.resources
        .get()
        .placement.getPlacements()
        .flatMap(({ pos, size }): Spot[] => {
            const label = `${size}@${pos.x},${pos.y}`;
            if (size === '2x2') return [{ label, abilityId: Ability.BUILD_SUPPLYDEPOT, targetPos: pos }];
            if (size !== '3x3') return [];
            return [
                { label, abilityId: Ability.BUILD_BARRACKS, targetPos: pos },
                {
                    label: `addon of ${label}`,
                    abilityId: Ability.BUILD_SUPPLYDEPOT,
                    targetPos: { x: pos.x + ADDON_OFFSET.x, y: pos.y + ADDON_OFFSET.y },
                },
            ];
        });

describe.skipIf(!process.env.SC2PATH)('live placement solver', () => {
    it.each(Object.keys(MAPS))(
        'every solved Terran spot on %s is accepted by query.placements (3x3 with its addon spot), at most 2% rejected',
        async (mapName) => {
            let results: { label: string; result: number | undefined }[] | undefined;
            const agent = createAgent({
                settings: { race: Race.TERRAN },
                async onStep(world: World) {
                    if (results) return;
                    const spots = spotsOf(world);
                    if (spots.length === 0) return;
                    results = [];
                    const { placements } = await clientOf(world).query({
                        placements: spots.map(({ abilityId, targetPos }) => ({ abilityId, targetPos })),
                    });
                    results = spots.map(({ label }, index) => ({ label, result: placements![index].result }));
                },
            });
            engine = newLiveEngine(5500 + Object.keys(MAPS).indexOf(mapName) * 2);
            await engine.connect();
            await engine.runGame(
                MAPS[mapName],
                [{ type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent }, veryEasyZerg()],
                { gameTimeLimit: 5 },
            );

            const queried = results ?? [];
            const rejected = queried.filter(({ result }) => result !== SUCCESS);
            console.log(
                `placement.live ${mapName}: ${queried.length} spots, ${rejected.length} rejected`,
                rejected.map(({ label, result }) => `${label}=${result}`),
            );
            expect(queried.length).toBeGreaterThan(0);
            expect(rejected.length / queried.length).toBeLessThanOrEqual(MAX_REJECTED);
        },
        180_000,
    );
});
