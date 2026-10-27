import { researchAbilityOf, spend, techEquivalents } from '../../agent/macro.ts';
import { Ability } from '../../constants/index.ts';
import { Race } from '../../constants/enums.ts';
import { researchRequirements } from '../../constants/dicts/research-requirements.ts';
import { researchedFrom } from '../../constants/dicts/researched-from.ts';
import { techRequirement } from '../../constants/dicts/tech-requirement.ts';
import { trainedFrom } from '../../constants/dicts/trained-from.ts';
import { workerTypes } from '../../constants/groups.ts';
import {
    BARRACKS,
    BARRACKSTECHLAB,
    FACTORY,
    FACTORYTECHLAB,
    GATEWAY,
    HATCHERY,
    HIVE,
    LAIR,
    STARPORT,
    STARPORTTECHLAB,
    TECHLAB,
    WARPGATE,
} from '../../constants/unit-type.ts';
import { ownUnitCount } from './helpers.ts';
import { buildStructure } from './structures.ts';
import type { Behavior, BehaviorContext, Point2D } from '../../types.ts';

const TECHLAB_HOST: Record<number, { host: number; ability: number }> = {
    [BARRACKSTECHLAB]: { host: BARRACKS, ability: Ability.BUILD_TECHLAB_BARRACKS },
    [FACTORYTECHLAB]: { host: FACTORY, ability: Ability.BUILD_TECHLAB_FACTORY },
    [STARPORTTECHLAB]: { host: STARPORT, ability: Ability.BUILD_TECHLAB_STARPORT },
};
const TECHLAB_OF_HOST: Record<number, number> = Object.fromEntries(
    Object.entries(TECHLAB_HOST).map(([addon, { host }]) => [host, Number(addon)]),
);

type TechUpOptions = {
    desired: { unit: number } | { upgrade: number };
    base?: Point2D;
    ignoreExistingTechlabs?: boolean;
};

function pendingOrComplete({ world }: BehaviorContext, upgrade: number): boolean {
    if ((world.agent.upgradeIds ?? []).includes(upgrade)) return true;
    const ability = researchAbilityOf(world.agent, upgrade);
    return (
        !!ability &&
        world.resources
            .get()
            .units.getStructures()
            .some((structure) => (structure.orders ?? []).some((order) => order.abilityId === ability))
    );
}

const present = ({ world }: BehaviorContext, unitTypes: number[]) =>
    unitTypes.some((unitType) => ownUnitCount(world, unitType) > 0);

function morphTownhall(ctx: BehaviorContext, structureType: number): boolean {
    const { agent } = ctx.world;
    const { units } = ctx.world.resources.get();
    if (!agent.canAfford(structureType) || agent.alreadyPending(structureType)) return false;
    if (units.getById([structureType, HIVE]).length > 0) return false;
    const idle = units
        .getById(structureType === LAIR ? HATCHERY : LAIR)
        .find((townhall) => townhall.buildProgress === 1 && townhall.isIdle());
    if (!idle || !ctx.order(idle, structureType === LAIR ? Ability.MORPH_LAIR : Ability.MORPH_HIVE)) return false;
    spend(agent, agent.calculateCost(structureType));
    return true;
}

function requirementsOf(type: number, host: number): number[] {
    if (type in TECHLAB_HOST) return [TECHLAB_HOST[type].host];
    const requirement = techRequirement[type];
    if (requirement === TECHLAB) return TECHLAB_OF_HOST[host] ? [TECHLAB_OF_HOST[host]] : [];
    return requirement === undefined ? [] : [requirement];
}

async function addTechlab(
    ctx: BehaviorContext,
    techlabType: number,
    required: number[],
    options: TechUpOptions,
): Promise<boolean> {
    const { agent } = ctx.world;
    const { units } = ctx.world.resources.get();
    const { host, ability } = TECHLAB_HOST[techlabType];
    const hosts = units.getById(host);
    if (!options.ignoreExistingTechlabs && hosts.some((structure) => structure.hasTechLab() && structure.isIdle())) {
        return false;
    }

    if (!present(ctx, [host])) {
        for (const type of required) {
            if (present(ctx, [type]) || !agent.canAfford(type)) continue;
            if (await techUpTo(ctx, { ...options, desired: { unit: type } })) return true;
        }
        return false;
    }

    if (!agent.canAfford(techlabType) || (units.getById(techlabType).length > 0 && !options.ignoreExistingTechlabs)) {
        return false;
    }
    const bare = hosts.find(
        (structure) => structure.buildProgress === 1 && structure.isIdle() && !structure.hasAddOn(),
    );
    const idleWithAddon = hosts.some((structure) => structure.isIdle() && structure.hasAddOn());
    if (!bare || idleWithAddon || !ctx.order(bare, ability)) return false;
    spend(agent, agent.calculateCost(techlabType));
    return true;
}

async function techUpTo(ctx: BehaviorContext, options: TechUpOptions): Promise<boolean> {
    const { agent } = ctx.world;
    const { desired, base } = options;

    let from: number;
    let required: number[];
    if ('upgrade' in desired) {
        from = researchedFrom[desired.upgrade];
        if (from === undefined) return false;
        required = requirementsOf(from, from);
    } else {
        const { unit } = desired;
        if ((unit === LAIR || unit === HIVE) && present(ctx, [unit])) return false;
        if (trainedFrom[unit]?.some((type) => workerTypes.includes(type))) {
            from = unit;
            required = requirementsOf(unit, unit);
        } else {
            from = trainedFrom[unit]?.[0];
            if (from === undefined) return false;
            if (from === WARPGATE) from = GATEWAY;
            required = requirementsOf(unit, from);
        }
    }

    if (from in TECHLAB_HOST) return agent.canAfford(from) && (await addTechlab(ctx, from, required, options));

    if (agent.techRequirementProgress(from) === 1 && !present(ctx, [from])) {
        if (from === LAIR || from === HIVE) return morphTownhall(ctx, from);
        if (from === GATEWAY && present(ctx, [WARPGATE])) return false;
        return buildStructure({ structureType: from, base }).execute(ctx);
    }

    for (const type of required) {
        if (type in TECHLAB_HOST) {
            if (await addTechlab(ctx, type, required, options)) return true;
            continue;
        }
        if (present(ctx, type === GATEWAY ? [type, WARPGATE] : [type])) continue;
        if (agent.techRequirementProgress(type) !== 1) continue;
        if (type === LAIR || type === HIVE) return morphTownhall(ctx, type);
        return buildStructure({ structureType: type, base }).execute(ctx);
    }
    return false;
}

export function techUp({ desired, base, ignoreExistingTechlabs = false }: TechUpOptions): Behavior {
    return {
        name: 'techUp',
        execute: (ctx) => techUpTo(ctx, { desired, base, ignoreExistingTechlabs }),
    };
}

export function upgradeController({
    upgrades,
    base,
    autoTechUp = true,
    prioritize = false,
}: {
    upgrades: number[];
    base?: Point2D;
    autoTechUp?: boolean;
    prioritize?: boolean;
}): Behavior {
    return {
        name: 'upgradeController',
        async execute(ctx) {
            const { agent } = ctx.world;
            const { units } = ctx.world.resources.get();
            for (const upgrade of upgrades) {
                if (pendingOrComplete(ctx, upgrade)) continue;

                const from = researchedFrom[upgrade];
                if (from === undefined) continue;
                const structures = units.getById([from, ...techEquivalents(from)]);
                if (structures.length === 0) {
                    if (autoTechUp && (await techUpTo(ctx, { desired: { upgrade }, base }))) return true;
                    continue;
                }

                const idle = structures.some(
                    (structure) =>
                        structure.buildProgress === 1 &&
                        structure.isIdle() &&
                        (agent.race !== Race.PROTOSS || structure.isPowered),
                );
                if (!idle) continue;

                const { requiredBuilding, requiredUpgrade } = researchRequirements[upgrade] ?? {};
                if (requiredBuilding !== undefined && agent.structureTypeBuildProgress(requiredBuilding) < 1) {
                    if (autoTechUp && (await techUpTo(ctx, { desired: { unit: requiredBuilding }, base }))) return true;
                    continue;
                }
                if (requiredUpgrade !== undefined && !(agent.upgradeIds ?? []).includes(requiredUpgrade)) continue;

                if (await agent.research(upgrade)) return true;
                if (prioritize && !agent.canAffordUpgrade(upgrade)) return true;
            }
            return false;
        },
    };
}
