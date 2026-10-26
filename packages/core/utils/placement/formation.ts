import type { Point2D } from '../../types.ts';

export type FormationGrids = {
    width: number;
    height: number;
    placeable: Uint8Array;
    startPlaceable?: Uint8Array;
    pathable: Uint8Array;
    terrainHeight: Uint8Array;
    creep?: Uint8Array;
    avoid: Uint8Array;
};

export type BuildingScan = {
    xStride: number;
    yStride: number;
    buildingWidth: number;
    buildingHeight: number;
    kernelWidth: number;
    kernelHeight: number;
    avoidCreep: boolean;
    reduceXStride?: boolean;
    dropInterval?: number;
};

const MAX_GENERATION = 0xffffffff;

type Scratch = { stamp: Uint32Array; generation: number; queue: Int32Array };

const scratchByGrids = new WeakMap<FormationGrids, Scratch>();

function nextStamp(grids: FormationGrids): Scratch {
    let scratch = scratchByGrids.get(grids);
    const size = grids.width * grids.height;
    if (!scratch || scratch.stamp.length !== size) {
        scratch = { stamp: new Uint32Array(size), generation: 0, queue: new Int32Array(size) };
        scratchByGrids.set(grids, scratch);
    }
    if (scratch.generation === MAX_GENERATION) {
        scratch.stamp.fill(0);
        scratch.generation = 0;
    }
    scratch.generation++;
    return scratch;
}

export function floodArea(grids: FormationGrids, start: Point2D, maxDist: number): Int32Array {
    const { width, height, terrainHeight } = grids;
    const placeable = grids.startPlaceable ?? grids.placeable;
    const sx = Math.floor(start.x);
    const sy = Math.floor(start.y);
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) return new Int32Array(0);
    const origin = sy * width + sx;
    if (!placeable[origin]) return new Int32Array(0);

    const { stamp, generation, queue } = nextStamp(grids);
    const level = terrainHeight[origin];
    const maxDist2 = maxDist * maxDist;
    let head = 0;
    let tail = 0;
    queue[tail++] = origin;
    stamp[origin] = generation;

    const visit = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const index = y * width + x;
        if (stamp[index] === generation) return;
        stamp[index] = generation;
        const dx = x - sx;
        const dy = y - sy;
        if (dx * dx + dy * dy > maxDist2 || !placeable[index] || terrainHeight[index] !== level) return;
        queue[tail++] = index;
    };

    while (head < tail) {
        const index = queue[head++];
        const x = index % width;
        const y = (index - x) / width;
        visit(x + 1, y);
        visit(x - 1, y);
        visit(x, y + 1);
        visit(x, y - 1);
    }
    return queue.slice(0, tail);
}

function fillAvoid(grids: FormationGrids, x0: number, y0: number, w: number, h: number, value: number) {
    const { width, height, avoid } = grids;
    const xEnd = Math.min(width, x0 + w);
    const yEnd = Math.min(height, y0 + h);
    for (let y = Math.max(0, y0); y < yEnd; y++) {
        for (let x = Math.max(0, x0); x < xEnd; x++) avoid[y * width + x] = value;
    }
}

export function markAvoid(grids: FormationGrids, x0: number, y0: number, w: number, h: number): void {
    fillAvoid(grids, x0, y0, w, h, 1);
}

export function unmarkAvoid(grids: FormationGrids, x0: number, y0: number, w: number, h: number): void {
    fillAvoid(grids, x0, y0, w, h, 0);
}

export function findBuildingLocations(grids: FormationGrids, area: Int32Array, opts: BuildingScan): Point2D[] {
    if (area.length === 0) return [];
    const { width, placeable, pathable, avoid, creep } = grids;
    const { yStride, kernelWidth, kernelHeight, buildingWidth, buildingHeight, dropInterval } = opts;
    const xStride = opts.reduceXStride && opts.xStride >= 7 && area.length < 300 ? 5 : opts.xStride;
    const checkCreep = opts.avoidCreep && creep !== undefined;

    const { stamp, generation } = nextStamp(grids);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const index of area) {
        stamp[index] = generation;
        const x = index % width;
        const y = (index - x) / width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    const fits = (x0: number, y0: number) => {
        for (let y = y0; y < y0 + kernelHeight; y++) {
            for (let x = x0; x < x0 + kernelWidth; x++) {
                const index = y * width + x;
                if (stamp[index] !== generation || !placeable[index] || !pathable[index] || avoid[index]) return false;
                if (checkCreep && creep[index]) return false;
            }
        }
        return true;
    };

    const corners: Point2D[] = [];
    for (let y = minY; y + kernelHeight - 1 <= maxY; y += yStride) {
        for (let x = minX; x + kernelWidth - 1 <= maxX; x += xStride) {
            if (!fits(x, y)) continue;
            markAvoid(grids, x, y, kernelWidth, kernelHeight);
            corners.push({ x, y });
        }
    }

    const centres: Point2D[] = [];
    corners.forEach(({ x, y }, i) => {
        if (dropInterval && corners.length > 6 && i % dropInterval === 0) {
            unmarkAvoid(grids, x, y, kernelWidth, kernelHeight);
            return;
        }
        centres.push({ x: x + buildingWidth / 2, y: y + buildingHeight / 2 });
    });
    return centres;
}
