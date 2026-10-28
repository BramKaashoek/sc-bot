import createDebug from 'debug';
import { Ability, UnitType, WarpUnitAbility } from '../constants/index.ts';
import { Alliance, Race } from '../constants/enums.ts';
import {
    addonHostTypes,
    creationAbilityOverrides,
    gasMineTypes,
    mineralFieldTypes,
    reactorTypes,
    researcherEquivalents,
    techLabTypes,
} from '../constants/groups.ts';
import { TownhallRace, TownhallWithFlyingRace, WorkerRace } from '../constants/race-map.ts';
import getRandom from '../utils/get-random.ts';
import { techAlias } from '../constants/dicts/tech-alias.ts';
import { techRequirement } from '../constants/dicts/tech-requirement.ts';
import { trainedFrom } from '../constants/dicts/trained-from.ts';
import { researchedFrom } from '../constants/dicts/researched-from.ts';
import { researchRequirements } from '../constants/dicts/research-requirements.ts';
import { NodeSC2Error } from '../engine/errors.ts';
import { distance, pointKey } from '../utils/geometry/point.ts';
import { generalAbility } from '../engine/data-storage.ts';
import { townhallCenter } from '../utils/map/townhall.ts';
import type { Agent, Cost, OwnedExpansion, Point2D, Unit, World } from '../types.ts';

const debug = createDebug('sc2:debug:Macro');

const CONTEXT_WORKER_TYPES = [...Object.values(WorkerRace), UnitType.DRONEBURROWED];

const TERRAN_STRUCTURES_REQUIRE_SCV = [
    UnitType.ARMORY,
    UnitType.BARRACKS,
    UnitType.BUNKER,
    UnitType.COMMANDCENTER,
    UnitType.ENGINEERINGBAY,
    UnitType.FACTORY,
    UnitType.FUSIONCORE,
    UnitType.GHOSTACADEMY,
    UnitType.MISSILETURRET,
    UnitType.REFINERY,
    UnitType.REFINERYRICH,
    UnitType.SENSORTOWER,
    UnitType.STARPORT,
    UnitType.SUPPLYDEPOT,
];

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

const CREATION_ABILITY_FIX: Record<number, number> = {
    [UnitType.ARCHON]: Ability.ARCHON_WARP_TARGET,
    [UnitType.ASSIMILATORRICH]: Ability.BUILD_ASSIMILATOR,
    [UnitType.BANELINGCOCOON]: Ability.TRAIN_BANELING,
    [UnitType.CHANGELING]: Ability.EFFECT_SPAWNCHANGELING,
    [UnitType.EXTRACTORRICH]: Ability.BUILD_EXTRACTOR,
    [UnitType.INTERCEPTOR]: Ability.BUILD_INTERCEPTORS,
    [UnitType.LURKERMPEGG]: Ability.MORPH_LURKER,
    [UnitType.MULE]: Ability.EFFECT_CALLDOWNMULE,
    [UnitType.RAVAGERCOCOON]: Ability.MORPH_RAVAGER,
    [UnitType.REFINERYRICH]: Ability.BUILD_REFINERY,
    [UnitType.TECHLAB]: Ability.BUILD_TECHLAB,
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

type AbilityProgress = {
    counts: Map<number, number>;
    maxProgress: Map<number, number>;
};

export function techEquivalents(unitType: number): number[] {
    const aliased = Object.entries(techAlias)
        .filter(([, aliases]) => aliases.includes(unitType))
        .map(([aliasType]) => Number(aliasType));
    return [...new Set([...(EQUIVALENTS_FOR_TECH_PROGRESS[unitType] ?? []), ...aliased])];
}

function increment(counts: Map<number, number>, abilityId: number, amount = 1) {
    counts.set(abilityId, (counts.get(abilityId) ?? 0) + amount);
}

function orderTarget(unit: Unit): string | Point2D | undefined {
    const [order] = unit.orders ?? [];
    if (!order) return undefined;
    return order.targetWorldSpacePos
        ? { x: order.targetWorldSpacePos.x!, y: order.targetWorldSpacePos.y! }
        : order.targetUnitTag;
}

function context(agent: Agent) {
    const { units, actions, map } = agent._world.resources.get();
    const own = units.getAlive(Alliance.SELF);
    const structures = own.filter((unit) => unit.isStructure());
    const townhallTypes = TownhallWithFlyingRace[agent.race!] ?? Object.values(TownhallWithFlyingRace).flat();

    return {
        actions,
        map,
        own,
        structures,
        townhalls: structures.filter((unit) => townhallTypes.includes(unit.unitType)),
        gasBuildings: structures.filter(
            (unit) => gasMineTypes.includes(unit.unitType) || Boolean(unit.vespeneContents),
        ),
        workers: own.filter((unit) => !unit.isStructure() && CONTEXT_WORKER_TYPES.includes(unit.unitType)),
        larva: own.filter((unit) => unit.unitType === UnitType.LARVA),
        mineralFields: units.getAlive(Alliance.NEUTRAL).filter((unit) => mineralFieldTypes.includes(unit.unitType)),
    };
}

function receivedThisFrame(agent: Agent): Set<string> {
    return agent._world.resources.get().actions.unitTagsReceivedAction();
}

function creationAbility({ _world: world }: Agent, unitType: number): number | undefined {
    return creationAbilityOverrides[unitType] ?? (world.data.getUnitTypeData(unitType)?.abilityId || undefined);
}

export function researchAbilityOf({ _world: world }: Agent, upgradeId: number): number | undefined {
    return researchRequirements[upgradeId]?.ability ?? world.data.getUpgradeData(upgradeId)?.abilityId;
}

function abilitiesCountAndBuildProgress(agent: Agent, own = context(agent).own): AbilityProgress {
    const { units } = agent._world.resources.get();
    const counts = new Map<number, number>();
    const maxProgress = new Map<number, number>();
    const orders = own.flatMap((unit) => unit.orders ?? []);
    orders.forEach((order) => increment(counts, order.abilityId!));

    // A constructing SCV, or an add-on's parent, keeps its build order, so its structure is already counted
    const hasBuildOrder = (abilityId: number, structure: Unit) =>
        orders.some((order) => {
            if (order.abilityId !== abilityId) return false;
            const target = order.targetWorldSpacePos ?? units.getByTag(order.targetUnitTag!)?.pos;
            return !!target && distance({ x: target.x!, y: target.y! }, structure.pos) < 1;
        });

    own.forEach((unit) => {
        if (unit.buildProgress === 1) return;

        let abilityId: number | undefined;
        let amount = 1;
        if (unit.unitType === UnitType.ARCHON) {
            abilityId = Ability.ARCHON_WARP_TARGET;
            amount = 2;
        } else {
            abilityId = CREATION_ABILITY_FIX[unit.unitType] ?? creationAbility(agent, unit.unitType);
            if (!abilityId) return;
        }
        if (
            agent.race === Race.TERRAN &&
            unit.isStructure() &&
            (reactorTypes.includes(unit.unitType) ||
                techLabTypes.includes(unit.unitType) ||
                hasBuildOrder(abilityId, unit))
        ) {
            return;
        }
        increment(counts, abilityId, amount);
        maxProgress.set(abilityId, Math.max(maxProgress.get(abilityId) ?? 0, unit.buildProgress ?? 0));
    });

    return { counts, maxProgress };
}

function trackedNotStarted(agent: Agent, own: Unit[], unitType: number, abilityId: number): number {
    const active = agent._world.resources
        .get()
        .buildings.getTracked()
        .filter(({ unitType: type, status }) => type === unitType && status !== 'done' && status !== 'failed');
    if (active.length === 0) return 0;

    const ordered = new Set(
        own.filter((unit) => (unit.orders ?? []).some((order) => order.abilityId === abilityId)).map(({ tag }) => tag),
    );
    const structures = own.filter((unit) => unit.isStructure());
    return active.filter(
        ({ workerTag, target }) =>
            !ordered.has(workerTag!) && !structures.some((structure) => distance(structure.pos, target) < 1),
    ).length;
}

function issue(agent: Agent, command: SC2APIProtocol.ActionRawUnitCommand) {
    agent._world.resources.get().actions.queueAction(command);
}

export function spend(agent: Agent, { minerals, vespene }: Cost, supply = 0) {
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

type MacroHelpers = Pick<
    Agent,
    | 'alreadyPending'
    | 'alreadyPendingUpgrade'
    | 'structureTypeBuildProgress'
    | 'techRequirementProgress'
    | 'workerEnRouteToBuild'
    | 'getNextExpansion'
    | 'ownedExpansions'
    | 'expandNow'
    | 'train'
    | 'research'
>;

export const macroHelpers: MacroHelpers & ThisType<Agent> = {
    alreadyPending(unitType) {
        const own = this._world.resources.get().units.getAlive(Alliance.SELF);
        const { counts } = abilitiesCountAndBuildProgress(this, own);

        if (unitType === UnitType.ARCHON) return (counts.get(Ability.ARCHON_WARP_TARGET) ?? 0) / 2;
        if (CREATION_ABILITY_FIX[unitType]) return counts.get(CREATION_ABILITY_FIX[unitType]) ?? 0;

        const abilityId = creationAbility(this, unitType);
        if (!abilityId) {
            debug(`Unknown creation ability in alreadyPending for unit type ${unitType}`);
            return 0;
        }
        return (counts.get(abilityId) ?? 0) + trackedNotStarted(this, own, unitType, abilityId);
    },
    alreadyPendingUpgrade(upgradeId) {
        if ((this.upgradeIds ?? []).includes(upgradeId)) return 1;

        const researchAbility = researchAbilityOf(this, upgradeId);
        if (!researchAbility) return 0;

        const { structures } = context(this);
        for (const structure of structures.filter((unit) => unit.buildProgress === 1)) {
            const order = (structure.orders ?? []).find((candidate) => candidate.abilityId === researchAbility);
            if (order) return order.progress ?? 0;
        }
        return 0;
    },
    structureTypeBuildProgress(unitType) {
        const { structures } = context(this);
        const equivalents = [unitType, ...techEquivalents(unitType)];
        const structureProgress = structures
            .filter((structure) => equivalents.includes(structure.unitType))
            .map((structure) => structure.buildProgress ?? 0);

        const unitData: SC2APIProtocol.UnitTypeData | undefined = this._world.data.get('units')[unitType];
        if (!unitData?.available) return Math.max(0, ...structureProgress);

        const abilityId = creationAbility(this, unitType);
        if (!abilityId) return 0;

        const { maxProgress } = abilitiesCountAndBuildProgress(this);
        return Math.max(0, ...structureProgress, maxProgress.get(abilityId) ?? 0);
    },
    techRequirementProgress(unitType) {
        const requirement = techRequirement[unitType] ?? 0;
        if (!requirement) return 1;

        return Math.max(
            this.structureTypeBuildProgress(requirement),
            ...techEquivalents(requirement).map((equivalent) => this.structureTypeBuildProgress(equivalent)),
        );
    },
    workerEnRouteToBuild(unitType) {
        const abilityId = creationAbility(this, unitType);
        if (!abilityId) {
            debug(`Unknown creation ability in workerEnRouteToBuild for unit type ${unitType}`);
            return 0;
        }

        const { structures, workers } = context(this);
        const inProduction = new Set(
            structures
                .filter((structure) => TERRAN_STRUCTURES_REQUIRE_SCV.includes(structure.unitType))
                .flatMap((structure) => [pointKey(structure.pos), `tag:${structure.tag}`]),
        );

        return workers
            .flatMap((worker) => worker.orders ?? [])
            .filter((order) => {
                const target = order.targetWorldSpacePos
                    ? pointKey(order.targetWorldSpacePos as Point2D)
                    : `tag:${order.targetUnitTag}`;
                return !inProduction.has(target) && order.abilityId === abilityId;
            }).length;
    },
    async getNextExpansion() {
        const spot = this._world.resources.get().buildings.getNextExpansion();
        return spot ? { x: spot.x + 0.5, y: spot.y + 0.5 } : null;
    },
    ownedExpansions() {
        const { map } = context(this);
        return map.getOccupiedExpansions().map(
            (expansion): OwnedExpansion => ({
                location: townhallCenter(expansion),
                townhall: expansion.getBase()!,
            }),
        );
    },
    async expandNow(unitType, location) {
        const building = unitType ?? TownhallRace[this.race!]?.[0];
        const target = location ?? (await this.getNextExpansion());
        if (!target) {
            debug('Trying to expandNow() but bot is out of locations to expand to');
            return;
        }
        const { buildings } = this._world.resources.get();
        // money is only spent once BUILD is ordered, so canAfford keeps passing while the worker walks; the picker skips
        // a targeted spot, so without a location the pending build itself has to stop a second one
        const tracked = buildings
            .getTracked()
            .some(
                ({ unitType, target: at, status }) =>
                    unitType === building &&
                    status !== 'done' &&
                    status !== 'failed' &&
                    (!location || distance(at, target) < 1),
            );
        if (tracked || !this.canAfford(building)) return;
        buildings.build(building, { at: target });
    },
    async train(unitType, amount = 1, closestTo, trainOnlyIdleBuildings = true) {
        if (this.techRequirementProgress(unitType) < 1) {
            debug(
                `Trying to produce unit ${unitType} in train() but tech requirement ${techRequirement[unitType]} is not met`,
            );
            return 0;
        }
        if (!this.canAfford(unitType, null, { supply: true })) return 0;

        const { structures, larva, own } = context(this);
        const received = receivedThisFrame(this);
        const producerTypes = trainedFrom[unitType] ?? [];
        const isProtoss = this.race === Race.PROTOSS;
        const isTerran = this.race === Race.TERRAN;
        const requiresTechlab = REQUIRES_TECHLAB.includes(unitType);
        const canHaveAddons = producerTypes.some((producerType) => addonHostTypes.includes(producerType));
        const reactorTags = new Set(
            structures
                .filter((structure) => reactorTypes.includes(structure.unitType))
                .map((structure) => structure.tag),
        );
        const techlabTags = new Set(
            structures
                .filter((structure) => techLabTypes.includes(structure.unitType))
                .map((structure) => structure.tag),
        );
        const hasReactor = (structure: Unit) => reactorTags.has(structure.addOnTag!);

        let producers = this.race === Race.ZERG ? [...structures, ...larva] : [...structures];
        if (closestTo) {
            producers.sort((left, right) => distance(left.pos, closestTo) - distance(right.pos, closestTo));
        } else if (canHaveAddons) {
            const addonRank = (structure: Unit) =>
                -1 * Number(hasReactor(structure)) + Number(techlabTags.has(structure.addOnTag!));
            producers = producers.sort((left, right) => addonRank(left) - addonRank(right));
        }

        const abilityId = creationAbility(this, unitType);
        const supply = this.calculateSupplyCost(unitType);
        const trainFrom = (structure: Unit, queue: boolean) => {
            spend(this, this.calculateCost(unitType), supply);
            issue(this, {
                abilityId: generalAbility(this._world.data, abilityId!),
                unitTags: [structure.tag!],
                queueCommand: queue,
            });
        };

        let trainedAmount = 0;
        for (const structure of producers) {
            if (!this.canAfford(unitType, null, { supply: true })) return trainedAmount;

            const eligible =
                !received.has(structure.tag!) &&
                producerTypes.includes(structure.unitType) &&
                structure.buildProgress === 1 &&
                (!isProtoss || Boolean(structure.isPowered) || structure.unitType === UnitType.NEXUS) &&
                (!trainOnlyIdleBuildings || (structure.orders ?? []).length < 1 + Number(hasReactor(structure))) &&
                (!requiresTechlab || techlabTags.has(structure.addOnTag!));
            if (!eligible) continue;

            if (structure.unitType === UnitType.WARPGATE) {
                const pylons = own.filter((unit) => unit.unitType === UnitType.PYLON);
                if (pylons.length === 0) return trainedAmount;
                const pylon = getRandom(pylons);
                const angle = Math.random() * 2 * Math.PI;
                spend(this, this.calculateCost(unitType), supply);
                issue(this, {
                    abilityId: WarpUnitAbility[unitType],
                    unitTags: [structure.tag!],
                    targetWorldSpacePos: {
                        x: pylon.pos.x + Math.cos(angle) * 4,
                        y: pylon.pos.y + Math.sin(angle) * 4,
                    },
                    queueCommand: false,
                });
            } else {
                if (!abilityId) return trainedAmount;
                trainFrom(structure, false);
                if (
                    isTerran &&
                    this.canAfford(unitType, null, { supply: true }) &&
                    (structure.orders ?? []).length === 0 &&
                    trainedAmount + 1 < amount &&
                    !requiresTechlab &&
                    hasReactor(structure)
                ) {
                    trainedAmount += 1;
                    trainFrom(structure, true);
                }
            }

            trainedAmount += 1;
            if (trainedAmount === amount) return trainedAmount;
        }
        return trainedAmount;
    },
    async research(upgradeId) {
        const researchStructureType = researchedFrom[upgradeId];
        if (researchStructureType === undefined) {
            throw new NodeSC2Error(`Could not find upgrade ${upgradeId} in the researched-from dictionary`);
        }

        const researchAbility = researchAbilityOf(this, upgradeId);
        const cost = this.calculateUpgradeCost(upgradeId);
        if (cost.minerals > (this.minerals ?? 0) || cost.vespene > (this.vespene ?? 0)) return false;

        const { requiredBuilding, requiredUpgrade } = researchRequirements[upgradeId] ?? {};
        if (requiredBuilding !== undefined && this.structureTypeBuildProgress(requiredBuilding) < 1) return false;
        if (requiredUpgrade !== undefined && !(this.upgradeIds ?? []).includes(requiredUpgrade)) return false;

        const { structures } = context(this);
        const received = receivedThisFrame(this);
        const researchStructureTypes = researcherEquivalents[researchStructureType] ?? [researchStructureType];
        const isProtoss = this.race === Race.PROTOSS;

        const facility = structures.find(
            (structure) =>
                researchStructureTypes.includes(structure.unitType) &&
                !received.has(structure.tag!) &&
                structure.buildProgress === 1 &&
                (structure.orders ?? []).length === 0 &&
                (!isProtoss || Boolean(structure.isPowered)),
        );
        if (!facility || !researchAbility) return false;

        spend(this, cost);
        issue(this, {
            abilityId: researchAbility,
            unitTags: [facility.tag!],
            queueCommand: false,
        });
        return true;
    },
};
