import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ability, UnitType } from '../constants/index.ts';
import { Alliance } from '../constants/enums.ts';
import { loadFixture } from './create-test-world.ts';
import { createFakeClient, pathingKey, placementKey } from './fake-client.ts';
import { observation, rawUnit, toyFixture } from './factories.ts';

type RockPlacements = {
    unitType: number;
    pos: SC2APIProtocol.Point;
    placements: [x: number, y: number, result: number][];
};

const PATHING_TOLERANCE = 0.1;
const SUCCESS = 1;
const CANT_BUILD_LOCATION_INVALID = 44;

// simple64: the engine accepts footprints poking past the top map edge; acropolis 20.5,25.5 starts inside a rock, which the engine walks out of
const BLUESHIFT_PATHING_DRIFT = ['0:61.5,65.5->9.5,71.5', '0:42.5,116.5->59.5,105.5'];
const KNOWN_DRIFT: Record<string, string[]> = {
    simple64: [
        '0:319@44,64',
        '0:319@50,64',
        '0:319@53,64',
        '0:321@50.5,64.5',
        '0:321@53.5,64.5',
        '0:881@44,64',
        '0:881@50,64',
        '0:881@53,64',
    ],
    acropolis: [
        '0:10.5,65.5->91.5,61.5',
        '0:66.5,27.5->90.5,55.5',
        '0:52.5,106.5->93.5,93.5',
        '0:20.5,25.5->8.5,59.5',
        '0:12.5,69.5->85.5,34.5',
    ],
    blueshift: BLUESHIFT_PATHING_DRIFT,
    'blueshift-zerg': BLUESHIFT_PATHING_DRIFT,
    'blueshift-protoss': BLUESHIFT_PATHING_DRIFT,
};

describe('fake client', () => {
    it('answers placement from grid and footprints, pathing by any-angle length, preferring engine answers recorded at the current loop', async () => {
        const fixture = toyFixture();
        const units = fixture.observations[0].observation!.rawData!.units!;
        const worker = units.find((unit) => unit.unitType === UnitType.SCV)!;
        const depotAt = (x: number, y: number) => ({ abilityId: Ability.BUILD_SUPPLYDEPOT, targetPos: { x, y } });
        fixture.queries = {
            0: [
                {
                    request: { placements: [depotAt(16, 16)] },
                    response: { placements: [{ result: CANT_BUILD_LOCATION_INVALID }] },
                },
            ],
        };
        fixture.abilities = {
            0: { [worker.tag!]: [Ability.MOVE] },
            8: { [worker.tag!]: [Ability.MOVE, Ability.BUILD_SUPPLYDEPOT] },
        };
        const client = createFakeClient({ fixture });
        const query = {
            placements: [depotAt(16, 16), depotAt(9, 17), depotAt(1, 16)],
            pathing: [
                { startPos: { x: 12, y: 4 }, endPos: { x: 20, y: 4 } },
                { startPos: { x: 4.5, y: 4.5 }, endPos: { x: 20.5, y: 10.5 } },
            ],
            abilities: [{ unitTag: worker.tag }],
        };
        const answer = (firstPlacement: number, abilityIds: number[]) => ({
            pathing: [{ distance: 8 }, { distance: Math.hypot(16, 6) }],
            abilities: [
                {
                    unitTag: worker.tag,
                    unitTypeId: UnitType.SCV,
                    abilities: abilityIds.map((abilityId) => ({ abilityId })),
                },
            ],
            placements: [firstPlacement, CANT_BUILD_LOCATION_INVALID, CANT_BUILD_LOCATION_INVALID].map((result) => ({
                result,
            })),
        });

        const atStart = await client.query(query);
        client.setObservation(observation({ gameLoop: 12, units }));
        const later = await client.query(query);

        expect([atStart, later]).toEqual([
            answer(CANT_BUILD_LOCATION_INVALID, [Ability.MOVE]),
            answer(SUCCESS, [Ability.MOVE, Ability.BUILD_SUPPLYDEPOT]),
        ]);
    });

    it.each(Object.entries(KNOWN_DRIFT))(
        "computes the engine's recorded %s answers except for the known drift",
        async (fixtureName, knownDrift) => {
            const fixture = loadFixture(fixtureName);
            const client = createFakeClient({ fixture, recordedAnswers: false });
            const drift: string[] = [];
            let compared = 0;

            for (const [loop, records] of Object.entries(fixture.queries!)) {
                client.setObservation(fixture.observations[Number(loop)]);
                for (const { request, response } of records) {
                    const answer = await client.query(request);
                    (request.placements ?? []).forEach((placement, index) => {
                        compared += 1;
                        if (answer.placements![index].result !== (response.placements![index].result ?? 1))
                            drift.push(`${loop}:${placementKey(placement)}`);
                    });
                    (request.pathing ?? []).forEach((path, index) => {
                        compared += 1;
                        const expected = response.pathing![index].distance ?? 0;
                        const computed = answer.pathing![index].distance ?? 0;
                        if (
                            Math.abs(computed - expected) > expected * PATHING_TOLERANCE ||
                            (expected === 0) !== (computed === 0)
                        )
                            drift.push(`${loop}:${pathingKey(path)}`);
                    });
                }
            }

            expect(compared).toBeGreaterThan(1000);
            expect(drift).toEqual(knownDrift);
        },
        30_000,
    );

    it("blocks the cells the engine refused around each debug-spawned destructible rock, except the 4x4 rock's rounded corners", async () => {
        const fixture = loadFixture('simple64');
        const client = createFakeClient({ fixture, recordedAnswers: false });
        const rocks: RockPlacements[] = JSON.parse(
            readFileSync(join(import.meta.dir, '..', 'fixtures', 'simple64', 'rock-placements.json'), 'utf8'),
        );
        const drift: string[] = [];

        for (const { unitType, pos, placements } of rocks) {
            client.setObservation(
                observation({
                    mapSize: fixture.gameInfo.startRaw!.mapSize,
                    units: [rawUnit({ unitType, pos, owner: 0, alliance: Alliance.NEUTRAL })],
                }),
            );
            const answer = await client.query({
                placements: placements.map(([x, y]) => ({
                    abilityId: Ability.BUILD_SENSORTOWER,
                    targetPos: { x: x + 0.5, y: y + 0.5 },
                })),
            });
            placements.forEach(([x, y, result], index) => {
                if (answer.placements![index].result !== result) drift.push(`${unitType}@${x},${y}`);
            });
        }

        expect(rocks.map(({ unitType }) => unitType)).toEqual([
            UnitType.DESTRUCTIBLEROCK2X4VERTICAL,
            UnitType.DESTRUCTIBLEROCK2X4HORIZONTAL,
            UnitType.DESTRUCTIBLEROCK2X6VERTICAL,
            UnitType.DESTRUCTIBLEROCK2X6HORIZONTAL,
            UnitType.DESTRUCTIBLEROCK4X4,
        ]);
        expect(drift).toEqual(
            ['17,23', '20,23', '17,26', '20,26'].map((cell) => `${UnitType.DESTRUCTIBLEROCK4X4}@${cell}`),
        );
    });
});
