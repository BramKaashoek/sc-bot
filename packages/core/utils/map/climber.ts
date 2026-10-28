export type ClimberInput = {
    width: number;
    height: number;
    pathing: number[][];
    terrainHeight: number[][];
    playable: { x0: number; y0: number; x1: number; y1: number };
    maxGap?: number;
    minStep?: number;
    maxStep?: number;
};

// map._grids.height is clamped at 0 for the void outside the map, so 0 never belongs to real ground
const VOID_HEIGHT = 0;

export const DEFAULT_MAX_GAP = 3;
// one cliff level is 20 in map._grids.height; steps of 10-15 on simple64/acropolis/blueshift all sit within 3 cells of a ramp, so they are slopes, not cliffs
export const DEFAULT_MIN_STEP = 20;
export const DEFAULT_MAX_STEP = 20;

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
];

export function computeClimberMask({
    width,
    height,
    pathing,
    terrainHeight,
    playable,
    maxGap = DEFAULT_MAX_GAP,
    minStep = DEFAULT_MIN_STEP,
    maxStep = DEFAULT_MAX_STEP,
}: ClimberInput): Uint8Array {
    const mask = new Uint8Array(width * height);
    const isGround = (x: number, y: number) =>
        x >= playable.x0 &&
        x < playable.x1 &&
        y >= playable.y0 &&
        y < playable.y1 &&
        (terrainHeight[y]?.[x] ?? VOID_HEIGHT) > VOID_HEIGHT;
    const isBlocked = (x: number, y: number) => pathing[y]?.[x] !== 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!isBlocked(x, y) || !isGround(x, y)) continue;

            mask[y * width + x] = DIRECTIONS.some(([dx, dy]) => {
                const walk = (sign: number) => {
                    let steps = 0;
                    let cx = x + sign * dx;
                    let cy = y + sign * dy;
                    while (steps < maxGap && isGround(cx, cy) && isBlocked(cx, cy)) {
                        steps++;
                        cx += sign * dx;
                        cy += sign * dy;
                    }
                    return { steps, cx, cy };
                };
                const back = walk(-1);
                const forward = walk(1);
                const gap = back.steps + forward.steps + 1;
                if (gap > maxGap) return false;
                if (!isGround(back.cx, back.cy)) return false;
                if (!isGround(forward.cx, forward.cy)) return false;
                const step = Math.abs(terrainHeight[back.cy][back.cx] - terrainHeight[forward.cy][forward.cx]);
                return step >= minStep && step <= maxStep;
            })
                ? 1
                : 0;
        }
    }

    return mask;
}
