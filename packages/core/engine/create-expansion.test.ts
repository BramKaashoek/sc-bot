import { describe, expect, it } from 'bun:test';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';
import { rawUnit, toyFixture } from '../test/factories.ts';
import { Alliance } from '../constants/enums.ts';
import { UnitType } from '../constants/index.ts';

describe('createExpansion', () => {
    it('lists only the own-base resources still alive now, while the cluster keeps its start-of-game snapshot', async () => {
        const world = await createTestWorld(toyFixture());
        const [expansion] = world.resources.get().map.getExpansions();
        const { mineralFields, vespeneGeysers } = expansion.cluster;
        const gone = [mineralFields[0].tag, vespeneGeysers![0].tag];

        expect(expansion.getMineralFields().map((unit) => unit.tag)).toEqual(mineralFields.map((unit) => unit.tag));
        expect(expansion.getVespeneGeysers().map((unit) => unit.tag)).toEqual(vespeneGeysers!.map((unit) => unit.tag));

        await stepTo(world, observationAt(world, 8, { base: 0, hide: gone }));

        expect(expansion.getMineralFields().map((unit) => unit.tag)).toEqual(
            mineralFields.slice(1).map((unit) => unit.tag),
        );
        expect(expansion.getVespeneGeysers()).toHaveLength(vespeneGeysers!.length - 1);
        expect(expansion.cluster.mineralFields.map((unit) => unit.tag)).toContain(gone[0]);
        expect(expansion.cluster.vespeneGeysers!.map((unit) => unit.tag)).toContain(gone[1]);
    });

    it('skips a resource cluster with no valid townhall spot instead of failing the map setup', async () => {
        const walledIn = [16, 18, 20, 22, 24].flatMap((x) =>
            [28, 30].map((y) =>
                rawUnit({
                    alliance: Alliance.NEUTRAL,
                    owner: 16,
                    unitType: UnitType.MINERALFIELD,
                    pos: { x, y, z: 10 },
                    mineralContents: 1800,
                }),
            ),
        );
        const world = await createTestWorld(toyFixture({ units: walledIn }));

        expect(
            world.resources
                .get()
                .map.getExpansions()
                .map((expansion) => expansion.townhallPosition),
        ).toEqual([
            { x: 8, y: 17 },
            { x: 23, y: 15 },
        ]);
    });
});
