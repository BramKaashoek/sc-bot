import { describe, expect, it } from 'bun:test';
import { TRAIN_MARINE, TRAIN_SCV } from '@sc-bot/core/constants/ability';
import { Alliance, DisplayType } from '@sc-bot/core/constants/enums';
import { vespeneGeyserTypes } from '@sc-bot/core/constants/groups';
import { BARRACKS, COMMANDCENTER, FACTORY, REFINERY, SCV, SUPPLYDEPOT } from '@sc-bot/core/constants/unit-type';
import { createTestWorld, loadFixture } from '../../test/create-test-world.ts';
import { observation, rawUnit } from '../../test/factories.ts';
import { createBot } from './managing-production.ts';

const MAIN_RADIUS = 20;

async function stepWith({
    foodCap,
    foodUsed,
    foodWorkers,
    refineries = 0,
    barracksBusy = false,
}: {
    foodCap: number;
    foodUsed: number;
    foodWorkers: number;
    refineries?: number;
    barracksBusy?: boolean;
}) {
    const fixture = loadFixture('blueshift');
    const { x, y } = fixture.gameInfo.startRaw!.startLocations![0];
    // the base sits on the fixture's enemy start, where its minerals are snapshots the miner can't use
    const neutral = fixture.observations[0]
        .observation!.rawData!.units!.filter(({ alliance }) => alliance === Alliance.NEUTRAL)
        .map((unit) => ({ ...unit, displayType: DisplayType.VISIBLE }));
    const geysers = neutral.filter(
        ({ unitType, pos }) => vespeneGeyserTypes.includes(unitType!) && Math.hypot(pos!.x! - x!, pos!.y! - y!) < 10,
    );
    fixture.observations = {
        0: observation({
            mapSize: fixture.gameInfo.startRaw!.mapSize,
            playerCommon: { minerals: 1000, vespene: 0, foodCap, foodUsed, foodWorkers },
            units: [
                ...neutral,
                rawUnit({ tag: 'cc', unitType: COMMANDCENTER, pos: { x: x!, y: y!, z: 10 } }),
                rawUnit({
                    tag: 'rax',
                    unitType: BARRACKS,
                    pos: { x: x! + 6, y: y!, z: 10 },
                    orders: barracksBusy ? [{ abilityId: TRAIN_MARINE, progress: 0.1 }] : [],
                }),
                rawUnit({ tag: 'depot', unitType: SUPPLYDEPOT, pos: { x: x! - 6, y: y!, z: 10 } }),
                rawUnit({ tag: 'scv', unitType: SCV, pos: { x: x! - 3, y: y!, z: 10 } }),
                ...geysers
                    .slice(0, refineries)
                    .map(({ pos }, index) => rawUnit({ tag: `refinery-${index}`, unitType: REFINERY, pos })),
            ],
        }),
    };
    fixture.observations[0].observation!.score = {
        scoreDetails: { collectionRateMinerals: 1000, collectionRateVespene: 1000 },
    } as SC2APIProtocol.Score;
    const world = await createTestWorld(fixture, { agent: createBot() });
    const trained = world.client.sent.actions
        .flatMap(({ actions }) => actions ?? [])
        .map(({ actionRaw }) => actionRaw!.unitCommand!)
        .filter(({ unitTags }) => !unitTags!.includes('scv'))
        .map(({ abilityId }) => abilityId);
    const builds = world.resources
        .get()
        .buildings.getTracked()
        .map(({ unitType, target, workerTag, geyserTag }) => ({
            unitType,
            workerTag,
            inMain: Math.hypot(target.x - x!, target.y - y!) < MAIN_RADIUS,
            geyserTag,
        }));
    return { world, trained, builds, geysers };
}

describe('managing-production example', () => {
    it('enables mining at game start', async () => {
        const { world } = await stepWith({ foodCap: 100, foodUsed: 20, foodWorkers: 12 });
        expect(world.resources.get().mining.isEnabled()).toBe(true);
    });

    it('builds a depot in the main before workers or army when supply is short', async () => {
        const { trained, builds } = await stepWith({ foodCap: 15, foodUsed: 14, foodWorkers: 12 });
        expect(trained).toEqual([]);
        expect(builds).toEqual([{ unitType: SUPPLYDEPOT, workerTag: 'scv', inMain: true, geyserTag: undefined }]);
    });

    it('trains workers before army while under 48 workers', async () => {
        const { trained, builds } = await stepWith({ foodCap: 100, foodUsed: 20, foodWorkers: 12 });
        expect(trained).toEqual([TRAIN_SCV]);
        expect(builds).toEqual([]);
    });

    it('takes a free geyser while under 8 refineries', async () => {
        const { trained, builds, geysers } = await stepWith({
            foodCap: 200,
            foodUsed: 60,
            foodWorkers: 48,
            refineries: 1,
        });
        expect(trained).toEqual([]);
        expect(builds).toEqual([{ unitType: REFINERY, workerTag: 'scv', inMain: true, geyserTag: geysers[1].tag }]);
    });

    it('moves on to army once 48 workers exist and no geyser is free', async () => {
        const { trained, builds } = await stepWith({ foodCap: 200, foodUsed: 60, foodWorkers: 48, refineries: 2 });
        expect(trained).toEqual([TRAIN_MARINE]);
        expect(builds).toEqual([]);
    });

    it('techs toward the composition in the main when nothing can be trained', async () => {
        const { trained, builds } = await stepWith({
            foodCap: 200,
            foodUsed: 60,
            foodWorkers: 48,
            refineries: 2,
            barracksBusy: true,
        });
        expect(trained).toEqual([]);
        expect(builds).toEqual([{ unitType: FACTORY, workerTag: 'scv', inMain: true, geyserTag: undefined }]);
    });
});
