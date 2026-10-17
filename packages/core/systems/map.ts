import createDebug from 'debug';
import flat from 'array.prototype.flat';
import hullJs from 'hull.js';
import bresenham from 'bresenham';
import createSystem from './create-system.ts';
import { consumeRawGrids, consumeImageData } from '../utils/map/grid.ts';
import { createClusters as findClusters } from '../utils/map/cluster.ts';
import createExpansion from '../engine/create-expansion.ts';
import floodFill from '../utils/map/flood.ts';
import { distanceAAShapeAndPoint, cellsInFootprint } from '../utils/geometry/plane.ts';
import { distance, avgPoints, areEqual, closestPoint, createPoint2D, getNeighbors } from '../utils/geometry/point.ts';
import { frontOfGrid } from '../utils/map/region.ts';
import { gridsInCircle } from '../utils/geometry/angle.ts';
import { MineralField, VespeneGeyser, Townhall, getFootprint } from '../utils/geometry/units.ts';
import { Alliance } from '../constants/enums.ts';
import { MapDecompositionError } from '../engine/errors.ts';
import Color from '../constants/color.ts';
import { UnitType, UnitTypeId } from '../constants/index.ts';
import { vespeneGeyserTypes, unbuildablePlateTypes, mineralFieldTypes } from '../constants/groups.ts';
import type { Expansion, Grid2D, MapResource, MapSystem, Point2D, WPoint, World } from '../types.ts';

const debugDrawPlacement = createDebug('sc2:DrawPlacementMap');
const debugDrawMap = createDebug('sc2:DrawDebugMap');
const debugDrawWalls = createDebug('sc2:DrawDebugWalls');
const debugDebug = createDebug('sc2:debug:MapSystem');
const silly = createDebug('sc2:silly:MapSystem');

type PointCluster = Point2D[] & { centroid?: Point2D };

function updateAreas(world: World, expansion: Expansion) {
    const { map, debug } = world.resources.get();
    const { townhallPosition: thPos, cluster: { mineralFields, vespeneGeysers } } = expansion;
    
    const isStartingLocation = (
        // is own base
        distance(map.getLocations().self, thPos) < 5 || 
        // is enemy base
        distance(map.getLocations().enemy[0], thPos) < 5
    );

    //const tmpMiniMap = grids.miniMap.map(r => r.slice())
    const placementGrid = floodFill(
        map.getGrids().miniMap!,
        Math.trunc(thPos.x + 3), // adding 3 to start at an x,y not occupied by the townhall
        Math.trunc(thPos.y),
        null,
        104,
        isStartingLocation ? false : 16,
    );

    const mineralLine = placementGrid
        .filter(gridPoint => {
            return [...mineralFields, ...vespeneGeysers!].some(resource => {
                const thShape = Townhall(thPos);
                const shape = resource.isMineralField() ? MineralField(resource.pos) : VespeneGeyser(resource.pos);
                return (
                    distanceAAShapeAndPoint(shape, gridPoint) < 4
                    && distanceAAShapeAndPoint(thShape, gridPoint) < 3
                );
            });
        });

    const behindMineralLine = placementGrid
        .filter(gridPoint => {
            return mineralFields.some(resource => {
                const thShape = Townhall(thPos);
                const shape = MineralField(resource.pos);
                const distanceResource = distanceAAShapeAndPoint(shape, gridPoint);
                const distanceTownhall = distanceAAShapeAndPoint(thShape, gridPoint);
                return (
                    distanceResource < 5
                    && distanceTownhall > 4
                    && distanceTownhall > distanceResource
                );
            });
        });

    const areaFill = floodFill(
        map.getGrids().placement!,
        Math.trunc(thPos.x),
        Math.trunc(thPos.y),
        null,
        104,
        isStartingLocation ? false : 16,
    );/* .filter((point) => {
        return !mineralLine.find(pos => pos.x === point.x && pos.y === point.y);
    }); */ // why were we doing this? The area fill should probably include the mineral line, no?

    // TODO(ts): @types/hull.js types the result as object | number[]
    const naiveHull = hullJs(areaFill, 2, ['.x', '.y']) as Point2D[];
    // debug.setDrawCells(`naiveHull-${Math.floor(expansion.townhallPosition.x)}`, naiveHull.map(fh => ({ pos: fh })), { size: 0.50, color: Color.AQUA, cube: true, persistText: true });

    const hull = naiveHull.reduce<Point2D[]>((acc, point, i, arr) => {
        const connector = arr[i + 1] || arr[0];
        bresenham(point.x, point.y, connector.x, connector.y, (x, y) => {
            if (!acc.find(p => p.x === x && p.y === y)) {
                acc.push({x, y});
            }
        });
        return acc;
    }, []);

    // debug.setDrawCells(`hull-${Math.floor(expansion.townhallPosition.x)}`, hull.map(fh => ({ pos: fh })), { size: 0.50, color: Color.YELLOW, cube: true, persistText: true });

    return {
        ...expansion,
        areas: {
            areaFill,
            hull,
            placementGrid: placementGrid.filter((point) => {
                return !mineralLine.find(pos => pos.x === point.x && pos.y === point.y);
            }),
            mineralLine,
            behindMineralLine,
        }
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

/** Natural wall only for now */
function calculateWall(world: World, expansion: Expansion) {
    const { map, units, debug } = world.resources.get();
    // TODO(ts): MapResource type lacks isRamp (defined on the concrete map manager in resources/map.ts)
    const rampMap = map as MapResource & { isRamp: (point: Point2D) => boolean };
    const placement = map.getGrids().placement!;

    const hull = expansion.areas!.hull;
    const foeHull = frontOfGrid(world, hull);
    // debug.setDrawCells('fonHull', foeHull.map(fh => ({ pos: fh })), { size: 0.50, color: Color.YELLOW, cube: true, persistText: true });

    /**
     * @FIXME: this is duplicated logic and can prolly be consolidated
     */


    const plates = units.getByType(unbuildablePlateTypes);
    const cellsBlockedByUnbuildableUnit = flat(
        plates.map(plate => {
            const footprint = getFootprint(plate.unitType!)!;
            return cellsInFootprint(createPoint2D(plate.pos), footprint);
        })
    );
    // debug.setDrawCells('blockedCells', cellsBlockedByUnbuildableUnit.map(fh => ({ pos: fh })), { size: 0.50, color: Color.YELLOW, cube: true, persistText: true });

    function findAllPossibleWalls(rampDesired = true): Point2D[][] {
        const rampTest = (point: Point2D) => rampDesired ? rampMap.isRamp(point) : !rampMap.isRamp(point);

        const { deadHull, liveHull } = foeHull.reduce<{ deadHull: Point2D[], liveHull: Point2D[] }>((decomp, point) => {
            const neighbors = getNeighbors(point, false);
            const diagNeighbors = getNeighbors(point, true, true);
    
            const deadNeighbors = neighbors.filter(point => !map.isPathable(point));
            const deadDiagNeighbors = diagNeighbors.filter(point => !map.isPathable(point));
    
            if ((deadNeighbors.length <= 0) && (deadDiagNeighbors.length <= 0)) {
                if (neighbors.some(rampTest)) {
                    if (
                        (!neighbors.some(point => cellsBlockedByUnbuildableUnit.some(cell => areEqual(cell,point))))
                        && (!diagNeighbors.some(point => cellsBlockedByUnbuildableUnit.some(cell => areEqual(cell,point))))
                    ) {
                        decomp.liveHull.push(point);
                    } else {
                        // the ether...
                    }
                } else {
                    // the ether...
                }
            }
    
            decomp.deadHull = decomp.deadHull.concat(
                deadNeighbors.filter((neighborCell) => {
                    const neighborsNeighbors = getNeighbors(neighborCell);
                    return neighborsNeighbors.some(rampTest);
                })
            );
    
            return decomp;
        }, { deadHull: [], liveHull: [] });
    
        // debug.setDrawCells(`liveHull-${Math.floor(expansion.townhallPosition.x)}`, live.map(fh => ({ pos: fh })), { size: 0.75, color: Color.LIME_GREEN, cube: true });
        // debug.setDrawCells(`deadHull-${Math.floor(expansion.townhallPosition.x)}`, decomp.deadHull.map(fh => ({ pos: fh })), { size: 0.75, color: Color.RED, cube: true });
    
        const deadHullClusters = deadHull.reduce<PointCluster[]>((clusters, deadHullCell) => {
            if (clusters.length <= 0) {
                const newCluster: PointCluster = [deadHullCell];
                newCluster.centroid = deadHullCell;
                clusters.push(newCluster);
                return clusters;
            }
    
            const clusterIndex = clusters.findIndex(cluster => distance(cluster.centroid!, deadHullCell) < (liveHull.length - 1));
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
    
        // debug.setDrawTextWorld(`liveHullLength-${Math.floor(expansion.townhallPosition.x)}`, [{ pos: createPoint2D(avgPoints(live)), text: `${live.length}` }]);
    
        // deadHullClusters.forEach((cluster, i) => {
        //     debug.setDrawCells(`dhcluster-${Math.floor(expansion.townhallPosition.x)}-${i}`, cluster.map(fh => ({ pos: fh })), { size: 0.8, cube: true });
        // });
    
        return deadHullClusters.reduce<Point2D[][]>((walls, cluster, i) => {
            const possibleWalls = flat(
                cluster.map(cell => {
                    const notOwnClusters = deadHullClusters.filter((c, j) => j !== i);
                    return notOwnClusters.map(jcluster => {
                        const closestCell = closestPoint(cell, jcluster);
                        const line: Point2D[] = [];
                        bresenham(cell.x, cell.y, closestCell.x, closestCell.y, (x, y) => line.push({x, y}));
                        return line;
                    });
                })
            );
    
            return walls.concat(possibleWalls);
        }, [])
        .map(wall => {
            const first = wall[0];
            const last = wall[wall.length -1];
    
            const newGraph = map.newGraph(placement.map(row => row.map(cell => cell === 0 ? 1 : 0)));
    
            newGraph.setWalkableAt(first.x, first.y, true);
            newGraph.setWalkableAt(last.x, last.y, true);
            return map.path(wall[0], wall[wall.length -1], { graph: newGraph, diagonal: true })
                .map(([x, y]) => ({ x, y }));
        })
        .map(wall => { 
            // debug.setDrawCells(`middleWallCalc-${Math.floor(expansion.townhallPosition.x)}`, wall.map(fh => ({ pos: fh })), { size: 1, color: Color.HOT_PINK, cube: false });
            return wall.filter(cell => map.isPlaceable(cell));
        })
        .sort((a, b) => a.length - b.length)
        .filter(wall => wall.length >= liveHull.length)
        .filter (wall => distance(avgPoints(wall), avgPoints(liveHull)) <= liveHull.length)
    }

    // try first assuming we have a nat ramp
    let allPossibleWalls = findAllPossibleWalls(true);

    if (!allPossibleWalls[0]) {
        // now try assuming there is no ramp
        allPossibleWalls = findAllPossibleWalls(false);
    }

    /**
     * @FIXME: we just sort of assume we always found a wall here... should be some contingency 
     */
    const [shortestWall] = allPossibleWalls;

    if (debugDrawWalls.enabled) {
        debug!.setDrawCells(
            `dhwall`,
            shortestWall.map(fh => ({ pos: fh })),
            { size: 0.9, color: Color.FUCHSIA, cube: true, persistText: true }
        );
    }

    expansion.areas!.wall = shortestWall;
    expansion.areas!.areaFill = expansion.areas!.areaFill.filter(areaPoint => {
        return shortestWall.every(wallPoint => (
            distance(wallPoint, expansion.townhallPosition) > distance(areaPoint, expansion.townhallPosition)
        ));
    });
}

function calculateExpansions(world: World) {
    const { units, debug, map } = world.resources.get();

    const startingLocation = map.getLocations().self;
    const mineralFields = units.getMineralFields();

    const mainBase = units.getAll(Alliance.SELF).find(u => u.isTownhall());
    const vespeneGeysers = units.getByType(vespeneGeyserTypes);

    if (!startingLocation) {
        throw new MapDecompositionError('No starting locations - map is likely custom');
    }

    const pathingSL = createPoint2D(startingLocation);
    pathingSL.x = pathingSL.x + 3;

    // @TODO: handle the case of more than 1 enemy location
    const pathingEL = createPoint2D(map.getLocations().enemy[0]);
    pathingEL.x = pathingEL.x + 3;
    
    let expansions: Expansion[] | undefined;
    try {
        expansions = findClusters([...mineralFields, ...vespeneGeysers!])
            .map(cluster => createExpansion(world, cluster))
            .map((expansion) => {
                const start =  { ...expansion.townhallPosition };
                start.x = start.x + 3;
                const paths = {
                    pathFromMain: map.path(start, pathingSL),
                    pathFromEnemy: map.path(start, pathingEL),
                };

                if (paths.pathFromEnemy.length === 0) paths.pathFromEnemy.length = 999;
                if (paths.pathFromMain.length === 0) paths.pathFromMain.length = 999;

                return Object.assign(expansion, paths);
            })
            .sort((a, b) => a.pathFromMain!.length - b.pathFromMain!.length)
            .map(expansion => updateAreas(world, expansion))
            .map(expansion => Object.assign(expansion, { centroid: avgPoints(expansion.areas!.areaFill) }));

        expansions[0].base = mainBase!.tag;

        map.setExpansions(expansions);

        if (debugDrawMap.enabled) {
            debug!.setRegions(expansions!);
        }
    } catch (e) {
        console.warn(e);
        console.warn('Map is not decomposable! If this is a 1v1 ladder map, please submit a bug report');
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

        const ownStartingTh = units.getAlive(Alliance.SELF).find(u => u.isTownhall());

        if (ownStartingTh && startRaw.startLocations!.length > 0) {
            map.setLocations({
                self: ownStartingTh.pos,
                // TODO(ts): proto Point2D has optional x/y, Locations.enemy expects required
                enemy: startRaw.startLocations! as Point2D[],
            });
        }

        map.setGrids(consumeRawGrids(startRaw));
        map.setSize(startRaw.mapSize!);
        map.setGraph();

        map.setRamps(calculateRamps(map._grids.miniMap!).map((rPoint) => {
            return Object.assign(rPoint, { z: map.getHeight(rPoint) });
        }));

        map.setRamps(map._ramps.filter((possibleRamp) => {
            const { x, y } = possibleRamp;
            // this is necessary because some maps have random tiles that aren't placeable but are pathable
            const neighbors = [
                { y: y - 1, x},
                { y, x: x - 1},
                { y, x: x + 1},
                { y: y + 1, x},
            ];

            return neighbors.some(point => (map as MapResource & { isRamp: (point: Point2D) => boolean }).isRamp(point));
        }));
        
        // mark cells under geysers, destructable plates, and mineral fields as initially unplaceable
        const geysers = units.getGasGeysers();
        const fields = units.getByType(mineralFieldTypes);
        const plates = units.getByType(unbuildablePlateTypes);

        // unpathable or placeable
        [...geysers, ...fields].forEach(blocker => {
            const footprint = getFootprint(blocker.unitType!)!;
            const blockedCells = cellsInFootprint(createPoint2D(blocker.pos), footprint);

            blockedCells.forEach(cell => {
                map.setPlaceable(cell, false);
                map.setPathable(cell, false);
            });
        });

        // unplaceable only
        plates.forEach(plate => {
            const footprint = getFootprint(plate.unitType!)!;
            const blockedCells = cellsInFootprint(createPoint2D(plate.pos), footprint);

            blockedCells.forEach(cell => map.setPlaceable(cell, false));
        });

        // debug.setDrawCells('ramps', map._ramps.map(r => ({ pos: r })), { size: 0.5, cube: true });
        calculateExpansions(world);
        calculateWall(world, map.getNatural());
    },
    async onStep({ data, resources }) {
        const { frame, map, events, debug } = resources.get();
        const newMapState = frame.getMapState();
        const mapState = {
            creep: consumeImageData(newMapState.creep!, map._mapSize.x!),
            visibility: consumeImageData(newMapState.visibility!, map._mapSize.x!),
        };

        map.setMapState(mapState);
        const currEffectData = map.getEffects();
        const newEffectData = frame.getEffects();

        // debug.setDrawCells('creepMap', map.getCreep().map(c => ({ pos: c })), { color: Color.RED });
        const newEffects = newEffectData.filter(newEffect => {
            return currEffectData.length > 0 ? 
                currEffectData.some(currEffect => {
                    return !(
                        currEffect.effectId === newEffect.effectId &&
                        currEffect.pos![0].x === newEffect.pos![0].x &&
                        currEffect.pos![0].y === newEffect.pos![0].y &&
                        currEffect.pos!.length === newEffect.pos!.length
                    );
                }):
                true;
        }).map((effect) => {
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

        const expiredEffects = currEffectData.filter(currEffect => {
            return newEffectData.length > 0 ?
                newEffectData.some(newEffect => {
                    return !(
                        currEffect.effectId === newEffect.effectId &&
                        currEffect.pos![0].x === newEffect.pos![0].x &&
                        currEffect.pos![0].y === newEffect.pos![0].y &&
                        currEffect.pos!.length === newEffect.pos!.length
                    );
                }):
                true;
        });

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

        const persistingEffects = currEffectData.filter(ce => { 
            return expiredEffects.length > 0 ?
                expiredEffects.some(expiredEffect => {
                    return !(
                        ce.effectId === expiredEffect.effectId &&
                        ce.pos![0].x === expiredEffect.pos![0].x &&
                        ce.pos![0].y === expiredEffect.pos![0].y &&
                        ce.pos!.length === expiredEffect.pos!.length
                    );
                }):
                true;
        });

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
                { includeText: false, }
            );
        }
    },
    async onUnitCreated({ resources }, newUnit) {
        const { map, frame } = resources.get();

        if (newUnit.isStructure()) {
            const { pos } = newUnit;
            const footprint = getFootprint(newUnit.unitType!)!;

            const blockedCells = cellsInFootprint(createPoint2D(pos), footprint);

            blockedCells.forEach(cell => {
                map.setPlaceable(cell, false);
                map.setPathable(cell, false);
            });
        }

        if (newUnit.isTownhall()) {
            debugDebug(`new townhall detected: ${UnitTypeId[newUnit.unitType!]}`);

            /**
             * @TODO: actually, the below *should* happen on frame 1, this would
             * allow us to re-sync to existing games without the engine state being
             * confused about which expansions are occupied...
             */
            // if the 'townhall' that was just 'created' was the game starting...
            if (frame.getGameLoop() <= 8) return;

            const newExpansion = map.getExpansions().find((expansion) => {
                return areEqual(
                    expansion.townhallPosition,
                    map.getClosestExpansion(newUnit.pos).townhallPosition
                );
            });

            // allow for misplaced townhalls, but not macro hatches
            if (newExpansion && distance(newExpansion.townhallPosition, newUnit.pos) < 4.5) {
                newExpansion.base = newUnit.tag;
            }
        }
    },
    async onUnitDestroyed({ resources }, deadUnit) {
        const { map } = resources.get();

        if (deadUnit.isStructure() && !deadUnit.isGasMine()) {
            if (deadUnit.is(UnitType.PYLON)) {
                // @WIP: unsure what this was debugging for, but leaving commented for posterity until i figure it out
                // console.log(resources.get().frame.getGameLoop(), `pylon destroyed (or canceled?) progress is/was: ${deadUnit.buildProgress}`);
            }
            const { pos } = deadUnit;
            const footprint = getFootprint(deadUnit.unitType!)!;

            const freedCells = cellsInFootprint(createPoint2D(pos), footprint);

            freedCells.forEach(cell => {
                map.setPlaceable(cell, true);
                map.setPathable(cell, true);
            });
        }
    },
    async onEnemyFirstSeen({ resources }, scoutedUnit) {
        const { map } = resources.get();

        if (!scoutedUnit.isTownhall()) return;

        const enemyExpansion = map.getExpansions().find((expansion) => {
            return areEqual(
                expansion.townhallPosition,
                map.getClosestExpansion(scoutedUnit.pos).townhallPosition
            );
        });

        // allow for misplaced townhalls, but not macro hatches
        if (enemyExpansion && distance(enemyExpansion.townhallPosition, scoutedUnit.pos) < 4.5) {
            enemyExpansion.base = scoutedUnit.tag;
        }
    },

};

export default () => createSystem(mapSystem);