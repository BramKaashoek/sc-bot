import type { Point2D } from '../../types.ts';

export type BucketIndex = ReturnType<typeof createBucketIndex>;

export function createBucketIndex(cellSize = 4) {
    let xs = new Float64Array(64);
    let ys = new Float64Array(64);
    let cellOf = new Int32Array(64);
    let order = new Int32Array(64);
    let starts = new Int32Array(65);
    let count = 0;
    let minX = 0;
    let minY = 0;
    let cols = 0;
    let rows = 0;

    const column = (x: number) => Math.floor((x - minX) / cellSize);
    const row = (y: number) => Math.floor((y - minY) / cellSize);

    const scanBucket = (bucket: number, x: number, y: number, r2: number, visit: (index: number) => boolean | void) => {
        for (let k = starts[bucket]; k < starts[bucket + 1]; k++) {
            const index = order[k];
            const dx = xs[index] - x;
            const dy = ys[index] - y;
            if (dx * dx + dy * dy <= r2 && visit(index) === true) return true;
        }
        return false;
    };

    return {
        get buffers() {
            return { xs, ys, cellOf, order, starts };
        },
        get size() {
            return count;
        },
        build(points: ArrayLike<Point2D>) {
            count = points.length;
            if (count > xs.length) {
                const capacity = Math.max(count, xs.length * 2);
                xs = new Float64Array(capacity);
                ys = new Float64Array(capacity);
                cellOf = new Int32Array(capacity);
                order = new Int32Array(capacity);
            }

            minX = Infinity;
            minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (let i = 0; i < count; i++) {
                const { x, y } = points[i];
                xs[i] = x;
                ys[i] = y;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
            if (count === 0) {
                cols = 0;
                rows = 0;
                return;
            }

            cols = column(maxX) + 1;
            rows = row(maxY) + 1;
            const cells = cols * rows;
            if (cells + 1 > starts.length) starts = new Int32Array(Math.max(cells + 1, starts.length * 2));
            starts.fill(0, 0, cells + 1);

            for (let i = 0; i < count; i++) {
                const cell = row(ys[i]) * cols + column(xs[i]);
                cellOf[i] = cell;
                starts[cell + 1] += 1;
            }
            for (let cell = 0; cell < cells; cell++) starts[cell + 1] += starts[cell];
            for (let i = 0; i < count; i++) {
                const cell = cellOf[i];
                order[starts[cell]] = i;
                starts[cell] += 1;
            }
            for (let cell = cells; cell > 0; cell--) starts[cell] = starts[cell - 1];
            starts[0] = 0;
        },
        forEachInRange(point: Point2D, radius: number, visit: (index: number) => boolean | void): boolean {
            if (count === 0 || !(radius >= 0)) return false;
            const { x, y } = point;
            const c0 = Math.max(0, column(x - radius));
            const c1 = Math.min(cols - 1, column(x + radius));
            const r0 = Math.max(0, row(y - radius));
            const r1 = Math.min(rows - 1, row(y + radius));
            const r2 = radius * radius;
            for (let j = r0; j <= r1; j++) {
                for (let i = c0; i <= c1; i++) {
                    if (scanBucket(j * cols + i, x, y, r2, visit)) return true;
                }
            }
            return false;
        },
        closest(point: Point2D, maxDistance = Infinity): number {
            if (count === 0 || !(maxDistance >= 0)) return -1;
            const { x, y } = point;
            const cx = column(x);
            const cy = row(y);
            const lastRing = Math.max(cx, cols - 1 - cx, cy, rows - 1 - cy);
            let best = -1;
            let bestD2 = maxDistance * maxDistance;
            const consider = (index: number) => {
                const dx = xs[index] - x;
                const dy = ys[index] - y;
                const d2 = dx * dx + dy * dy;
                if (d2 <= bestD2 && (best === -1 || d2 < bestD2)) {
                    best = index;
                    bestD2 = d2;
                }
            };
            const visitCell = (i: number, j: number) => {
                if (i < 0 || j < 0 || i >= cols || j >= rows) return;
                const bucket = j * cols + i;
                for (let k = starts[bucket]; k < starts[bucket + 1]; k++) consider(order[k]);
            };

            // a cell in ring k is at least k - 1 whole cells away from the query point
            for (let k = 0; k <= lastRing; k++) {
                const gap = (k - 1) * cellSize;
                if (k > 1 && gap * gap > bestD2) break;
                const i0 = Math.max(0, cx - k);
                const i1 = Math.min(cols - 1, cx + k);
                for (let i = i0; i <= i1; i++) {
                    visitCell(i, cy - k);
                    if (k > 0) visitCell(i, cy + k);
                }
                const j0 = Math.max(0, cy - k + 1);
                const j1 = Math.min(rows - 1, cy + k - 1);
                for (let j = j0; j <= j1; j++) {
                    visitCell(cx - k, j);
                    if (k > 0) visitCell(cx + k, j);
                }
            }
            return best;
        },
    };
}
