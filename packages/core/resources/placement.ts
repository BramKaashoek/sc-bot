import createDebug from 'debug';
import Color from '../constants/color.ts';
import { Race } from '../constants/enums.ts';
import { NodeSC2Error } from '../engine/errors.ts';
import { addonHostTypes, flyingStructureTypes, gasMineTypes } from '../constants/groups.ts';
import * as UnitType from '../constants/unit-type.ts';
import { distance, distanceSquared, towards } from '../utils/geometry/point.ts';
import { footprintData, getFootprint, isFlying } from '../utils/geometry/units.ts';
import {
    type BuildingScan,
    type FormationGrids,
    findBuildingLocations,
    floodArea,
    markAvoid,
    unmarkAvoid,
} from '../utils/placement/formation.ts';
import type {
    BuildingSize,
    Color as ColorType,
    Expansion,
    PlacementFlag,
    PlacementRequest,
    PlacementResource,
    PlacementSettings,
    PlacementState,
    Point2D,
    ResourceDefinition,
    Unit,
    UserPlacement,
    World,
} from '../types.ts';

const debugPlacement = createDebug('sc2:debug:placement');

type Spot = {
    pos: Point2D;
    size: BuildingSize;
    base: Point2D;
    flags: Set<PlacementFlag>;
    state: PlacementState;
    tag?: string;
    reservedAt?: number;
};

type State = {
    settings: PlacementSettings;
    spots: Spot[];
    solved: boolean;
    grids?: FormationGrids;
    pending: UserPlacement[];
    lastReservationCheck: number;
};

const DEFAULT_SETTINGS: PlacementSettings = { reservationTimeout: 60 };
const RESERVATION_CHECK_LOOPS = 16;
const RAMP_EXCLUSION_SQUARED = 36;
const POWER_RANGE_SQUARED = 6.5 ** 2;
const CREEP_EXEMPT = [UnitType.HATCHERY, UnitType.NYDUSCANAL];
const SIZE_BY_WIDTH: Record<number, BuildingSize> = { 2: '2x2', 3: '3x3', 5: '5x5' };
const WIDTH_BY_SIZE: Record<BuildingSize, number> = { '2x2': 2, '3x3': 3, '5x5': 5 };

export const stateByPlacement = new WeakMap<PlacementResource, State>();

const freshState = (settings: PlacementSettings): State => ({
    settings,
    spots: [],
    solved: false,
    pending: [],
    lastReservationCheck: 0,
});

const samePos = (a: Point2D, b: Point2D) => a.x === b.x && a.y === b.y;

function closest<T extends { pos: Point2D }>(items: T[], to: Point2D): T | undefined {
    let best: T | undefined;
    let bestDistance = Infinity;
    for (const item of items) {
        const d = distanceSquared(item.pos, to);
        if (d < bestDistance) {
            best = item;
            bestDistance = d;
        }
    }
    return best;
}

function attempt<T>(read: () => T): T | undefined {
    try {
        return read();
    } catch (error) {
        debugPlacement(`skipping a map lookup that threw: ${(error as Error).message}`);
        return undefined;
    }
}

function sizeOf(world: World, unitType: number): BuildingSize | undefined {
    const footprint = getFootprint(unitType, footprintData(world));
    return footprint ? SIZE_BY_WIDTH[footprint.w] : undefined;
}

function createGrids(world: World): FormationGrids {
    const { map } = world.resources.get();
    const { x: width = 0, y: height = 0 } = map.getSize();
    const size = width * height;
    const grids: FormationGrids = {
        width,
        height,
        placeable: new Uint8Array(size),
        startPlaceable: new Uint8Array(size),
        pathable: new Uint8Array(size),
        terrainHeight: new Uint8Array(size),
        creep: new Uint8Array(size),
        avoid: new Uint8Array(size),
    };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;
            grids.startPlaceable![index] = map.inPlacementGrid({ x, y }) ? 1 : 0;
            grids.terrainHeight[index] = map.getTerrainHeight({ x, y });
        }
    }
    return refreshLive(world, grids);
}

function refreshLive(world: World, grids: FormationGrids): FormationGrids {
    const { map } = world.resources.get();
    const { placement, pathing } = map.getGrids();
    const { creep } = map._mapState;
    for (let y = 0; y < grids.height; y++) {
        for (let x = 0; x < grids.width; x++) {
            const index = y * grids.width + x;
            grids.placeable[index] = placement![y][x] ? 1 : 0;
            grids.pathable[index] = pathing![y][x] ? 0 : 1;
            grids.creep![index] = creep[y][x] ? 1 : 0;
        }
    }
    return grids;
}

function kernelOrigin(pos: Point2D, size: BuildingSize) {
    const half = WIDTH_BY_SIZE[size] / 2;
    return { x: Math.floor(pos.x - half), y: Math.floor(pos.y - half) };
}

function markSpot(grids: FormationGrids, pos: Point2D, size: BuildingSize, withAddon = true) {
    const { x, y } = kernelOrigin(pos, size);
    const width = WIDTH_BY_SIZE[size];
    markAvoid(grids, x, y, withAddon && size === '3x3' ? 5 : width, width);
}

function footprintAvoided(grids: FormationGrids, pos: Point2D, size: BuildingSize) {
    const { x: x0, y: y0 } = kernelOrigin(pos, size);
    const width = WIDTH_BY_SIZE[size];
    for (let y = y0; y < y0 + width; y++) {
        for (let x = x0; x < x0 + width; x++) {
            if (x < 0 || y < 0 || x >= grids.width || y >= grids.height || grids.avoid[y * grids.width + x])
                return true;
        }
    }
    return false;
}

function cellsFree(world: World, x0: number, y0: number, w: number, h: number, checkCreep: boolean) {
    const { map } = world.resources.get();
    const { placement, pathing } = map.getGrids();
    const { creep } = map._mapState;
    for (let y = y0; y < y0 + h; y++) {
        const placementRow = placement![y];
        if (!placementRow) return false;
        for (let x = x0; x < x0 + w; x++) {
            if (!placementRow[x] || pathing![y][x]) return false;
            if (checkCreep && creep[y][x]) return false;
        }
    }
    return true;
}

function canPlace(world: World, unitType: number, pos: Point2D, includeAddon = addonHostTypes.includes(unitType)) {
    const { units } = world.resources.get();
    if (gasMineTypes.includes(unitType)) {
        return !units
            .getAll()
            .some((unit) => gasMineTypes.includes(unit.unitType) && distanceSquared(unit.pos, pos) < 12.25);
    }

    const footprint = getFootprint(unitType, footprintData(world));
    if (!footprint) return false;
    const checkCreep = world.agent.race !== Race.ZERG && !CREEP_EXEMPT.includes(unitType);
    const x0 = Math.round(pos.x - footprint.w / 2);
    const y0 = Math.round(pos.y - footprint.h / 2);
    if (!cellsFree(world, x0, y0, footprint.w, footprint.h, checkCreep)) return false;
    return !includeAddon || cellsFree(world, Math.round(pos.x + 1.5), Math.round(pos.y - 1.5), 2, 2, checkCreep);
}

function closestBase(world: World, pos: Point2D): Point2D {
    const { map } = world.resources.get();
    const bases = map.getExpansions().map((expansion) => ({ pos: expansion.townhallPosition }));
    return closest(bases, pos)?.pos ?? pos;
}

function addSpot(state: State, size: BuildingSize, base: Point2D, pos: Point2D, flags: PlacementFlag[] = []) {
    state.spots.push({ pos, size, base, flags: new Set(flags), state: 'available' });
}

function addUserPlacements(world: World, state: State, placements: UserPlacement[]) {
    const grids = state.grids!;
    for (const placement of placements) {
        const size = placement.size ?? (placement.unitType ? sizeOf(world, placement.unitType) : undefined) ?? '3x3';
        const checkType = placement.unitType ?? (size === '2x2' ? UnitType.SUPPLYDEPOT : UnitType.BARRACKS);
        if (
            size === '5x5' ||
            !canPlace(world, checkType, placement.pos, false) ||
            footprintAvoided(grids, placement.pos, size)
        ) {
            debugPlacement(`skipping user placement ${placement.pos.x},${placement.pos.y}: it can't be placed`);
            continue;
        }
        addSpot(state, size, closestBase(world, placement.pos), placement.pos, ['custom', ...(placement.flags ?? [])]);
        markSpot(grids, placement.pos, size, world.agent.race === Race.TERRAN);
    }
}

function solveNaturalBunker(world: World, state: State, natural: Expansion) {
    const { map } = world.resources.get();
    const nat = natural.townhallPosition;
    const grids = state.grids!;
    markAvoid(grids, Math.floor(nat.x - 4.5), Math.floor(nat.y - 4.5), 9, 9);
    if (state.spots.some((spot) => spot.flags.has('bunker') && samePos(spot.base, nat))) return;

    const ramp = attempt(() => map.getMainBaseRamp());
    if (!ramp) return;
    const goal = towards(towards(nat, ramp.bottomCenter, 4), map.getCenter(), 6);
    for (let dx = -2; dx < 2; dx++) {
        for (let dy = -2; dy < 2; dy++) {
            const pos = { x: Math.floor(goal.x) + dx + 0.5, y: Math.floor(goal.y) + dy + 0.5 };
            if (!canPlace(world, UnitType.BUNKER, pos)) continue;
            addSpot(state, '3x3', nat, pos, ['bunker']);
            markSpot(grids, pos, '3x3');
            return;
        }
    }
}

function solveRampWall(world: World, state: State, main: Point2D) {
    const ramp = attempt(() => world.resources.get().map.getMainBaseRamp());
    const grids = state.grids!;
    const barracks = attempt(() => ramp?.barracksCorrectPlacement);
    if (barracks) {
        addSpot(state, '3x3', main, barracks, ['wall']);
        markSpot(grids, barracks, '3x3');
    }
    for (const depot of attempt(() => ramp?.cornerDepots) ?? []) {
        addSpot(state, '2x2', main, depot, ['wall']);
        markSpot(grids, depot, '2x2');
    }
}

function scanBase(
    world: World,
    state: State,
    base: Point2D,
    maxDist: number,
    size: BuildingSize,
    scan: BuildingScan,
    flags: PlacementFlag[] = [],
) {
    const grids = state.grids!;
    const rampTop = attempt(() => world.resources.get().map.getMainBaseRamp())?.topCenter;
    const baseHeight = grids.terrainHeight[Math.floor(base.y) * grids.width + Math.floor(base.x)];
    const area = floodArea(grids, base, maxDist);
    for (const pos of findBuildingLocations(grids, area, scan)) {
        const height = grids.terrainHeight[Math.floor(pos.y) * grids.width + Math.floor(pos.x)];
        if (height !== baseHeight || (rampTop && distanceSquared(pos, rampTop) <= RAMP_EXCLUSION_SQUARED)) {
            const x0 = pos.x - scan.buildingWidth / 2;
            const y0 = pos.y - scan.buildingHeight / 2;
            unmarkAvoid(grids, x0, y0, scan.kernelWidth, scan.kernelHeight);
            continue;
        }
        addSpot(state, size, base, pos, flags);
    }
}

function markMineralLines(world: World, grids: FormationGrids) {
    for (const expansion of world.resources.get().map.getExpansions()) {
        for (const cell of expansion.areas?.mineralLine ?? []) {
            markAvoid(grids, Math.floor(cell.x), Math.floor(cell.y), 1, 1);
        }
    }
}

function solveProtossRampWall(world: World, state: State, main: Point2D) {
    const ramp = attempt(() => world.resources.get().map.getMainBaseRamp());
    const grids = state.grids!;
    const pylon = attempt(() => ramp?.protossWallPylon);
    if (pylon) {
        addSpot(state, '2x2', main, pylon, ['wall', 'productionPylon']);
        markSpot(grids, pylon, '2x2');
    }
    for (const building of attempt(() => ramp?.protossWallBuildings) ?? []) {
        addSpot(state, '3x3', main, building, ['wall']);
        markSpot(grids, building, '3x3', false);
    }
}

function flagOptimalPylon(state: State, base: Point2D) {
    const atBase = state.spots.filter((spot) => samePos(spot.base, base));
    const threeByThrees = atBase.filter((spot) => spot.size === '3x3');
    const pylons = atBase.filter((spot) => spot.flags.has('productionPylon'));
    if (pylons.length === 0 || threeByThrees.length === 0) return;

    let best = pylons[0];
    let most = 0;
    for (const pylon of pylons) {
        const count = threeByThrees.filter((spot) => distanceSquared(spot.pos, pylon.pos) < POWER_RANGE_SQUARED).length;
        if (count >= most) {
            most = count;
            best = pylon;
        }
    }
    best.flags.add('optimalPylon');
}

function solveProtoss(world: World, state: State) {
    const { map, placer } = world.resources.get();
    const grids = state.grids!;
    const expansions = map.getExpansions();
    // own main exists once the game has started
    const main = map.getMain()!.townhallPosition;

    addUserPlacements(world, state, [...(placer?.placements?.(world) ?? []), ...state.pending]);
    state.pending = [];

    for (const expansion of expansions) {
        const base = expansion.townhallPosition;
        markAvoid(grids, Math.floor(base.x - 5), Math.floor(base.y - 5), 10, 10);
    }
    markMineralLines(world, grids);

    for (const expansion of expansions) {
        const base = expansion.townhallPosition;
        const isMain = samePos(base, main);
        const maxDist = isMain ? 22 : 16;
        if (isMain) solveProtossRampWall(world, state, main);
        const pass = (xStride: number, yStride: number, size: BuildingSize, flags: PlacementFlag[] = []) => {
            const width = WIDTH_BY_SIZE[size];
            scanBase(
                world,
                state,
                base,
                maxDist,
                size,
                {
                    xStride,
                    yStride,
                    buildingWidth: width,
                    buildingHeight: width,
                    kernelWidth: width,
                    kernelHeight: width,
                    avoidCreep: true,
                },
                flags,
            );
        };
        pass(7, 7, '2x2', ['productionPylon']);
        pass(3, 3, '3x3');
        pass(2, 3, '2x2');
        flagOptimalPylon(state, base);
    }
}

function solveTerran(world: World, state: State) {
    const { map, placer } = world.resources.get();
    const grids = state.grids!;
    const expansions = map.getExpansions();
    const main = map.getMain()!.townhallPosition;
    const enemyMain = attempt(() => map.getEnemyMain()?.townhallPosition);

    markMineralLines(world, grids);

    addUserPlacements(world, state, [...(placer?.placements?.(world) ?? []), ...state.pending]);
    state.pending = [];

    const natural = map.getNatural();
    if (natural) solveNaturalBunker(world, state, natural);

    for (const expansion of expansions) {
        const base = expansion.townhallPosition;
        const isMain = samePos(base, main);
        markAvoid(grids, Math.floor(base.x - 4), Math.floor(base.y - 4), 8, 8);
        if (isMain) solveRampWall(world, state, main);
        const isStart = isMain || (enemyMain !== undefined && samePos(base, enemyMain));
        scanBase(world, state, base, isMain ? 22 : 16, '3x3', {
            xStride: isStart ? 6 : 5,
            yStride: 3,
            buildingWidth: 3,
            buildingHeight: 3,
            kernelWidth: 5,
            kernelHeight: 3,
            avoidCreep: true,
            reduceXStride: true,
        });
        markAvoid(grids, Math.floor(base.x - 6.5), Math.floor(base.y - 6.5), 13, 13);
        scanBase(world, state, base, 16, '2x2', {
            xStride: 2,
            yStride: 2,
            buildingWidth: 2,
            buildingHeight: 2,
            kernelWidth: 2,
            kernelHeight: 2,
            avoidCreep: true,
        });
    }
}

function poweredBy(world: World, state: State, buildProgress: number) {
    const grids = state.grids!;
    const heightAt = (pos: Point2D) => grids.terrainHeight[Math.floor(pos.y) * grids.width + Math.floor(pos.x)];
    const pylons = world.resources
        .get()
        .units.getById(UnitType.PYLON)
        .filter((pylon) => pylon.buildProgress! >= buildProgress);
    return (pos: Point2D) =>
        pylons.some(
            (pylon) => heightAt(pylon.pos) === heightAt(pos) && distanceSquared(pylon.pos, pos) < POWER_RANGE_SQUARED,
        );
}

function select(world: World, candidates: Spot[], base: Point2D, opts: PlacementRequest): Spot | undefined {
    const closestTo = opts.closestTo ?? base;
    const flags = opts.flags ?? [];
    const withFlag = (flag: PlacementFlag) => candidates.filter((spot) => spot.flags.has(flag));

    if (flags.includes('wall')) {
        const { map } = world.resources.get();
        const isMain = samePos(base, map.getMain()!.townhallPosition);
        const rampTop = isMain ? attempt(() => map.getMainBaseRamp())?.topCenter : undefined;
        const wallClosestTo = opts.closestTo ?? rampTop ?? base;
        const others = flags.filter((flag) => flag !== 'wall');
        const walls = withFlag('wall');
        const wallAndOther = walls.filter((spot) => others.some((flag) => spot.flags.has(flag)));
        return (
            closest(wallAndOther, wallClosestTo) ??
            closest(walls, wallClosestTo) ??
            closest(
                candidates.filter((spot) => !spot.flags.has('wall')),
                wallClosestTo,
            )
        );
    }

    for (const flag of flags) {
        const picked = closest(withFlag(flag), closestTo);
        if (picked) return picked;
    }
    return (
        closest(
            candidates.filter((spot) => !spot.flags.has('custom')),
            closestTo,
        ) ?? closest(candidates, closestTo)
    );
}

function updateBookkeeping(world: World, state: State) {
    const { units, frame } = world.resources.get();
    const grounded = units
        .getStructures()
        .filter((structure) => !isFlying(structure) && !flyingStructureTypes.includes(structure.unitType));
    const onSpot = (spot: Spot) => (structure: Unit) => distanceSquared(structure.pos, spot.pos) <= 0.25;

    for (const spot of state.spots) {
        if (spot.state === 'taken') {
            const occupant = grounded.find((structure) => structure.tag === spot.tag);
            if (occupant && !occupant.labels.has('dead') && onSpot(spot)(occupant)) continue;
            spot.state = 'available';
            spot.tag = undefined;
        }
        const occupant = grounded.find(onSpot(spot));
        if (occupant) {
            spot.state = 'taken';
            spot.tag = occupant.tag;
            spot.reservedAt = undefined;
        }
    }

    const loop = frame.getGameLoop();
    if (loop - state.lastReservationCheck < RESERVATION_CHECK_LOOPS) return;
    state.lastReservationCheck = loop;
    const now = frame.time();
    for (const spot of state.spots) {
        if (spot.state === 'reserved' && now > spot.reservedAt! + state.settings.reservationTimeout) {
            spot.state = 'available';
            spot.reservedAt = undefined;
        }
    }
}

const STATE_COLORS: Record<PlacementState, ColorType> = {
    available: Color.LIME_GREEN,
    reserved: Color.YELLOW,
    taken: Color.RED,
};

export const placementResource: ResourceDefinition<'placement'> = {
    name: 'placement',
    create(world) {
        const placement: PlacementResource = {
            request(unitType, opts = {}) {
                const state = stateByPlacement.get(placement)!;
                if (world.agent.race === Race.ZERG || !state.solved) return undefined;
                const size = sizeOf(world, unitType);
                if (size !== '2x2' && size !== '3x3') return undefined;

                const { map } = world.resources.get();
                const origin = opts.base ?? map.getMain()!.townhallPosition;
                const solvedBases = state.spots.map((spot) => ({ pos: spot.base }));
                const base = closest(solvedBases, origin)?.pos;
                if (!base) return undefined;

                const isPowered = opts.powered ? poweredBy(world, state, opts.pylonBuildProgress ?? 1) : () => true;
                const candidatesAt = (at: Point2D) =>
                    state.spots.filter(
                        (spot) =>
                            spot.state === 'available' &&
                            spot.size === size &&
                            samePos(spot.base, at) &&
                            !(unitType === UnitType.PYLON && spot.flags.has('staticDefence')) &&
                            isPowered(spot.pos) &&
                            canPlace(world, unitType, spot.pos),
                    );

                let at = base;
                let candidates = candidatesAt(base);
                if (candidates.length === 0 && opts.findAlternative !== false) {
                    const alternatives = map
                        .getOccupiedExpansions()
                        .map((expansion) => expansion.townhallPosition)
                        .filter((pos) => !samePos(pos, base))
                        .sort((a, b) => distanceSquared(a, origin) - distanceSquared(b, origin));
                    for (const alternative of alternatives) {
                        candidates = candidatesAt(alternative);
                        if (candidates.length > 0) {
                            at = alternative;
                            break;
                        }
                    }
                }

                const picked = select(world, candidates, at, opts);
                if (!picked) return undefined;
                if (opts.reserve !== false) {
                    picked.state = 'reserved';
                    picked.reservedAt = world.resources.get().frame.time();
                }
                return picked.pos;
            },
            reserve(pos) {
                const spot = stateByPlacement.get(placement)!.spots.find((candidate) => samePos(candidate.pos, pos));
                if (!spot || spot.state !== 'available') return false;
                spot.state = 'reserved';
                spot.reservedAt = world.resources.get().frame.time();
                return true;
            },
            release(pos) {
                const spot = stateByPlacement.get(placement)!.spots.find((candidate) => samePos(candidate.pos, pos));
                if (spot?.state !== 'reserved') return;
                spot.state = 'available';
                spot.reservedAt = undefined;
            },
            canPlace(unitType, pos, opts = {}) {
                return canPlace(world, unitType, pos, opts.includeAddon);
            },
            getPlacements(filter = {}) {
                return stateByPlacement
                    .get(placement)!
                    .spots.filter(
                        (spot) =>
                            (!filter.base || samePos(spot.base, filter.base)) &&
                            (!filter.size || spot.size === filter.size) &&
                            (!filter.state || spot.state === filter.state) &&
                            (!filter.flag || spot.flags.has(filter.flag)),
                    )
                    .map((spot) => Object.freeze({ ...spot, pos: { ...spot.pos }, flags: new Set(spot.flags) }));
            },
            add(placements) {
                const state = stateByPlacement.get(placement)!;
                if (!state.solved) {
                    state.pending.push(...placements);
                    return;
                }
                if (!state.grids) {
                    debugPlacement('ignoring add(): placement has no grids for this race');
                    return;
                }
                refreshLive(world, state.grids);
                addUserPlacements(world, state, placements);
            },
            getGatekeeperPositions() {
                throw new NodeSC2Error('not implemented: getGatekeeperPositions');
            },
            getNatGatekeeperPosition() {
                throw new NodeSC2Error('not implemented: getNatGatekeeperPosition');
            },
            configure(settings) {
                Object.assign(stateByPlacement.get(placement)!.settings, settings);
            },
            drawDebug() {
                const { debug } = world.resources.get();
                const cells = stateByPlacement.get(placement)!.spots.map((spot) => ({
                    pos: spot.pos,
                    size: WIDTH_BY_SIZE[spot.size],
                    color: spot.flags.has('custom')
                        ? Color.PURPLE
                        : spot.flags.has('wall')
                          ? Color.AQUA
                          : STATE_COLORS[spot.state],
                }));
                debug?.setDrawCells('placement', cells, { includeText: false });
            },
        };
        stateByPlacement.set(placement, freshState({ ...DEFAULT_SETTINGS }));
        return placement;
    },
    reset(placement) {
        stateByPlacement.set(placement, freshState(stateByPlacement.get(placement)!.settings));
    },
    onStep(placement, world) {
        const state = stateByPlacement.get(placement)!;
        if (!state.solved) {
            const { map } = world.resources.get();
            // expansions, race and the first map state arrive on different dispatches at game start
            if (map.getExpansions().length === 0 || world.agent.race === undefined || !map._mapState.creep) return;
            state.solved = true;
            if (world.agent.race !== Race.TERRAN && world.agent.race !== Race.PROTOSS) return;
            state.grids = createGrids(world);
            if (world.agent.race === Race.TERRAN) solveTerran(world, state);
            else solveProtoss(world, state);
        }
        updateBookkeeping(world, state);
    },
};
