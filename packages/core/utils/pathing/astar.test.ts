import { describe, expect, it } from 'bun:test';
import { createAStar } from './astar.ts';

function grid(rows: string[]): Float32Array {
    return Float32Array.from(rows.join('').split(''), (cell) => (cell === '#' ? Infinity : 1));
}

function random(seed: number) {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function neighbours(costs: Float32Array, width: number, node: number): [number, number][] {
    const height = costs.length / width;
    const x = node % width;
    const y = Math.floor(node / width);
    const free = (cx: number, cy: number) =>
        cx >= 0 && cy >= 0 && cx < width && cy < height && costs[cy * width + cx] !== Infinity;
    const result: [number, number][] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            if ((dx || dy) && free(x + dx, y + dy) && (!dx || !dy ? true : free(x + dx, y) && free(x, y + dy))) {
                const next = (y + dy) * width + x + dx;
                result.push([next, costs[next] * (dx && dy ? Math.SQRT2 : 1)]);
            }
        }
    }
    return result;
}

function dijkstra(costs: Float32Array, width: number, start: number, goal: number): number {
    const dist = new Array<number>(costs.length).fill(Infinity);
    const done = new Array<boolean>(costs.length).fill(false);
    dist[start] = 0;
    for (;;) {
        let current = -1;
        dist.forEach((d, node) => {
            if (!done[node] && d < Infinity && (current < 0 || d < dist[current])) current = node;
        });
        if (current < 0 || current === goal) return dist[goal];
        done[current] = true;
        neighbours(costs, width, current).forEach(([next, step]) => {
            dist[next] = Math.min(dist[next], dist[current] + step);
        });
    }
}

function pathCost(costs: Float32Array, width: number, start: number, path: Int32Array): number {
    let total = 0;
    let previous = start;
    path.forEach((node) => {
        const step = neighbours(costs, width, previous).find(([next]) => next === node);
        if (!step) throw new Error(`illegal step ${previous} -> ${node}`);
        total += step[1];
        previous = node;
    });
    return total;
}

function randomGrid(next: () => number, width: number, height: number): Float32Array {
    return Float32Array.from({ length: width * height }, () => {
        const roll = next();
        if (roll < 0.25) return Infinity;
        return roll < 0.5 ? 1 + Math.floor(next() * 20) : 1;
    });
}

describe('createAStar', () => {
    it('walks a straight line on an open grid, excluding the start', () => {
        const costs = grid(['.....', '.....', '.....']);

        expect(Array.from(createAStar(5, 3).findPath(costs, 5, 9)!)).toEqual([6, 7, 8, 9]);
    });

    it('detours around a costly blob only when the detour is cheaper, and never cuts a corner', () => {
        const blob = (cost: number) =>
            grid(['.....', '.....', '.....']).map((value, node) => (node % 5 === 2 && node !== 2 ? cost : value));
        const corner = grid(['.#.', '#..', '...']);
        const astar = createAStar(5, 3);

        expect(Array.from(astar.findPath(blob(50), 5, 9)!)).not.toContainAnyValues([7, 12]);
        expect(Array.from(astar.findPath(blob(2), 10, 14)!)).toEqual([11, 12, 13, 14]);
        expect(createAStar(3, 3).findPath(corner, 0, 4)).toBeNull();
    });

    it('returns null for an unreachable goal or when maxExpanded runs out, and treats the start as passable', () => {
        const walled = grid(['..#..', '..#..', '..#..']);
        const open = grid(['#....', '.....', '.....']);
        const astar = createAStar(5, 3);

        expect(astar.findPath(walled, 0, 4)).toBeNull();
        expect(astar.findPath(open, 0, 14, 3)).toBeNull();
        expect(Array.from(astar.findPath(open, 0, 2)!)).toEqual([1, 2]);
    });

    it('matches brute-force Dijkstra cost and fresh instances over 1000 queries on one instance', () => {
        const next = random(7);
        const width = 12;
        const height = 10;
        const shared = createAStar(width, height);

        for (let query = 0; query < 1000; query += 1) {
            const costs = randomGrid(next, width, height);
            const start = Math.floor(next() * costs.length);
            const goal = Math.floor(next() * costs.length);

            const path = shared.findPath(costs, start, goal);
            expect(path).toEqual(createAStar(width, height).findPath(costs, start, goal));

            const best = costs[goal] === Infinity && goal !== start ? Infinity : dijkstra(costs, width, start, goal);
            if (best === Infinity) {
                expect(path).toBeNull();
            } else {
                expect(pathCost(costs, width, start, path!)).toBeCloseTo(best, 3);
            }
        }
    });
});
