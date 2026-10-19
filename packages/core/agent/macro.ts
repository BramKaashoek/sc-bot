import createDebug from 'debug';
import { Ability, UnitType, WarpUnitAbility } from '../constants/index.ts';
import { Alliance, Race } from '../constants/enums.ts';
import { mineralFieldTypes, reactorTypes, techLabTypes } from '../constants/groups.ts';
import { techAlias } from '../constants/dicts/tech-alias.ts';
import { techRequirement } from '../constants/dicts/tech-requirement.ts';
import { trainedFrom } from '../constants/dicts/trained-from.ts';
import { researchedFrom } from '../constants/dicts/researched-from.ts';
import { researchRequirements } from '../constants/dicts/research-requirements.ts';
import { distance } from '../utils/geometry/point.ts';
import type { Agent, OwnedExpansion, Point2D, Unit } from '../types.ts';

const debug = createDebug('sc2:debug:Macro');

const EXPANSION_GAP_THRESHOLD = 15;

const RACE_TOWNHALLS: Record<number, number[]> = {
    [Race.PROTOSS]: [UnitType.NEXUS],
    [Race.TERRAN]: [
        UnitType.COMMANDCENTER,
        UnitType.ORBITALCOMMAND,
        UnitType.PLANETARYFORTRESS,
        UnitType.COMMANDCENTERFLYING,
        UnitType.ORBITALCOMMANDFLYING,
    ],
    [Race.ZERG]: [UnitType.HATCHERY, UnitType.LAIR, UnitType.HIVE],
};

const START_TOWNHALL: Record<number, number> = {
    [Race.PROTOSS]: UnitType.NEXUS,
    [Race.TERRAN]: UnitType.COMMANDCENTER,
    [Race.ZERG]: UnitType.HATCHERY,
};

const WORKER_TYPES = [UnitType.SCV, UnitType.PROBE, UnitType.DRONE, UnitType.DRONEBURROWED];

const GAS_BUILDING_TYPES = [
    UnitType.ASSIMILATOR,
    UnitType.ASSIMILATORRICH,
    UnitType.EXTRACTOR,
    UnitType.EXTRACTORRICH,
    UnitType.REFINERY,
    UnitType.REFINERYRICH,
];

const MINERAL_TYPES = [
    ...mineralFieldTypes,
    UnitType.MINERALFIELD450,
    UnitType.MINERALFIELDOPAQUE,
    UnitType.MINERALFIELDOPAQUE900,
];

const ADDON_PRODUCERS = [UnitType.BARRACKS, UnitType.FACTORY, UnitType.STARPORT];

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
const REQUIRES_TECHLAB = [
    UnitType.MARAUDER,
    UnitType.GHOST,
    UnitType.CYCLONE,
    UnitType.SIEGETANK,
    UnitType.THOR,
    UnitType.BANSHEE,
    UnitType.BATTLECRUISER,
    UnitType.RAVEN,
];

const RESEARCH_EQUIVALENT_STRUCTURES: Record<number, number[]> = {
    [UnitType.SPIRE]: [UnitType.SPIRE, UnitType.GREATERSPIRE],
    [UnitType.GREATERSPIRE]: [UnitType.SPIRE, UnitType.GREATERSPIRE],
    [UnitType.HATCHERY]: [UnitType.HATCHERY, UnitType.LAIR, UnitType.HIVE],
    [UnitType.LAIR]: [UnitType.HATCHERY, UnitType.LAIR, UnitType.HIVE],
    [UnitType.HIVE]: [UnitType.HATCHERY, UnitType.LAIR, UnitType.HIVE],
};

type AbilityProgress = { counts: Map<number, number>; maxProgress: Map<number, number> };

// python-sc2's hand-written equivalents plus the API's tech aliases, so e.g. a TECHLAB requirement is met by any add-on tech lab
function techEquivalents(unitType: number): number[] {
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

function randomOf<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

function context(agent: Agent) {
    const { units, actions, map } = agent._world.resources.get();
    const own = units.getAlive(Alliance.SELF);
    const structures = own.filter((unit) => unit.isStructure());
    const townhallTypes = RACE_TOWNHALLS[agent.race!] ?? Object.values(RACE_TOWNHALLS).flat();

    return {
        actions,
        map,
        own,
        structures,
        townhalls: structures.filter((unit) => townhallTypes.includes(unit.unitType)),
        gasBuildings: structures.filter(
            (unit) => GAS_BUILDING_TYPES.includes(unit.unitType) || Boolean(unit.vespeneContents),
        ),
        workers: own.filter((unit) => !unit.isStructure() && WORKER_TYPES.includes(unit.unitType)),
        larva: own.filter((unit) => unit.unitType === UnitType.LARVA),
        mineralFields: units.getAlive(Alliance.NEUTRAL).filter((unit) => MINERAL_TYPES.includes(unit.unitType)),
    };
}

function receivedThisFrame(agent: Agent): Set<string> {
    return agent._world.resources.get().actions.unitTagsReceivedAction();
}

function creationAbility({ _world: world }: Agent, unitType: number): number | undefined {
    // The API reports LURKERASPECTMPFROMHYDRALISKBURROWED instead of MORPH_LURKER, as python-sc2 patches
    if (unitType === UnitType.LURKERMP) return Ability.MORPH_LURKER;
    return world.data.getUnitTypeData(unitType)?.abilityId || undefined;
}

function generalAbility({ _world: world }: Agent, abilityId: number): number {
    return world.data.getAbilityData(abilityId)?.remapsToAbilityId || abilityId;
}

function researchAbilityOf({ _world: world }: Agent, upgradeId: number): number | undefined {
    return researchRequirements[upgradeId]?.ability ?? world.data.getUpgradeData(upgradeId)?.abilityId;
}

function abilitiesCountAndBuildProgress(agent: Agent): AbilityProgress {
    const { own } = context(agent);
    const counts = new Map<number, number>();
    const maxProgress = new Map<number, number>();

    own.forEach((unit) => {
        (unit.orders ?? []).forEach((order) => increment(counts, order.abilityId!));

        // Terran structures are counted from the constructing SCV's order instead
        if (unit.buildProgress === 1 || (agent.race === Race.TERRAN && unit.isStructure())) return;

        let abilityId: number | undefined;
        if (unit.unitType === UnitType.ARCHON) {
            abilityId = Ability.ARCHON_WARP_TARGET;
            increment(counts, abilityId, 2);
        } else if (CREATION_ABILITY_FIX[unit.unitType]) {
            abilityId = CREATION_ABILITY_FIX[unit.unitType];
            increment(counts, abilityId);
        } else {
            abilityId = creationAbility(agent, unit.unitType);
            if (!abilityId) return;
            increment(counts, abilityId);
        }
        maxProgress.set(abilityId, Math.max(maxProgress.get(abilityId) ?? 0, unit.buildProgress ?? 0));
    });

    return { counts, maxProgress };
}

function selectBuildWorker(agent: Agent, position: Point2D, force = false): Unit | undefined {
    const { workers } = context(agent);
    const received = receivedThisFrame(agent);
    const isIdle = (worker: Unit) => (worker.orders ?? []).length === 0;
    const isGathering = (worker: Unit) =>
        (worker.orders ?? []).length > 0 &&
        generalAbility(agent, worker.orders![0].abilityId!) === Ability.HARVEST_GATHER;

    const nearby = workers.filter(
        (worker) => (isGathering(worker) || isIdle(worker)) && distance(worker.pos, position) < 20,
    );
    const candidates = nearby.length > 0 ? nearby : workers;
    if (candidates.length === 0) return undefined;

    const preferIdle = [...candidates]
        .sort((left, right) => distance(left.pos, position) - distance(right.pos, position))
        .sort((left, right) => Number(isIdle(right)) - Number(isIdle(left)));

    const moveOrGather = [Ability.MOVE, Ability.GENERAL_MOVE, Ability.HARVEST_GATHER];
    const builder = preferIdle.find(
        (worker) =>
            (!received.has(worker.tag!) && isIdle(worker)) ||
            ((worker.orders ?? []).length === 1 &&
                moveOrGather.includes(generalAbility(agent, worker.orders![0].abilityId!))),
    );
    if (builder) return builder;
    return force ? randomOf(candidates) : undefined;
}

async function issue(agent: Agent, command: SC2APIProtocol.ActionRawUnitCommand) {
    const { actions } = agent._world.resources.get();
    if (agent.settings?.batchActions) {
        actions.queueAction(command);
        return;
    }
    await actions.sendAction(command);
}

function spend(agent: Agent, { minerals, vespene }: { minerals: number; vespene: number }, supply = 0) {
    agent.minerals = (agent.minerals ?? 0) - minerals;
    agent.vespene = (agent.vespene ?? 0) - vespene;
    if (supply > 0) agent.foodUsed = (agent.foodUsed ?? 0) + supply;
}

async function buildNear(agent: Agent, unitType: number, near: Point2D, maxDistance: number): Promise<boolean> {
    if (!agent.canAffordUnit(unitType)) return false;

    const { actions } = context(agent);
    const position = await actions.findPlacement(unitType, near, {
        maxDistance,
        randomAlternative: false,
        placementStep: 1,
    });
    if (!position) return false;

    const builder = selectBuildWorker(agent, near);
    const abilityId = creationAbility(agent, unitType);
    if (!builder || !abilityId) return false;

    spend(agent, agent.calculateCost(unitType));
    await issue(agent, {
        abilityId: generalAbility(agent, abilityId),
        unitTags: [builder.tag!],
        targetWorldSpacePos: position,
        queueCommand: false,
    });
    return true;
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
    | 'distributeWorkers'
    | 'train'
    | 'research'
>;

export const macroHelpers: MacroHelpers & ThisType<Agent> = {
    alreadyPending(unitType) {
        const { counts } = abilitiesCountAndBuildProgress(this);

        if (unitType === UnitType.ARCHON) return (counts.get(Ability.ARCHON_WARP_TARGET) ?? 0) / 2;
        if (CREATION_ABILITY_FIX[unitType]) return counts.get(CREATION_ABILITY_FIX[unitType]) ?? 0;

        const abilityId = creationAbility(this, unitType);
        if (!abilityId) {
            debug(`Unknown creation ability in alreadyPending for unit type ${unitType}`);
            return 0;
        }
        return counts.get(abilityId) ?? 0;
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
                .flatMap((structure) => [`${structure.pos.x},${structure.pos.y}`, `tag:${structure.tag}`]),
        );

        return workers
            .flatMap((worker) => worker.orders ?? [])
            .filter((order) => {
                const target = order.targetWorldSpacePos
                    ? `${order.targetWorldSpacePos.x},${order.targetWorldSpacePos.y}`
                    : `tag:${order.targetUnitTag}`;
                return !inProduction.has(target) && order.abilityId === abilityId;
            }).length;
    },
    async getNextExpansion() {
        const { map, townhalls } = context(this);
        const { x, y } = map.getLocations().self;
        const start = { x, y };

        let closest: Point2D | null = null;
        let bestDistance = Infinity;
        for (const location of map.getExpansionLocations()) {
            if (townhalls.some((townhall) => distance(townhall.pos, location) < EXPANSION_GAP_THRESHOLD)) continue;

            const pathingDistance = await map.queryPathing(start, location);
            if (pathingDistance === null) continue;

            if (pathingDistance < bestDistance) {
                bestDistance = pathingDistance;
                closest = location;
            }
        }
        return closest;
    },
    ownedExpansions() {
        const { map, townhalls } = context(this);
        return map.getExpansionLocations().flatMap((location): OwnedExpansion[] => {
            const townhall = townhalls.find((candidate) => distance(candidate.pos, location) < EXPANSION_GAP_THRESHOLD);
            return townhall ? [{ location, townhall }] : [];
        });
    },
    async expandNow(unitType, maxDistance = 10, location) {
        const building = unitType ?? START_TOWNHALL[this.race!];
        const target = location ?? (await this.getNextExpansion());
        if (!target) {
            debug('Trying to expandNow() but bot is out of locations to expand to');
            return;
        }
        await buildNear(this, building, target, maxDistance);
    },
    async distributeWorkers(resourceRatio = 2) {
        const { mineralFields, workers, townhalls, gasBuildings } = context(this);
        const bases = townhalls.filter((townhall) => townhall.buildProgress === 1);
        if (mineralFields.length === 0 || workers.length === 0 || bases.length === 0) return;

        const workerPool = workers.filter((worker) => (worker.orders ?? []).length === 0);
        const readyGas = gasBuildings.filter((gas) => gas.buildProgress === 1);
        const deficitMiningPlaces: Unit[] = [];
        const closestBase = (place: Unit) =>
            bases.reduce((best, base) => (distance(base.pos, place.pos) < distance(best.pos, place.pos) ? base : best));

        [...new Set([...bases, ...readyGas])].forEach((miningPlace) => {
            const difference = miningPlace.surplusHarvesters();
            if (!difference) return;

            let localWorkers: Unit[];
            if (miningPlace.vespeneContents) {
                const base = closestBase(miningPlace);
                localWorkers = workers.filter(
                    (worker) =>
                        orderTarget(worker) === miningPlace.tag ||
                        (worker.isCarryingVespene() && orderTarget(worker) === base.tag),
                );
            } else {
                const localMineralTags = new Set(
                    mineralFields
                        .filter((mineral) => distance(mineral.pos, miningPlace.pos) <= 8)
                        .map((mineral) => mineral.tag),
                );
                localWorkers = workers.filter((worker) => {
                    const target = orderTarget(worker);
                    return (
                        (typeof target === 'string' && localMineralTags.has(target)) ||
                        (worker.isCarryingMinerals() && target === miningPlace.tag)
                    );
                });
            }

            if (difference > 0) {
                workerPool.push(...localWorkers.slice(0, difference));
            } else {
                deficitMiningPlaces.push(...Array.from({ length: -difference }, () => miningPlace));
            }
        });

        const allMineralsNearBase =
            workerPool.length > deficitMiningPlaces.length
                ? mineralFields.filter((mineral) => bases.some((base) => distance(mineral.pos, base.pos) <= 8))
                : [];

        const gather = (worker: Unit, target: Unit) =>
            issue(this, {
                abilityId: Ability.HARVEST_GATHER,
                unitTags: [worker.tag!],
                targetUnitTag: target.tag,
                queueCommand: false,
            });

        const minerals = this.minerals ?? 0;
        const vespene = this.vespene ?? 0;
        const preferGas = !vespene || minerals / vespene >= resourceRatio;

        for (const worker of workerPool) {
            if (deficitMiningPlaces.length > 0) {
                const preferred = deficitMiningPlaces.filter((place) => Boolean(place.vespeneContents) === preferGas);
                const possiblePlaces = preferred.length > 0 ? preferred : deficitMiningPlaces;
                const currentPlace = possiblePlaces.reduce((best, place) =>
                    distance(place.pos, worker.pos) < distance(best.pos, worker.pos) ? place : best,
                );
                deficitMiningPlaces.splice(deficitMiningPlaces.indexOf(currentPlace), 1);

                if (currentPlace.vespeneContents) {
                    await gather(worker, currentPlace);
                } else {
                    const localMinerals = mineralFields.filter(
                        (mineral) => distance(mineral.pos, currentPlace.pos) <= 8,
                    );
                    if (localMinerals.length > 0) {
                        await gather(
                            worker,
                            localMinerals.reduce((best, mineral) =>
                                (mineral.mineralContents ?? 0) > (best.mineralContents ?? 0) ? mineral : best,
                            ),
                        );
                    }
                }
            } else if ((worker.orders ?? []).length === 0 && allMineralsNearBase.length > 0) {
                await gather(
                    worker,
                    allMineralsNearBase.reduce((best, mineral) =>
                        distance(mineral.pos, worker.pos) < distance(best.pos, worker.pos) ? mineral : best,
                    ),
                );
            }
        }
    },
    async train(unitType, amount = 1, closestTo, trainOnlyIdleBuildings = true) {
        if (this.techRequirementProgress(unitType) < 1) {
            debug(
                `Trying to produce unit ${unitType} in train() but tech requirement ${techRequirement[unitType]} is not met`,
            );
            return 0;
        }
        if (!this.canAffordUnit(unitType)) return 0;

        const { structures, larva, own } = context(this);
        const received = receivedThisFrame(this);
        const producerTypes = trainedFrom[unitType] ?? [];
        const isProtoss = this.race === Race.PROTOSS;
        const isTerran = this.race === Race.TERRAN;
        const requiresTechlab = REQUIRES_TECHLAB.includes(unitType);
        const canHaveAddons = producerTypes.some((producerType) => ADDON_PRODUCERS.includes(producerType));
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
        const trainFrom = async (structure: Unit, queue: boolean) => {
            spend(this, this.calculateCost(unitType), supply);
            await issue(this, {
                abilityId: generalAbility(this, abilityId!),
                unitTags: [structure.tag!],
                queueCommand: queue,
            });
        };

        let trainedAmount = 0;
        for (const structure of producers) {
            if (!this.canAffordUnit(unitType)) return trainedAmount;

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
                const pylon = randomOf(pylons);
                const angle = Math.random() * 2 * Math.PI;
                spend(this, this.calculateCost(unitType), supply);
                await issue(this, {
                    abilityId: WarpUnitAbility[unitType],
                    unitTags: [structure.tag!],
                    targetWorldSpacePos: { x: pylon.pos.x + Math.cos(angle) * 4, y: pylon.pos.y + Math.sin(angle) * 4 },
                    queueCommand: false,
                });
            } else {
                if (!abilityId) return trainedAmount;
                await trainFrom(structure, false);
                if (
                    isTerran &&
                    this.canAffordUnit(unitType) &&
                    (structure.orders ?? []).length === 0 &&
                    trainedAmount + 1 < amount &&
                    !requiresTechlab &&
                    hasReactor(structure)
                ) {
                    trainedAmount += 1;
                    await trainFrom(structure, true);
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
            throw new Error(`Could not find upgrade ${upgradeId} in the researched-from dictionary`);
        }

        const researchAbility = researchAbilityOf(this, upgradeId);
        const cost = this.calculateUpgradeCost(upgradeId);
        if (cost.minerals > (this.minerals ?? 0) || cost.vespene > (this.vespene ?? 0)) return false;

        const { requiredBuilding, requiredUpgrade } = researchRequirements[upgradeId] ?? {};
        if (requiredBuilding !== undefined && this.structureTypeBuildProgress(requiredBuilding) < 1) return false;
        if (requiredUpgrade !== undefined && !(this.upgradeIds ?? []).includes(requiredUpgrade)) return false;

        const { structures } = context(this);
        const received = receivedThisFrame(this);
        const researchStructureTypes = RESEARCH_EQUIVALENT_STRUCTURES[researchStructureType] ?? [researchStructureType];
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
        await issue(this, {
            abilityId: researchAbility,
            unitTags: [facility.tag!],
            queueCommand: false,
        });
        return true;
    },
};
