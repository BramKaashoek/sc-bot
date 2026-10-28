import { describe, expect, it } from 'bun:test';
import { createAgent, createPlacer } from '@sc-bot/core';
import type { Placement, PlacementTable } from '@sc-bot/core';
import { Race } from '@sc-bot/core/constants/enums';
import { createTestWorld, loadFixture } from '../../test/create-test-world.ts';
import { natGatekeeper, nextFirstPylon, placerFromYaml } from './custom-building-placements.ts';

const TABLE: PlacementTable = {
    Blueshift: {
        LowerSpawn: {
            VsAll: {
                SupplyDepots: [[6, 8]],
                SupplyDepotsWall: [[4, 14]],
                Production: [[8.5, 5.5]],
                UpgradeStructures: [[14.5, 5.5]],
                BunkersWall: [[20.5, 5.5]],
                ThreeByThreesWall: [[8.5, 23.5]],
                MissileTurrets: [[12, 2]],
                SensorTowers: [[26, 6]],
                PylonsWall: [[22, 8]],
                StaticDefencesWall: [[24, 12]],
            },
            VsZerg: { Production: [[8.5, 8.5]], SupplyDepots: [[6, 10]] },
        },
        UpperSpawn: { VsAll: { SupplyDepots: [[12, 4]] } },
    },
};

const customSpots = (placements: Placement[]) =>
    placements.map(({ pos, size, flags }) => ({ pos, size, flags: [...flags] }));

async function worldVs(opponent: number) {
    const fixture = loadFixture('blueshift');
    const enemy = fixture.gameInfo.playerInfo!.find(({ playerId }) => playerId !== 1)!;
    enemy.raceRequested = opponent;
    const agent = createAgent({
        async onGameStart({ resources }) {
            resources.set({ placer: createPlacer(TABLE) });
        },
    });
    return createTestWorld(fixture, { agent });
}

const YAML = `
Blueshift:
  LowerSpawn:
    VsAll:
      FirstPylon:
        - [ [ 12.0, 40.0 ] ]
      GateKeeper:
        - [ [ 16.0, 38.0 ] ]
`;

describe('custom-building-placements example', () => {
    it('maps every key to its size and flags, picking the entries for the spawn side only', async () => {
        const world = await worldVs(Race.PROTOSS);
        const spots = world.resources.get().placement.getPlacements({ flag: 'custom' });

        expect(customSpots(spots)).toEqual([
            { pos: { x: 6, y: 8 }, size: '2x2', flags: ['custom', 'supplyDepot'] },
            { pos: { x: 4, y: 14 }, size: '2x2', flags: ['custom', 'supplyDepot', 'wall'] },
            { pos: { x: 8.5, y: 5.5 }, size: '3x3', flags: ['custom', 'production'] },
            { pos: { x: 14.5, y: 5.5 }, size: '3x3', flags: ['custom', 'upgradeStructure'] },
            { pos: { x: 20.5, y: 5.5 }, size: '3x3', flags: ['custom', 'bunker', 'wall'] },
            { pos: { x: 8.5, y: 23.5 }, size: '3x3', flags: ['custom', 'wall'] },
            { pos: { x: 12, y: 2 }, size: '2x2', flags: ['custom', 'missileTurret'] },
            { pos: { x: 26, y: 6 }, size: '2x2', flags: ['custom', 'sensorTower'] },
            { pos: { x: 24, y: 12 }, size: '2x2', flags: ['custom', 'staticDefence', 'wall'] },
        ]);
    });

    it('lets an opponent race entry win and come first for the keys it names, then appends the VsAll spots', async () => {
        const world = await worldVs(Race.ZERG);
        const spots = world.resources.get().placement.getPlacements({ flag: 'custom' });

        expect(customSpots(spots)).toEqual([
            { pos: { x: 8.5, y: 8.5 }, size: '3x3', flags: ['custom', 'production'] },
            { pos: { x: 8.5, y: 5.5 }, size: '3x3', flags: ['custom', 'production'] },
            { pos: { x: 6, y: 10 }, size: '2x2', flags: ['custom', 'supplyDepot'] },
            { pos: { x: 6, y: 8 }, size: '2x2', flags: ['custom', 'supplyDepot'] },
            { pos: { x: 4, y: 14 }, size: '2x2', flags: ['custom', 'supplyDepot', 'wall'] },
            { pos: { x: 14.5, y: 5.5 }, size: '3x3', flags: ['custom', 'upgradeStructure'] },
            { pos: { x: 20.5, y: 5.5 }, size: '3x3', flags: ['custom', 'bunker', 'wall'] },
            { pos: { x: 8.5, y: 23.5 }, size: '3x3', flags: ['custom', 'wall'] },
            { pos: { x: 12, y: 2 }, size: '2x2', flags: ['custom', 'missileTurret'] },
            { pos: { x: 26, y: 6 }, size: '2x2', flags: ['custom', 'sensorTower'] },
            { pos: { x: 24, y: 12 }, size: '2x2', flags: ['custom', 'staticDefence', 'wall'] },
        ]);
    });

    it('loads FirstPylon and GateKeeper from ares YAML text, and the first pylon request takes the FirstPylon spot', async () => {
        const fixture = loadFixture('blueshift');
        fixture.gameInfo.playerInfo!.find(({ playerId }) => playerId === 1)!.raceRequested = Race.PROTOSS;
        fixture.gameInfo.playerInfo!.find(({ playerId }) => playerId === 1)!.raceActual = Race.PROTOSS;
        const agent = createAgent({
            settings: { race: Race.PROTOSS },
            async onGameStart({ resources }) {
                resources.set({ placer: placerFromYaml(YAML) });
            },
        });
        const world = await createTestWorld(fixture, { agent });

        expect([nextFirstPylon(world), natGatekeeper(world)]).toEqual([
            { x: 12, y: 40 },
            { x: 16, y: 38 },
        ]);
    });
});
