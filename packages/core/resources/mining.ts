import { ATTACK, HARVEST_GATHER, HARVEST_RETURN, MOVE, SMART } from '../constants/ability.ts';
import { Race } from '../constants/enums.ts';
import { gasMineTypes, gatheringAbilities, returningAbilities } from '../constants/groups.ts';
import { WorkerRace } from '../constants/race-map.ts';
import { BUILDING, GATHERING } from '../constants/unit-role.ts';
import { ASSIMILATORRICH, EXTRACTORRICH, REFINERYRICH } from '../constants/unit-type.ts';
import { distance, distanceSquared } from '../utils/geometry/point.ts';
import { mineralTargets, townhallTarget } from '../utils/mining/targets.ts';
import { Units } from './units-collection.ts';
import type {
    MiningAssignment,
    MiningResource,
    MiningSettings,
    Point2D,
    ResourceDefinition,
    Unit,
    World,
} from '../types.ts';

const MINERAL_RANGE = 10;
const GAS_RANGE = 12;
const ACTION_LOCK_SECONDS = 0.5;
const gasBuildingTypes = [...gasMineTypes, REFINERYRICH, ASSIMILATORRICH, EXTRACTORRICH];

type Assignments = { resourceOf: Map<string, string>; workersOn: Map<string, Set<string>> };

type MiningState = {
    settings: MiningSettings;
    minerals: Assignments;
    gas: Assignments;
    townhallOf: Map<string, string>;
    lockedAt: Map<string, number>;
    initialSplit: boolean;
    mineralTargets?: Map<string, Point2D>;
};

type Step = { townhalls: Units; ready: Units; minerals: Units; threatened: boolean; longDistanceFields?: Units };

const stateByMining = new WeakMap<MiningResource, MiningState>();

const tagOf = (unit: Unit | string) => (typeof unit === 'string' ? unit : unit.tag);
const isAlive = (unit: Unit | undefined): unit is Unit => !!unit && unit.isCurrent() && !unit.labels.has('dead');
const isBusy = (worker: Unit) => worker.labels.has('command') || worker.isConstructing();
// python-sc2 semantics: only the current order counts, unlike Unit.isGathering/isReturning
const isGathering = (worker: Unit) => worker.isUsingAbility(gatheringAbilities);
const isReturning = (worker: Unit) => worker.isUsingAbility(returningAbilities);

function assign({ resourceOf, workersOn }: Assignments, worker: string, resource: string) {
    resourceOf.set(worker, resource);
    const workers = workersOn.get(resource) ?? new Set<string>();
    workersOn.set(resource, workers);
    workers.add(worker);
}

function removeWorker({ resourceOf, workersOn }: Assignments, worker: string) {
    const resource = resourceOf.get(worker);
    if (resource === undefined) return;
    resourceOf.delete(worker);
    workersOn.get(resource)!.delete(worker);
}

function removeResource(state: MiningState, { resourceOf, workersOn }: Assignments, resource: string) {
    workersOn.get(resource)?.forEach((worker) => {
        resourceOf.delete(worker);
        state.townhallOf.delete(worker);
    });
    workersOn.delete(resource);
}

function unassign(state: MiningState, worker: string) {
    removeWorker(state.minerals, worker);
    removeWorker(state.gas, worker);
    state.townhallOf.delete(worker);
    state.lockedAt.delete(worker);
}

const isAssigned = (state: MiningState, worker: string) =>
    state.minerals.resourceOf.has(worker) || state.gas.resourceOf.has(worker);

const countOn = ({ workersOn }: Assignments, resource: string) => workersOn.get(resource)?.size ?? 0;

export const miningResource: ResourceDefinition<'mining'> = {
    name: 'mining',
    create(world) {
        const state: MiningState = {
            settings: {
                enabled: false,
                priority: -10,
                workersPerGas: 3,
                speedMining: true,
                townhallDistanceFactor: 1.08,
                keepSafe: true,
                fleeAtHealth: 0.5,
                weightSafetyLimit: 12,
                selfDefence: true,
                longDistanceMine: true,
            },
            minerals: { resourceOf: new Map(), workersOn: new Map() },
            gas: { resourceOf: new Map(), workersOn: new Map() },
            townhallOf: new Map(),
            lockedAt: new Map(),
            initialSplit: true,
        };

        const pick = (near: Point2D, forceClose: boolean, minHealth: number, exclude?: ReadonlySet<string>) =>
            pickWorker(world, state, near, forceClose, minHealth, exclude);

        const mining: MiningResource = {
            selectWorker(near, { forceClose = false, minHealth = 0, role, exclude } = {}) {
                const worker = pick(near, forceClose, minHealth, exclude);
                if (!worker) return undefined;
                unassign(state, worker.tag);
                world.resources.get().roles.assign(worker, role ?? BUILDING);
                return worker;
            },
            release(worker) {
                unassign(state, tagOf(worker));
                world.resources.get().roles.assign(worker, GATHERING);
            },
            getAssignment(worker): MiningAssignment | undefined {
                const tag = tagOf(worker);
                const townhallTag = state.townhallOf.get(tag)!;
                const mineral = state.minerals.resourceOf.get(tag);
                if (mineral !== undefined) return { kind: 'mineral', resourceTag: mineral, townhallTag };
                const gas = state.gas.resourceOf.get(tag);
                if (gas !== undefined) return { kind: 'gas', resourceTag: gas, townhallTag };
                return undefined;
            },
            getWorkersOn(resource) {
                const tag = tagOf(resource);
                return [...(state.minerals.workersOn.get(tag) ?? state.gas.workersOn.get(tag) ?? [])];
            },
            getMineralTarget(mineral) {
                const unit = typeof mineral === 'string' ? world.resources.get().units.getByTag(mineral) : mineral;
                return unit && targetsOf(world, state).get(positionKey(unit.pos));
            },
            isEnabled() {
                return state.settings.enabled;
            },
            configure(next) {
                const { workersPerGas } = next;
                if (
                    workersPerGas !== undefined &&
                    !(Number.isInteger(workersPerGas) && workersPerGas >= 0 && workersPerGas <= 3)
                ) {
                    throw new RangeError(`workersPerGas must be an integer from 0 to 3, got ${workersPerGas}`);
                }
                Object.assign(state.settings, next);
            },
        };
        stateByMining.set(mining, state);
        return mining;
    },
    reset(mining) {
        const state = stateByMining.get(mining)!;
        [state.minerals, state.gas].forEach(({ resourceOf, workersOn }) => {
            resourceOf.clear();
            workersOn.clear();
        });
        state.townhallOf.clear();
        state.lockedAt.clear();
        state.initialSplit = true;
        state.mineralTargets = undefined;
    },
    onStep(mining, world) {
        const state = stateByMining.get(mining)!;
        if (!state.settings.enabled) return;

        const workers = managedWorkers(world);
        const managed = new Set(workers.map((worker) => worker.tag));
        [...state.minerals.resourceOf.keys(), ...state.gas.resourceOf.keys(), ...state.lockedAt.keys()]
            .filter((tag) => !managed.has(tag))
            .forEach((tag) => unassign(state, tag));

        const { units, roles, intel } = world.resources.get();
        const townhalls = units.getBases();
        dropLostResources(world, state, townhalls);
        if (workers.length === 0 || townhalls.length === 0) return;

        const step: Step = {
            townhalls,
            ready: townhalls.ready,
            minerals: units.getMineralFields(),
            threatened: (intel.getMainThreat('ground')?.ground.length ?? 0) > 0,
        };
        assignGas(world, state, townhalls);
        assignMinerals(world, state, step, workers);

        roles.as(GATHERING, () => workers.forEach((worker) => mine(world, state, step, worker)), {
            priority: state.settings.priority,
        });
    },
};

function managedWorkers(world: World) {
    const { roles } = world.resources.get();
    return roles.get(GATHERING, { types: WorkerRace[world.agent.race!] });
}

function dropLostResources(world: World, state: MiningState, townhalls: Units) {
    const { units } = world.resources.get();
    [...state.minerals.workersOn.keys()].forEach((tag) => {
        const mineral = units.getByTag(tag);
        if (!isAlive(mineral) || townhalls.closerThan(MINERAL_RANGE, mineral).length === 0) {
            removeResource(state, state.minerals, tag);
        }
    });
    [...state.gas.workersOn.keys()].forEach((tag) => {
        const gas = units.getByTag(tag);
        if (!isAlive(gas) || gas.vespeneContents === 0 || townhalls.closerThan(GAS_RANGE, gas).length === 0) {
            removeResource(state, state.gas, tag);
        }
    });
}

function pickWorker(
    world: World,
    state: MiningState,
    near: Point2D,
    forceClose: boolean,
    minHealth: number,
    exclude?: ReadonlySet<string>,
) {
    const { units } = world.resources.get();
    const workers = managedWorkers(world).filter(
        (worker) => !isBusy(worker) && !exclude?.has(worker.tag) && worker.health! / worker.healthMax! >= minHealth,
    );
    if (workers.length === 0) return undefined;

    const unassigned = workers.filter((worker) => !isAssigned(state, worker.tag));
    if (unassigned.length > 0 && !forceClose) return unassigned.closestTo(near);

    const available = workers.filter(
        (worker) => state.minerals.resourceOf.has(worker.tag) && !worker.isCarryingResource(),
    );
    if (available.length === 0) return undefined;

    const minerals = units.getMineralFields();
    const townhalls = units
        .getBases()
        .ready.filter((townhall) => minerals.closerThan(MINERAL_RANGE, townhall).length >= 8)
        .sortedByDistanceTo(near);

    for (const townhall of townhalls) {
        for (const mineral of minerals.closerThan(MINERAL_RANGE, townhall).sortedByDistanceTo(townhall, true)) {
            const onPatch = state.minerals.workersOn.get(mineral.tag);
            if (!onPatch) continue;
            if (forceClose) {
                const close = available.filter(
                    (worker) => onPatch.has(worker.tag) && worker.distanceTo(townhall) < MINERAL_RANGE,
                );
                if (close.length > 0) return close.closestTo(near);
            } else {
                const idle = available.find((worker) => onPatch.has(worker.tag) && !worker.isCollecting());
                if (idle) return idle;
            }
        }
    }
    return available.closestTo(near);
}

function assignGas(world: World, state: MiningState, townhalls: Units) {
    const { units } = world.resources.get();
    const { workersPerGas } = state.settings;
    const gasBuildings = units
        .getById(gasBuildingTypes)
        .ready.filter((gas) => townhalls.closerThan(GAS_RANGE, gas).length > 0);

    for (const gas of gasBuildings) {
        const count = countOn(state.gas, gas.tag);
        if (count > workersPerGas) {
            const [first] = state.gas.workersOn.get(gas.tag)!;
            unassign(state, first);
            continue;
        }
        if (count === workersPerGas) continue;

        const worker = pickWorker(world, state, gas.pos, true, 0);
        if (!worker) continue;
        unassign(state, worker.tag);
        assign(state.gas, worker.tag, gas.tag);
        state.townhallOf.set(worker.tag, townhalls.closestTo(gas).tag);
        break;
    }
}

function availableMinerals(world: World, state: MiningState, townhalls: Units) {
    const minerals = world.resources.get().units.getMineralFields().visible;
    const seen = new Set<string>();
    return townhalls
        .filter((townhall) => townhall.buildProgress! > 0.85)
        .flatMap((townhall) =>
            minerals
                .closerThan(MINERAL_RANGE, townhall)
                .filter((mineral) => countOn(state.minerals, mineral.tag) < 2)
                .sortedByDistanceTo(townhall),
        )
        .filter((mineral) => !seen.has(mineral.tag) && !!seen.add(mineral.tag));
}

function assignToPatch(state: MiningState, worker: Unit, mineral: Unit, townhalls: Units) {
    assign(state.minerals, worker.tag, mineral.tag);
    state.townhallOf.set(worker.tag, townhalls.closestTo(mineral).tag);
}

const startOf = (world: World, townhalls: Units) =>
    world.resources.get().map.getMain()?.townhallPosition ?? townhalls[0].pos;

function assignMinerals(world: World, state: MiningState, step: Step, workers: Units) {
    const { townhalls } = step;
    let minerals = Units.from(availableMinerals(world, state, townhalls));
    const unassigned = workers.filter((worker) => !isAssigned(state, worker.tag) && !isBusy(worker));
    if (minerals.length === 0 || unassigned.length === 0) return;

    if (state.initialSplit) {
        state.initialSplit = false;
        const split = new Set<string>();
        minerals.sortedByDistanceTo(startOf(world, townhalls), true).forEach((mineral, index) => {
            unassigned
                .tagsNotIn(split)
                .sortedByDistanceTo(mineral)
                .take(index <= 3 ? 1 : 2)
                .forEach((worker) => {
                    assignToPatch(state, worker, mineral, townhalls);
                    split.add(worker.tag);
                });
        });
        return;
    }

    for (const worker of unassigned) {
        if (minerals.length === 0) return;
        const mineral = pickMineral(world, step, worker, minerals);
        if (countOn(state.minerals, mineral.tag) < 2) assignToPatch(state, worker, mineral, townhalls);
        if (countOn(state.minerals, mineral.tag) >= 2) minerals = minerals.filter((other) => other !== mineral);
    }
}

function pickMineral(world: World, step: Step, worker: Unit, minerals: Units) {
    const time = world.resources.get().frame.time();
    if (time < 120) return minerals.closestTo(worker);
    if (time < 300 && step.threatened) return minerals.closestTo(startOf(world, step.townhalls));
    const closest = minerals.closestTo(worker);
    return minerals.closerThan(MINERAL_RANGE, closest).closestTo(step.townhalls.closestTo(closest));
}

const positionKey = ({ x, y }: Point2D) => `${x},${y}`;

function targetsOf(world: World, state: MiningState) {
    if (state.mineralTargets) return state.mineralTargets;
    const { units, map } = world.resources.get();
    const minerals = units.getMineralFields();
    const townhalls = map.getExpansions().map(({ townhallPosition }) => townhallPosition);
    if (minerals.length === 0 || townhalls.length === 0) return new Map<string, Point2D>();
    state.mineralTargets = mineralTargets(
        minerals.map(({ pos }) => ({ tag: positionKey(pos), pos })),
        townhalls,
    );
    return state.mineralTargets;
}

function issue(world: World, worker: Unit, abilityId: number, target?: Point2D | string, queueCommand = false) {
    world.resources.get().actions.queueAction({
        abilityId,
        unitTags: [worker.tag],
        queueCommand,
        ...(typeof target === 'string' ? { targetUnitTag: target } : { targetWorldSpacePos: target }),
    });
}

function healthFraction(world: World, worker: Unit) {
    if (world.agent.race !== Race.PROTOSS) return worker.health! / worker.healthMax!;
    return (worker.health! + worker.shield!) / (worker.healthMax! + worker.shieldMax!);
}

function defend(world: World, worker: Unit, toResource: number) {
    if (worker.isCollecting() && toResource <= 1) return false;
    const enemies = world.resources
        .get()
        .spatial.unitsInRange(worker, worker.groundRange() + worker.radius! + 0.5, 'enemyGround')
        .filter((enemy) => enemy.isCurrent());
    if (enemies.length === 0 || !worker.weaponReady()) return false;
    const target = enemies.reduce((low, enemy) =>
        enemy.health! + enemy.shield! < low.health! + low.shield! ? enemy : low,
    );
    issue(world, worker, ATTACK, target.tag);
    return true;
}

function mustFlee(world: World, state: MiningState, worker: Unit, safe: boolean) {
    const { pathing } = world.resources.get();
    const { fleeAtHealth, weightSafetyLimit } = state.settings;
    return (
        !pathing.isPositionSafe(worker.pos, { layer: 'groundAvoidance' }) ||
        (!safe && healthFraction(world, worker) <= fleeAtHealth) ||
        !pathing.isPositionSafe(worker.pos, { layer: 'ground', limit: weightSafetyLimit })
    );
}

function flee(world: World, worker: Unit) {
    const spot = world.resources.get().pathing.closestSafeSpot(worker.pos, { layer: 'ground' });
    if (spot) issue(world, worker, MOVE, spot);
}

function mine(world: World, state: MiningState, step: Step, worker: Unit) {
    if (isBusy(worker)) return;
    const { units, pathing } = world.resources.get();
    const { settings } = state;
    const mineralTag = state.minerals.resourceOf.get(worker.tag);
    const resourceTag = mineralTag ?? state.gas.resourceOf.get(worker.tag);
    const resource = resourceTag === undefined ? undefined : units.getByTag(resourceTag);
    if (resourceTag !== undefined && !isAlive(resource)) return;
    const toResource = resource ? distance(worker.pos, resource.pos) : Infinity;

    const safe = pathing.isPositionSafe(worker.pos, { layer: 'ground' });
    if (!safe && settings.selfDefence && step.threatened && defend(world, worker, toResource)) return;
    if (settings.keepSafe && mustFlee(world, state, worker, safe)) return flee(world, worker);

    if (resource) {
        if (toResource > 6 && !worker.isCarryingResource()) {
            return issue(world, worker, MOVE, pathing.nextPoint(worker.pos, resource.pos, { layer: 'ground' }));
        }
        const orders = worker.orders ?? [];
        const target = orders[0]?.targetUnitTag;
        const { ready } = step;
        const stuckMove =
            orders.length === 1 &&
            orders[0].abilityId === MOVE &&
            ready.length > 0 &&
            target === ready.closestTo(worker).tag;
        if (stuckMove || (isGathering(worker) && target !== resource.tag)) {
            return issue(world, worker, SMART, resource.tag);
        }
        if (settings.speedMining && mineralTag !== undefined) return speedMine(world, state, step, worker, resource);
        return standardMine(world, state, worker, resource, mineralTag !== undefined);
    }

    if (settings.longDistanceMine) return longDistanceMine(world, state, step, worker, safe);
    if (!safe) flee(world, worker);
}

function speedMine(world: World, state: MiningState, step: Step, worker: Unit, mineral: Unit) {
    if ((worker.orders ?? []).length >= 2) return;

    if (isReturning(worker) || worker.isCarryingResource()) {
        const assigned = world.resources.get().units.getByTag(state.townhallOf.get(worker.tag) ?? '');
        const townhall = isAlive(assigned) ? assigned : step.townhalls.closestTo(worker);
        const target = townhallTarget(townhall.pos, worker.pos, state.settings.townhallDistanceFactor);
        const away = distance(worker.pos, target);
        if (away > 0.75 && away < 2) {
            issue(world, worker, MOVE, target);
            return issue(world, worker, SMART, townhall.tag, true);
        }
        if (!isReturning(worker)) issue(world, worker, SMART, townhall.tag);
        return;
    }

    const target = targetsOf(world, state).get(positionKey(mineral.pos));
    if (!target) return;
    const away = distance(worker.pos, target);
    if ((away > 0.75 && away < 2) || worker.isIdle()) {
        issue(world, worker, MOVE, target);
        return issue(world, worker, SMART, mineral.tag, true);
    }
    if (away > 2 && isGathering(worker)) issue(world, worker, MOVE, target);
}

function standardMine(world: World, state: MiningState, worker: Unit, resource: Unit, isMineral: boolean) {
    const now = world.resources.get().frame.time();
    const lockedAt = state.lockedAt.get(worker.tag);
    if (lockedAt !== undefined) {
        if (now > lockedAt + ACTION_LOCK_SECONDS) state.lockedAt.delete(worker.tag);
        return;
    }

    const command = (abilityId: number, target?: string) => {
        issue(world, worker, abilityId, target);
        state.lockedAt.set(worker.tag, now);
    };

    if (worker.isCarryingVespene() && isMineral) return command(HARVEST_RETURN);

    const [order] = worker.orders ?? [];
    if (order && returningAbilities.includes(order.abilityId!)) return;
    const target = order?.targetUnitTag;
    if (worker.isIdle() || (distanceSquared(worker.pos, resource.pos) > 81 && target && target !== resource.tag)) {
        return command(HARVEST_GATHER, resource.tag);
    }
    if (!worker.isCarryingMinerals() && !worker.isCarryingVespene() && target !== resource.tag) {
        command(HARVEST_GATHER, resource.tag);
    }
}

function longDistanceFields(world: World, state: MiningState, step: Step) {
    if (step.longDistanceFields) return step.longDistanceFields;
    const { pathing, frame } = world.resources.get();
    const collectionRate = frame.getObservation().score?.scoreDetails?.collectionRateMinerals ?? 0;
    const limit = collectionRate < 300 ? 100 : 6;
    const targets = targetsOf(world, state);
    // the mineral's own cell is unpathable (Infinity), so judge safety where the worker stands
    const standAt = (mineral: Unit) => targets.get(positionKey(mineral.pos)) ?? mineral.pos;
    step.longDistanceFields = step.minerals.filter(
        (mineral) =>
            countOn(state.minerals, mineral.tag) === 0 &&
            pathing.isPositionSafe(standAt(mineral), { layer: 'ground', limit }),
    );
    return step.longDistanceFields;
}

function longDistanceMine(world: World, state: MiningState, step: Step, worker: Unit, safe: boolean) {
    const { map, pathing, frame } = world.resources.get();
    const target = worker.orders?.[0]?.targetUnitTag;
    const onManagedPatch = target !== undefined && countOn(state.minerals, target) > 0;
    if (isGathering(worker) && !onManagedPatch) return;

    const { ready, minerals } = step;
    if (ready.length === 0) return;

    if ((!isGathering(worker) && !worker.isCarryingResource()) || onManagedPatch) {
        const pending = step.townhalls.filter((townhall) => townhall.buildProgress! < 1);
        let mineral: Unit | undefined;
        if (pending.length > 0 && minerals.length > 0) {
            mineral = minerals.closestTo(pending.closestTo(worker));
        } else {
            const fields = longDistanceFields(world, state, step);
            if (fields.length > 0) {
                const early = frame.time() < 260 && map.getNatural();
                mineral = fields.closestTo(early ? early.townhallPosition : worker.pos);
            }
        }
        if (!mineral) return;
        if (!safe && distanceSquared(worker.pos, mineral.pos) > 25) {
            const next = pathing.nextPoint(worker.pos, mineral.pos, { layer: 'ground', senseDanger: false });
            return issue(world, worker, MOVE, next);
        }
        if (target !== mineral.tag) issue(world, worker, HARVEST_GATHER, mineral.tag);
        return;
    }

    if (isReturning(worker)) return;
    const base = ready.closestTo(worker);
    if (!safe && distanceSquared(worker.pos, base.pos) > 64) {
        const next = pathing.nextPoint(worker.pos, base.pos, { layer: 'ground', senseDanger: false });
        return issue(world, worker, MOVE, next);
    }
    issue(world, worker, HARVEST_RETURN);
}
