import { HARVEST_GATHER, HARVEST_RETURN } from '../constants/ability.ts';
import { gasMineTypes, returningAbilities } from '../constants/groups.ts';
import { WorkerRace } from '../constants/race-map.ts';
import { BUILDING, GATHERING } from '../constants/unit-role.ts';
import { ASSIMILATORRICH, EXTRACTORRICH, REFINERYRICH } from '../constants/unit-type.ts';
import { NodeSC2Error } from '../engine/errors.ts';
import { distanceSquared } from '../utils/geometry/point.ts';
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

const LOOPS_PER_SECOND = 22.4;
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
};

const stateByMining = new WeakMap<MiningResource, MiningState>();

const notImplemented = (): never => {
    throw new NodeSC2Error('not implemented');
};

const tagOf = (unit: Unit | string) => (typeof unit === 'string' ? unit : unit.tag);
const isAlive = (unit: Unit | undefined): unit is Unit => !!unit && unit.isCurrent() && !unit.labels.has('dead');
const isBusy = (worker: Unit) => worker.labels.has('command') || worker.isConstructing();

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

        const pick = (near: Point2D, forceClose: boolean, minHealth: number) =>
            pickWorker(world, state, near, forceClose, minHealth);

        const mining: MiningResource = {
            selectWorker(near, { forceClose = false, minHealth = 0, role } = {}) {
                const worker = pick(near, forceClose, minHealth);
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
            getMineralTarget: notImplemented,
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
    },
    onStep(mining, world) {
        const state = stateByMining.get(mining)!;
        if (!state.settings.enabled) return;

        const workers = managedWorkers(world);
        const managed = new Set(workers.map((worker) => worker.tag));
        [...state.minerals.resourceOf.keys(), ...state.gas.resourceOf.keys(), ...state.lockedAt.keys()]
            .filter((tag) => !managed.has(tag))
            .forEach((tag) => unassign(state, tag));

        const { units, roles } = world.resources.get();
        const townhalls = units.getBases();
        dropLostResources(world, state, townhalls);
        if (workers.length === 0 || townhalls.length === 0) return;

        assignGas(world, state, townhalls);
        assignMinerals(world, state, workers, townhalls);

        roles.as(GATHERING, () => workers.forEach((worker) => mine(world, state, worker)), {
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

function pickWorker(world: World, state: MiningState, near: Point2D, forceClose: boolean, minHealth: number) {
    const { units } = world.resources.get();
    const workers = managedWorkers(world).filter(
        (worker) => !isBusy(worker) && worker.health! / worker.healthMax! >= minHealth,
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

function assignMinerals(world: World, state: MiningState, workers: Units, townhalls: Units) {
    let minerals = Units.from(availableMinerals(world, state, townhalls));
    const unassigned = workers.filter((worker) => !isAssigned(state, worker.tag) && !isBusy(worker));
    if (minerals.length === 0 || unassigned.length === 0) return;

    if (state.initialSplit) {
        state.initialSplit = false;
        const start = world.resources.get().map.getMain()?.townhallPosition ?? townhalls[0].pos;
        const split = new Set<string>();
        minerals.sortedByDistanceTo(start, true).forEach((mineral, index) => {
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
        const mineral = pickMineral(world, worker, minerals, townhalls);
        if (countOn(state.minerals, mineral.tag) < 2) assignToPatch(state, worker, mineral, townhalls);
        if (countOn(state.minerals, mineral.tag) >= 2) minerals = minerals.filter((other) => other !== mineral);
    }
}

function pickMineral(world: World, worker: Unit, minerals: Units, townhalls: Units) {
    if (world.resources.get().frame.getGameLoop() / LOOPS_PER_SECOND < 120) return minerals.closestTo(worker);
    const closest = minerals.closestTo(worker);
    return minerals.closerThan(MINERAL_RANGE, closest).closestTo(townhalls.closestTo(closest));
}

function mine(world: World, state: MiningState, worker: Unit) {
    if (isBusy(worker)) return;
    const { units, actions, frame } = world.resources.get();
    const mineralTag = state.minerals.resourceOf.get(worker.tag);
    const resource = units.getByTag(mineralTag ?? state.gas.resourceOf.get(worker.tag) ?? '');
    if (!isAlive(resource)) return;

    const now = frame.getGameLoop() / LOOPS_PER_SECOND;
    const lockedAt = state.lockedAt.get(worker.tag);
    if (lockedAt !== undefined) {
        if (now > lockedAt + ACTION_LOCK_SECONDS) state.lockedAt.delete(worker.tag);
        return;
    }

    const command = (abilityId: number, targetUnitTag?: string) => {
        actions.queueAction({ abilityId, unitTags: [worker.tag], targetUnitTag, queueCommand: false });
        state.lockedAt.set(worker.tag, now);
    };

    if (worker.isCarryingVespene() && mineralTag !== undefined) return command(HARVEST_RETURN);

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
