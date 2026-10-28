const SAMPLES_PER_CELL = 5;
const COST_TOLERANCE = 1.002;
const SQRT2 = 1.41421;

function lineWeight(data: Float32Array, width: number, from: number, to: number): number {
    const x0 = from % width;
    const y0 = (from / width) | 0;
    const flight = Math.fround(Math.hypot(x0 - (to % width), y0 - ((to / width) | 0)));
    const dirX = ((to % width) - x0) / flight;
    const dirY = (((to / width) | 0) - y0) / flight;
    const dots = SAMPLES_PER_CELL * Math.trunc(flight);
    const seen = new Set<number>();
    for (let i = 0; i < dots; i += 1) {
        const x = Math.trunc(x0 + (dirX * i) / SAMPLES_PER_CELL);
        const y = Math.trunc(y0 + (dirY * i) / SAMPLES_PER_CELL);
        seen.add(y * width + x);
    }
    let sum = 0;
    for (const cell of seen) {
        sum += data[cell];
        if (sum === Infinity) break;
    }
    return seen.size > 0 ? (sum * flight) / seen.size : 0;
}

function stepWeight(data: Float32Array, width: number, from: number, to: number): number {
    const dx = Math.abs((from % width) - (to % width));
    const dy = Math.abs(((from / width) | 0) - ((to / width) | 0));
    return data[to] * (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy));
}

// findPath output omits the start node; prepend it before calling.
export function smoothPath(pathWithStart: Int32Array, data: Float32Array, width: number): Int32Array {
    if (pathWithStart.length < 3) return pathWithStart;
    const kept: number[] = [pathWithStart[0]];
    // MA seeds the running weight with 0, so the first step is never counted.
    let running = 0;
    for (let i = 1; i < pathWithStart.length - 1; i += 1) {
        const current = pathWithStart[i];
        const next = pathWithStart[i + 1];
        const step = stepWeight(data, width, current, next);
        running += step;
        if (lineWeight(data, width, kept[kept.length - 1], next) > running * COST_TOLERANCE) {
            running = step;
            kept.push(current);
        }
    }
    kept.push(pathWithStart[pathWithStart.length - 1]);
    return Int32Array.from(kept);
}
