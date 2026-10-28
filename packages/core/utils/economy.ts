import { UnitType } from '../constants/index.ts';
import { techAlias } from '../constants/dicts/tech-alias.ts';
import { researchRequirements } from '../constants/dicts/research-requirements.ts';
import type { Cost, World } from '../types.ts';

const EQUIVALENTS_FOR_TECH_PROGRESS: Record<number, number[]> = {
    [UnitType.GATEWAY]: [UnitType.WARPGATE],
    [UnitType.WARPPRISM]: [UnitType.WARPPRISMPHASING],
    [UnitType.OBSERVER]: [UnitType.OBSERVERSIEGEMODE],
    [UnitType.SUPPLYDEPOT]: [UnitType.SUPPLYDEPOTLOWERED, UnitType.SUPPLYDEPOTDROP],
    [UnitType.BARRACKS]: [UnitType.BARRACKSFLYING],
    [UnitType.FACTORY]: [UnitType.FACTORYFLYING],
    [UnitType.STARPORT]: [UnitType.STARPORTFLYING],
    [UnitType.COMMANDCENTER]: [
        UnitType.COMMANDCENTERFLYING,
        UnitType.PLANETARYFORTRESS,
        UnitType.ORBITALCOMMAND,
        UnitType.ORBITALCOMMANDFLYING,
    ],
    [UnitType.ORBITALCOMMAND]: [UnitType.ORBITALCOMMANDFLYING],
    [UnitType.HELLION]: [UnitType.HELLIONTANK],
    [UnitType.WIDOWMINE]: [UnitType.WIDOWMINEBURROWED],
    [UnitType.SIEGETANK]: [UnitType.SIEGETANKSIEGED],
    [UnitType.THOR]: [UnitType.THORAP],
    [UnitType.VIKINGFIGHTER]: [UnitType.VIKINGASSAULT],
    [UnitType.LIBERATOR]: [UnitType.LIBERATORAG],
    [UnitType.LAIR]: [UnitType.HIVE],
    [UnitType.HATCHERY]: [UnitType.LAIR, UnitType.HIVE],
    [UnitType.SPIRE]: [UnitType.GREATERSPIRE],
    [UnitType.SPINECRAWLER]: [UnitType.SPINECRAWLERUPROOTED],
    [UnitType.SPORECRAWLER]: [UnitType.SPORECRAWLERUPROOTED],
    [UnitType.OVERLORD]: [UnitType.OVERLORDTRANSPORT],
    [UnitType.OVERSEER]: [UnitType.OVERSEERSIEGEMODE],
    [UnitType.DRONE]: [UnitType.DRONEBURROWED],
    [UnitType.ZERGLING]: [UnitType.ZERGLINGBURROWED],
    [UnitType.ROACH]: [UnitType.ROACHBURROWED],
    [UnitType.RAVAGER]: [UnitType.RAVAGERBURROWED],
    [UnitType.HYDRALISK]: [UnitType.HYDRALISKBURROWED],
    [UnitType.LURKERMP]: [UnitType.LURKERMPBURROWED],
    [UnitType.SWARMHOSTMP]: [UnitType.SWARMHOSTBURROWEDMP],
    [UnitType.INFESTOR]: [UnitType.INFESTORBURROWED],
    [UnitType.ULTRALISK]: [UnitType.ULTRALISKBURROWED],
};

// python-sc2 TRAIN_INFO requires_techlab; 4.10 data lacks the TECHLAB requirement for GHOST/THOR/BATTLECRUISER
export const REQUIRES_TECHLAB = [
    UnitType.MARAUDER,
    UnitType.GHOST,
    UnitType.CYCLONE,
    UnitType.SIEGETANK,
    UnitType.THOR,
    UnitType.BANSHEE,
    UnitType.BATTLECRUISER,
    UnitType.RAVEN,
];

export function techEquivalents(unitType: number): number[] {
    const aliased = Object.entries(techAlias)
        .filter(([, aliases]) => aliases.includes(unitType))
        .map(([aliasType]) => Number(aliasType));
    return [...new Set([...(EQUIVALENTS_FOR_TECH_PROGRESS[unitType] ?? []), ...aliased])];
}

export function researchAbilityOf(world: World, upgradeId: number): number | undefined {
    return researchRequirements[upgradeId]?.ability ?? world.data.getUpgradeData(upgradeId)?.abilityId;
}

export function spend(world: World, { minerals, vespene }: Cost, supply = 0) {
    const { agent } = world;
    agent.minerals = (agent.minerals ?? 0) - minerals;
    agent.vespene = (agent.vespene ?? 0) - vespene;
    if (supply > 0) agent.foodUsed = (agent.foodUsed ?? 0) + supply;
}

// Unlike agent.canAfford this never settles the earmark, which the tracker must keep until it sends BUILD
export function affordable({ agent, data }: World, { minerals, vespene }: Cost, earmarkName?: string | null): boolean {
    const reserved = data.getEarmarkTotals(earmarkName);
    return (
        (agent.minerals ?? 0) - reserved.minerals >= minerals &&
        (!vespene || (agent.vespene ?? 0) - reserved.vespene >= vespene)
    );
}
