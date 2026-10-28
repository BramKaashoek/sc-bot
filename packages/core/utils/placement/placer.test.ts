import { afterAll, afterEach, describe, expect, it, spyOn } from 'bun:test';
import { createAgent } from '@sc-bot/core';
import { Race } from '../../constants/enums.ts';
import { parseAresPlacements } from '../config/ares-yaml.ts';
import { createTestWorld, loadFixture } from '../../test/create-test-world.ts';
import type { PlacementTable, UserPlacement } from '../../types.ts';
import { createPlacer, loadAresProtossPlacements } from './placer.ts';

const TABLE: PlacementTable = {
    LeyLines: {
        LowerSpawn: {
            VsAll: {
                FirstPylon: [[4, 6]],
                GateKeeper: [[5.5, 7.5]],
                PylonsReaperWall: [[8, 8]],
                StaticDefencesReaperWall: [[10, 8]],
                ThreeByThreesReaperWall: [[12.5, 8.5]],
                Bogus: [[1, 1]],
            },
        },
    },
    Pylon: { LowerSpawn: { VsAll: { SupplyDepots: [[6, 8]] } } },
};

async function placementsOn(mapName: string, race: number = Race.PROTOSS, table = TABLE, opponent?: number) {
    const fixture = loadFixture('blueshift');
    fixture.gameInfo.mapName = mapName;
    const world = await createTestWorld(fixture, { agent: createAgent({}) });
    world.agent.race = race;
    if (opponent !== undefined) world.agent.opponent = { race: opponent };
    return createPlacer(table).placements!(world);
}

describe('createPlacer', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    afterEach(() => warn.mockClear());
    afterAll(() => warn.mockRestore());

    it('matches map names as ares does and maps the first pylon, gatekeeper and reaper wall keys', async () => {
        expect(await placementsOn('Ley Lines AIE')).toEqual([
            { pos: { x: 4, y: 6 }, size: '2x2', flags: ['firstPylon'] },
            { pos: { x: 5.5, y: 7.5 }, gateKeeper: true },
            { pos: { x: 8, y: 8 }, size: '2x2', flags: ['reaperWall'] },
            { pos: { x: 10, y: 8 }, size: '2x2', flags: ['staticDefence', 'reaperWall'] },
            { pos: { x: 12.5, y: 8.5 }, size: '3x3', flags: ['reaperWall'] },
        ]);
        expect(warn).toHaveBeenCalledWith('Unknown building placement key "Bogus"');
    });

    it('does not match a map that merely starts with a table name', async () => {
        expect(await placementsOn('Pylons Of Doom LE')).toEqual([]);
        expect(await placementsOn('Pylon LE', Race.TERRAN)).toHaveLength(1);
    });

    it('keeps only the keys ares consumes for the bot race', async () => {
        const table: PlacementTable = {
            Pylon: {
                LowerSpawn: {
                    VsAll: {
                        SupplyDepots: [[1, 1]],
                        Bunkers: [[2, 2]],
                        Pylons: [[3, 3]],
                        FirstPylon: [[4, 4]],
                        ProductionWall: [[5.5, 5.5]],
                        StaticDefences: [[6, 6]],
                        ThreeByThrees: [[7.5, 7.5]],
                        UpgradeStructuresWall: [[8.5, 8.5]],
                    },
                },
            },
        };
        const shared: UserPlacement[] = [
            { pos: { x: 5.5, y: 5.5 }, size: '3x3', flags: ['production', 'wall'] },
            { pos: { x: 6, y: 6 }, size: '2x2', flags: ['staticDefence'] },
            { pos: { x: 7.5, y: 7.5 }, size: '3x3', flags: [] },
            { pos: { x: 8.5, y: 8.5 }, size: '3x3', flags: [] },
        ];

        expect(await placementsOn('Pylon LE', Race.TERRAN, table)).toEqual([
            { pos: { x: 1, y: 1 }, size: '2x2', flags: ['supplyDepot'] },
            { pos: { x: 2, y: 2 }, size: '3x3', flags: ['bunker'] },
            ...shared,
        ]);
        expect(await placementsOn('Pylon LE', Race.PROTOSS, table)).toEqual([
            { pos: { x: 3, y: 3 }, size: '2x2', flags: ['wall', 'productionPylon'] },
            { pos: { x: 4, y: 4 }, size: '2x2', flags: ['firstPylon'] },
            ...shared,
        ]);
        expect(await placementsOn('Pylon LE', Race.ZERG, table)).toEqual(shared);
    });

    it('falls back to VsRandom for an opponent race that is not Zerg, Protoss or Terran', async () => {
        const table: PlacementTable = {
            Pylon: { LowerSpawn: { VsRandom: { Production: [[1.5, 1.5]] }, VsZerg: { Production: [[9.5, 9.5]] } } },
        };
        const production: UserPlacement[] = [{ pos: { x: 1.5, y: 1.5 }, size: '3x3', flags: ['production'] }];

        expect(await placementsOn('Pylon LE', Race.PROTOSS, table, Race.NORACE)).toEqual(production);
        expect(await placementsOn('Pylon LE', Race.PROTOSS, table, Race.RANDOM)).toEqual(production);
    });

    it('produces the same placements from a parsed ares YAML as from the equivalent TS table', async () => {
        const yaml = `
Ley Lines LE:
    LowerSpawn:
        VsAll:
            FirstPylon: [4, 6]
            ThreeByThreesWall:
                - [[12.5, 8.5]]
            StaticDefencesWall: [[10, 8]]
        VsZerg:
            GateKeeper: [5.5, 7.5]
`;
        const equivalent: PlacementTable = {
            'Ley Lines LE': {
                LowerSpawn: {
                    VsAll: { FirstPylon: [[4, 6]], ThreeByThreesWall: [[12.5, 8.5]], StaticDefencesWall: [[10, 8]] },
                    VsZerg: { GateKeeper: [[5.5, 7.5]] },
                },
            },
        };
        const fromYaml = await placementsOn('Ley Lines LE', Race.PROTOSS, parseAresPlacements(yaml), Race.ZERG);

        expect(fromYaml).toHaveLength(4);
        expect(fromYaml).toEqual(await placementsOn('Ley Lines LE', Race.PROTOSS, equivalent, Race.ZERG));
    });

    it('loads the shipped ares Protoss data with the unconsumed PylonsWall key dropped', () => {
        const table = loadAresProtossPlacements();

        expect(Object.keys(table)).toHaveLength(7);
        expect(table.Incorporeal.UpperSpawn!.VsZerg!.FirstPylon).toEqual([[62, 134]]);
        expect(table.Incorporeal.UpperSpawn!.VsZerg!.ThreeByThreesWall).toEqual([
            [62.5, 128.5],
            [59.5, 129.5],
            [66.5, 129.5],
        ]);
        expect(JSON.stringify(table)).not.toContain('PylonsWall');
    });
});
