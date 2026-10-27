import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { PlayerType, Race } from '../constants/enums.ts';
import * as UnitType from '../constants/unit-type.ts';
import { clientOf, killNewSc2, newLiveEngine, sc2Pids, veryEasyZerg } from '../test/live.ts';
import { spawnUnits } from '../test/spawn-units.ts';
import type { Point2D, World } from '../types.ts';

const MAP = 'Melee/Simple64';
const SWAP_SECONDS = 30;
const GAME_SECONDS = 60;
const LOOPS_PER_SECOND = 22.4;
const LAND_TOLERANCE = 0.5;
const ADDON_OFFSET = { x: 2.5, y: -0.5 };

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

const near = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y) <= LAND_TOLERANCE;

describe.skipIf(!process.env.SC2PATH)('live flying structures', () => {
    it("addonSwap lands the barracks (with reactor) and the factory at each other's positions within 30 game s", async () => {
        let barracksTag: string | undefined;
        let factoryTag: string | undefined;
        let reactorTag: string | undefined;
        let factoryAddOn: string | undefined;
        let barracksHome: Point2D | undefined;
        let factoryHome: Point2D | undefined;
        let swapLoop: number | undefined;
        let landedLoop: number | undefined;
        let accepted: boolean | undefined;

        const agent = createAgent({
            settings: { race: Race.TERRAN },
            async onStep(world: World) {
                const { frame, placement, units, flying } = world.resources.get();
                const loop = frame.getGameLoop();

                if (!barracksTag) {
                    const first = placement.request(UnitType.BARRACKS, { flags: ['production'] });
                    const second = placement.request(UnitType.FACTORY, { flags: ['production'] });
                    if (!first || !second) return;
                    const client = clientOf(world);
                    const owner = world.agent.playerId!;
                    const [barracks] = await spawnUnits(client, { unitType: UnitType.BARRACKS, owner, pos: first });
                    const [reactor] = await spawnUnits(client, {
                        unitType: UnitType.BARRACKSREACTOR,
                        owner,
                        pos: { x: first.x + ADDON_OFFSET.x, y: first.y + ADDON_OFFSET.y },
                    });
                    const [factory] = await spawnUnits(client, { unitType: UnitType.FACTORY, owner, pos: second });
                    reactorTag = reactor.tag;
                    barracksTag = barracks.tag;
                    factoryTag = factory.tag;
                    barracksHome = first;
                    factoryHome = second;
                    return;
                }

                const barracks = units.getByTag(barracksTag);
                const factory = units.getByTag(factoryTag!);
                if (!barracks || !factory) return;

                if (swapLoop === undefined) {
                    if (!barracks.addOnTag) return;
                    accepted = flying.addonSwap(factory, UnitType.REACTOR);
                    swapLoop = loop;
                    return;
                }
                if (
                    landedLoop === undefined &&
                    barracks.unitType === UnitType.BARRACKS &&
                    factory.unitType === UnitType.FACTORY &&
                    near(barracks.pos, factoryHome!) &&
                    near(factory.pos, barracksHome!)
                ) {
                    landedLoop = loop;
                    factoryAddOn = factory.addOnTag;
                }
            },
        });
        engine = newLiveEngine(5700);
        await engine.connect();
        await engine.runGame(MAP, [{ type: PlayerType.PARTICIPANT, race: Race.TERRAN, agent }, veryEasyZerg()], {
            gameTimeLimit: GAME_SECONDS,
        });

        console.log(`flying.live swap: ${((landedLoop ?? NaN) - (swapLoop ?? NaN)) / LOOPS_PER_SECOND} game s`);
        expect(accepted).toBe(true);
        expect(landedLoop).toBeDefined();
        expect(factoryAddOn).toBe(reactorTag);
        expect((landedLoop! - swapLoop!) / LOOPS_PER_SECOND).toBeLessThanOrEqual(SWAP_SECONDS);
    }, 240_000);
});
