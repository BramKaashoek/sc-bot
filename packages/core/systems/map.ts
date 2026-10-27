import createDebug from 'debug';
import flat from 'array.prototype.flat';
import hullJs from 'hull.js';
import bresenham from 'bresenham';
import createSystem from './create-system.ts';
import { consumeRawGrids, consumeImageData } from '../utils/map/grid.ts';
import { createClusters as findClusters } from '../utils/map/cluster.ts';
import createExpansion from '../engine/create-expansion.ts';
import floodFill from '../utils/map/flood.ts';
import { distanceAAShapeAndPoint } from '../utils/geometry/plane.ts';
import { distance, avgPoints, areEqual, closestPoint, createPoint2D, getNeighbors } from '../utils/geometry/point.ts';
import { frontOfGrid } from '../utils/map/region.ts';
import { gridsInCircle } from '../utils/geometry/angle.ts';
import {
    MineralField,
    VespeneGeyser,
    Townhall,
    footprintData,
    footprintCells,
    pathingCells,
    getFootprint,
} from '../utils/geometry/units.ts';
import { Alliance } from '../constants/enums.ts';
import Color from '../constants/color.ts';
import { UnitType, UnitTypeId } from '../constants/index.ts';
import {
    flyingStructureTypes,
    vespeneGeyserTypes,
    mineralFieldTypes,
    townhallTypes,
    unbuildablePlateTypes,
} from '../constants/groups.ts';
import type { Expansion, Grid2D, MapResource, MapSystem, Point2D, Unit, WPoint, World } from '../types.ts';

const debugDrawPlacement = createDebug('sc2:DrawPlacementMap');
const debugDrawMap = createDebug('sc2:DrawDebugMap');
const debugDrawWalls = createDebug('sc2:DrawDebugWalls');
const debugDebug = createDebug('sc2:debug:MapSystem');
const silly = createDebug('sc2:silly:MapSystem');

type PointCluster = Point2D[] & { centroid?: Point2D };

type BlockedStructure = { unitType: number; pos: Point2D };

// mapSystem is a shared module object, so per-game state is keyed by world
const blockedEnemyStructures = new WeakMap<World, Map<string, BlockedStructure>>();

function enemyBlocks(world: World) {
    let blocked = blockedEnemyStructures.get(world);
    if (!blocked) {
        blocked = new Map();
        blockedEnemyStructures.set(world, blocked);
    }
    return blocked;
}

const cellKey = ({ x, y }: Point2D) => `${x},${y}`;

function blockStructure(world: World, unitType: number, pos: Point2D) {
    const { map } = world.resources.get();
    footprintCells(world, unitType, pos).forEach((cell) => map.setPlaceable(cell, false));
    pathingCells(world, unitType, pos).forEach((cell) => map.setPathable(cell, false));
}

// own and enemy footprints can overlap through a stale enemy record, so a cell another structure still covers stays blocked
function releaseStructure(world: World, tag: string, unitType: number, pos: Point2D, { placement = true } = {}) {
    const { map, units } = world.resources.get();
    const heldPlacement = new Set<string>();
    const heldPathing = new Set<string>();
    const hold = (heldType: number, heldPos: Point2D) => {
        // footprints are at most 5x5, so farther centres can't share a cell
        if (Math.abs(heldPos.x - pos.x) >= 5 || Math.abs(heldPos.y - pos.y) >= 5) return;
        footprintCells(world, heldType, heldPos).forEach((cell) => heldPlacement.add(cellKey(cell)));
        pathingCells(world, heldType, heldPos).forEach((cell) => heldPathing.add(cellKey(cell)));
    };
    enemyBlocks(world).forEach((other, otherTag) => otherTag !== tag && hold(other.unitType, other.pos));
    units
        .getAlive(Alliance.SELF)
        .filter(
            (own) =>
                own.tag !== tag &&
                own.isStructure() &&
                !own.isGasMine() &&
                !flyingStructureTypes.includes(own.unitType!),
        )
        .forEach((own) => hold(own.unitType!, own.pos));

    if (placement) {
        footprintCells(world, unitType, pos)
            .filter((cell) => !heldPlacement.has(cellKey(cell)))
            .forEach((cell) => map.setPlaceable(cell, true));
    }
    pathingCells(world, unitType, pos)
        .filter((cell) => !heldPathing.has(cellKey(cell)))
        .forEach((cell) => map.setPathable(cell, true));
}

// unitCreated and unitTypeChanged are own-only, so enemy structures are diffed against what was blocked for them
function reconcileEnemyStructures(world: World) {
    const { units, map } = world.resources.get();
    const blocked = enemyBlocks(world);
    const inSight = new Set<string>();

    // getStructures throws on unknown types; isStructure doesn't
    for (const structure of units.getAlive(Alliance.ENEMY)) {
        if (!structure.isStructure() || structure.isGasMine()) continue;
        const { tag, unitType, pos } = structure;
        inSight.add(tag!);

        const record = blocked.get(tag!);
        if (record && record.unitType === unitType && areEqual(record.pos, pos)) continue;

        if (record) {
            blocked.delete(tag!);
            releaseStructure(world, tag!, record.unitType, record.pos);
        }

        if (flyingStructureTypes.includes(unitType!) || !getFootprint(unitType!, footprintData(world))) continue;

        blocked.set(tag!, { unitType: unitType!, pos: { x: pos.x, y: pos.y } });
        blockStructure(world, unitType!, pos);
    }

    for (const [tag, record] of blocked) {
        if (inSight.has(tag) || !map.isVisible(record.pos)) continue;
        blocked.delete(tag);
        releaseStructure(world, tag, record.unitType, record.pos);
    }
}

function assignBase(map: MapResource, townhall: Unit) {
    const expansion = map.getExpansions().find((candidate) => {
        return areEqual(candidate.townhallPosition, map.getClosestExpansion(townhall.pos).townhallPosition);
    });

    // allow for misplaced townhalls, but not macro hatches
    if (expansion && distance(expansion.townhallPosition, townhall.pos) < 4.5) {
        expansion.base = townhall.tag;
    }
}

// live SC2 lets ground units cross unbuildable rocks, bricks and plates, but not rocks, debris or Xel'Naga towers
const walkableBlockerTypes = [...unbuildablePlateTypes, UnitType.UNBUILDABLEROCKSDESTRUCTIBLE];

const placementBlockers = (world: World) => {
    const { units } = world.resources.get();
    return [...units.getDestructables(), ...units.getWatchtowers()].filter((blocker) =>
        getFootprint(blocker.unitType, footprintData(world)),
    );
};

function updateAreas(world: World, expansion: Expansion) {
    const { map, debug } = world.resources.get();
    const {
        townhallPosition: thPos,
        cluster: { mineralFields, vespeneGeysers },
    } = expansion;

    const { self, enemy } = map.getLocations();
    const isStartingLocation = [self, enemy?.[0]].some((location) => location && distance(location, thPos) < 5);

    const placementGrid = floodFill(
        map.getGrids().miniMap!,
        Math.trunc(thPos.x + 3), // adding 3 to start at an x,y not occupied by the townhall
        Math.trunc(thPos.y),
        null,
        104,
        isStartingLocation ? false : 16,
    );

    const mineralLine = placementGrid.filter((gridPoint) => {
        return [...mineralFields, ...vespeneGeysers!].some((resource) => {
            const thShape = Townhall(thPos);
            const shape = resource.isMineralField() ? MineralField(resource.pos) : VespeneGeyser(resource.pos);
            return distanceAAShapeAndPoint(shape, gridPoint) < 4 && distanceAAShapeAndPoint(thShape, gridPoint) < 3;
        });
    });

    const behindMineralLine = placementGrid.filter((gridPoint) => {
        return mineralFields.some((resource) => {
            const thShape = Townhall(thPos);
            const shape = MineralField(resource.pos);
            const distanceResource = distanceAAShapeAndPoint(shape, gridPoint);
            const distanceTownhall = distanceAAShapeAndPoint(thShape, gridPoint);
            return distanceResource < 5 && distanceTownhall > 4 && distanceTownhall > distanceResource;
        });
    });

    const areaFill = floodFill(
        map.getGrids().placement!,
        Math.trunc(thPos.x),
        Math.trunc(thPos.y),
        null,
        104,
        isStartingLocation ? false : 16,
    );

    // @types/hull.js can't express that a format argument makes it return the input points
    const naiveHull = hullJs(areaFill, 2, ['.x', '.y']) as Point2D[];

    const hull = naiveHull.reduce<Point2D[]>((acc, point, i, arr) => {
        const connector = arr[i + 1] || arr[0];
        bresenham(point.x, point.y, connector.x, connector.y, (x, y) => {
            if (!acc.find((p) => p.x === x && p.y === y)) {
                acc.push({ x, y });
            }
        });
        return acc;
    }, []);

    return {
        ...expansion,
        areas: {
            areaFill,
            hull,
            placementGrid: placementGrid.filter((point) => {
                return !mineralLine.find((pos) => pos.x === point.x && pos.y === point.y);
            }),
            mineralLine,
            behindMineralLine,
        },
    };
}

function calculateRamps(minimap: Grid2D) {
    return minimap.reduce<Point2D[]>((acc, row, y) => {
        row.forEach((tile, x) => {
            if (tile === 114) {
                acc = acc.concat([{ x, y }]);
            }
        });

        return acc;
    }, []);
}

function calculateWall(world: World, expansion: Expansion) {
    const { map, units, debug } = world.resources.get();
    const placement = map.getGrids().placement!;

    const hull = expansion.areas!.hull;
    const foeHull = frontOfGrid(world, hull);

    const cellsBlockedByUnbuildableUnit = flat(
        placementBlockers(world).map((plate) => footprintCells(world, plate.unitType!, plate.pos)),
    );

    function findAllPossibleWalls(rampDesired = true): Point2D[][] {
        const rampTest = (point: Point2D) => (rampDesired ? map.isRamp(point) : !map.isRamp(point));

        const { deadHull, liveHull } = foeHull.reduce<{ deadHull: Point2D[]; liveHull: Point2D[] }>(
            (decomp, point) => {
                const neighbors = getNeighbors(point, false);
                const diagNeighbors = getNeighbors(point, true, true);

                const deadNeighbors = neighbors.filter((point) => !map.isPathable(point));
                const deadDiagNeighbors = diagNeighbors.filter((point) => !map.isPathable(point));

                if (deadNeighbors.length <= 0 && deadDiagNeighbors.length <= 0) {
                    if (neighbors.some(rampTest)) {
                        if (
                            !neighbors.some((point) =>
                                cellsBlockedByUnbuildableUnit.some((cell) => areEqual(cell, point)),
                            ) &&
                            !diagNeighbors.some((point) =>
                                cellsBlockedByUnbuildableUnit.some((cell) => areEqual(cell, point)),
                            )
                        ) {
                            decomp.liveHull.push(point);
                        }
                    }
                }

                decomp.deadHull = decomp.deadHull.concat(
                    deadNeighbors.filter((neighborCell) => {
                        const neighborsNeighbors = getNeighbors(neighborCell);
                        return neighborsNeighbors.some(rampTest);
                    }),
                );

                return decomp;
            },
            { deadHull: [], liveHull: [] },
        );

        const deadHullClusters = deadHull.reduce<PointCluster[]>((clusters, deadHullCell) => {
            if (clusters.length <= 0) {
                const newCluster: PointCluster = [deadHullCell];
                newCluster.centroid = deadHullCell;
                clusters.push(newCluster);
                return clusters;
            }

            const clusterIndex = clusters.findIndex(
                (cluster) => distance(cluster.centroid!, deadHullCell) < liveHull.length - 1,
            );
            if (clusterIndex !== -1) {
                clusters[clusterIndex].push(deadHullCell);
                clusters[clusterIndex].centroid = avgPoints(clusters[clusterIndex]);
            } else {
                const newCluster: PointCluster = [deadHullCell];
                newCluster.centroid = deadHullCell;
                clusters.push(newCluster);
            }

            return clusters;
        }, []);

        return deadHullClusters
            .reduce<Point2D[][]>((walls, cluster, i) => {
                const possibleWalls = flat(
                    cluster.map((cell) => {
                        const notOwnClusters = deadHullClusters.filter((c, j) => j !== i);
                        return notOwnClusters.map((jcluster) => {
                            const closestCell = closestPoint(cell, jcluster);
                            const line: Point2D[] = [];
                            bresenham(cell.x, cell.y, closestCell.x, closestCell.y, (x, y) => line.push({ x, y }));
                            return line;
                        });
                    }),
                );

                return walls.concat(possibleWalls);
            }, [])
            .map((wall) => {
                const first = wall[0];
                const last = wall[wall.length - 1];

                const newGraph = map.newGraph(placement.map((row) => row.map((cell) => (cell === 0 ? 1 : 0))));

                newGraph.setWalkableAt(first.x, first.y, true);
                newGraph.setWalkableAt(last.x, last.y, true);
                return map
                    .path(wall[0], wall[wall.length - 1], { graph: newGraph, diagonal: true })
                    .map(([x, y]) => ({ x, y }));
            })
            .map((wall) => {
                return wall.filter((cell) => map.isPlaceable(cell));
            })
            .sort((a, b) => a.length - b.length)
            .filter((wall) => wall.length >= liveHull.length)
            .filter((wall) => distance(avgPoints(wall), avgPoints(liveHull)) <= liveHull.length);
    }

    let allPossibleWalls = findAllPossibleWalls(true);

    if (!allPossibleWalls[0]) {
        allPossibleWalls = findAllPossibleWalls(false);
    }

    const [shortestWall = []] = allPossibleWalls;

    if (debugDrawWalls.enabled) {
        debug!.setDrawCells(
            `dhwall`,
            shortestWall.map((fh) => ({ pos: fh })),
            { size: 0.9, color: Color.FUCHSIA, cube: true, persistText: true },
        );
    }

    expansion.areas!.wall = shortestWall;
    if (shortestWall.length === 0) return;

    expansion.areas!.areaFill = expansion.areas!.areaFill.filter((areaPoint) => {
        return shortestWall.every(
            (wallPoint) =>
                distance(wallPoint, expansion.townhallPosition) > distance(areaPoint, expansion.townhallPosition),
        );
    });
}

function calculateExpansions(world: World) {
    const { units, debug, map } = world.resources.get();

    const { self, enemy } = map.getLocations();
    const mineralFields = units.getMineralFields();

    const mainBase = units.getAll(Alliance.SELF).find((u) => u.isTownhall());
    const vespeneGeysers = units.getByType(vespeneGeyserTypes);

    // @TODO: handle the case of more than 1 enemy location
    const pathingTargets = [self, enemy?.[0]].map((location) => {
        if (!location) return undefined;
        const target = createPoint2D(location);
        target.x = target.x + 3;
        return target;
    });

    const UNREACHABLE = 999;
    const pathTo = (start: Point2D, target?: Point2D) => {
        const path = target ? map.path(start, target) : [];
        if (path.length === 0) path.length = UNREACHABLE;
        return path;
    };

    const expansions = findClusters([...mineralFields, ...vespeneGeysers!])
        .map((cluster) => createExpansion(world, cluster))
        .map((expansion) => {
            const start = { ...expansion.townhallPosition };
            start.x = start.x + 3;
            return Object.assign(expansion, {
                pathFromMain: pathTo(start, pathingTargets[0]),
                pathFromEnemy: pathTo(start, pathingTargets[1]),
            });
        })
        .sort((a, b) => a.pathFromMain!.length - b.pathFromMain!.length)
        .map((expansion) => updateAreas(world, expansion))
        .map((expansion) => Object.assign(expansion, { centroid: avgPoints(expansion.areas!.areaFill) }));

    if (expansions[0] && mainBase) expansions[0].base = mainBase.tag;

    map.setExpansions(expansions);

    if (debugDrawMap.enabled) {
        debug!.setRegions(expansions);
    }

    return expansions;
}

const mapSystem: MapSystem = {
    name: 'MapSystem',
    type: 'engine',
    defaultOptions: {
        stepIncrement: 1,
    },
    async onGameStart(world: World) {
        const { units, frame, map, debug } = world.resources.get();
        const startRaw = frame.getGameInfo().startRaw!;

        const ownStartingTh = units.getAlive(Alliance.SELF).find((u) => u.isTownhall());

        map.setLocations({
            ...(ownStartingTh ? { self: ownStartingTh.pos } : {}),
            enemy: (startRaw.startLocations ?? []).map(({ x, y }) => ({ x: x!, y: y! })),
        });

        map.setGrids(consumeRawGrids(startRaw));
        map.setSize(startRaw.mapSize!);
        map.setGraph();

        try {
            map.setStartRaw(startRaw);
        } catch (e) {
            console.warn('Could not analyze ramps and expansion locations from the start grids', e);
        }

        map.setRamps(
            calculateRamps(map._grids.miniMap!).map((rPoint) => {
                return Object.assign(rPoint, { z: map.getHeight(rPoint) });
            }),
        );

        map.setRamps(
            map._ramps.filter((possibleRamp) => {
                const { x, y } = possibleRamp;
                // this is necessary because some maps have random tiles that aren't placeable but are pathable
                const neighbors = [
                    { y: y - 1, x },
                    { y, x: x - 1 },
                    { y, x: x + 1 },
                    { y: y + 1, x },
                ];

                return neighbors.some((point) => map.isRamp(point));
            }),
        );

        const geysers = units.getGasGeysers();
        const fields = units.getByType(mineralFieldTypes);

        [...geysers, ...fields].forEach((blocker) => {
            footprintCells(world, blocker.unitType!, blocker.pos).forEach((cell) => {
                map.setPlaceable(cell, false);
                map.setPathable(cell, false);
            });
        });

        // the start pathing grid leaves rocks and towers walkable
        placementBlockers(world).forEach((blocker) => {
            const cells = footprintCells(world, blocker.unitType!, blocker.pos);
            cells.forEach((cell) => map.setPlaceable(cell, false));
            if (!walkableBlockerTypes.includes(blocker.unitType!))
                cells.forEach((cell) => map.setPathable(cell, false));
        });

        calculateExpansions(world);
        const natural = map.getNatural();
        if (natural) calculateWall(world, natural);
    },
    async onStep(world) {
        const { data, resources } = world;
        const { frame, map, events, debug } = resources.get();
        const newMapState = frame.getMapState();
        const mapState = {
            creep: consumeImageData(newMapState.creep!, map._mapSize.x!),
            visibility: consumeImageData(newMapState.visibility!, map._mapSize.x!),
        };

        map.setMapState(mapState);
        reconcileEnemyStructures(world);

        const currEffectData = map.getEffects();
        const newEffectData = frame.getEffects();

        const sameEffect = (left: SC2APIProtocol.Effect, right: SC2APIProtocol.Effect) =>
            left.effectId === right.effectId &&
            left.pos![0].x === right.pos![0].x &&
            left.pos![0].y === right.pos![0].y &&
            left.pos!.length === right.pos!.length;

        const newEffects = newEffectData
            .filter((newEffect) => !currEffectData.some((currEffect) => sameEffect(currEffect, newEffect)))
            .map((effect) => {
                const effectData = data.getEffectData(effect.effectId!);
                const effectGrid = effect.pos!.reduce<Point2D[]>((grid, pos) => {
                    return grid.concat(gridsInCircle(pos as Point2D, effectData.radius!, { normalize: true }));
                }, []);

                return {
                    ...effect,
                    ...effectData,
                    effectGrid,
                };
            });

        if (newEffects.length >= 1) {
            newEffects.forEach((effect) => {
                silly('New Effect!', effect);

                events.write({
                    name: 'newEffect',
                    data: effect,
                });
            });
        }

        const expiredEffects = currEffectData.filter(
            (currEffect) => !newEffectData.some((newEffect) => sameEffect(currEffect, newEffect)),
        );

        if (expiredEffects.length >= 1) {
            expiredEffects.forEach((effect) => {
                const effectData = data.getEffectData(effect.effectId!);
                silly('Expired effect!', effect);
                silly('Effect Data:', effectData);

                events.write({
                    name: 'expiredEffect',
                    data: {
                        ...effect,
                        ...effectData,
                    },
                });
            });
        }

        const persistingEffects = currEffectData.filter((currEffect) => !expiredEffects.includes(currEffect));

        map.setActiveEffects(persistingEffects.concat(newEffects));

        if (debugDrawPlacement.enabled) {
            debug!.setDrawCells(
                'debugDrawPlaceable',
                map.getGrids().placement!.reduce<WPoint[]>((cells, row, y) => {
                    row.forEach((placeable, x) => {
                        cells.push({
                            pos: { x, y },
                            size: 0.5,
                            color: placeable ? Color.LIME_GREEN : Color.RED,
                        });
                    });

                    return cells;
                }, []),
                { includeText: false },
            );
        }
    },
    async onUnitCreated(world, newUnit) {
        const { map, frame } = world.resources.get();

        if (newUnit.isStructure()) blockStructure(world, newUnit.unitType!, newUnit.pos);

        if (newUnit.isTownhall()) {
            debugDebug(`new townhall detected: ${UnitTypeId[newUnit.unitType!]}`);

            // @TODO: this should happen on frame 1, so we can re-sync to existing games
            if (frame.getGameLoop() <= 8) return;

            assignBase(map, newUnit);
        }
    },
    async onUnitDestroyed(world, deadUnit) {
        if (deadUnit.alliance === Alliance.ENEMY) {
            const record = enemyBlocks(world).get(deadUnit.tag!);
            if (!record) return;

            enemyBlocks(world).delete(deadUnit.tag!);
            releaseStructure(world, deadUnit.tag!, record.unitType, record.pos);
            return;
        }

        if (deadUnit.isStructure() && !deadUnit.isGasMine()) {
            releaseStructure(world, deadUnit.tag!, deadUnit.unitType!, deadUnit.pos);
        }
    },
    async onUnitTypeChanged(world, { unit, previousType }) {
        const wasFlying = flyingStructureTypes.includes(previousType);
        const isFlying = flyingStructureTypes.includes(unit.unitType!);
        const { map } = world.resources.get();

        if (wasFlying === isFlying) {
            if (isFlying || !unit.isStructure()) return;

            releaseStructure(world, unit.tag!, previousType, unit.pos, { placement: false });
            pathingCells(world, unit.unitType!, unit.pos).forEach((cell) => map.setPathable(cell, false));
            return;
        }

        if (isFlying) {
            releaseStructure(world, unit.tag!, previousType, unit.pos);
        } else {
            blockStructure(world, unit.unitType!, unit.pos);
        }
    },
    async onEnemyFirstSeen({ resources }, scoutedUnit) {
        const { map } = resources.get();

        if (!scoutedUnit.isTownhall()) return;

        assignBase(map, scoutedUnit);
    },
};

export default () => createSystem(mapSystem);
