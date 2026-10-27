import { CANCEL_BUILDINPROGRESS, HARVEST_RETURN, MOVE, SMART } from '../constants/ability.ts';
import { Alliance, Race } from '../constants/enums.ts';
import { addonTypes, gasMineTypes, townhallTypes } from '../constants/groups.ts';
import { GasMineRace } from '../constants/race-map.ts';
import { BUILDING } from '../constants/unit-role.ts';
import * as UnitType from '../constants/unit-type.ts';
import { distanceSquared } from '../utils/geometry/point.ts';
import type {
    BuildingSettings,
    BuildingTracker,
    BuildOptions,
    CommandResult,
    Earmark,
    Point2D,
    ResourceDefinition,
    TrackedBuild,
    Unit,
    World,
} from '../types.ts';

const LOOPS_PER_SECOND = 22.4;
const STRUCTURE_AT_TARGET_SQUARED = 1.5 ** 2;
const GAS_RANGE = 3.2;
const BUILD_RANGE = 1;
const ENEMY_GAS_SQUARED = 4.5 ** 2;
const GEYSER_NEAR_TOWNHALL_SQUARED = 15 ** 2;
const GAS_TYPES = [...gasMineTypes, UnitType.ASSIMILATORRICH, UnitType.EXTRACTORRICH, UnitType.REFINERYRICH];
const CREEP_TUMORS = [UnitType.CREEPTUMOR, UnitType.CREEPTUMORBURROWED, UnitType.CREEPTUMORQUEEN];
const MORPHED_TOWNHALLS = [UnitType.ORBITALCOMMAND, UnitType.PLANETARYFORTRESS];

type Build = {
    -readonly [K in keyof TrackedBuild]: TrackedBuild[K];
} & {
    earmark?: string;
    placementRequest?: BuildOptions['placement'];
    reserved: boolean;
    pinned: boolean;
    adopted: boolean;
    finishedAt?: number;
};

type State = {
    settings: BuildingSettings;
    builds: Build[];
    nextId: number;
    healthByTag: Map<string, number>;
    unfinishedDone: Set<string>;
    optedIn: boolean;
    step: () => void;
};

const stateByTracker = new WeakMap<BuildingTracker, State>();

const isGas = (unitType: number) => GAS_TYPES.includes(unitType);

const isActive = (build: Build) => build.status !== 'done' && build.status !== 'failed';

const loopsToSeconds = (loops: number) => loops / LOOPS_PER_SECOND;

function context(world: World) {
    return world.resources.get();
}

function closestFreeWorker(world: World, near: Point2D, busy: Set<string>): Unit | undefined {
    const { units } = context(world);
    const free = (workers: Unit[]) =>
        workers.filter((worker) => !worker.labels.has('command') && !busy.has(worker.tag!));
    const candidates = free(units.getMineralWorkers());
    const pool = candidates.length > 0 ? candidates : free(units.getWorkers());
    return pool.length > 0 ? units.getClosest(near, pool)[0] : undefined;
}

function selectWorker(world: World, near: Point2D, busy: Set<string>): Unit | undefined {
    const { mining } = context(world);
    const picked = mining.selectWorker(near, { forceClose: true });
    return picked ?? (mining.isEnabled() ? undefined : closestFreeWorker(world, near, busy));
}

function affordable(world: World, unitType: number, earmark?: string): boolean {
    const { mineralCost = 0, vespeneCost = 0 } = world.data.getUnitTypeData(unitType);
    const reserved = world.data.getEarmarkTotals(earmark);
    return (
        (world.agent.minerals ?? 0) - reserved.minerals >= mineralCost &&
        (!vespeneCost || (world.agent.vespene ?? 0) - reserved.vespene >= vespeneCost)
    );
}

function hasBuilder(world: World, structure: Unit): boolean {
    const reach = (structure.radius ?? 0) + 1;
    return context(world)
        .units.getWorkers(true)
        .some(
            (worker) =>
                (worker.orders ?? []).some((order) => order.targetUnitTag === structure.tag) ||
                (worker.isConstructingScv() && worker.distanceTo(structure) <= reach),
        );
}

function freeGeysers(world: World, exclude: Set<string>): Unit[] {
    const { units, frame } = context(world);
    const gasBuildings = units.getAll().filter((unit) => unit.isCurrent() && isGas(unit.unitType!));
    const progress = loopsToSeconds(frame.getGameLoop()) > 300 ? 0.55 : 0.98;
    const townhalls = units.getBases().filter((townhall) => townhall.buildProgress! >= progress);
    return units
        .getGasGeysers()
        .filter(
            (geyser) =>
                !exclude.has(geyser.tag!) &&
                !gasBuildings.some((gas) => distanceSquared(gas.pos, geyser.pos) < 1) &&
                townhalls.some((townhall) => distanceSquared(townhall.pos, geyser.pos) <= GEYSER_NEAR_TOWNHALL_SQUARED),
        )
        .sort((a, b) => {
            const nearest = (geyser: Unit) =>
                Math.min(...townhalls.map((townhall) => distanceSquared(townhall.pos, geyser.pos)));
            return nearest(a) - nearest(b);
        });
}

export const buildingsResource: ResourceDefinition<'buildings'> = {
    name: 'buildings',
    create(world) {
        const state: State = {
            settings: { priority: 10, timeout: 120, maxAttempts: 5, cancelLowHp: 'tracked' },
            builds: [],
            nextId: 1,
            healthByTag: new Map(),
            unfinishedDone: new Set(),
            optedIn: false,
            step: () => {},
        };

        const track = (unitType: number, target: Point2D, worker: Unit, extra: Partial<Build>): Build => {
            const build: Build = {
                id: state.nextId++,
                unitType,
                target,
                workerTag: worker.tag,
                status: 'moving',
                requestedAt: context(world).frame.getGameLoop(),
                attempts: 0,
                reserved: false,
                pinned: false,
                adopted: false,
                ...extra,
            };
            state.builds.push(build);
            if (!build.adopted) state.optedIn = true;
            return build;
        };

        const busyWorkers = () =>
            new Set(state.builds.filter(isActive).flatMap((build) => (build.workerTag ? [build.workerTag] : [])));

        const tracker: BuildingTracker = {
            build(unitType, { at, placement: placementRequest, worker, earmark } = {}) {
                const { placement } = context(world);
                const geyser = at && 'tag' in at && isGas(unitType) ? at : undefined;
                const requested = at ? undefined : placement.request(unitType, placementRequest);
                const target = at ? ('tag' in at ? at.pos : at) : requested;
                if (!target) return undefined;

                const builder = worker ?? selectWorker(world, target, busyWorkers());
                if (!builder) {
                    if (requested) placement.release(requested);
                    return undefined;
                }
                context(world).roles.assign(builder, BUILDING);
                return track(unitType, { x: target.x, y: target.y }, builder, {
                    geyserTag: geyser?.tag,
                    earmark,
                    placementRequest,
                    reserved: !!requested,
                    pinned: !!at,
                });
            },
            buildGas({ geyser, max = 1 } = {}) {
                const { units } = context(world);
                const gasType = GasMineRace[world.agent.race as keyof typeof GasMineRace];
                const pendingGas = state.builds.filter((build) => isActive(build) && isGas(build.unitType));
                const unfinished = units
                    .getStructures()
                    .filter(
                        (structure) =>
                            isGas(structure.unitType!) &&
                            structure.buildProgress! < 1 &&
                            !pendingGas.some(
                                (build) =>
                                    build.structureTag === structure.tag ||
                                    distanceSquared(build.target, structure.pos) < STRUCTURE_AT_TARGET_SQUARED,
                            ),
                    );
                if (pendingGas.length + unfinished.length >= max) return undefined;

                const pendingGeysers = new Set(pendingGas.map((build) => build.geyserTag!));
                const target = geyser ?? freeGeysers(world, pendingGeysers)[0];
                if (!target) return undefined;
                return tracker.build(gasType, { at: target });
            },
            cancel(target) {
                const build =
                    'id' in target
                        ? state.builds.find((candidate) => candidate.id === target.id)
                        : state.builds.find(
                              (candidate) =>
                                  candidate.structureTag === target.tag ||
                                  (isActive(candidate) &&
                                      distanceSquared(candidate.target, target.pos) < STRUCTURE_AT_TARGET_SQUARED),
                          );
                const structure = 'id' in target ? structureAt(build) : (target as Unit);
                if (structure && structure.buildProgress! < 1) issue(structure, CANCEL_BUILDINPROGRESS);
                if (build && isActive(build)) finish(build, 'failed', 'cancelled');
            },
            pending(unitType) {
                return state.builds.filter(
                    (build) =>
                        isActive(build) && !build.adopted && (unitType === undefined || build.unitType === unitType),
                ).length;
            },
            getTracked() {
                return state.builds;
            },
            configure(next) {
                Object.assign(state.settings, next);
            },
        };

        function issue(
            unit: Unit,
            abilityId: number,
            target?: Point2D | Unit,
            onNotSent?: (tags: string[], result: CommandResult) => void,
        ) {
            const { actions, roles } = context(world);
            const command: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId,
                unitTags: [unit.tag!],
                queueCommand: false,
                ...(target && 'tag' in target
                    ? { targetUnitTag: target.tag }
                    : target
                      ? { targetWorldSpacePos: target }
                      : {}),
            };
            roles.as(BUILDING, () => actions.queueAction(command, onNotSent && { onNotSent }), {
                priority: state.settings.priority,
            });
        }

        function structureAt(build: Build | undefined): Unit | undefined {
            if (!build) return undefined;
            const { units } = context(world);
            if (build.structureTag) {
                const known = units.getByTag(build.structureTag);
                if (known && !known.labels.has('dead')) return known;
            }
            const gas = isGas(build.unitType);
            return units
                .getStructures()
                .find(
                    (structure) =>
                        (gas ? isGas(structure.unitType!) : structure.unitType === build.unitType) &&
                        distanceSquared(structure.pos, build.target) < STRUCTURE_AT_TARGET_SQUARED,
                );
        }

        function finish(build: Build, status: 'done' | 'failed', failure?: TrackedBuild['failure']) {
            const { mining, placement, frame } = context(world);
            build.status = status;
            build.failure = failure;
            build.finishedAt = frame.getGameLoop();
            if (build.workerTag && context(world).units.getByTag(build.workerTag)) mining.release(build.workerTag);
            if (status === 'done' && build.structureTag && !build.adopted) state.unfinishedDone.add(build.structureTag);
            if (status === 'failed' && build.reserved) placement.release(build.target);
        }

        function replan(build: Build): boolean {
            const { placement } = context(world);
            if (build.pinned) {
                finish(build, 'failed', 'blocked');
                return false;
            }
            if (build.reserved) placement.release(build.target);
            const next = placement.request(build.unitType, build.placementRequest);
            build.attempts = 0;
            if (!next) {
                build.reserved = false;
                finish(build, 'failed', 'noPlacement');
                return false;
            }
            build.target = next;
            build.reserved = true;
            return true;
        }

        function orderBuild(build: Build, worker: Unit) {
            const { frame } = context(world);
            const { abilityId, mineralCost = 0, vespeneCost = 0 } = world.data.getUnitTypeData(build.unitType);
            const geyser = build.geyserTag ? context(world).units.getByTag(build.geyserTag) : undefined;
            worker.labels.set('command', frame.getGameLoop());
            world.agent.minerals = (world.agent.minerals ?? 0) - mineralCost;
            world.agent.vespene = (world.agent.vespene ?? 0) - vespeneCost;
            const settled = build.earmark
                ? world.data.get('earmarks').filter((earmark: Earmark) => earmark.name === build.earmark)
                : [];
            if (build.earmark) world.data.settleEarmark(build.earmark);
            build.status = 'ordered';
            issue(worker, abilityId!, geyser ?? build.target, (_tags, result) => {
                worker.labels.delete('command');
                if (result.reason === 'repeat') return;
                settled.forEach((earmark: Earmark) => world.data.addEarmark(earmark));
                if (!isActive(build)) return;
                build.status = 'moving';
                build.attempts += 1;
                if (build.attempts >= state.settings.maxAttempts && !build.geyserTag) replan(build);
            });
        }

        function retargetTownhall(build: Build): boolean {
            const { map, placement } = context(world);
            const next = map
                .getAvailableExpansions()
                .map((expansion) => expansion.townhallPosition)
                .find((pos) => placement.canPlace(build.unitType, pos));
            if (!next) {
                finish(build, 'failed', 'blocked');
                return false;
            }
            build.target = next;
            return true;
        }

        function stepBuild(build: Build) {
            const { units, frame, pathing, placement } = context(world);
            const terran = world.agent.race === Race.TERRAN;
            const gas = isGas(build.unitType);

            const structure = structureAt(build);
            if (structure) build.structureTag = structure.tag;
            if (structure && structure.buildProgress! >= (terran ? 1 : Number.MIN_VALUE)) {
                finish(build, 'done');
                return;
            }
            if (structure && !terran) {
                build.status = 'constructing';
                return;
            }

            let worker = build.workerTag ? units.getByTag(build.workerTag) : undefined;
            if (!worker || worker.labels.has('dead')) {
                worker = selectWorker(world, build.target, busyWorkers());
                if (!worker) {
                    build.workerTag = undefined;
                    finish(build, 'failed', 'noWorker');
                    return;
                }
                context(world).roles.assign(worker, BUILDING);
                build.workerTag = worker.tag;
                if (build.status === 'ordered') build.status = 'moving';
            }

            if ((!terran || gas) && loopsToSeconds(frame.getGameLoop() - build.requestedAt) > state.settings.timeout) {
                finish(build, 'failed', 'timeout');
                return;
            }

            if (structure) {
                if (terran && !hasBuilder(world, structure)) issue(worker, SMART, structure);
                build.status = 'constructing';
                return;
            }

            const abilityId = world.data.getUnitTypeData(build.unitType).abilityId;
            if ((worker.orders ?? []).some((order) => order.abilityId === abilityId)) {
                build.status = 'ordered';
                return;
            }
            if (worker.isConstructingScv()) return;

            if (build.status !== 'ordered' && worker.isCarryingResource()) {
                issue(worker, HARVEST_RETURN);
                return;
            }

            const isTownhall = townhallTypes.includes(build.unitType);
            if (isTownhall && !placement.canPlace(build.unitType, build.target) && !retargetTownhall(build)) return;

            if (worker.distanceTo(build.target) > (gas ? GAS_RANGE : BUILD_RANGE)) {
                build.status = 'moving';
                issue(worker, MOVE, pathing.nextPoint(worker.pos, build.target));
                return;
            }

            if (gas) {
                const enemyGas = units
                    .getAll(Alliance.ENEMY)
                    .some(
                        (unit) => isGas(unit.unitType!) && distanceSquared(unit.pos, build.target) < ENEMY_GAS_SQUARED,
                    );
                if (enemyGas) {
                    const taken = new Set(
                        state.builds
                            .filter((other) => other !== build && isActive(other))
                            .map((other) => other.geyserTag!),
                    );
                    taken.add(build.geyserTag!);
                    const next = freeGeysers(world, taken)[0];
                    if (!next) {
                        finish(build, 'failed', 'blocked');
                        return;
                    }
                    build.geyserTag = next.tag;
                    build.target = { x: next.pos.x, y: next.pos.y };
                    return;
                }
            } else if (!isTownhall && !placement.canPlace(build.unitType, build.target)) {
                replan(build);
                return;
            }

            if (
                world.agent.techRequirementProgress(build.unitType) === 1 &&
                affordable(world, build.unitType, build.earmark)
            ) {
                orderBuild(build, worker);
            }
        }

        function adoptUnfinished() {
            const { units } = context(world);
            // opt-in (P4-D3): bots that never hand the tracker a build keep full control of their workers
            if (world.agent.race !== Race.TERRAN || !state.optedIn) return;
            const targets = state.builds.filter(isActive).map((build) => build.target);
            for (const structure of units.getStructures()) {
                if (
                    structure.buildProgress! >= 1 ||
                    addonTypes.includes(structure.unitType!) ||
                    MORPHED_TOWNHALLS.includes(structure.unitType!) ||
                    targets.some((target) => distanceSquared(target, structure.pos) < STRUCTURE_AT_TARGET_SQUARED) ||
                    hasBuilder(world, structure)
                )
                    continue;
                const worker = selectWorker(world, structure.pos, busyWorkers());
                if (!worker) return;
                context(world).roles.assign(worker, BUILDING);
                track(structure.unitType!, { x: structure.pos.x, y: structure.pos.y }, worker, {
                    adopted: true,
                    structureTag: structure.tag,
                    status: 'constructing',
                });
                issue(worker, SMART, structure);
                return;
            }
        }

        function cancelLowHp() {
            const { units } = context(world);
            const { cancelLowHp: mode } = state.settings;
            const seen = new Map<string, number>();
            for (const structure of units.getStructures()) {
                if (structure.buildProgress! >= 1 || CREEP_TUMORS.includes(structure.unitType!)) continue;
                const health = structure.health ?? 0;
                seen.set(structure.tag!, health);
                const previous = state.healthByTag.get(structure.tag!);
                // ares cancels on damage only; unfinished Terran structures start below the threshold
                if (mode === 'off' || previous === undefined || health >= previous) continue;
                if (health >= Math.max(50, 0.09 * (structure.healthMax ?? 0))) continue;
                const build = state.builds.find(
                    (candidate) => isActive(candidate) && candidate.structureTag === structure.tag,
                );
                const trackedDone = state.unfinishedDone.has(structure.tag!);
                if (mode === 'tracked' && !trackedDone && (!build || build.adopted)) continue;
                issue(structure, CANCEL_BUILDINPROGRESS);
                if (build) finish(build, 'failed', 'cancelled');
            }
            state.healthByTag = seen;
            state.unfinishedDone = new Set([...state.unfinishedDone].filter((tag) => seen.has(tag)));
        }

        state.step = () => {
            const loop = context(world).frame.getGameLoop();
            state.builds = state.builds.filter((build) => isActive(build) || build.finishedAt === loop);
            const { placement } = context(world);
            for (const build of state.builds) {
                if (!isActive(build) || !build.reserved) continue;
                // reserve() won't refresh an already-reserved spot, so a long wait would expire it
                placement.release(build.target);
                placement.reserve(build.target);
            }
            state.builds.filter(isActive).forEach(stepBuild);
            adoptUnfinished();
            cancelLowHp();
        };
        stateByTracker.set(tracker, state);
        return tracker;
    },
    reset(tracker) {
        const state = stateByTracker.get(tracker)!;
        state.builds = [];
        state.nextId = 1;
        state.healthByTag = new Map();
        state.unfinishedDone = new Set();
        state.optedIn = false;
    },
    onStep(tracker) {
        stateByTracker.get(tracker)!.step();
    },
};
