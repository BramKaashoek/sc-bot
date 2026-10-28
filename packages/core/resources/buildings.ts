import { CANCEL_BUILDINPROGRESS, HARVEST_RETURN, MOVE, SMART } from '../constants/ability.ts';
import { Alliance, Race } from '../constants/enums.ts';
import { SCANNERSWEEP } from '../constants/effect.ts';
import { DETECTOR_RANGES } from '../constants/detection.ts';
import { addonTypes, creepTumorTypes, gasMineTypes, townhallTypes } from '../constants/groups.ts';
import { GasMineRace } from '../constants/race-map.ts';
import { BUILDING } from '../constants/unit-role.ts';
import * as UnitType from '../constants/unit-type.ts';
import { distanceSquared } from '../utils/geometry/point.ts';
import { affordable, spend } from '../agent/macro.ts';
import { selectBuilder } from '../utils/workers/select-builder.ts';
import type {
    BuildingSettings,
    BuildingTracker,
    BuildOptions,
    CommandResult,
    Earmark,
    OwnedEffect,
    Point2D,
    ResourceDefinition,
    TrackedBuild,
    Unit,
    World,
} from '../types.ts';
import { GAME_LOOPS_PER_SECOND } from '../constants/time.ts';

const STRUCTURE_AT_TARGET_SQUARED = 1.5 ** 2;
const GAS_RANGE = 3.2;
const BUILD_RANGE = 1;
const ENEMY_GAS_SQUARED = 4.5 ** 2;
const GEYSER_NEAR_TOWNHALL_SQUARED = 15 ** 2;
const STALL_LOOPS = 10 * GAME_LOOPS_PER_SECOND;
const STALL_DISTANCE_SQUARED = 1;
const STALL_COOLDOWN_LOOPS = 60 * GAME_LOOPS_PER_SECOND;
const EXPANSION_BLOCK_RADIUS = 5.5;
const EXPANSION_BLOCK_SQUARED = EXPANSION_BLOCK_RADIUS ** 2;
const DETECTOR_RANGE = 7;
const ENEMY_CLEAR_RANGE = 9;
const CANT_BUILD_LOCATION_INVALID = 44;
const DETECTOR_TYPES = Object.keys(DETECTOR_RANGES).map(Number);
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
    stall?: { workerTag: string; target: Point2D; pos: Point2D; since: number };
    stalls: number;
    suppliedWorker: boolean;
};

type State = {
    settings: BuildingSettings;
    builds: Build[];
    nextId: number;
    healthByTag: Map<string, number>;
    unfinishedDone: Set<string>;
    stalledWorkers: Map<string, { unitType: number; until: number }>;
    optedIn: boolean;
    blocked: Point2D[];
};

export const stateByBuildings = new WeakMap<BuildingTracker, State>();

const stepByBuildings = new WeakMap<BuildingTracker, () => void>();

const freshState = (settings: BuildingSettings): State => ({
    settings,
    builds: [],
    nextId: 1,
    healthByTag: new Map(),
    unfinishedDone: new Set(),
    stalledWorkers: new Map(),
    optedIn: false,
    blocked: [],
});

const isGas = (unitType: number) => gasMineTypes.includes(unitType);

const isActive = (build: Build) => build.status !== 'done' && build.status !== 'failed';

const loopsToSeconds = (loops: number) => loops / GAME_LOOPS_PER_SECOND;

function context(world: World) {
    return world.resources.get();
}

function selectWorker(world: World, near: Point2D, busy: Set<string>): Unit | undefined {
    const { mining } = context(world);
    return mining.isEnabled()
        ? mining.selectWorker(near, { forceClose: true, exclude: busy })
        : selectBuilder(world, near, { exclude: busy });
}

export function stalledWorkers(world: World, unitType: number): Set<string> {
    const state = stateByBuildings.get(context(world).buildings)!;
    const loop = context(world).frame.getGameLoop();
    const stalled = new Set<string>();
    state.stalledWorkers.forEach((stall, tag) => {
        if (stall.until <= loop) state.stalledWorkers.delete(tag);
        else if (stall.unitType === unitType) stalled.add(tag);
    });
    return stalled;
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
        const state = freshState({ priority: 10, timeout: 120, maxAttempts: 5, cancelLowHp: 'tracked' });

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
                stalls: 0,
                suppliedWorker: false,
                ...extra,
            };
            state.builds.push(build);
            if (!build.adopted) state.optedIn = true;
            return build;
        };

        const busyWorkers = (unitType: number) =>
            new Set([
                ...state.builds.filter(isActive).flatMap((build) => (build.workerTag ? [build.workerTag] : [])),
                ...stalledWorkers(world, unitType),
            ]);

        const tracker: BuildingTracker = {
            build(unitType, { at, placement: placementRequest, worker, earmark } = {}) {
                const { placement } = context(world);
                const geyser = at && 'tag' in at && isGas(unitType) ? at : undefined;
                const requested = at ? undefined : placement.request(unitType, placementRequest);
                const target = at ? ('tag' in at ? at.pos : at) : requested;
                if (!target) return undefined;

                const builder = worker ?? selectWorker(world, target, busyWorkers(unitType));
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
                    suppliedWorker: !!worker,
                });
            },
            getNextExpansion({ checkSafe = true } = {}) {
                return nextExpansion(checkSafe);
            },
            isExpansionBlocked(pos) {
                return isBlocked(pos);
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
            const { abilityId } = world.data.getUnitTypeData(build.unitType);
            const geyser = build.geyserTag ? context(world).units.getByTag(build.geyserTag) : undefined;
            worker.labels.set('command', frame.getGameLoop());
            spend(world.agent, world.agent.calculateCost(build.unitType));
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
                if (
                    result.result === CANT_BUILD_LOCATION_INVALID &&
                    townhallTypes.includes(build.unitType) &&
                    !isListed(build.target)
                ) {
                    state.blocked.push(build.target);
                }
                build.status = 'moving';
                build.attempts += 1;
                if (build.attempts >= state.settings.maxAttempts && !build.geyserTag) replan(build);
            });
        }

        const isListed = (pos: Point2D) => state.blocked.some((other) => other.x === pos.x && other.y === pos.y);

        function isBlocked(pos: Point2D): boolean {
            const { spatial, units } = context(world);
            if (isListed(pos)) return true;
            if (
                spatial
                    .unitsInRange(pos, EXPANSION_BLOCK_RADIUS, 'enemyGround')
                    .some((unit) => unit.unitType !== UnitType.AUTOTURRET)
            ) {
                return true;
            }
            if (
                spatial
                    .unitsInRange(pos, EXPANSION_BLOCK_RADIUS, 'own')
                    .some((unit) => townhallTypes.includes(unit.unitType!))
            ) {
                return true;
            }
            return [...units.getDestructables(), ...units.getWatchtowers()].some(
                (unit) => distanceSquared(unit.pos, pos) < EXPANSION_BLOCK_SQUARED,
            );
        }

        // own townhalls only block once they exist as units; a build still walking there has no structure yet
        const isTargeted = (pos: Point2D) =>
            state.builds.some(
                (build) =>
                    isActive(build) &&
                    townhallTypes.includes(build.unitType) &&
                    distanceSquared(build.target, pos) < EXPANSION_BLOCK_SQUARED,
            );

        function nextExpansion(checkSafe: boolean, accept: (pos: Point2D) => boolean = () => true) {
            const { map, pathing } = context(world);
            return map
                .getAvailableExpansions()
                .map((expansion) => expansion.townhallPosition)
                .find(
                    (pos) =>
                        !isBlocked(pos) &&
                        !isTargeted(pos) &&
                        (!checkSafe || pathing.isPositionSafe(pos)) &&
                        accept(pos),
                );
        }

        function clearBlocked() {
            const { spatial, map } = context(world);
            const scans = (map.getEffects() as OwnedEffect[]).filter(
                (effect) => effect.effectId === SCANNERSWEEP && effect.alliance === Alliance.SELF,
            );
            state.blocked = state.blocked.filter((pos) => {
                const detected =
                    spatial
                        .unitsInRange(pos, DETECTOR_RANGE, 'own')
                        .some((unit) => DETECTOR_TYPES.includes(unit.unitType!)) ||
                    scans.some((scan) =>
                        (scan.pos ?? []).some(
                            (center) => distanceSquared(center as Point2D, pos) <= DETECTOR_RANGE ** 2,
                        ),
                    );
                return !detected || spatial.anyInRange(pos, ENEMY_CLEAR_RANGE, 'enemy');
            });
        }

        function retargetTownhall(build: Build): boolean {
            const { placement } = context(world);
            const next = nextExpansion(true, (pos) => placement.canPlace(build.unitType, pos));
            if (!next) {
                finish(build, 'failed', 'blocked');
                return false;
            }
            build.target = next;
            return true;
        }

        // a detour via a ramp first walks away from the target, so closing distance can't measure progress
        function stalled(build: Build, worker: Unit): boolean {
            const loop = context(world).frame.getGameLoop();
            const { stall } = build;
            if (
                stall?.workerTag === worker.tag &&
                stall.target === build.target &&
                distanceSquared(stall.pos, worker.pos) <= STALL_DISTANCE_SQUARED
            ) {
                return loop - stall.since > STALL_LOOPS;
            }
            build.stall = {
                workerTag: worker.tag!,
                target: build.target,
                pos: { x: worker.pos.x, y: worker.pos.y },
                since: loop,
            };
            return false;
        }

        function replaceWorker(build: Build, stalled: Unit) {
            const next = selectWorker(world, build.target, busyWorkers(build.unitType));
            if (!next) return;
            context(world).mining.release(stalled);
            context(world).roles.assign(next, BUILDING);
            build.workerTag = next.tag;
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
                worker = selectWorker(world, build.target, busyWorkers(build.unitType));
                if (!worker) {
                    build.workerTag = undefined;
                    finish(build, 'failed', 'noWorker');
                    return;
                }
                context(world).roles.assign(worker, BUILDING);
                build.workerTag = worker.tag;
                build.suppliedWorker = false;
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
            if (isTownhall) {
                const rejected = frame
                    .getActionErrors()
                    .some((error) => error.unitTag === worker.tag && error.result === CANT_BUILD_LOCATION_INVALID);
                if (rejected && !isListed(build.target)) state.blocked.push(build.target);
                if (
                    (isListed(build.target) || !placement.canPlace(build.unitType, build.target)) &&
                    !retargetTownhall(build)
                ) {
                    return;
                }
            }

            if (worker.distanceTo(build.target) > (gas ? GAS_RANGE : BUILD_RANGE)) {
                build.status = 'moving';
                if (stalled(build, worker)) {
                    // SC2 parks a MOVE to an unreachable spot at the closest reachable point, so re-issuing never ends
                    build.stall = undefined;
                    build.stalls += 1;
                    state.stalledWorkers.set(worker.tag!, {
                        unitType: build.unitType,
                        until: frame.getGameLoop() + STALL_COOLDOWN_LOOPS,
                    });
                    if (build.stalls > 1) finish(build, 'failed', 'blocked');
                    else if (replan(build) && !build.suppliedWorker) replaceWorker(build, worker);
                    return;
                }
                issue(worker, MOVE, pathing.nextPoint(worker.pos, build.target));
                return;
            }
            build.stall = undefined;

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
                affordable(world, world.agent.calculateCost(build.unitType), build.earmark)
            ) {
                orderBuild(build, worker);
            }
        }

        function adoptUnfinished() {
            const { units } = context(world);
            // bots that never hand the tracker a build keep full control of their workers
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
                const worker = selectWorker(world, structure.pos, busyWorkers(structure.unitType!));
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
                if (structure.buildProgress! >= 1 || creepTumorTypes.includes(structure.unitType!)) continue;
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

        stepByBuildings.set(tracker, () => {
            clearBlocked();
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
        });
        stateByBuildings.set(tracker, state);
        return tracker;
    },
    reset(tracker) {
        const state = stateByBuildings.get(tracker)!;
        // create()'s closures hold this object, so it is reseated in place
        Object.assign(state, freshState(state.settings));
    },
    onStep(tracker) {
        stepByBuildings.get(tracker)!();
    },
};
