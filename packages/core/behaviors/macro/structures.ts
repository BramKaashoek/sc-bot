import { spend } from '../../utils/economy.ts';
import { Race } from '../../constants/enums.ts';
import { Ability } from '../../constants/index.ts';
import {
    ASSIMILATOR,
    BARRACKS,
    COMMANDCENTER,
    COMMANDCENTERFLYING,
    EXTRACTOR,
    FACTORY,
    GATEWAY,
    HATCHERY,
    HIVE,
    LAIR,
    NEXUS,
    ORBITALCOMMAND,
    ORBITALCOMMANDFLYING,
    OVERLORD,
    PLANETARYFORTRESS,
    PYLON,
    REFINERY,
    ROBOTICSFACILITY,
    STARGATE,
    STARPORT,
    SUPPLYDEPOT,
    WARPGATE,
} from '../../constants/unit-type.ts';
import { GasMineRace, SupplyUnitRace, TownhallRace, TownhallWithFlyingRace } from '../../constants/race-map.ts';
import { notStarted } from './helpers.ts';
import type { Behavior, PlacementFlag, Point2D, World } from '../../types.ts';

const PRODUCTION_TYPES = [
    BARRACKS,
    FACTORY,
    STARPORT,
    GATEWAY,
    WARPGATE,
    ROBOTICSFACILITY,
    STARGATE,
    HATCHERY,
    LAIR,
    HIVE,
];

const isZerg = ({ agent }: World) => agent.race === Race.ZERG;

const readyCount = (world: World, unitTypes: number[]) =>
    world.resources
        .get()
        .units.getById(unitTypes)
        .filter((structure) => structure.buildProgress === 1).length;

type BuildStructureOptions = {
    structureType: number;
    base?: Point2D;
    maxOnRoute?: number;
    closestTo?: Point2D;
    toCount?: number;
    techProgressCheck?: number;
    flags?: PlacementFlag[];
    findAlternative?: boolean;
};

export function buildStructure({
    structureType,
    base,
    maxOnRoute = 1,
    closestTo,
    toCount = 0,
    techProgressCheck = 0.85,
    flags,
    findAlternative = true,
}: BuildStructureOptions): Behavior {
    return {
        name: 'buildStructure',
        execute({ world }) {
            if (isZerg(world)) return false;
            const { buildings } = world.resources.get();
            if (notStarted(world, structureType) >= maxOnRoute) return false;
            if (
                toCount > 0 &&
                readyCount(world, [structureType]) + world.agent.alreadyPending(structureType) >= toCount
            ) {
                return false;
            }
            if (world.agent.techRequirementProgress(structureType) < techProgressCheck) return false;
            return !!buildings.build(structureType, { placement: { base, closestTo, flags, findAlternative } });
        },
    };
}

function numSupplyRequired(world: World): number {
    const { agent } = world;
    if (agent.supplyCap >= 200) return 0;

    const { supplyLeft, supplyUsed } = agent;
    const townhalls = readyCount(world, TownhallWithFlyingRace[agent.race as number]);

    if (isZerg(world)) {
        const pending = agent.alreadyPending(OVERLORD);
        if (supplyLeft <= 0 && pending < townhalls + 1) {
            return (supplyUsed < 72 ? townhalls : townhalls + 1) - pending;
        }
        if (supplyUsed < 60 && supplyUsed >= 13) {
            const threshold = supplyUsed <= 36 ? 5 : 6;
            const building = supplyLeft > 0 || supplyUsed < 29 ? 1 : 2;
            if (supplyLeft <= threshold && pending < building) return building - pending;
        } else if (supplyLeft < 4 * townhalls && pending < townhalls) {
            return Math.min(townhalls - pending, 6);
        }
        return 0;
    }

    const pending = world.agent.alreadyPending(SupplyUnitRace[agent.race as number]);
    const production = readyCount(world, PRODUCTION_TYPES);
    if (supplyLeft <= Math.max(2 * production, 5) && pending < Math.ceil(production / 2)) {
        return Math.min(Math.ceil(production / 2) - pending, 6);
    }
    if (production === 0 && supplyLeft <= 2 && !pending) return 1;
    return 0;
}

export function autoSupply({
    base,
    closestTo,
    returnTrueIfSupplyRequired = true,
}: {
    base?: Point2D;
    closestTo?: Point2D;
    returnTrueIfSupplyRequired?: boolean;
} = {}): Behavior {
    return {
        name: 'autoSupply',
        async execute(ctx) {
            const { agent } = ctx.world;
            if (numSupplyRequired(ctx.world) <= 0) return false;
            const structureType = SupplyUnitRace[agent.race as number];
            if (isZerg(ctx.world)) {
                if (agent.canAfford(structureType) && (await agent.train(structureType)) > 0) return true;
            } else {
                const flags = agent.race === Race.TERRAN ? (['supplyDepot'] as PlacementFlag[]) : undefined;
                await buildStructure({ structureType, base, closestTo, flags }).execute(ctx);
            }
            return returnTrueIfSupplyRequired;
        },
    };
}

export function expansionController({
    toCount,
    canAffordCheck = true,
    checkLocationIsSafe = true,
    maxPending = 1,
    prioritize = false,
}: {
    toCount: number;
    canAffordCheck?: boolean;
    checkLocationIsSafe?: boolean;
    maxPending?: number;
    prioritize?: boolean;
}): Behavior {
    return {
        name: 'expansionController',
        execute({ world }) {
            const { agent } = world;
            const { buildings } = world.resources.get();
            const townhallType = TownhallRace[agent.race as number]?.[0];
            const pending = world.agent.alreadyPending(townhallType);
            if (readyCount(world, TownhallWithFlyingRace[agent.race as number]) + pending >= toCount) return false;
            if (pending >= maxPending) return false;
            if (canAffordCheck && !prioritize && !agent.canAfford(townhallType)) return false;

            const at = buildings.getNextExpansion({ checkSafe: checkLocationIsSafe });
            return !!at && !!buildings.build(townhallType, { at });
        },
    };
}

export function gasBuildingController({ toCount, maxPending = 1 }: { toCount: number; maxPending?: number }): Behavior {
    return {
        name: 'gasBuildingController',
        execute({ world }) {
            const { buildings, units } = world.resources.get();
            const gasType = GasMineRace[world.agent.race as number];
            if (units.getGasMines().length + notStarted(world, gasType) >= toCount) return false;
            if (buildings.pending(gasType) >= maxPending || (world.agent.minerals ?? 0) < 35) return false;
            return !!buildings.buildGas({ max: maxPending });
        },
    };
}

export function upgradeCCs({
    to,
    prioritize = false,
}: {
    to: typeof ORBITALCOMMAND | typeof PLANETARYFORTRESS;
    prioritize?: boolean;
}): Behavior {
    return {
        name: 'upgradeCCs',
        execute({ world, order }) {
            const { agent } = world;
            const cc = world.resources
                .get()
                .units.getById(COMMANDCENTER)
                .find((candidate) => candidate.buildProgress === 1 && candidate.isIdle());
            if (!cc || agent.techRequirementProgress(to) < 1) return false;
            if (!agent.canAfford(to)) return prioritize;

            const ordered = order(
                cc,
                to === PLANETARYFORTRESS ? Ability.MORPH_PLANETARYFORTRESS : Ability.MORPH_ORBITALCOMMAND,
            );
            if (ordered) spend(world, agent.calculateCost(to));
            return ordered;
        },
    };
}
