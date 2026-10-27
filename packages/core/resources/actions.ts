import createDebug from 'debug';
import getRandom from '../utils/get-random.ts';
import { distance, nClosestPoint } from '../utils/geometry/point.ts';
import { gridsInCircle } from '../utils/geometry/angle.ts';
import { Ability, enums, UnitType, UnitTypeId, WarpUnitAbility } from '../constants/index.ts';
import { creationAbilityOverrides } from '../constants/groups.ts';
import { GasMineRace } from '../constants/race-map.ts';
import { GATHERING } from '../constants/unit-role.ts';
import UnitAbilites from '../constants/unit-ability-map.ts';
import createClient from '../engine/create-client.ts';
import { ActionManagerError, BuildError, TrainError, GatherError } from '../engine/errors.ts';
import { researchAbilityOf, spend } from '../agent/macro.ts';
import { selectBuilder } from '../utils/workers/select-builder.ts';
import { stalledWorkers } from './buildings.ts';
import { arbitrate } from './command-arbiter.ts';
import { currentCommander, runAsCommander } from './command-context.ts';
import type { Committed, Proposal } from './command-arbiter.ts';
import type { CommandContext } from './command-context.ts';
import type { AbilityOptions, ActionManager, CommandResult, Point2D, Unit, WarpInOptions, World } from '../types.ts';

const { Alliance, Race, AbilityDataTarget } = enums;
const debugActionManager = createDebug('sc2:debug:actionManager');

type Target = Unit | Point2D | null | undefined;

const isUnit = (target: Target): target is Unit =>
    typeof target === 'object' && !!target && 'tag' in target && !!target.tag;
const isPoint = (target: Target): target is Point2D =>
    typeof target === 'object' && !!target && 'x' in target && typeof target.x === 'number';

function getRandomN<T>(arr: T[], n: number): T[] {
    return Array.from({ length: n }, () => {
        return arr[Math.floor(Math.random() * arr.length)];
    });
}

function shuffled<T>(arr: T[]): T[] {
    const copy = arr.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
}

const SUCCESS = 1 as SC2APIProtocol.ActionResult;

type ExecutorProposal = Proposal & { onNotSent?: (tags: string[], result: CommandResult) => void };

const CHAT_BROADCAST = 1 as SC2APIProtocol.ActionChat_Channel;
const CHAT_TEAM = 2 as SC2APIProtocol.ActionChat_Channel;

const tagsOf = (units: Unit | Unit[]): string[] => (Array.isArray(units) ? units : [units]).map((unit) => unit.tag!);

function createActionManager(world: World, client?: NodeSC2Proto.ProtoClient): ActionManager {
    const protoClient = client || createClient();
    let proposals: ExecutorProposal[] = [];
    let seq = 0;
    let ordered: { gameLoop: number; observation: unknown; tags: Set<string>; committed: Committed } = {
        gameLoop: -1,
        observation: undefined,
        tags: new Set(),
        committed: new Map(),
    };

    const thisObservation = () => {
        const { frame } = world.resources.get();
        const gameLoop = frame.getGameLoop();
        const observation = frame._observation;
        if (ordered.gameLoop !== gameLoop || ordered.observation !== observation)
            ordered = { gameLoop, observation, tags: new Set(), committed: new Map() };
        return ordered;
    };

    const markOrdered = (commands: SC2APIProtocol.ActionRawUnitCommand[]) => {
        const { tags } = thisObservation();
        commands.forEach((command) => (command.unitTags ?? []).forEach((tag) => tags.add(tag)));
    };

    const warpInPoints = (opts: WarpInOptions): Point2D[] => {
        const { units, map } = world.resources.get();
        const nearPosition = opts.nearPosition || map.getCombatRally();
        const selectedMatricies = [...(world.agent.powerSources ?? [])]
            .sort((a, b) => distance(nearPosition, a.pos as Point2D) - distance(nearPosition, b.pos as Point2D))
            .slice(0, opts.nearPosition ? 1 : 3);
        let myPoints = selectedMatricies
            .map((matrix) => gridsInCircle(matrix.pos as Point2D, matrix.radius!))
            .reduce((acc, arr) => acc.concat(arr), [])
            .filter((point) => map.isPathable(point) && !map.hasCreep(point));

        if (opts.highground) {
            myPoints = myPoints
                .map((point) => ({ ...point, z: map.getHeight(point) }))
                .sort((a, b) => b.z - a.z)
                .filter((p, i, arr) => p.z === arr[0].z);
        }

        const myStructures = units.getStructures();
        const claimed = proposals.flatMap(({ command }) =>
            command.targetWorldSpacePos ? [command.targetWorldSpacePos as Point2D] : [],
        );
        return nClosestPoint(nearPosition, myPoints, 100).filter(
            (point) =>
                myStructures.every((structure) => distance(structure.pos, point) > 2) &&
                claimed.every((target) => distance(target, point) >= 1),
        );
    };

    const commit = (tags: string[], commander: CommandContext) => {
        const { committed } = thisObservation();
        tags.forEach((tag) => committed.set(tag, commander));
    };

    const send = (commands: SC2APIProtocol.ActionRawUnitCommand[]) =>
        protoClient.action({ actions: commands.map((unitCommand) => ({ actionRaw: { unitCommand } })) });

    const repeatsCurrentOrder = (command: SC2APIProtocol.ActionRawUnitCommand, tag: string): boolean => {
        if (command.queueCommand) return false;

        const [current] = world.resources.get().units.getByTag(tag)?.orders ?? [];
        if (!current) return false;

        const general = (abilityId: number) => world.data.getAbilityData(abilityId)?.remapsToAbilityId || abilityId;
        if (general(command.abilityId!) !== general(current.abilityId!)) return false;

        if (command.targetUnitTag) return command.targetUnitTag === current.targetUnitTag;

        const { targetWorldSpacePos: wanted } = command;
        const { targetWorldSpacePos: active } = current;
        return !!wanted && !!active && wanted.x === active.x && wanted.y === active.y;
    };

    return {
        _client: protoClient,
        async do(abilityId: number, ts: string | string[] | Unit[], opts: AbilityOptions = {}) {
            const tags = (Array.isArray(ts) ? ts : [ts]).map((entry) =>
                typeof entry === 'string' ? entry : entry.tag!,
            );
            if (tags.length === 0) return;

            const doAction: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId,
                unitTags: tags,
                queueCommand: opts.queue || false,
            };

            const { target } = opts;
            if (isUnit(target)) {
                doAction.targetUnitTag = target.tag;
            } else if (isPoint(target)) {
                doAction.targetWorldSpacePos = target;
            }

            this.queueAction(doAction);
        },
        async smart(us: Unit[], posOrUnit: Point2D | Unit, queue = false) {
            const units = Array.isArray(us) ? us : [us];
            if (units.length === 0) return;

            const smartTo: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId: Ability.SMART,
                unitTags: units.map((unit) => unit.tag!),
                queueCommand: queue,
            };

            if (isUnit(posOrUnit)) {
                smartTo.targetUnitTag = posOrUnit.tag;
            } else if (isPoint(posOrUnit)) {
                smartTo.targetWorldSpacePos = posOrUnit;
            }

            this.queueAction(smartTo);
        },
        async move(u: Unit | Unit[], target: Point2D | Unit, queue = false) {
            const units = Array.isArray(u) ? u : [u];
            if (units.length === 0) return;

            const moveTo: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId: Ability.MOVE,
                unitTags: units.map((unit) => unit.tag!),
                queueCommand: queue,
            };

            if (isUnit(target)) {
                moveTo.targetUnitTag = target.tag;
            } else if (isPoint(target)) {
                moveTo.targetWorldSpacePos = target;
            }

            this.queueAction(moveTo);
        },
        async patrol(u: Unit | Unit[], p: [from: Point2D, to: Point2D] | Point2D, queue = false) {
            const units = Array.isArray(u) ? u : [u];
            if (units.length === 0) return;

            const [from, to] = Array.isArray(p) ? p : [units[0].pos, p];

            const patrolToTo: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId: Ability.PATROL,
                unitTags: units.map((unit) => unit.tag!),
                targetWorldSpacePos: to,
                queueCommand: true,
            };

            await this.move(units, from, queue);
            this.queueAction(patrolToTo);
        },
        async attack(us?: Unit[], unit?: Unit, queue = false) {
            const units = (Array.isArray(us) ? us : [us]).filter((attacker) => attacker !== undefined);
            if (!unit?.tag) {
                throw new ActionManagerError('attack needs a target unit; use attackMove for a position', {
                    data: { units: us, unit },
                });
            }
            if (units.length === 0) return;

            this.queueAction({
                abilityId: Ability.ATTACK,
                targetUnitTag: unit.tag,
                unitTags: units.map((attacker) => attacker.tag!),
                queueCommand: queue,
            });
        },
        async attackMove(u?: Unit[], p?: Point2D, queue = false) {
            const units = (Array.isArray(u) ? u : [u]).filter((attacker) => attacker !== undefined);
            const position = p ?? world.resources.get().map.getLocations().enemy?.[0];
            if (!position) {
                throw new ActionManagerError(
                    'attackMove needs a position (none given and no enemy start location known)',
                    { data: { units: u, position: p } },
                );
            }
            if (units.length === 0) return;

            // SC2 remaps the generic ATTACK to each unit's own attack ability, as python-sc2 relies on
            this.queueAction({
                abilityId: Ability.ATTACK,
                targetWorldSpacePos: position,
                unitTags: units.map((attacker) => attacker.tag!),
                queueCommand: queue,
            });
        },
        async swapBuildings(unitA: Unit, unitB: Unit) {
            const haveAbility = [unitA, unitB].every((unit) => {
                return UnitAbilites[unit.unitType!].includes(Ability.LIFT);
            });

            const isComplete = [unitA, unitB].every((unit) => unit.buildProgress! >= 1);

            if (!haveAbility || !isComplete) {
                throw new ActionManagerError('These two units cannot be swapped', { data: { unitA, unitB } });
            }

            world.resources.get().flying.swap(unitA, unitB);
        },
        async gather(unit: Unit, mineralField?: Unit, queue = true) {
            const { units } = world.resources.get();

            if (!unit.isWorker() && unit.unitType !== UnitType.MULE) {
                throw new GatherError('only workers can gather', { data: { unit, mineralField, queue } });
            }

            if (unit.labels.has('command') && queue === false) {
                console.warn('WARNING! unit with command erroniously told to force gather! Forcing queue');
                queue = true;
            }

            const ownBases = units.getBases(Alliance.SELF).filter((base) => base.buildProgress! >= 1);

            let target: Unit | undefined;
            if (mineralField && mineralField.tag) {
                target = mineralField;
            } else {
                const byDistance = ownBases.sort((a, b) => distance(unit.pos!, a.pos!) - distance(unit.pos!, b.pos!));
                const targetBase =
                    byDistance.find((base) => base.assignedHarvesters! < base.idealHarvesters!) ?? byDistance[0];

                if (targetBase) {
                    const targetBaseFields = units.getMineralFields().closestNUnits(targetBase.pos!, 3);
                    [target] = targetBaseFields.closestNUnits(unit.pos!, 1);
                }
            }

            if (!target) {
                throw new GatherError(
                    'no mineral field given and no completed own base with mineral fields to gather at',
                    { data: { unit, mineralField, queue } },
                );
            }

            const sendToGather: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId: Ability.SMART,
                targetUnitTag: target.tag,
                unitTags: [unit.tag!],
                queueCommand: queue,
            };

            this.queueAction(sendToGather);
        },
        async mine(us: Unit[], target: Unit, queue = true) {
            const units = Array.isArray(us) ? us : [us];
            if (units.length === 0) return;

            const sendToMine: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId: Ability.HARVEST_GATHER,
                unitTags: units.map((unit) => unit.tag!),
                targetUnitTag: target.tag,
                queueCommand: queue,
            };

            this.queueAction(sendToMine);
        },
        canPlace: (async (unitTypeId: number, poses: Point2D[]) => {
            // limit to checking 10 placements because the client gets unhappy
            const positions = poses.length <= 10 ? poses : getRandomN(poses, 10);

            const placements = positions
                .map((pos) => ({
                    targetPos: pos,
                    abilityId: world.data.getUnitTypeData(unitTypeId).abilityId,
                }))
                .reverse();

            const query: SC2APIProtocol.ResponseQuery = await protoClient.query({ placements });

            const successes = query
                .placements!.map((placement, index) => ({ placement, index }))
                .filter((success) => success.placement.result === 1);

            if (successes.length > 0) {
                return placements[getRandom(successes).index].targetPos;
            } else {
                return false;
            }
        }) as ActionManager['canPlace'],
        async findPlacement(
            unitTypeId,
            near,
            { maxDistance = 20, randomAlternative = true, placementStep = 2, addonPlace = false } = {},
        ) {
            const abilityId = world.data.getUnitTypeData(unitTypeId).abilityId;

            const placeable = async (ability: number, positions: Point2D[]) => {
                if (positions.length <= 0) return [];
                const query = (await protoClient.query({
                    placements: positions.map((targetPos) => ({ abilityId: ability, targetPos })),
                })) as SC2APIProtocol.ResponseQuery;
                return positions.filter((_, i) => query.placements![i].result === 1);
            };

            // add-ons sit 2.5 right, 0.5 down of the host and share a supply depot's 2x2 footprint
            const withAddonRoom = async (positions: Point2D[]) => {
                if (!addonPlace) return positions;
                const addonSpots = await placeable(
                    Ability.BUILD_SUPPLYDEPOT,
                    positions.map((position) => ({ x: position.x + 2.5, y: position.y - 0.5 })),
                );
                return positions.filter((position) =>
                    addonSpots.some((spot) => spot.x === position.x + 2.5 && spot.y === position.y - 0.5),
                );
            };

            if ((await withAddonRoom(await placeable(abilityId!, [near]))).length > 0) return near;

            for (let d = placementStep; d < maxDistance; d += placementStep) {
                const ring: Point2D[] = [];
                for (let offset = -d; offset <= d; offset += placementStep) {
                    ring.push(
                        { x: near.x + offset, y: near.y - d },
                        { x: near.x + offset, y: near.y + d },
                        { x: near.x - d, y: near.y + offset },
                        { x: near.x + d, y: near.y + offset },
                    );
                }

                const possible = await withAddonRoom(await placeable(abilityId!, ring));
                if (possible.length <= 0) continue;

                return randomAlternative
                    ? getRandom(possible)
                    : possible.reduce((best, candidate) =>
                          distance(candidate, near) < distance(best, near) ? candidate : best,
                      );
            }

            return false;
        },
        async build(unitTypeId: number, pointOrUnitOrNone?: Point2D | Unit | null, worker?: Unit) {
            const { units, frame } = world.resources.get();

            let queue = false;
            if (world.agent.hasTechFor(unitTypeId) === false) {
                throw new BuildError('Missing tech requirements to build unit type', {
                    data: { unitTypeId, pointOrUnitOrNone, worker },
                });
            }

            // a concurrent build can spend the minerals while placement is awaited, yet the API answers success to both
            if (!world.agent.canAfford(unitTypeId)) {
                throw new BuildError(`You can not (currently) afford to build unitTypeId ${unitTypeId}`, {
                    data: { unitTypeId, pointOrUnitOrNone, worker },
                });
            }

            let pos: Point2D | undefined, target: Unit | undefined;

            if (isUnit(pointOrUnitOrNone)) {
                target = pointOrUnitOrNone;
            } else if (isPoint(pointOrUnitOrNone)) {
                pos = pointOrUnitOrNone;
            }

            const abilityId = world.data.getUnitTypeData(unitTypeId).abilityId!;

            const buildAbilityTarget = world.data.getAbilityData(abilityId).target;
            const mustBeNone = buildAbilityTarget === AbilityDataTarget.NONE;
            const canBeNone = mustBeNone || buildAbilityTarget === AbilityDataTarget.POINTORNONE;

            if (!target && !pos && !canBeNone) {
                throw new BuildError(
                    `Building unit ${unitTypeId} with build ability ${abilityId} requires a target of type ${buildAbilityTarget}, but none was given`,
                    { data: { unitTypeId, pointOrUnitOrNone, worker } },
                );
            }

            if ((target || pos) && mustBeNone) {
                throw new BuildError(
                    `Building unit ${unitTypeId} with build ability ${abilityId} must be done without a target, but you gave: ${pointOrUnitOrNone}. Try passing null as the second argument, and your target as the third.`,
                    { data: { unitTypeId, pointOrUnitOrNone, worker } },
                );
            }

            const near = (pos || target?.pos) as Point2D | undefined;
            const { mining } = world.resources.get();
            const exclude = stalledWorkers(world, unitTypeId);
            let builder: Unit | undefined =
                worker ??
                (near && mining.isEnabled()
                    ? mining.selectWorker(near, { forceClose: true, role: GATHERING, exclude })
                    : undefined);
            if (!builder && near) {
                builder = selectBuilder(world, near, { exclude, reuseConstructing: world.agent.race === Race.PROTOSS });
                if (builder?.isConstructing()) {
                    queue = true;
                } else if (builder?.isCarryingResource()) {
                    this.queueAction({
                        abilityId: Ability.HARVEST_RETURN,
                        unitTags: [builder.tag!],
                        queueCommand: false,
                    });
                    queue = true;
                }
            }

            if (!builder) {
                throw new BuildError('Unable to find or use builder, something is very wrong', {
                    data: { unitTypeId, pointOrUnitOrNone, worker },
                });
            }

            const unitCommand: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId,
                unitTags: [builder.tag!],
                queueCommand: queue,
            };

            builder.labels.set('command', frame.getGameLoop());

            spend(world.agent, world.agent.calculateCost(unitTypeId));

            if (target) {
                unitCommand.targetUnitTag = target.tag;
            } else if (pos) {
                unitCommand.targetWorldSpacePos = pos;
            }

            this.queueAction(unitCommand, { onNotSent: () => builder.labels.delete('command') });

            if (unitTypeId === GasMineRace[world.agent.race!]) {
                await this.gather(builder);
            }
        },
        async buildGasMine() {
            const { map } = world.resources.get();

            const gasMine = GasMineRace[world.agent.race!];
            const [geyser] = map.freeGasGeysers();

            if (!geyser) {
                throw new BuildError('no free geysers in own expansions for building mines on');
            }

            return this.build(gasMine, geyser);
        },
        async train(unitTypeId: number, productionUnit?: Unit) {
            const { units } = world.resources.get();

            if (world.agent.hasTechFor(unitTypeId) === false) {
                throw new TrainError(`Missing tech requirements to build unit type ${unitTypeId}`, {
                    data: { unitTypeId, productionUnit },
                });
            }

            let trainer: Unit | undefined;

            if (!world.agent.canAfford(unitTypeId)) {
                throw new TrainError(`cannot afford training unit: ${unitTypeId}`, {
                    data: { unitTypeId, productionUnit },
                });
            }

            if (productionUnit) {
                trainer = productionUnit;
            } else {
                const received = this.unitTagsReceivedAction();
                const producers = units.getProductionUnits(unitTypeId).filter((unit) => !received.has(unit.tag!));
                trainer =
                    producers.find((unit) => unit.unitType !== UnitType.WARPGATE && unit.noQueue) ??
                    producers.find(
                        (unit) =>
                            unit.unitType === UnitType.WARPGATE && unit.abilityAvailable(WarpUnitAbility[unitTypeId]),
                    );
            }

            if (!trainer) {
                throw new TrainError(`no free production unit for type: ${unitTypeId}`, {
                    data: { unitTypeId, productionUnit },
                });
            }

            let unitCommand: SC2APIProtocol.ActionRawUnitCommand;
            if (trainer.unitType === UnitType.WARPGATE) {
                const abilityId = WarpUnitAbility[unitTypeId];
                const [point] = shuffled(warpInPoints({}));
                if (!trainer.abilityAvailable(abilityId) || !point) {
                    throw new TrainError(`warp gate cannot warp in type ${unitTypeId}: on cooldown or no free point`, {
                        data: { unitTypeId, productionUnit },
                    });
                }
                unitCommand = { abilityId, unitTags: [trainer.tag!], targetWorldSpacePos: point };
            } else {
                const abilityId =
                    creationAbilityOverrides[unitTypeId] ?? world.data.getUnitTypeData(unitTypeId).abilityId;
                unitCommand = { abilityId, unitTags: [trainer.tag!] };
            }

            spend(world.agent, world.agent.calculateCost(unitTypeId));
            this.queueAction(unitCommand);
        },
        async upgrade(upgradeId: number, upgradeFacility?: Unit) {
            const { units } = world.resources.get();

            if (!world.agent.canAffordUpgrade(upgradeId)) {
                throw new TrainError(`cannot afford upgrade: ${upgradeId}`, { data: { upgradeId, upgradeFacility } });
            }

            let upgrader: Unit | undefined;

            if (upgradeFacility) {
                upgrader = upgradeFacility;
            } else {
                upgrader = units.getUpgradeFacilities(upgradeId).find((unit) => unit.noQueue);
            }

            if (!upgrader) {
                throw new TrainError(`no free upgrade facility for upgradeId: ${upgradeId}`, {
                    data: { upgradeId, upgradeFacility },
                });
            }

            const abilityId = researchAbilityOf(world.agent, upgradeId);
            const unitCommand: SC2APIProtocol.ActionRawUnitCommand = { abilityId, unitTags: [upgrader.tag!] };

            spend(world.agent, world.agent.calculateUpgradeCost(upgradeId));
            this.queueAction(unitCommand);
        },
        async warpIn(unitType: number, opts: WarpInOptions = {}) {
            const { units } = world.resources.get();
            const abilityId = WarpUnitAbility[unitType];
            const n = opts.maxQty || 1;

            let qtyToWarp = n;
            while (qtyToWarp > 0 && !world.agent.canAfford(unitType, null, { count: qtyToWarp })) qtyToWarp -= 1;
            if (qtyToWarp <= 0) {
                throw new ActionManagerError(`cannot afford warping any qty of unit: ${UnitTypeId[unitType]}`, {
                    data: { unitType, opts },
                });
            }

            const points = warpInPoints(opts);

            const warpGates = units
                .getById(UnitType.WARPGATE)
                .filter((wg) => wg.abilityAvailable(abilityId))
                .slice(0, qtyToWarp);
            if (warpGates.length <= 0) {
                throw new ActionManagerError(`No ready warpgates with ability to warp in ${UnitTypeId[unitType]}`);
            }

            if (points.length <= 0) {
                throw new ActionManagerError(`No free warp-in points to warp in ${UnitTypeId[unitType]}`, {
                    data: { unitType, opts },
                });
            }

            const destPoints = shuffled(points).slice(0, warpGates.length);

            const commands: SC2APIProtocol.ActionRawUnitCommand[] = destPoints.map((point, i) => ({
                abilityId,
                unitTags: [warpGates[i].tag!],
                targetWorldSpacePos: point,
            }));

            this.queueAction(commands);
        },
        async stop(units: Unit | Unit[], queue = false) {
            return this.do(Ability.STOP, tagsOf(units), { queue });
        },
        async holdPosition(units: Unit | Unit[], queue = false) {
            return this.do(Ability.HOLDPOSITION, tagsOf(units), { queue });
        },
        async repair(units: Unit | Unit[], target: Unit, queue = false) {
            return this.do(Ability.EFFECT_REPAIR, tagsOf(units), { target, queue });
        },
        async returnResource(units: Unit | Unit[], queue = false) {
            return this.do(Ability.HARVEST_RETURN, tagsOf(units), { queue });
        },
        queueAction(commands, { onNotSent } = {}) {
            const commandList = Array.isArray(commands) ? commands : [commands];
            const untagged = commandList.find((command) => !command.unitTags?.length);
            if (untagged) {
                throw new ActionManagerError('a unit command needs at least one unit', { data: { command: untagged } });
            }
            const commander = currentCommander();
            markOrdered(commandList);
            commandList.forEach((command) => proposals.push({ ...commander, command, seq: seq++, onNotSent }));
        },
        as(context, fn) {
            const overrides = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
            return runAsCommander({ ...currentCommander(), ...overrides }, fn);
        },
        unitTagsReceivedAction() {
            return thisObservation().tags;
        },
        clearQueuedActions() {
            proposals = [];
            ordered = { ...ordered, committed: new Map() };
        },
        async flushQueuedActions() {
            const pending = proposals;
            proposals = [];
            if (pending.length === 0) return undefined;

            const { committed } = thisObservation();
            const { roles } = world.resources.get();
            const { commands, dropped } = arbitrate(pending, committed, repeatsCurrentOrder, (owner, tag) =>
                roles.mayCommand(owner, tag) ? undefined : `role:${roles.roleOf(tag)}`,
            );
            const previousHolders = new Map<string, CommandContext | undefined>();
            commands.forEach(({ covers }) =>
                covers.forEach(({ proposal, tags }) => {
                    tags.forEach((tag) => !previousHolders.has(tag) && previousHolders.set(tag, committed.get(tag)));
                    commit(tags, proposal);
                }),
            );

            const outcomes: { proposal: ExecutorProposal; result: CommandResult }[] = dropped.map(
                ({ proposal, tags, reason, by }) => ({
                    proposal,
                    result: {
                        owner: proposal.owner,
                        command: proposal.command,
                        tags,
                        outcome: 'dropped',
                        reason,
                        ...(by && { by }),
                    },
                }),
            );

            let response: SC2APIProtocol.ResponseAction | undefined;
            let failure: Error | undefined;
            if (commands.length > 0) {
                try {
                    response = await send(commands.map(({ command }) => command));
                } catch (err) {
                    failure = err as Error;
                }
            }

            commands.forEach(({ command, covers }, index) => {
                const result = response?.result?.[index];
                if (!failure && result !== SUCCESS) {
                    debugActionManager(`command not accepted, result ${result}: ${JSON.stringify(command)}`);
                }
                covers.forEach(({ proposal, tags }) => {
                    const base = { owner: proposal.owner, command: proposal.command, tags };
                    if (failure || result !== SUCCESS) {
                        tags.filter((tag) => committed.get(tag) === proposal).forEach((tag) => {
                            const previous = previousHolders.get(tag);
                            if (previous) committed.set(tag, previous);
                            else committed.delete(tag);
                        });
                    }
                    outcomes.push({
                        proposal,
                        result: failure
                            ? { ...base, outcome: 'rejected', error: failure.message }
                            : { ...base, outcome: result === SUCCESS ? 'won' : 'rejected', result },
                    });
                });
            });

            const grouped = new Map<string, { proposal: ExecutorProposal; result: CommandResult }>();
            outcomes.forEach(({ proposal, result }) => {
                const { outcome, reason, by, result: code, error } = result;
                const key = JSON.stringify([proposal.seq, outcome, reason, by, code, error]);
                const group = grouped.get(key);
                if (group) group.result.tags = [...group.result.tags, ...result.tags];
                else grouped.set(key, { proposal, result });
            });
            const results = [...grouped.values()].sort((a, b) => a.proposal.seq - b.proposal.seq);

            results.forEach(({ proposal, result }) => {
                if (result.outcome !== 'won') proposal.onNotSent?.(result.tags, result);
            });
            if (results.length > 0) {
                world.resources
                    .get()
                    .events.write({ name: 'commandResults', data: results.map(({ result }) => result) });
            }

            if (failure) throw failure;
            return response;
        },
        async chatSend(message: string, teamOnly = false) {
            return protoClient.action({
                actions: [{ actionChat: { channel: teamOnly ? CHAT_TEAM : CHAT_BROADCAST, message } }],
            });
        },
        async toggleAutocast(units: Unit | Unit[], abilityId: number) {
            return protoClient.action({
                actions: [{ actionRaw: { toggleAutocast: { abilityId, unitTags: tagsOf(units) } } }],
            });
        },
        async surrender() {
            return protoClient.leaveGame();
        },
        async sendQuery(query: SC2APIProtocol.RequestQuery) {
            return protoClient.query(query);
        },
        async sendAction(commands: SC2APIProtocol.ActionRawUnitCommand | SC2APIProtocol.ActionRawUnitCommand[]) {
            const actionList = Array.isArray(commands) ? commands : [commands];
            const commander = currentCommander();
            markOrdered(actionList);
            actionList.forEach((command) => commit(command.unitTags ?? [], commander));

            return send(actionList);
        },
    };
}

export default createActionManager;
