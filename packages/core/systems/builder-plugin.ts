import createDebug from 'debug';
import { add, distance, multiply, normalize, subtract } from '../utils/geometry/point.ts';
import getRandom from '../utils/get-random.ts';
import { BuildOrder, BuildOrderId, BuildResult, Race } from '../constants/enums.ts';
import type { BuildOrderStatus } from '../constants/enums.ts';
import * as ability from '../constants/ability.ts';
import { WorkerRace } from '../constants/race-map.ts';
import { gasMineTypes, townhallTypes, addonTypes } from '../constants/groups.ts';
import { Upgrade, UnitType, UnitTypeId, AbilityId, UpgradeId, Color } from '../constants/index.ts';
import type {
    BuildSystemObject,
    BuildTask,
    BuildTaskI,
    EventReader,
    Point2D,
    System,
    TaskFunctions,
    Unit,
    World,
} from '../types.ts';

const debugBuild = createDebug('sc2:debug:build');
const debugDraw = createDebug('sc2:DrawDebug');
const debugBuildSilly = createDebug('sc2:silly:build');

const { BUILD_REACTOR, BUILD_TECHLAB } = ability;
const { PYLON, BARRACKS, FACTORY, STARPORT } = UnitType;
const addonHostTypes = [BARRACKS, FACTORY, STARPORT];

const NOOP = () => {};

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
};

function builderPlugin(system: EventReader<System>): void {
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
    };

    const buildFns: Record<symbol, BuildFn> = {};

    const systemOnGameStart = system.onGameStart ? system.onGameStart.bind(system) : NOOP;
    const { onStep } = system as unknown as BuildSystemObject;
    const systemOnStep: StepFn = onStep ? onStep.bind(system) : NOOP;
    const buildComplete = system.buildComplete ? system.buildComplete.bind(system) : NOOP;

    function createTask(taskData: object, index: number, supply?: number) {
        return {
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

    function normalizeBuildOrder(world: World, bo: BuildTask[]) {
        if (Array.isArray(bo[0])) {
            return (bo as Array<[number, BuildTaskI]>).reduce<{
                supply: number;
                buildOrder: object[];
                reducerIndex: number;
            }>(
                (acc, [supply, task]) => {
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
        } else {
            return bo.map((task, i: number) => {
                return createTask(task, i);
            });
        }
    }

    system.onGameStart = async function (world: World) {
        this.setState({
            [buildSym]: normalizeBuildOrder(world, system.buildOrder!),
        });

        return systemOnGameStart(world);
    };

    system.onStep = async function (world: World, gameLoop: number) {
        if (system.buildOptions!.paused) {
            return systemOnStep(world, gameLoop);
        }

        const task: BuildTaskRuntime | undefined = this.state[buildSym].find(
            (o: BuildTaskRuntime) =>
                o.status === BuildOrder.COMMAND_GIVEN ||
                o.status === BuildOrder.IN_PROGRESS ||
                o.status === BuildOrder.NOT_STARTED,
        );

        if (!task) {
            if (this.state[completeSym]) {
                return systemOnStep(world, gameLoop);
            } else {
                this.setState({ [completeSym]: true });
                return buildComplete(world, gameLoop);
            }
        }

        const buildTask: BuildTaskRuntime = this.state[buildSym][task.index];

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

                if (cost && !world.agent.canAfford(buildTask.id)) {
                    world.data.addEarmark({
                        name: `task${buildTask.index}`,
                        minerals: cost.mineralCost!,
                        vespene: cost.vespeneCost!,
                    });
                    buildTask.earmarked = true;
                }
            }
        }

        if (buildTask.status === BuildOrder.COMMAND_GIVEN) {
            if (gameLoop - buildTask.commanded! >= 250) {
                buildTask.status = BuildOrder.NOT_STARTED;
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

        if (!agent.canAfford(task.id, task.earmarked ? `task${task.index}` : null)) return BuildResult.CANNOT_SATISFY;

        const { actions, map, placer } = resources.get();

        if (gasMineTypes.includes(task.id)) {
            try {
                await actions.buildGasMine();
                return BuildResult.COMMAND_SENT;
            } catch (e) {
                return BuildResult.ERROR;
            }
        } else if (townhallTypes.includes(task.id)) {
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
            if (placer && placer.place) {
                const placements = placer.place(world, task.id);

                if (!placements || placements.length <= 0) {
                    return buildPlacement[agent.race!](world, task);
                }

                const foundPosition = await actions.canPlace(task.id, placements);
                if (!foundPosition) {
                    return buildPlacement[agent.race!](world, task);
                }

                // in case something changed while waiting for placement position
                const canNoLongerAfford = !agent.canAfford(task.id);
                if (canNoLongerAfford) return BuildResult.CANNOT_SATISFY;

                try {
                    await actions.build(task.id, foundPosition);
                    return BuildResult.COMMAND_SENT;
                } catch (e) {
                    return BuildResult.ERROR;
                }
            } else {
                return buildPlacement[agent.race!](world, task);
            }
        }
    };

    buildFns[buildFnSyms.train] = async function ({ agent, resources }: World, task: TrainTask) {
        const { actions } = resources.get();

        const id = Array.isArray(task.id) ? getRandom(task.id) : task.id;

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

        if (!agent.canAffordUpgrade(task.id, task.earmarked ? `task${task.index}` : null))
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
        let unitsCanDo = units.getByType(canDo).filter((unit) => unit.abilityAvailable(task.id));

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
}

export { builderPlugin, taskFunctions };
