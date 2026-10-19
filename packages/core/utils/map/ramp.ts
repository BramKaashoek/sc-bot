import { PixelMap } from '../pixel-map.ts';
import { distance } from '../geometry/point.ts';
import type { Point2D } from '../../types.ts';

const RAMP_WALL_OFFSET = 0.5;
const WALL_UPPER_SIZES = [2, 5];
const MINIMUM_RAMP_SIZE = 8;

function centerOf(points: Point2D[]): Point2D {
    return {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
}

function maxBy(points: Point2D[], score: (point: Point2D) => number): Point2D {
    return points.reduce((best, point) => (score(point) > score(best) ? point : best));
}

// python-sc2 Point2.circle_intersection; throws where python asserts
function circleIntersection(from: Point2D, to: Point2D, radius: number): Point2D[] {
    const between = distance(from, to);
    if (between === 0 || radius < between / 2) {
        throw new RangeError(`No circle intersection of radius ${radius} for points ${between} apart`);
    }

    const remaining = (radius ** 2 - (between / 2) ** 2) ** 0.5;
    const toCenter = { x: (to.x - from.x) / 2, y: (to.y - from.y) / 2 };
    const center = { x: from.x + toCenter.x, y: from.y + toCenter.y };
    const stretch = remaining / (between / 2);
    const stretched = { x: toCenter.x * stretch, y: toCenter.y * stretch };

    return [
        { x: center.x + stretched.y, y: center.y - stretched.x },
        { x: center.x - stretched.y, y: center.y + stretched.x },
    ];
}

function extremeHeightPoints(points: Point2D[], heightAt: (point: Point2D) => number, pickHigher: boolean): Point2D[] {
    const heights = points.map(heightAt);
    const extreme = pickHigher ? Math.max(...heights) : Math.min(...heights);
    return points.filter((_point, index) => heights[index] === extreme);
}

export class Ramp {
    readonly points: Point2D[];
    readonly upper: Point2D[];
    readonly lower: Point2D[];
    readonly topCenter: Point2D;
    readonly bottomCenter: Point2D;
    private readonly startLocation: () => Point2D;

    constructor(points: Point2D[], terrainHeight: PixelMap, startLocation: () => Point2D) {
        const heightAt = (point: Point2D) => terrainHeight.get(point);
        this.points = points;
        this.upper = extremeHeightPoints(points, heightAt, true);
        this.lower = extremeHeightPoints(points, heightAt, false);
        this.topCenter = centerOf(this.upper);
        this.bottomCenter = centerOf(this.lower);
        this.startLocation = startLocation;
    }

    get size(): number {
        return this.points.length;
    }

    get upper2ForRampWall(): Point2D[] {
        return [...this.upper]
            .sort((left, right) => distance(right, this.bottomCenter) - distance(left, this.bottomCenter))
            .slice(0, 2);
    }

    get barracksInMiddle(): Point2D | null {
        if (!WALL_UPPER_SIZES.includes(this.upper.length)) return null;
        const [first, second] = this.offsetUpper2();
        return this.awayFromLower(circleIntersection(first, second, 5 ** 0.5));
    }

    get depotInMiddle(): Point2D | null {
        if (!WALL_UPPER_SIZES.includes(this.upper.length)) return null;
        const [first, second] = this.offsetUpper2();
        let intersections: Point2D[];
        try {
            intersections = circleIntersection(first, second, 2.5 ** 0.5);
        } catch {
            // python-sc2: Honorgrounds LE's main ramp is too wide for a middle depot
            return null;
        }
        return this.awayFromLower(intersections);
    }

    get cornerDepots(): Point2D[] {
        if (this.upper2ForRampWall.length === 0) return [];
        const [first, second] = this.offsetUpper2();
        const between = distance(first, second);
        const center = {
            x: first.x + ((second.x - first.x) / between) * (between / 2),
            y: first.y + ((second.y - first.y) / between) * (between / 2),
        };
        const depot = this.depotInMiddle;
        if (!depot) return [];
        return circleIntersection(center, depot, 5 ** 0.5);
    }

    get barracksCanFitAddon(): boolean {
        this.offsetUpper2();
        return this.barracksInMiddle!.x + 1 > maxBy(this.cornerDepots, (depot) => depot.x).x;
    }

    get barracksCorrectPlacement(): Point2D | null {
        const barracks = this.barracksInMiddle;
        if (!barracks || this.cornerDepots.length === 0) return null;
        return this.barracksCanFitAddon ? barracks : { x: barracks.x - 2, y: barracks.y };
    }

    get protossWallPylon(): Point2D | null {
        const wall = this.protossWallFrame();
        if (!wall) return null;
        return { x: wall.middle.x + 6 * wall.direction.x, y: wall.middle.y + 6 * wall.direction.y };
    }

    get protossWallBuildings(): Point2D[] {
        const wall = this.protossWallFrame();
        if (!wall) return [];
        const { middle, direction } = wall;
        const [, farDepot] = this.depotsByStartDistance();
        const wall1 = { x: farDepot.x + direction.x, y: farDepot.y + direction.y };
        const wall2 = {
            x: middle.x + direction.x + (middle.x - wall1.x) / 1.5,
            y: middle.y + direction.y + (middle.y - wall1.y) / 1.5,
        };
        return [wall1, wall2];
    }

    get protossWallWarpin(): Point2D | null {
        const wall = this.protossWallFrame();
        if (!wall) return null;
        const [nearDepot] = this.depotsByStartDistance();
        return { x: nearDepot.x - wall.direction.x, y: nearDepot.y - wall.direction.y };
    }

    private offsetUpper2(): Point2D[] {
        const upper2 = this.upper2ForRampWall;
        if (upper2.length !== 2) {
            throw new Error('Not implemented. Trying to access a ramp that has a wrong amount of upper points.');
        }
        return upper2.map((point) => ({ x: point.x + RAMP_WALL_OFFSET, y: point.y + RAMP_WALL_OFFSET }));
    }

    private awayFromLower(candidates: Point2D[]): Point2D {
        const [anyLower] = this.lower;
        return maxBy(candidates, (candidate) => distance(candidate, anyLower));
    }

    private protossWallFrame(): { middle: Point2D; direction: Point2D } | null {
        if (!WALL_UPPER_SIZES.includes(this.upper.length)) return null;
        this.offsetUpper2();
        const middle = this.depotInMiddle;
        const barracks = this.barracksInMiddle;
        if (!middle || !barracks) return null;
        return { middle, direction: { x: barracks.x - middle.x, y: barracks.y - middle.y } };
    }

    private depotsByStartDistance(): Point2D[] {
        const start = this.startLocation();
        return [...this.cornerDepots].sort((left, right) => distance(left, start) - distance(right, start));
    }
}

export type StartGrids = {
    pathing: PixelMap;
    placement: PixelMap;
    terrainHeight: PixelMap;
};

export function createStartGrids(startRaw: SC2APIProtocol.StartRaw): StartGrids {
    const toImage = ({ bitsPerPixel, size, data }: SC2APIProtocol.ImageData) =>
        new PixelMap({
            bitsPerPixel: bitsPerPixel!,
            size: { x: size!.x!, y: size!.y! },
            data: data!,
        });

    return {
        pathing: toImage(startRaw.pathingGrid!),
        placement: toImage(startRaw.placementGrid!),
        terrainHeight: toImage(startRaw.terrainHeight!),
    };
}

// numpy's [y-1:y+2, x-1:x+2] slice is empty at index 0, so edge cells never count as level
function equalHeightAround(terrainHeight: PixelMap, { x, y }: Point2D): boolean {
    if (x < 1 || y < 1) return false;
    const heights = new Set<number>();
    for (let row = y - 1; row <= Math.min(y + 1, terrainHeight.height - 1); row += 1) {
        for (let column = x - 1; column <= Math.min(x + 1, terrainHeight.width - 1); column += 1) {
            heights.add(terrainHeight.get({ x: column, y: row }));
        }
    }
    return heights.size === 1;
}

export function findRampsAndVisionBlockers(
    { pathing, placement, terrainHeight }: StartGrids,
    playableArea: SC2APIProtocol.RectangleI,
    startLocation: () => Point2D,
): { ramps: Ramp[]; visionBlockers: Point2D[] } {
    const minX = playableArea.p0!.x!;
    const minY = playableArea.p0!.y!;
    const maxX = playableArea.p1!.x!;
    const maxY = playableArea.p1!.y!;

    const rampMask = new Uint8Array(pathing.width * pathing.height);
    const visionBlockers: Point2D[] = [];

    for (let y = minY; y < maxY; y += 1) {
        for (let x = minX; x < maxX; x += 1) {
            const point = { x, y };
            if (pathing.isEmpty(point) || placement.isSet(point)) continue;

            if (equalHeightAround(terrainHeight, point)) {
                visionBlockers.push(point);
            } else {
                rampMask[y * pathing.width + x] = 1;
            }
        }
    }

    const rampPoints = new PixelMap({ bitsPerPixel: 8, size: { x: pathing.width, y: pathing.height }, data: rampMask });
    const ramps = rampPoints
        .floodFillAll((value) => value === 1)
        .filter((group) => group.length >= MINIMUM_RAMP_SIZE)
        .map((group) => new Ramp(group, terrainHeight, startLocation));

    return { ramps, visionBlockers };
}
