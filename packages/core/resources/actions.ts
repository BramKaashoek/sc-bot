import createDebug from 'debug';
import Bluebird from 'bluebird';
import createTransport from '@node-sc2/proto';
import getRandom from '../utils/get-random.ts';
import { distance, nClosestPoint } from '../utils/geometry/point.ts';
import { gridsInCircle } from '../utils/geometry/angle.ts';
import {
    Ability,
    enums,
    UnitType,
    UnitTypeId,
    WarpUnitAbility,
} from '../constants/index.ts';
import { GasMineRace } from '../constants/race-map.ts';
import UnitAbilites from '../constants/unit-ability-map.ts';
import { ActionManagerError, BuildError, TrainError, GatherError } from '../engine/errors.ts';
import type { AbilityOptions, ActionManager, Point2D, Unit, WarpInOptions, World } from '../types.ts';

const { Alliance, Race, AbilityDataTarget } = enums;
const debugActionManager = createDebug('sc2:debug:actionManager');

// TODO(ts): the Unit/Point2D unions below are discriminated at runtime by truthy `.tag` / `.x`, not by type
type UnitOrPoint = Partial<Unit & Point2D>;

function getRandomN<T>(arr: T[], n: number): T[] {
    return Array.from({ length: n }, () => {
        return arr[Math.floor(Math.random()*arr.length)];
    });
}

function createActionManager(world: World, client?: NodeSC2Proto.ProtoClient): ActionManager {
    const protoClient = client || createTransport();
    
    return {
        _client: protoClient,
        async do(abilityId: number, ts: string | string[] | Unit[], opts: AbilityOptions = {}) {
            let tags = (Array.isArray(ts) ? ts : [ts]) as Array<string | UnitOrPoint>;

            if ((tags[0] as UnitOrPoint).tag) {
                tags = (tags as UnitOrPoint[]).map(unit => unit.tag!);
            }

            const doAction: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId,
                unitTags: tags as string[],
                queueCommand: opts.queue || false,
            };

            const target = opts.target as UnitOrPoint | undefined;
            if (target && target.tag) {
                doAction.targetUnitTag = target.tag;
            } else if (target && target.x) {
                doAction.targetWorldSpacePos = target as Point2D;
            }

            return this.sendAction(doAction)
                .then(async (res) => {
                    if (res.result![0] !== 1) {
                        throw new Error(`Could not perform ability, result ${res.result![0]}`);
                    }

                    return res;
                });
        },
        async smart(us: Unit[], posOrUnit: Point2D | Unit, queue = false) {
            const units = Array.isArray(us) ? us : [us];
            const pos = posOrUnit as UnitOrPoint;

            const smartTo: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId: Ability.SMART,
                unitTags: units.map(unit => unit.tag!),
                queueCommand: queue,
            };

            if (pos.tag) {
                smartTo.targetUnitTag = pos.tag;
            } else if (pos.x) {
                smartTo.targetWorldSpacePos = pos as Point2D;
            }

            return this.sendAction(smartTo)
                .then(async (res) => {
                    if (res.result![0] !== 1) {
                        throw new Error(`Could not SMART unit, result ${res.result![0]}`);
                    }

                    return res;
                });
        },
        async move(u: Unit | Unit[], target: Point2D | Unit, queue = false) {
            const units = Array.isArray(u) ? u : [u];
            const posOrUnit = target as UnitOrPoint;

            const moveTo: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId: Ability.MOVE,
                unitTags: units.map(unit => unit.tag!),
                queueCommand: queue,
            };

            if (posOrUnit.tag) {
                moveTo.targetUnitTag = posOrUnit.tag;
            } else if (posOrUnit.x) {
                moveTo.targetWorldSpacePos = posOrUnit as Point2D;
            }

            return this.sendAction(moveTo)
                .then((res) => {
                    if (res.result![0] !== 1) {
                        throw new Error(`Could not move unit, result ${res.result![0]}`);
                    }

                    return res;
                });
        },
        async patrol(u: Unit | Unit[], p: Array<[Point2D, Point2D]> | Point2D, queue = false) {
            const units = Array.isArray(u) ? u : [u];

            // TODO(ts): runtime treats `p` as a flat [from, to] pair of points (or a single point), unlike the declared Array<[Point2D, Point2D]>
            const points = (Array.isArray(p) ? p : [units[0].pos, p]) as unknown as Point2D[];
            const [from, to] = points;

            const patrolToTo: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId: Ability.PATROL,
                unitTags: units.map(unit => unit.tag!),
                targetWorldSpacePos: to,
                queueCommand: true,
            };

            return this.move(units, from, queue)
                .then(() => this.sendAction(patrolToTo))
                .then((res) => {
                    if (res.result![0] !== 1) {
                        throw new Error(`Could not patrol unit, result ${res.result![0]}`);
                    }

                    return res;
                });
        },
        async attack(us?: Unit[], unit?: Unit, queue = false) {
            const units = (Array.isArray(us) ? us : [us]) as Unit[];

            return this.sendAction({
                abilityId: Ability.ATTACK_ATTACK,
                targetUnitTag: unit!.tag,
                unitTags: units.map(unit => unit.tag!),
                queueCommand: queue,
            });
        },
        async attackMove(u?: Unit[], p?: Point2D, queue = false) {
            const us = (Array.isArray(u) ? u : [u]) as Unit[];
            const { map } = world.resources.get();

            const moveUnits = us;
            const position = p || map.getLocations().enemy[0];

            return this.sendAction({
                abilityId: Ability.ATTACK_ATTACK,
                targetWorldSpacePos: position,
                unitTags: moveUnits.map(unit => unit.tag!),
                queueCommand: queue,
            });
        },
        async swapBuildings(unitA: Unit, unitB: Unit) {
            const haveAbility = [unitA, unitB].every((unit) => {
                return UnitAbilites[unit.unitType!].includes(Ability.LIFT);
            });

            const isComplete = [unitA, unitB].every(unit => unit.buildProgress! >= 1);

            if (!haveAbility || !isComplete) {
                throw new ActionManagerError(
                    'These two units cannot be swapped',
                    { data: { unitA, unitB } }
                );
            }

            const unitAPos = unitA.pos as Point2D;
            const unitBPos = unitB.pos as Point2D;
    
            // the is dangling on purpose, don't want to hold up our game loop on this stuff
            Bluebird.all([
                this.do(Ability.LIFT, unitA.tag!),
                this.do(Ability.LIFT, unitB.tag!),
            ])
            .delay(100)
            .then(() => {
                return Bluebird.all([
                    this.move([unitA], unitBPos, true),
                    this.move([unitB], unitAPos, true),
                ]);
            })
            .delay(100)
            .then(() => {
                return Bluebird.all([
                    this.do(Ability.LAND, unitA.tag!, { target: unitBPos, queue: true }),
                    this.do(Ability.LAND, unitB.tag!, { target: unitAPos, queue: true }),
                ]);
            }).catch((error) => {
                debugActionManager(`Transport error while trying to engage building swap: ${error.message}`);
            });

            return null; // suppress bluebird warning
        },
        async gather(unit: Unit, mineralField?: Unit, queue = true) {
            const { units } = world.resources.get();

            if (!unit.isWorker() && unit.unitType !== UnitType.MULE) {
                throw new GatherError('only workers can gather', { data: { unit, mineralField, queue }});
            }

            if (unit.labels.has('command') && queue === false) {
                console.warn('WARNING! unit with command erroniously told to force gather! Forcing queue');
                queue = true;
            }

            const ownBases = units.getBases(Alliance.SELF).filter(base => base.buildProgress! >= 1);

            let target: Unit;
            if (mineralField && mineralField.tag) {
                target = mineralField;
            } else {
                let targetBase: Unit;
                const needyBase = ownBases.sort((a, b) => {
                    return distance(unit.pos!, a.pos!) - distance(unit.pos!, b.pos!);
                })
                .find(base => base.assignedHarvesters! < base.idealHarvesters!);

                if (!needyBase) {
                    [targetBase] = ownBases;
                } else {
                    targetBase = needyBase;
                }

                const currentMineralFields = units.getMineralFields();
                const targetBaseFields = units.getClosest(targetBase.pos!, currentMineralFields, 3);
                
                [target] = units.getClosest(unit.pos!, targetBaseFields);
            }

            const sendToGather: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId: Ability.SMART,
                targetUnitTag: target.tag,
                unitTags: [unit.tag!],
                queueCommand: queue,
            };

            return this.sendAction(sendToGather)
                .then(async (res) => {
                    if (res.result![0] !== 1) {
                        throw new Error(`Could not send to gather, result ${res.result![0]}`);
                    }

                    return res;
                });
        },
        async mine(us: Unit[], target: Unit, queue = true) {
            const units = Array.isArray(us) ? us : [us];

            const sendToMine: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId: Ability.HARVEST_GATHER,
                unitTags: units.map(unit => unit.tag!),
                targetUnitTag: target.tag,
                queueCommand: queue,
            };

            return this.sendAction(sendToMine);
        },
        canPlace: (async (unitTypeId: number, poses: Point2D[]) => {
            // limit to checking 10 placements because the client gets unhappy
            const positions = poses.length <= 10 ? poses : getRandomN(poses, 10);

            const placements = positions.map((pos) => ({
                targetPos: pos,
                abilityId: world.data.getUnitTypeData(unitTypeId).abilityId,
            })).reverse();

            const query: SC2APIProtocol.ResponseQuery = await protoClient.query({ placements });

            const successes = query.placements!
                .map((placement, index) => ({ placement, index }))
                .filter((success) => success.placement.result === 1);

            if (successes.length > 0) {
                return placements[getRandom(successes).index].targetPos;
            } else {
                return false;
            }
        }) as ActionManager['canPlace'],
        async findPlacement(unitTypeId, near, { maxDistance = 20, randomAlternative = true, placementStep = 2, addonPlace = false } = {}) {
            const abilityId = world.data.getUnitTypeData(unitTypeId).abilityId;

            const placeable = async (ability: number, positions: Point2D[]) => {
                if (positions.length <= 0) return [];
                const query = await protoClient.query({
                    placements: positions.map(targetPos => ({ abilityId: ability, targetPos })),
                }) as SC2APIProtocol.ResponseQuery;
                return positions.filter((_, i) => query.placements![i].result === 1);
            };

            // add-ons sit 2.5 right, 0.5 down of the host and share a supply depot's 2x2 footprint
            const withAddonRoom = async (positions: Point2D[]) => {
                if (!addonPlace) return positions;
                const addonSpots = await placeable(Ability.BUILD_SUPPLYDEPOT, positions.map(position => ({ x: position.x + 2.5, y: position.y - 0.5 })));
                return positions.filter(position => addonSpots.some(spot => spot.x === position.x + 2.5 && spot.y === position.y - 0.5));
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
                    : possible.reduce((best, candidate) => distance(candidate, near) < distance(best, near) ? candidate : best);
            }

            return false;
        },
        async build(unitTypeId: number, pointOrUnitOrNone?: Point2D | Unit | null, worker?: Unit) {
            const { units, frame } = world.resources.get();

            let queue = false;
            if (world.agent.hasTechFor(unitTypeId) === false) {
                throw new BuildError(
                    'Missing tech requirements to build unit type',
                    { data: { unitTypeId, pointOrUnitOrNone, worker } }
                );
            }

            /**
             * NEVER REMOVE THIS - the user should be checking this on their own
             * to avoid expensive calculations and placement calls, but *we also
             * need to check here again anyway*. Two systems wanting to build something
             * can over take one another while the other is waiting on their placement
             * call to come back, thereby both being able to afford at the start of their
             * routine but not after - AND THE API RESPONDS 1 / SUCCESS TO BOTH - very bad-
             */
            if (!world.agent.canAfford(unitTypeId)) {
                throw new BuildError(
                    `You can not (currently) afford to build unitTypeId ${unitTypeId}`,
                    { data: { unitTypeId, pointOrUnitOrNone, worker } }
                );
            }

            let pos: Point2D | undefined, target: Unit | undefined;

            if (pointOrUnitOrNone && (pointOrUnitOrNone as UnitOrPoint).tag) {
                target = pointOrUnitOrNone as Unit;
            } else if (pointOrUnitOrNone && (pointOrUnitOrNone as UnitOrPoint).x) {
                pos = pointOrUnitOrNone as Point2D;
            }

            const abilityId = world.data.getUnitTypeData(unitTypeId).abilityId!;

            const buildAbilityTarget = world.data.getAbilityData(abilityId).target;
            const mustBeNone = buildAbilityTarget === AbilityDataTarget.NONE;
            const canBeNone = (
                mustBeNone ||
                buildAbilityTarget === AbilityDataTarget.POINTORNONE
            );

            if (!target && !pos && !canBeNone) {
                throw new BuildError(
                    `Building unit ${unitTypeId} with build ability ${abilityId} requires a target of type ${buildAbilityTarget}, but none was given`,
                    { data: { unitTypeId, pointOrUnitOrNone, worker } }
                );
            }

            if ((target || pos) && mustBeNone) {
                throw new BuildError(
                    `Building unit ${unitTypeId} with build ability ${abilityId} must be done without a target, but you gave: ${pointOrUnitOrNone}. Try passing null as the second argument, and your target as the third.`,
                    { data: { unitTypeId, pointOrUnitOrNone, worker } }
                );
            }

            let builder: Unit;
            if (worker) {
                builder = worker;
            } else {
                const builders = [
                    ...units.getMineralWorkers(),
                    ...units.getWorkers().filter(worker => worker.noQueue),
                ];

                // @FIXME: race-specific stuff should be Proxy'd and not conditional like this, ugly
                if (world.agent.race === Race.PROTOSS) {
                    const builderWorkers = units.getConstructingWorkers().filter(worker => !worker.hasLabel('stuck'));
                    if (builderWorkers.length > 0) {
                        [builder] = units.getClosest((pos || target!.pos) as Point2D, builderWorkers);
                        if (distance(builder.pos!, (pos || target!.pos) as Point2D) < 20) {
                            queue = true;
                        } else {
                            [builder] = units.getClosest((pos || target!.pos) as Point2D, builders);
                        }
                    } else {
                        [builder] = units.getClosest((pos || target!.pos) as Point2D, builders);
                    }
                } else {
                    [builder] = units.getClosest((pos || target!.pos) as Point2D, builders);
                }
            }

            if (!builder) {
                throw new BuildError(
                    'Unable to find or use builder, something is very wrong',
                    { data: { unitTypeId, pointOrUnitOrNone, worker } }
                );
            }

            const unitCommand: SC2APIProtocol.ActionRawUnitCommand = {
                abilityId,
                unitTags: [builder.tag!],
                queueCommand: queue,
            };

            builder.labels.set('command', frame.getGameLoop());

            const { mineralCost, vespeneCost } = world.data.getUnitTypeData(unitTypeId);

            world.agent.minerals = world.agent.minerals! - mineralCost!;
            world.agent.vespene = world.agent.vespene! - vespeneCost!;

            if (target) { 
                unitCommand.targetUnitTag = target.tag;
            } else if (pos) {
                unitCommand.targetWorldSpacePos = pos;
            }

            return this.sendAction(unitCommand)
                .then(async (res) => {
                    // *do not delete any builder labels here* - it's not fully ack'd until next frame
                    if (res.result![0] !== 1) {
                        // *not even in here*
                        debugActionManager(`failed request: ${JSON.stringify(unitCommand)}`);
                        throw new Error(`Could not build, result ${res.result![0]}`);
                    }

                    // @FIXME: is there any reason we should hold the loop on this? i feel like there might be...
                    if (unitTypeId === GasMineRace[world.agent.race!]) {
                        await this.gather(builder);
                    }

                    return res;
                });
        },
        async buildGasMine() {
            const { map } = world.resources.get();
            
            const gasMine = GasMineRace[world.agent.race!];
            const [geyser] = map.freeGasGeysers();

            if (!geyser) {
                throw new BuildError(
                    'no free geysers in own expansions for building mines on'
                );
            }

            return this.build(gasMine, geyser);
        },
        async train(unitTypeId: number, productionUnit?: Unit) {
            const { units } = world.resources.get();
            
            if (world.agent.hasTechFor(unitTypeId) === false) {
                throw new TrainError(
                    `Missing tech requirements to build unit type ${unitTypeId}`,
                    { data: { unitTypeId, productionUnit }}
                );
            }

            let trainer: Unit | undefined;

            if (!world.agent.canAfford(unitTypeId)) {
                throw new TrainError(
                    `cannot afford training unit: ${unitTypeId}`,
                    { data: { unitTypeId, productionUnit }}
                );
            } 

            if (productionUnit) {
                trainer = productionUnit;
            } else {
                trainer = units.getProductionUnits(unitTypeId).find(unit => unit.noQueue);
            }

            if (!trainer) {
                throw new TrainError(
                    `no free production unit for type: ${unitTypeId}`,
                    { data: { unitTypeId, productionUnit }}
                );
            }

            const { mineralCost, vespeneCost, abilityId } = world.data.getUnitTypeData(unitTypeId);

            world.agent.minerals = world.agent.minerals! - mineralCost!;
            world.agent.vespene = world.agent.vespene! - vespeneCost!;

            const unitCommand: SC2APIProtocol.ActionRawUnitCommand = { abilityId, unitTags: [trainer.tag!] };

            return this.sendAction(unitCommand)
                .then(async (res) => {
                    if (res.result![0] !== 1) {
                        throw new Error(`Could not train, result ${res.result![0]}`);
                    }

                    return res;
                });
        },
        async upgrade(upgradeId: number, upgradeFacility?: Unit) {
            const { units } = world.resources.get();
            
            let upgrader: Unit | undefined;

            if (upgradeFacility) {
                upgrader = upgradeFacility;
            } else {
                upgrader = units.getUpgradeFacilities(upgradeId).find(unit => unit.noQueue);
            }

            if (!upgrader) {
                throw new TrainError(
                    `no free upgrade facility for upgradeId: ${upgradeId}`,
                    { data: { upgradeId, upgradeFacility }}
                );
            }

            const { abilityId } = world.data.getUpgradeData(upgradeId);
            const unitCommand: SC2APIProtocol.ActionRawUnitCommand = { abilityId, unitTags: [upgrader.tag!] };

            return this.sendAction(unitCommand)
                .then(async (res) => {
                    if (res.result![0] !== 1) {
                        throw new Error(`Could not start upgrade ${upgradeId}, result ${res.result![0]}`);
                    }

                    return res;
                });
        },
        async warpIn(unitType: number, opts: WarpInOptions = {}) {
            const { units, map } = world.resources.get();
            const abilityId = WarpUnitAbility[unitType];
            const n = opts.maxQty || 1;
            const nearPosition = opts.nearPosition || map.getCombatRally();

            const qtyToWarp = world.agent.canAffordN(unitType, n);
            if (qtyToWarp <= 0) {
                throw new ActionManagerError(
                    `cannot afford warping any qty of unit: ${UnitTypeId[unitType]}`,
                    { data: { unitType, opts }}
                );
            }

            const selectedMatricies = units.getClosest(nearPosition, world.agent.powerSources!, opts.nearPosition ? 1 : 3);
            let myPoints = selectedMatricies
                .map(matrix => gridsInCircle(matrix.pos as Point2D, matrix.radius!))
                .reduce((acc, arr) => acc.concat(arr), [])
                .filter(point => map.isPathable(point) && !map.hasCreep(point));

            if (opts.highground) {
                myPoints = myPoints
                    .map(point => ({ ...point, z: map.getHeight(point) }))
                    .sort((a, b) => b.z - a.z)
                    .filter((p, i, arr) => p.z === arr[0].z);
            }
    
            const myStructures = units.getStructures();
            const points = nClosestPoint(nearPosition, myPoints, 100)
                .filter(point => myStructures.every(structure => distance(structure.pos, point) > 2));
    
            const warpGates = units.getById(UnitType.WARPGATE).filter(wg => wg.abilityAvailable(abilityId)).slice(0, qtyToWarp);
            if (warpGates.length <= 0) {
                throw new ActionManagerError(`No ready warpgates with ability to warp in ${UnitTypeId[unitType]}`);
            }

            const destPoints = getRandomN(points, warpGates.length);
    
            const commands: SC2APIProtocol.ActionRawUnitCommand[] = warpGates.map((warpGate, i) => ({
                abilityId,
                unitTags: [warpGate.tag!],
                targetWorldSpacePos: destPoints[i],
            }));

            return this.sendAction(commands).then(async (res) => {
                if (res.result![0] !== 1) {
                    throw new Error(`Could not warp in unit, result ${res.result![0]}`);
                }

                return res;
            });
        },
        async sendQuery(query: SC2APIProtocol.RequestQuery) {
            return protoClient.query(query);
        },
        async sendAction(commands: SC2APIProtocol.ActionRawUnitCommand | SC2APIProtocol.ActionRawUnitCommand[]) {
            const actionList = Array.isArray(commands) ? commands : [commands];

            const action = {
                actions: actionList.map((command) => {
                    return {
                        actionRaw: {
                            unitCommand: command,
                        },
                    };
                }),
            };

            return protoClient.action(action);
        },
    };
}

export default createActionManager;