import PF from 'pathfinding';
import createDebug from 'debug';
import { enums, Color } from '../constants/index.ts';
import { add, distance, avgPoints, closestPoint, areEqual, createPoint2D } from '../utils/geometry/point.ts';
import { gridsInCircle } from '../utils/geometry/angle.ts';
import { gasMineTypes } from '../constants/groups.ts';
import { footprintCells } from '../utils/geometry/units.ts';
import { createStartGrids, findRampsAndVisionBlockers } from '../utils/map/ramp.ts';
import { townhallCenter } from '../utils/map/townhall.ts';
import { NodeSC2Error } from '../engine/errors.ts';
import type { Ramp, StartGrids } from '../utils/map/ramp.ts';
import type {
    Grid2D,
    MapPathOptions,
    MapResource,
    Point2D,
    ResourceDefinition,
    Unit,
    WPoint,
    World,
} from '../types.ts';

const { Alliance } = enums;
const debugWeights = createDebug('sc2:DebugWeights');
const debugPathable = createDebug('sc2:DebugPathable');

type PFNode = PF.Node & { weight: number };
type PFGrid = PF.Grid & { nodes: PFNode[][] };
// @types/pathfinding lacks the (width, height, matrix) constructor overload and Grid.nodes
const PFGridCtor = PF.Grid as unknown as new (width: number, height: number, matrix?: Grid2D) => PFGrid;

type MapManager = MapResource & {
    isPlaceable: (point: Point2D, opts?: MapPathOptions) => boolean;
    isPlaceableAt: (unitType: number, pos: Point2D, opts?: MapPathOptions) => boolean;
    setPathable: (point: Point2D, pathable?: boolean) => void;
    setPlaceable: (point: Point2D, placeable?: boolean) => void;
    closestPathable: (point: Point2D, r?: number) => Point2D;
    setActiveEffects: (effects?: SC2APIProtocol.Effect[]) => void;
    getCenter: (pathable?: boolean) => Point2D;
};

function createMapManager(world: World): MapManager {
    let determinedPaths: Array<{ begin: Point2D; finish: Point2D; result: number[][] }> = [];
    let combatRally: { numOfBases: number; pos: Point2D } | undefined;
    let startGrids: StartGrids | undefined;
    let ramps: Ramp[] = [];
    let visionBlockers: Point2D[] = [];
    let mainBaseRamp: Ramp | undefined;

    const requireStartGrids = () => {
        if (!startGrids)
            throw new NodeSC2Error('Start grids are not set yet; they are read from the game info on game start');
        return startGrids;
    };

    return {
        _activeEffects: [],
        _grids: {
            height: null!,
            placement: null!,
            pathing: null!,
            miniMap: null!,
        },
        _ramps: [],
        _graph: null,
        _locations: {
            self: null!,
            enemy: null!,
        },
        _expansions: [],
        _expansionsFromEnemy: [],
        _mapState: {
            visibility: null!,
            creep: null!,
        },
        _mapSize: {
            x: 0,
            y: 0,
        },
        isCustom() {
            return this._expansions.length <= 0;
        },
        isPathable(p) {
            const point = createPoint2D(p);
            const cell = this._grids.pathing![point.y]?.[point.x];
            return cell !== undefined && !cell;
        },
        setPathable(p, pathable = true) {
            const point = createPoint2D(p);
            this._grids.pathing![point.y][point.x] = pathable ? 0 : 1;
            this._graph.setWalkableAt(p.x, p.y, pathable);
            determinedPaths = [];
        },
        isPlaceable(p, opts: MapPathOptions = {}) {
            const point = createPoint2D(p);

            if (opts.graph) {
                return opts.graph.isWalkableAt(point.x, point.y);
            } else {
                return !!this._grids.placement![point.y]?.[point.x];
            }
        },
        setPlaceable(p, placeable = true) {
            const point = createPoint2D(p);
            this._grids.placement![point.y][point.x] = placeable ? 1 : 0;
        },
        isVisible(p) {
            const point = createPoint2D(p);
            return this._mapState.visibility[point.y]?.[point.x] === 2;
        },
        isRamp(p) {
            const point = createPoint2D(p);
            return !!this._ramps.find((c) => areEqual(point, c));
        },
        hasCreep(p) {
            const point = createPoint2D(p);
            return !!this._mapState.creep[point.y]?.[point.x];
        },
        freeGasGeysers() {
            const { units } = world.resources.get();

            // @TODO: put this somewhere useful
            const geyserHasMine = (geyser: Unit) => {
                const gasMines = units.getByType(gasMineTypes);
                return gasMines.find((mine) => distance(geyser.pos!, mine.pos!) < 1);
            };

            return units
                .getGasGeysers()
                .filter((g) => units.getBases().some((b) => distance(b.pos!, g.pos!) < 15))
                .filter((g) => !geyserHasMine(g));
        },
        getMain() {
            return this._expansions[0];
        },
        getEnemyMain() {
            return this._expansionsFromEnemy[0];
        },
        getNatural() {
            return this._expansions[1];
        },
        getEnemyNatural() {
            return this._expansionsFromEnemy[1];
        },
        getThirds() {
            return this._expansions.slice(2, 4);
        },
        getEnemyThirds() {
            return this._expansionsFromEnemy.slice(2, 4);
        },
        getExpansions(alliance) {
            if (alliance === Alliance.ENEMY) {
                return this._expansionsFromEnemy.slice();
            } else {
                return this._expansions.slice();
            }
        },
        getOccupiedExpansions(alliance = Alliance.SELF) {
            return this._expansions.filter((expansion) => {
                const base = expansion.getBase();
                return !!base && !base.labels.has('dead') && base.alliance === alliance;
            });
        },
        getAvailableExpansions() {
            return this._expansions.filter((expansion) => {
                const currentBase = expansion.getBase();
                return !currentBase || currentBase.labels.has('dead');
            });
        },
        closestPathable(point, r: number = 3) {
            const allPathable = gridsInCircle(point, r, { normalize: true }).filter((p) => this.isPathable(p));

            if (allPathable.length <= 0) {
                throw new NodeSC2Error(`No pathable points within ${r} radius of point ${point}`);
            }

            return closestPoint(point, allPathable)!;
        },
        getClosestExpansion(point) {
            const startPoint = this.isPathable(point) ? point : this.closestPathable(point);

            const expansionOrder = this.getExpansions();
            const [closestReachable] = expansionOrder
                .map((expansion, i) => {
                    return {
                        index: i,
                        distance: this.path(startPoint, add(expansion.townhallPosition, 3)).length,
                    };
                })
                .filter((exp) => {
                    return exp.distance > 0;
                })
                .sort((a, b) => a.distance - b.distance);

            if (closestReachable) {
                return expansionOrder[closestReachable.index];
            }

            return expansionOrder.reduce((closest, expansion) =>
                distance(point, expansion.townhallPosition) < distance(point, closest.townhallPosition)
                    ? expansion
                    : closest,
            );
        },
        getCreep() {
            const creepRaw = this._mapState.creep;

            return creepRaw.reduce((acc, row, y) => {
                row.forEach((pixel, x) => {
                    if (pixel !== 0) {
                        acc.push({ x, y });
                    }
                });

                return acc;
            }, [] as Point2D[]);
        },
        getEffects() {
            return this._activeEffects;
        },
        getGrids() {
            return this._grids;
        },
        getLocations() {
            return this._locations;
        },
        getHeight(p) {
            const point = createPoint2D(p);
            return (this._grids.height![point.y]?.[point.x] ?? 0) / 10;
        },
        getCombatRally() {
            if (this.isCustom()) return this.getCenter();

            const numOfBases = this.getOccupiedExpansions().length;
            if (combatRally && combatRally.numOfBases === numOfBases) return combatRally.pos;

            const mapCenter = {
                x: this._mapSize.x! / 2,
                y: this._mapSize.y! / 2,
            };

            const closestPathable = this.closestPathable(mapCenter, 5);

            // own main exists once the game has started
            const natural = this.getNatural() ?? this.getMain()!;
            const naturalWall = natural.getWall();
            const avg = naturalWall.length > 0 ? avgPoints(naturalWall) : natural.townhallPosition;
            const closestNatPathable = this.closestPathable(avg, 5);

            const path = this.path(closestNatPathable, closestPathable);

            const multiplier = numOfBases * 0.05;
            const newPos = path[Math.floor(path.length * multiplier)];
            combatRally = {
                numOfBases,
                pos: { x: newPos[0], y: newPos[1] },
            };
            return combatRally.pos;
        },
        setActiveEffects(newEffects = []) {
            this._activeEffects = newEffects;
        },
        setMapState(newMapState) {
            this._mapState = newMapState;
        },
        setLocations(locations) {
            this._locations = { ...this._locations, ...locations };
        },
        setGrids(newGrids) {
            this._grids = { ...this._grids, ...newGrids };

            if (debugPathable.enabled) {
                world.resources.get().debug!.setDrawCells(
                    'debugPathable',
                    this._grids.pathing!.reduce((cells, row, y) => {
                        row.forEach((node, x) => {
                            if (this.isPathable({ x, y })) {
                                cells.push({
                                    pos: { x, y },
                                    text: `p-able`,
                                    color: Color.LIME_GREEN,
                                });
                            }
                        });

                        return cells;
                    }, [] as WPoint[]),
                );
            }
        },
        setSize(mapSize) {
            this._mapSize = mapSize;
        },
        getSize() {
            return this._mapSize;
        },
        getCenter(pathable = false) {
            const absoluteCenter = {
                x: this._mapSize.x! / 2,
                y: this._mapSize.y! / 2,
            };

            if (pathable) {
                return this.closestPathable(absoluteCenter, 5);
            } else {
                return absoluteCenter;
            }
        },
        newGraph(grid) {
            return new PFGridCtor(this._mapSize.x!, this._mapSize.y!, grid);
        },
        getGraph() {
            return this._graph.clone();
        },
        setGraph(graph) {
            determinedPaths = [];
            if (graph) {
                this._graph = graph;
            } else {
                const newGraph = new PFGridCtor(this._mapSize.x!, this._mapSize.y!, this._grids.pathing);
                newGraph.nodes.forEach((row) => {
                    row.forEach((node) => {
                        const nonWalkableNeighbors = 8 - newGraph.getNeighbors(node, 1).length;
                        switch (nonWalkableNeighbors) {
                            case 1: {
                                node.weight = 2;
                                break;
                            }
                            case 2: {
                                node.weight = 3;
                                break;
                            }
                            case 3: {
                                node.weight = 4;
                                break;
                            }
                            case 4: {
                                node.weight = 5;
                                break;
                            }
                            case 5: {
                                node.weight = 6;
                                break;
                            }
                            case 6: {
                                node.weight = 7;
                                break;
                            }
                            case 7: {
                                node.weight = 8;
                                break;
                            }
                            case 8: {
                                node.weight = 9;
                                break;
                            }
                        }
                    });
                });

                if (debugWeights.enabled) {
                    world.resources.get().debug!.setDrawCells(
                        'debugWeights',
                        newGraph.nodes.reduce((cells, row, y) => {
                            row.forEach((node, x) => {
                                if (node.walkable && node.weight > 1) {
                                    cells.push({
                                        pos: { x, y },
                                        text: `W: ${node.weight}`,
                                        color:
                                            node.weight <= 1
                                                ? Color.LIME_GREEN
                                                : node.weight <= 5
                                                  ? Color.YELLOW
                                                  : node.weight <= 20
                                                    ? Color.ORANGE_RED
                                                    : Color.RED,
                                    });
                                }
                            });

                            return cells;
                        }, [] as WPoint[]),
                    );
                }

                this._graph = newGraph;
            }
        },
        setExpansions(exps) {
            this._expansions = Object.freeze(exps);
            this._expansionsFromEnemy = Object.freeze(
                this._expansions.slice().sort((a, b) => a.pathFromEnemy!.length - b.pathFromEnemy!.length),
            );
        },
        setRamps(ramps) {
            this._ramps = ramps;
        },
        isPlaceableAt(unitType, pos, opts: MapPathOptions = {}) {
            const shapePoints = footprintCells(world, unitType, pos);

            if (opts.graph) {
                return shapePoints.every((point) => opts.graph.isWalkableAt(point.x, point.y));
            } else {
                return shapePoints.every((point) => this.isPlaceable(point));
            }
        },
        setStartRaw(startRaw) {
            startGrids = createStartGrids(startRaw);
            mainBaseRamp = undefined;
            const startLocation = () => {
                const { x, y } = this.getLocations().self!;
                return { x, y };
            };
            ({ ramps, visionBlockers } = findRampsAndVisionBlockers(startGrids, startRaw.playableArea!, startLocation));
        },
        getRamps() {
            return ramps.slice();
        },
        isArcade() {
            throw new NodeSC2Error('not implemented: isArcade');
        },
        getMainBaseRamp() {
            if (mainBaseRamp) return mainBaseRamp;

            const { self } = this.getLocations();
            if (!self) return undefined;
            const closestWithUpperSize = (sizes: number[]) =>
                ramps
                    .filter((ramp) => sizes.includes(ramp.upper.length))
                    .reduce<Ramp | undefined>(
                        (best, ramp) =>
                            !best || distance(self, ramp.topCenter) < distance(self, best.topCenter) ? ramp : best,
                        undefined,
                    );

            // python-sc2: Honorgrounds LE's main ramp has 4 or 9 upper points
            mainBaseRamp = closestWithUpperSize([2, 5]) ?? closestWithUpperSize([4, 9]);
            return mainBaseRamp;
        },
        getVisionBlockers() {
            return visionBlockers.slice();
        },
        getExpansionLocations() {
            return this._expansions.map(townhallCenter);
        },
        getTerrainHeight(point) {
            return requireStartGrids().terrainHeight.get(createPoint2D(point));
        },
        getTerrainZHeight(point) {
            return -16 + (32 * this.getTerrainHeight(point)) / 255;
        },
        inPathingGrid(point) {
            return requireStartGrids().pathing.isSet(createPoint2D(point));
        },
        inPlacementGrid(point) {
            return requireStartGrids().placement.isSet(createPoint2D(point));
        },
        async queryPathing(start, end) {
            const { actions } = world.resources.get();
            const endPos = { x: end.x, y: end.y };
            const request: SC2APIProtocol.RequestQueryPathing =
                'pos' in start ? { unitTag: start.tag, endPos } : { startPos: { x: start.x, y: start.y }, endPos };
            const response = await actions.sendQuery({ pathing: [request] });
            const pathingDistance = response.pathing?.[0]?.distance ?? 0;
            return pathingDistance <= 0 ? null : pathingDistance;
        },
        path(start, end, opts = {}) {
            const begin = createPoint2D(start);
            const finish = createPoint2D(end);

            if (!opts.force && !opts.graph) {
                const exists = determinedPaths.find(
                    (path) =>
                        path.begin.x === begin.x &&
                        path.begin.y === begin.y &&
                        path.finish.x === finish.x &&
                        path.finish.y === finish.y,
                );

                if (exists) return exists.result;
            }

            const graphClone = opts.graph ? opts.graph.clone() : this._graph.clone();

            const finder = new PF.AStarFinder({
                allowDiagonal: opts.diagonal !== undefined ? opts.diagonal : true,
                heuristic: PF.Heuristic.manhattan,
            });

            const result = finder.findPath(begin.x, begin.y, finish.x, finish.y, graphClone);
            if (!opts.graph) determinedPaths.push({ begin, finish, result });

            return result;
        },
    };
}

export const mapResource: ResourceDefinition<'map'> = {
    name: 'map',
    create: (world) => createMapManager(world),
};
