import createDebug from 'debug';
import { add, distance, multiply, normalize, subtract } from '../utils/geometry/point.ts';
import getRandom from '../utils/get-random.ts';
import { BuildOrder, BuildOrderId, BuildResult, Race } from '../constants/enums.ts';
import type { BuildOrderStatus } from '../constants/enums.ts';
import * as ability from '../constants/ability.ts';
import { SupplyUnitRace, TownhallRace, WorkerRace } from '../constants/race-map.ts';
import { gasMineTypes, townhallTypes, addonTypes, structureTypes } from '../constants/groups.ts';
import { Upgrade, UnitType, UnitTypeId, AbilityId, UpgradeId, Color } from '../constants/index.ts';
import { ENEMY_NAT_VISION, ENEMY_SPAWN, NAT } from '../constants/build-target.ts';
import { BUILD_RUNNER_SCOUT, GATHERING, PERSISTENT_BUILDER } from '../constants/unit-role.ts';
import { autoSupply } from '../behaviors/macro/structures.ts';
import { NodeSC2Error } from '../engine/errors.ts';
import { parseBuildOrder } from '../utils/build-order/parse.ts';
import { resolveTarget, scoutWaypoints, structurePlacement } from '../utils/build-order/targets.ts';
import type {
    BuildOptions,
    BuildOrderStep,
    BuildSystemObject,
    BuildTask,
    BuildTaskI,
    EventReader,
    OpeningDefinition,
    PlacementFlag,
    PlacementRequest,
    Point2D,
    System,
    TaskFunctions,
    Unit,
    World,
} from '../types.ts';

const debugBuild = createDebug('sc2:debug:build');
const debugDraw = createDebug('sc2:DrawDebug');
const debugBuildSilly = createDebug('sc2:silly:build');

const { BUILD_REACTOR, BUILD_TECHLAB, HARVEST_RETURN, MOVE, MORPH_ORBITALCOMMAND, MORPH_PLANETARYFORTRESS } = ability;
const { PYLON, BARRACKS, FACTORY, STARPORT, SUPPLYDEPOT, OVERLORD } = UnitType;
const addonHostTypes = [BARRACKS, FACTORY, STARPORT];

const NOOP = () => {};

let pluginCount = 0;

const PERSISTENT_EARLY_SUPPLY = 13;
const PERSISTENT_EARLY_TIME = 3;
const PERSISTENT_LATE_TIME = 9;
const ORBITAL_TECH_READY = 0.95;
const townhallMorphs = [MORPH_ORBITALCOMMAND, MORPH_PLANETARYFORTRESS];

type BuildTaskRuntime = Omit<BuildTaskI, 'id' | 'qty' | 'index' | 'started' | 'status'> & {
    id: number;
    qty: number;
    index: number;
    started: number | null;
    status: BuildOrderStatus;
};

type TrainTask = Omit<BuildTaskRuntime, 'id'> & { id: number | number[] };

type BuildFn = (world: World, task: BuildTaskRuntime) => Promise<BuildResult>;

type StepFn = (world: World, gameLoop: number, task?: BuildTaskRuntime, result?: BuildResult) => any;

const taskFunctions: TaskFunctions = {
    ability: (id, opts = {}) => ({ type: 'ability', id, qty: 1, opts }),
    build: (id, qty = 1, opts = {}) => ({ type: 'build', id, qty, opts }),
    train: (id, qty = 1, opts = {}) => ({ type: 'train', id, qty, opts }),
    upgrade: (id) => ({ type: 'upgrade', id, qty: 1 }),
    scout: (scout, waypoints = [scout === 'worker' ? ENEMY_SPAWN : ENEMY_NAT_VISION]) => ({
        type: 'scout',
        qty: 1,
        opts: { scout, waypoints },
    }),
    addonSwap: (host, addon) => ({ type: 'addonSwap', id: host, qty: 1, opts: { addon } }),
};

function builderPlugin(system: EventReader<System>): void {
    const prefix = `build${pluginCount++}`;
    const earmarkName = (task: BuildTaskRuntime) => `${prefix}:task${task.index}`;
    const buildSym = Symbol('build');
    const completeSym = Symbol('complete');

    system.buildOptions = {
        paused: false,
        earmarks: 1000,
        ...system.buildOptions,
    };

    system.pauseBuild = function () {
        system.buildOptions!.paused = true;
    };

    system.resumeBuild = function () {
        system.buildOptions!.paused = false;
    };

    system.earmarkDelay = function (delay: number) {
        system.buildOptions!.earmarks = delay;
    };

    const buildFnSyms: { [index: string]: symbol } = {
        ability: Symbol('ability'),
        build: Symbol('build'),
        train: Symbol('train'),
        upgrade: Symbol('upgrade'),
        attack: Symbol('attack'),
        worker: Symbol('worker'),
        scout: Symbol('scout'),
        addonSwap: Symbol('addonSwap'),
    };

    const buildFns: Record<symbol, BuildFn> = {};

    const baseFillWorkers = system.buildOptions.fillWorkers;
    let defs: Record<string, OpeningDefinition> | undefined;
    let currentOpening: string | undefined;
    let currentWorld: World | undefined;
    let persistent: { picked: boolean; tag?: string } = { picked: false };

    const systemOnGameStart = system.onGameStart ? system.onGameStart.bind(system) : NOOP;
    const { onStep } = system as unknown as BuildSystemObject;
    const systemOnStep: StepFn = onStep ? onStep.bind(system) : NOOP;
    const buildComplete = system.buildComplete ? system.buildComplete.bind(system) : NOOP;

    function createTask(taskData: object, index: number, supply?: number) {
        return {
            qty: 1,
            ...taskData,
            index,
            touched: false,
            supply: supply ? supply : null,
            status: BuildOrder.NOT_STARTED,
            started: null,
            earmarked: false,
        };
    }

    const workerTask = {
        type: 'worker',
        qty: 1,
    };

    function calculateSupply({ agent, data }: World, acc: { supply: number }, supply: number, task: BuildTaskI) {
        const isZerg = agent.race === Race.ZERG;

        if (task.type === 'train') {
            const ids = Array.isArray(task.id) ? task.id : [task.id!];
            acc.supply = supply + Math.max(...ids.map((id) => data.getUnitTypeData(id).foodRequired!)) * task.qty!;
        } else if (task.type === 'build') {
            if (isZerg) {
                acc.supply = acc.supply - 1;
            } else {
                acc.supply = supply;
            }
        } else {
            acc.supply = supply;
        }
    }

    function normalizeBuildOrder(world: World, steps: Array<BuildTask | BuildOrderStep>) {
        const bo = parseBuildOrder(steps, world.agent.race!);
        if (system.buildOptions!.fillWorkers === false) {
            return bo.map((step, i) => (Array.isArray(step) ? createTask(step[1], i, step[0]) : createTask(step, i)));
        }
        return bo.reduce<{
            supply: number;
            buildOrder: object[];
            reducerIndex: number;
        }>(
            (acc, step) => {
                const [supply, task] = Array.isArray(step) ? step : [acc.supply, step];
                if (acc.supply >= supply) {
                    acc.buildOrder.push(createTask(task, acc.reducerIndex));
                    calculateSupply(world, acc, supply, task);
                    acc.reducerIndex++;
                    return acc;
                } else {
                    Array.from({ length: supply - acc.supply }).forEach(() => {
                        acc.buildOrder.push(createTask(workerTask, acc.reducerIndex, supply));
                        acc.supply = acc.supply + 1;
                        acc.reducerIndex++;
                    });

                    acc.buildOrder.push(createTask(task, acc.reducerIndex));
                    acc.reducerIndex++;
                    calculateSupply(world, acc, supply, task);
                    return acc;
                }
            },
            { supply: 12, buildOrder: [], reducerIndex: 0 },
        ).buildOrder;
    }

    const openingTasks = (world: World, name: string) => {
        const def = defs![name];
        system.buildOptions!.fillWorkers = (def.constantWorkerProductionTill ?? 0) > 0 ? false : baseFillWorkers;
        return normalizeBuildOrder(world, def.buildOrder);
    };

    const present = ({ agent, resources }: World, id: number) => {
        const { buildings, units } = resources.get();
        const existing = units.getById(id).length;
        return existing + (structureTypes.includes(id) ? buildings.pending(id) : agent.alreadyPending(id));
    };

    // ares build_order_parser.py _remove_completed_steps
    const removeCompleted = (world: World, tasks: BuildTaskRuntime[]) => {
        const { agent } = world;
        const worker = WorkerRace[agent.race!];
        const seen = new Map<number, number>([
            [TownhallRace[agent.race!][0], 1],
            [OVERLORD, 1],
            [worker, 12],
        ]);
        return tasks.filter((task) => {
            if (
                task.type === 'scout' ||
                (task.type === 'ability' && task.id === ability.EFFECT_CHRONOBOOSTENERGYCOST)
            ) {
                return false;
            }
            if (task.type === 'upgrade') return !(agent.alreadyPendingUpgrade(task.id) > 0);
            const id = task.type === 'worker' ? worker : task.type === 'build' || task.type === 'train' ? task.id : 0;
            if (!id || Array.isArray(id)) return true;
            const total = present(world, id);
            const count = seen.get(id) ?? 0;
            if (count >= total) return true;
            seen.set(id, count + 1);
            return false;
        });
    };

    system.onGameStart = async function (world: World) {
        currentWorld = world;
        persistent = { picked: false };
        defs = undefined;
        currentOpening = undefined;

        if (system.openings) {
            if (system.buildOrder?.length)
                console.warn('Build system has both openings and buildOrder, ignoring buildOrder');
            const { openings } = world.resources.get();
            defs = system.openings === 'config' ? { ...openings.getDefinitions() } : system.openings;
            const name =
                typeof system.opening === 'function'
                    ? system.opening(world)
                    : (system.opening ?? openings.choose(Object.keys(defs)));
            if (name === undefined || !defs[name]) {
                throw new NodeSC2Error(`Unknown opening "${name}", available: ${Object.keys(defs).join(', ')}`);
            }
            currentOpening = name;
            openings.record(name);
            this.setState({ [buildSym]: openingTasks(world, name) });
        } else {
            this.setState({
                [buildSym]: normalizeBuildOrder(world, system.buildOrder!),
            });
        }

        return systemOnGameStart(world);
    };

    system.getOpening = () => currentOpening;

    system.switchOpening = function (name: string, { removeCompleted: remove = true } = {}) {
        if (!defs || !currentWorld || name === currentOpening) return;
        if (!defs[name])
            throw new NodeSC2Error(`Unknown opening "${name}", available: ${Object.keys(defs).join(', ')}`);
        currentOpening = name;
        for (const task of system.state[buildSym] as BuildTaskRuntime[]) {
            if (task.earmarked) currentWorld.data.settleEarmark(earmarkName(task));
        }
        releasePersistent(currentWorld);
        persistent = { picked: false };
        const tasks = openingTasks(currentWorld, name) as BuildTaskRuntime[];
        const kept = remove ? removeCompleted(currentWorld, tasks) : tasks;
        system.setState({
            [buildSym]: kept.map((task, index) => ({ ...task, index })),
            [completeSym]: false,
        });
    };

    const isOpen = ({ status }: BuildTaskRuntime) =>
        status === BuildOrder.COMMAND_GIVEN || status === BuildOrder.IN_PROGRESS || status === BuildOrder.NOT_STARTED;

    const runTasks = async function (this: EventReader<System>, world: World, gameLoop: number) {
        if (system.buildOptions!.paused) {
            return systemOnStep(world, gameLoop);
        }

        const task: BuildTaskRuntime | undefined = this.state[buildSym].find(isOpen);

        if (!task) {
            if (this.state[completeSym]) {
                return systemOnStep(world, gameLoop);
            } else {
                this.setState({ [completeSym]: true });
                releasePersistent(world);
                return buildComplete(world, gameLoop);
            }
        }

        const buildTask: BuildTaskRuntime = this.state[buildSym][task.index];

        if (buildTask.status === BuildOrder.COMMAND_GIVEN) {
            if (gameLoop - buildTask.commanded! >= 250 && world.resources.get().buildings.pending(buildTask.id) === 0) {
                buildTask.status = BuildOrder.NOT_STARTED;
            }
        }

        if (
            system.buildOptions!.fillWorkers === false &&
            buildTask.status === BuildOrder.NOT_STARTED &&
            buildTask.supply &&
            world.agent.supplyUsed < buildTask.supply
        ) {
            return systemOnStep(world, gameLoop, buildTask, BuildResult.CANNOT_SATISFY);
        }

        if (task.opts && task.opts.skip) {
            if (system.state[task.opts.skip]) {
                buildTask.status = BuildOrder.SKIPPED;
                return systemOnStep(world, gameLoop, this.state[buildSym][task.index], BuildResult.SKIPPED);
            }
        }

        if (buildTask.touched === false) {
            const taskName =
                buildTask.type === 'ability'
                    ? AbilityId[buildTask.id]
                    : buildTask.type === 'upgrade'
                      ? UpgradeId[buildTask.id]
                      : UnitTypeId[buildTask.id];
            debugBuild(`starting new build task: ${buildTask.type} ${taskName}`);
            buildTask.started = gameLoop;
            buildTask.touched = true;
        }

        if (debugDraw.enabled) {
            world.resources.get().debug!.setDrawTextScreen('buildOrder', [
                {
                    pos: { x: 0.85, y: 0.1 },
                    text: `Build:\n\n${this.state[buildSym]
                        .map((buildTask: BuildTaskRuntime, i: number) => {
                            let reverseId;
                            if (buildTask.type === 'build' || buildTask.type === 'train') {
                                reverseId = UnitTypeId[buildTask.id];
                            } else if (buildTask.type === 'ability') {
                                reverseId = AbilityId[buildTask.id];
                            } else if (buildTask.type === 'upgrade') {
                                reverseId = UpgradeId[buildTask.id];
                            } else {
                                reverseId = UnitTypeId[WorkerRace[world.agent.race!]];
                            }

                            return `${String(i).padStart(2, '0')} ${BuildOrderId[buildTask.status]}: ${buildTask.type} - ${reverseId}`;
                        })
                        .join('\n')}`,
                    color: Color.YELLOW,
                },
            ]);
        }

        if (this.buildOptions!.earmarks && buildTask.status !== BuildOrder.COMMAND_GIVEN) {
            if (gameLoop - buildTask.started! >= this.buildOptions!.earmarks) {
                let cost: SC2APIProtocol.UnitTypeData | SC2APIProtocol.UpgradeData | undefined;
                switch (buildTask.type) {
                    case 'train':
                    case 'build': {
                        cost = world.data.getUnitTypeData(buildTask.id);
                        break;
                    }
                    case 'upgrade': {
                        cost = world.data.getUpgradeData(buildTask.id);
                        break;
                    }
                    case 'ability': {
                        const unitFromAbility = world.data
                            .get('units')
                            .find((ud: SC2APIProtocol.UnitTypeData) => ud.available && ud.abilityId === buildTask.id);
                        if (unitFromAbility) {
                            cost = world.data.getUnitTypeData(buildTask.id);
                        }
                        break;
                    }
                }

                const canAfford =
                    buildTask.type === 'upgrade'
                        ? world.agent.canAffordUpgrade(buildTask.id)
                        : world.agent.canAfford(buildTask.id);
                if (cost && !canAfford) {
                    world.data.addEarmark({
                        name: earmarkName(buildTask),
                        minerals: cost.mineralCost!,
                        vespene: cost.vespeneCost!,
                    });
                    buildTask.earmarked = true;
                }
            }
        }

        const result = await buildFns[buildFnSyms[task.type]](world, task);

        switch (result) {
            case BuildResult.SUCCESS: {
                if (task.qty > 1) {
                    buildTask.qty -= 1;
                    buildTask.status = BuildOrder.IN_PROGRESS;
                } else if (task.qty === 1) {
                    buildTask.qty = 0;
                    buildTask.status = BuildOrder.COMPLETE;
                    if (task.type === 'build' && task.id === PYLON && world.agent.race === Race.PROTOSS) {
                        releasePersistent(world);
                    }
                }
                break;
            }
            case BuildResult.COMMAND_SENT: {
                buildTask.commanded = gameLoop;
                buildTask.status = BuildOrder.COMMAND_GIVEN;
                break;
            }
            case BuildResult.CANNOT_SATISFY: {
                break;
            }
            case BuildResult.ERROR: {
                break;
            }
        }

        return systemOnStep(world, gameLoop, this.state[buildSym][task.index], result);
    };

    system.onStep = async function (world: World, gameLoop: number) {
        const active = () => defs && !system.buildOptions!.paused && !this.state[completeSym];
        if (active()) reclaimPersistent(world);
        const result = await runTasks.call(this, world, gameLoop);
        if (active()) await runOpeningOptions(world, this.state[buildSym].find(isOpen));
        return result;
    };

    const pickWorker = (world: World, role: typeof BUILD_RUNNER_SCOUT | typeof PERSISTENT_BUILDER) => {
        const { map, mining, roles, units } = world.resources.get();
        const main = map.getMain().townhallPosition;
        if (mining.isEnabled()) return mining.selectWorker(main, { role });
        const free = units.getMineralWorkers().filter((worker) => roles.roleOf(worker) === GATHERING);
        const [worker] = units.getClosest(main, free);
        if (worker) roles.assign(worker, role);
        return worker;
    };

    const persistentWorker = ({ resources }: World) =>
        persistent.tag ? resources.get().units.getByTag(persistent.tag) : undefined;

    const releasePersistent = (world: World) => {
        const worker = persistentWorker(world);
        persistent.tag = undefined;
        const { mining, roles } = world.resources.get();
        // a BUILDING worker goes back via the tracker
        if (!worker || roles.roleOf(worker) !== PERSISTENT_BUILDER) return;
        if (mining.isEnabled()) mining.release(worker);
        else roles.assign(worker, GATHERING);
    };

    // the tracker hands a builder back to GATHERING when its build finishes; other roles are someone else's pick
    const reclaimPersistent = (world: World) => {
        const worker = persistentWorker(world);
        const { roles } = world.resources.get();
        if (worker && roles.roleOf(worker) === GATHERING) roles.assign(worker, PERSISTENT_BUILDER);
    };

    // a builder busy on a tracked build holds the BUILDING role
    const builderFor = (world: World) => {
        const worker = persistentWorker(world);
        return worker && world.resources.get().roles.roleOf(worker) === PERSISTENT_BUILDER ? worker : undefined;
    };

    const firstSupplyStep = (world: World, steps: Array<BuildTask | BuildOrderStep>) => {
        const supplyType = SupplyUnitRace[world.agent.race as keyof typeof SupplyUnitRace];
        for (const step of parseBuildOrder(steps, world.agent.race!)) {
            const [supply, task] = Array.isArray(step) ? step : [undefined, step];
            if (task.type === 'build' && task.id === supplyType) return { supply, task };
        }
        return undefined;
    };

    const assignPersistent = (world: World, def: OpeningDefinition) => {
        const { actions, frame, placement, roles } = world.resources.get();
        const first = firstSupplyStep(world, def.buildOrder);
        if (!first) return;
        const early = (first.supply ?? 0) <= PERSISTENT_EARLY_SUPPLY || first.task.opts?.at === NAT;
        if (frame.time() < (early ? PERSISTENT_EARLY_TIME : PERSISTENT_LATE_TIME)) return;

        const worker = pickWorker(world, PERSISTENT_BUILDER);
        if (!worker) return;
        persistent = { picked: true, tag: worker.tag };

        const task = first.task as BuildTaskRuntime;
        const targeted = task.opts?.at === undefined ? undefined : structurePlacement(world, task.id, task.opts.at);
        const requested =
            targeted && 'at' in targeted
                ? undefined
                : targeted && 'near' in targeted
                  ? undefined
                  : placement.request(task.id, targeted?.placement ?? placementRequest(world, task));
        const point =
            (targeted && 'at' in targeted && targeted.at) ||
            (targeted && 'near' in targeted && targeted.near) ||
            requested;
        if (!point) return;
        roles.as(PERSISTENT_BUILDER, () =>
            actions.queueAction([
                { abilityId: MOVE, unitTags: [worker.tag!], targetWorldSpacePos: point, queueCommand: false },
            ]),
        );
        // the tracker re-requests the spot when the depot is built
        if (requested) placement.release(requested);
    };

    // judged after the step ran, as in ares, so a morph that just became current already holds
    const holdsTownhall = ({ agent }: World, task?: BuildTaskRuntime) =>
        !!task &&
        task.type === 'ability' &&
        townhallMorphs.includes(task.id) &&
        agent.supplyUsed >= (task.supply ?? 0) &&
        !(
            task.id === MORPH_ORBITALCOMMAND &&
            agent.techRequirementProgress(UnitType.ORBITALCOMMAND) < ORBITAL_TECH_READY
        );

    const runOpeningOptions = async (world: World, current?: BuildTaskRuntime) => {
        const { agent, resources } = world;
        const { behaviors, units } = resources.get();
        const def = defs![currentOpening!];

        const till = def.constantWorkerProductionTill ?? 0;
        const workerType = WorkerRace[agent.race!];
        if (
            till > 0 &&
            agent.supplyWorkers < till &&
            agent.supplyLeft > 0 &&
            agent.canAfford(workerType) &&
            units.getById(townhallTypes).some((th) => th.isFinished() && th.noQueue)
        ) {
            if (!holdsTownhall(world, current)) await agent.train(workerType, 1);
        }

        if (def.autoSupplyAtSupply !== undefined && agent.supplyUsed >= def.autoSupplyAtSupply) {
            await behaviors.run(autoSupply({}));
        }

        if (
            def.persistentWorker !== false &&
            (agent.race === Race.TERRAN || agent.race === Race.PROTOSS) &&
            !persistent.picked
        ) {
            assignPersistent(world, def);
        }
    };

    const defaultAnchor = ({ resources }: World): Point2D => {
        const { map } = resources.get();
        const [main] = map.getExpansions();
        const towardsCenter = normalize(subtract(map.getCenter(), main.townhallPosition));
        return add(main.townhallPosition, multiply(towardsCenter, 8));
    };

    const nearAnchor = (world: World, task: BuildTaskRuntime): Point2D => {
        const { units } = world.resources.get();
        const [nearUnit] = task.opts?.near ? units.getById(task.opts.near) : [];
        return nearUnit ? nearUnit.pos! : defaultAnchor(world);
    };

    const buildAt = async ({ agent, resources }: World, task: BuildTaskRuntime, position: Point2D | false) => {
        if (!position) return BuildResult.CANNOT_SATISFY;

        // in case something changed while waiting for placement position
        if (!agent.canAfford(task.id)) return BuildResult.CANNOT_SATISFY;

        try {
            await resources.get().actions.build(task.id, position);
            return BuildResult.COMMAND_SENT;
        } catch (e) {
            return BuildResult.ERROR;
        }
    };

    const earmarkOf = (task: BuildTaskRuntime) => (task.earmarked ? earmarkName(task) : undefined);

    // agent.canAfford settles the earmark, which the tracker must keep until it sends BUILD
    const affordable = ({ agent, data }: World, task: BuildTaskRuntime) => {
        const { mineralCost = 0, vespeneCost = 0 } = data.getUnitTypeData(task.id);
        const reserved = data.getEarmarkTotals(earmarkOf(task));
        return (
            agent.minerals! - reserved.minerals >= mineralCost &&
            (!vespeneCost || agent.vespene! - reserved.vespene >= vespeneCost)
        );
    };

    const trackBuild = (world: World, task: BuildTaskRuntime, opts: BuildOptions) => {
        const { agent, resources } = world;
        if (agent.race !== Race.TERRAN && agent.race !== Race.PROTOSS) return undefined;
        return (
            resources
                .get()
                .buildings.build(task.id, { ...opts, worker: builderFor(world), earmark: earmarkOf(task) }) &&
            BuildResult.COMMAND_SENT
        );
    };

    const placementRequest = (world: World, task: BuildTaskRuntime): PlacementRequest => {
        const { units } = world.resources.get();
        const [nearUnit] = task.opts?.near ? units.getById(task.opts.near) : [];
        const near = nearUnit?.pos && { base: nearUnit.pos, closestTo: nearUnit.pos };
        if (world.agent.race === Race.PROTOSS) return { ...near, powered: task.id !== PYLON };
        const flags: PlacementFlag[] =
            task.id === SUPPLYDEPOT ? ['supplyDepot'] : addonHostTypes.includes(task.id) ? ['production'] : [];
        return { ...near, flags };
    };

    const buildPlacement: Record<number, BuildFn> = {
        async [Race.PROTOSS](world: World, task: BuildTaskRuntime) {
            const { actions, map, units } = world.resources.get();

            if (task.id === PYLON) {
                return buildAt(world, task, await actions.findPlacement(task.id, nearAnchor(world, task)));
            }

            const [main] = map.getExpansions();
            const poweredPylons = units
                .getById(PYLON)
                .filter((unit) => unit.buildProgress! >= 1)
                .sort((a, b) => distance(a.pos!, main.townhallPosition) - distance(b.pos!, main.townhallPosition));

            for (const pylon of poweredPylons) {
                const position = await actions.findPlacement(task.id, pylon.pos!, { maxDistance: 6 });
                if (position) return buildAt(world, task, position);
            }

            return BuildResult.CANNOT_SATISFY;
        },
        async [Race.TERRAN](world: World, task: BuildTaskRuntime) {
            const { actions, units } = world.resources.get();

            if (addonTypes.includes(task.id)) {
                let target;
                if (task.opts!.on) {
                    [target] = units
                        .getById(task.opts!.on!)
                        .filter((unit) => unit.isFinished() && unit.noQueue && unit.addOnTag === '0');
                    debugBuild('no available units to build addon');
                    if (!target) return BuildResult.CANNOT_SATISFY;
                } else {
                    [target] = units
                        .getProductionUnits(task.id)
                        .filter((unit) => unit.isFinished() && unit.noQueue && unit.addOnTag === '0');
                    if (!target) return BuildResult.CANNOT_SATISFY;
                }

                try {
                    await actions.build(task.id, null, target);
                    return BuildResult.COMMAND_SENT;
                } catch (e) {
                    return BuildResult.ERROR;
                }
            }

            const position = await actions.findPlacement(task.id, nearAnchor(world, task), {
                addonPlace: addonHostTypes.includes(task.id),
            });
            return buildAt(world, task, position);
        },
        async [Race.ZERG](world: World, task: BuildTaskRuntime) {
            const { actions } = world.resources.get();
            return buildAt(world, task, await actions.findPlacement(task.id, nearAnchor(world, task)));
        },
    };

    buildFns[buildFnSyms.build] = async function (world: World, task: BuildTaskRuntime) {
        const { agent, resources } = world;
        const { units } = resources.get();

        if (task.status === BuildOrder.COMMAND_GIVEN) {
            const [u] = units.getById(task.id).filter((unit) => !unit.isFinished());
            if (u) {
                return BuildResult.SUCCESS;
            } else {
                return BuildResult.CANNOT_SATISFY;
            }
        }

        if (!affordable(world, task)) return BuildResult.CANNOT_SATISFY;
        const settle = () => agent.canAfford(task.id, earmarkOf(task));

        const { actions, map, placer } = resources.get();

        const targeted = task.opts?.at === undefined ? undefined : structurePlacement(world, task.id, task.opts.at);
        if (targeted) {
            const at =
                'placement' in targeted
                    ? undefined
                    : 'at' in targeted
                      ? targeted.at
                      : await actions.findPlacement(task.id, targeted.near);
            if (at === false || !affordable(world, task)) return BuildResult.CANNOT_SATISFY;
            const tracked = trackBuild(world, task, 'placement' in targeted ? targeted : { at });
            if (tracked) return tracked;
            if (at) {
                settle();
                return buildAt(world, task, at);
            }
        }

        if (gasMineTypes.includes(task.id)) {
            settle();
            // build-order gas steps are explicit, so don't cap simultaneous builds like buildGas' default
            return resources.get().buildings.buildGas({ max: Infinity })
                ? BuildResult.COMMAND_SENT
                : BuildResult.CANNOT_SATISFY;
        } else if (townhallTypes.includes(task.id)) {
            settle();
            const expansionLocation = map.getAvailableExpansions()[0].townhallPosition;

            const foundPosition = await actions.canPlace(task.id, [expansionLocation]);
            // @TODO: if we can't place - try to clear out obstacles (like a burrowed zergling)
            if (!foundPosition) return BuildResult.CANNOT_SATISFY;

            try {
                await actions.build(task.id, foundPosition);
                return BuildResult.COMMAND_SENT;
            } catch (e) {
                return BuildResult.ERROR;
            }
        } else {
            const placements = placer?.place?.(world, task.id);
            const foundPosition = placements?.length ? await actions.canPlace(task.id, placements) : false;

            if (foundPosition) {
                // in case something changed while waiting for placement position
                if (!affordable(world, task)) return BuildResult.CANNOT_SATISFY;
                const tracked = trackBuild(world, task, { at: foundPosition });
                if (tracked) return tracked;
                settle();
                return buildAt(world, task, foundPosition);
            }

            if (!addonTypes.includes(task.id)) {
                const tracked = trackBuild(world, task, { placement: placementRequest(world, task) });
                if (tracked) return tracked;
            }

            settle();
            return buildPlacement[agent.race!](world, task);
        }
    };

    buildFns[buildFnSyms.train] = async function (world: World, task: TrainTask) {
        const { agent, resources } = world;
        const { actions } = resources.get();

        const id = Array.isArray(task.id) ? getRandom(task.id) : task.id;

        if (task.opts?.at) {
            const trained = await agent.train(id, 1, resolveTarget(world, task.opts.at));
            return trained > 0 ? BuildResult.SUCCESS : BuildResult.CANNOT_SATISFY;
        }

        try {
            if (agent.upgradeIds!.includes(Upgrade.WARPGATERESEARCH)) {
                try {
                    await actions.warpIn(id, {});
                } catch (e) {
                    await actions.train(id);
                }
            } else {
                await actions.train(id);
            }
            return BuildResult.SUCCESS;
        } catch (e) {
            debugBuildSilly('BUILD TRAIN ERR:', e);
            return BuildResult.ERROR;
        }
    };

    buildFns[buildFnSyms.worker] = async function ({ agent, resources }: World) {
        const { actions } = resources.get();

        const id = WorkerRace[agent.race!];

        try {
            await actions.train(id);
            return BuildResult.SUCCESS;
        } catch (e) {
            debugBuildSilly('BUILD WORKER ERR:', e);
            return BuildResult.ERROR;
        }
    };

    buildFns[buildFnSyms.upgrade] = async function ({ agent, resources }: World, task: BuildTaskRuntime) {
        const { actions, units } = resources.get();

        if (!agent.canAffordUpgrade(task.id, task.earmarked ? earmarkName(task) : null))
            return BuildResult.CANNOT_SATISFY;

        const upgradeFacilities = units.getUpgradeFacilities(task.id);

        if (upgradeFacilities.length <= 0) return BuildResult.CANNOT_SATISFY;
        const freeUpgradeFacility = upgradeFacilities.find((unit) => unit.noQueue);

        if (!freeUpgradeFacility) return BuildResult.CANNOT_SATISFY;

        try {
            await actions.upgrade(task.id, freeUpgradeFacility);
            return BuildResult.SUCCESS;
        } catch (e) {
            debugBuildSilly('BUILD UPGRADE ERR:', e);
            return BuildResult.ERROR;
        }
    };

    buildFns[buildFnSyms.ability] = async function ({ data, resources }: World, task: BuildTaskRuntime) {
        const { actions, units } = resources.get();

        const canDo = data.findUnitTypesWithAbility(task.id);
        let unitsCanDo = units
            .getByType(task.opts?.on ? [task.opts.on] : canDo)
            .filter((unit) => unit.abilityAvailable(task.id));

        if ([BUILD_REACTOR, BUILD_TECHLAB].includes(task.id)) {
            unitsCanDo = unitsCanDo.filter((unit) => unit.addOnTag === '0' && unit.noQueue);
        }

        if (unitsCanDo.length <= 0) return BuildResult.CANNOT_SATISFY;

        let target: Unit | undefined;
        if (task.opts!.target) {
            target = getRandom(units.getById(task.opts!.target!).filter((unit) => unit.isFinished()));
            if (!target) return BuildResult.CANNOT_SATISFY;
        }

        try {
            await actions.do(task.id, [unitsCanDo[0].tag!], { target });
            return BuildResult.SUCCESS;
        } catch (e) {
            debugBuild('BUILD ABILITY ERR:', e);
            return BuildResult.ERROR;
        }
    };

    const workerScout = (world: World) => pickWorker(world, BUILD_RUNNER_SCOUT);

    const overlordScout = (world: World): Unit | undefined => {
        const { roles, units } = world.resources.get();
        const overlord = units.getById(OVERLORD).find((unit) => roles.roleOf(unit) !== BUILD_RUNNER_SCOUT);
        if (overlord) roles.assign(overlord, BUILD_RUNNER_SCOUT);
        return overlord;
    };

    buildFns[buildFnSyms.scout] = async function (world: World, task: BuildTaskRuntime) {
        const { actions, roles } = world.resources.get();
        const scout = task.opts?.scout === 'overlord' ? overlordScout(world) : workerScout(world);
        if (!scout) return BuildResult.CANNOT_SATISFY;

        const waypoints = scoutWaypoints(world, task.opts?.waypoints ?? []);
        const returning = scout.isWorker() && scout.isCarryingResource();
        const unitTags = [scout.tag!];
        roles.as(BUILD_RUNNER_SCOUT, () =>
            actions.queueAction([
                ...(returning ? [{ abilityId: HARVEST_RETURN, unitTags }] : []),
                ...waypoints.map((targetWorldSpacePos, i) => ({
                    abilityId: MOVE,
                    unitTags,
                    targetWorldSpacePos,
                    queueCommand: returning || i > 0,
                })),
            ]),
        );
        return BuildResult.SUCCESS;
    };

    buildFns[buildFnSyms.addonSwap] = async function (world: World, task: BuildTaskRuntime) {
        return world.resources.get().flying.addonSwap(task.id, task.opts!.addon!)
            ? BuildResult.SUCCESS
            : BuildResult.CANNOT_SATISFY;
    };
}

export { builderPlugin, taskFunctions };
