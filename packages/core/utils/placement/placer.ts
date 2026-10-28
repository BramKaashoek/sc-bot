import { readFileSync } from 'node:fs';
import { Race } from '../../constants/enums.ts';
import { parseAresPlacements } from '../config/ares-yaml.ts';
import type { BuildingSize, PlacementFlag, Placer, PlacementTable, UserPlacement, World } from '../../types.ts';

type SpotKind = {
    size?: BuildingSize;
    flags?: PlacementFlag[];
    gateKeeper?: true;
    race?: (typeof Race)[keyof typeof Race];
};

export const ARES_PLACEMENT_KEYS: Readonly<Record<string, SpotKind>> = {
    SupplyDepots: { size: '2x2', flags: ['supplyDepot'], race: Race.TERRAN },
    SupplyDepotsWall: { size: '2x2', flags: ['supplyDepot', 'wall'], race: Race.TERRAN },
    Production: { size: '3x3', flags: ['production'] },
    ProductionWall: { size: '3x3', flags: ['production', 'wall'] },
    ThreeByThrees: { size: '3x3', flags: [] },
    ThreeByThreesWall: { size: '3x3', flags: ['wall'] },
    ThreeByThreesReaperWall: { size: '3x3', flags: ['reaperWall'] },
    Bunkers: { size: '3x3', flags: ['bunker'], race: Race.TERRAN },
    BunkersWall: { size: '3x3', flags: ['bunker', 'wall'], race: Race.TERRAN },
    MissileTurrets: { size: '2x2', flags: ['missileTurret'], race: Race.TERRAN },
    SensorTowers: { size: '2x2', flags: ['sensorTower'], race: Race.TERRAN },
    UpgradeStructures: { size: '3x3', flags: ['upgradeStructure'] },
    // ares lists this key in the wall set but never passes wall=True for it
    UpgradeStructuresWall: { size: '3x3', flags: [] },
    Pylons: { size: '2x2', flags: ['wall', 'productionPylon'], race: Race.PROTOSS },
    PylonsReaperWall: { size: '2x2', flags: ['reaperWall'], race: Race.PROTOSS },
    StaticDefences: { size: '2x2', flags: ['staticDefence'] },
    StaticDefencesWall: { size: '2x2', flags: ['staticDefence', 'wall'] },
    StaticDefencesReaperWall: { size: '2x2', flags: ['staticDefence', 'reaperWall'] },
    FirstPylon: { size: '2x2', flags: ['firstPylon'], race: Race.PROTOSS },
    GateKeeper: { gateKeeper: true },
};

// present in ares' shipped data but never consumed by its placement manager
export const IGNORED_PLACEMENT_KEYS: readonly string[] = ['PylonsWall'];

const RACE_KEYS: Record<number, string> = {
    [Race.PROTOSS]: 'VsProtoss',
    [Race.RANDOM]: 'VsRandom',
    [Race.TERRAN]: 'VsTerran',
    [Race.ZERG]: 'VsZerg',
};

// ares user_placement_extractor.py normalize_map_name, quirks included
export function normalizeMapName(name: string): string {
    let result = name.toLowerCase();
    for (const suffix of ['le', 'aie']) {
        if (result.endsWith(suffix)) result = result.slice(0, -suffix.length);
        else if (result.endsWith(` ${suffix}`)) result = result.slice(0, -suffix.length - 1);
    }
    return result.replaceAll(' ', '');
}

function resolvePlacements(world: World, table: PlacementTable): UserPlacement[] {
    const { frame, map } = world.resources.get();
    const gameMap = normalizeMapName(frame.getGameInfo().mapName ?? '');
    const forMap = Object.entries(table).find(([name]) => normalizeMapName(name) === gameMap)?.[1];
    if (!forMap) return [];

    const spawn = map.getLocations().self!.y > map.getLocations().enemy[0].y ? 'UpperSpawn' : 'LowerSpawn';
    const forSpawn = forMap[spawn] ?? {};
    const raceKey = RACE_KEYS[world.agent.opponent?.race ?? Race.NORACE] ?? 'VsRandom';
    const entries: Record<string, Array<[number, number]> | undefined> = { ...((raceKey && forSpawn[raceKey]) || {}) };
    for (const [key, spots] of Object.entries(forSpawn.VsAll ?? {})) {
        const own = entries[key] ?? [];
        entries[key] = [...own, ...(spots ?? []).filter(([x, y]) => !own.some(([ox, oy]) => ox === x && oy === y))];
    }

    return Object.entries(entries).flatMap(([key, spots]) => {
        if (IGNORED_PLACEMENT_KEYS.includes(key)) return [];
        const kind = ARES_PLACEMENT_KEYS[key];
        if (!kind) {
            console.warn(`Unknown building placement key "${key}"`);
            return [];
        }
        if (kind.race !== undefined && kind.race !== world.agent.race) return [];
        const { race: _race, ...spot } = kind;
        return (spots ?? []).map(([x, y]) => ({
            pos: { x, y },
            ...spot,
            ...(spot.flags && { flags: [...spot.flags] }),
        }));
    });
}

export function loadAresProtossPlacements(): PlacementTable {
    return parseAresPlacements(
        readFileSync(new URL('../../data/protoss_building_placements.yml', import.meta.url), 'utf8'),
    );
}

export const createPlacer = (table: PlacementTable): Placer => ({
    placements: (world) => resolvePlacements(world, table),
});
