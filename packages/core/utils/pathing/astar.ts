const DIAGONAL = Math.SQRT2;
const MAX_GENERATION = 0xffffffff;

export function createAStar(width: number, height: number) {
    const size = width * height;
    const g = new Float32Array(size);
    const parent = new Int32Array(size);
    const opened = new Uint32Array(size);
    const closed = new Uint32Array(size);
    let generation = 0;

    let heapNodes = new Int32Array(64);
    let heapKeys = new Float32Array(64);
    let heapSize = 0;

    const push = (node: number, key: number) => {
        if (heapSize === heapNodes.length) {
            const nodes = new Int32Array(heapSize * 2);
            const keys = new Float32Array(heapSize * 2);
            nodes.set(heapNodes);
            keys.set(heapKeys);
            heapNodes = nodes;
            heapKeys = keys;
        }
        let index = heapSize++;
        while (index > 0) {
            const up = (index - 1) >> 1;
            if (heapKeys[up] <= key) break;
            heapNodes[index] = heapNodes[up];
            heapKeys[index] = heapKeys[up];
            index = up;
        }
        heapNodes[index] = node;
        heapKeys[index] = key;
    };

    const pop = (): number => {
        const top = heapNodes[0];
        heapSize -= 1;
        const node = heapNodes[heapSize];
        const key = heapKeys[heapSize];
        let index = 0;
        for (;;) {
            let child = 2 * index + 1;
            if (child >= heapSize) break;
            if (child + 1 < heapSize && heapKeys[child + 1] < heapKeys[child]) child += 1;
            if (heapKeys[child] >= key) break;
            heapNodes[index] = heapNodes[child];
            heapKeys[index] = heapKeys[child];
            index = child;
        }
        heapNodes[index] = node;
        heapKeys[index] = key;
        return top;
    };

    const heuristic = (node: number) => {
        const dx = Math.abs((node % width) - goalX);
        const dy = Math.abs(((node / width) | 0) - goalY);
        return dx > dy ? dx - dy + DIAGONAL * dy : dy - dx + DIAGONAL * dx;
    };

    const reconstruct = (start: number, goal: number) => {
        let length = 0;
        for (let node = goal; node !== start; node = parent[node]) length += 1;
        const path = new Int32Array(length);
        for (let node = goal; node !== start; node = parent[node]) path[--length] = node;
        return path;
    };

    let costs: Float32Array = new Float32Array(0);
    let current = 0;
    let goalX = 0;
    let goalY = 0;

    const visit = (next: number, step: number) => {
        if (closed[next] === generation) return;
        const cost = g[current] + costs[next] * step;
        if (opened[next] === generation && cost >= g[next]) return;
        g[next] = cost;
        parent[next] = current;
        opened[next] = generation;
        push(next, cost + heuristic(next));
    };

    function findPath(grid: Float32Array, start: number, goal: number, maxExpanded = Infinity): Int32Array | null {
        if (grid[goal] === Infinity && goal !== start) return null;
        costs = grid;

        if (generation === MAX_GENERATION) {
            opened.fill(0);
            closed.fill(0);
            generation = 0;
        }
        generation += 1;
        heapSize = 0;

        goalX = goal % width;
        goalY = (goal / width) | 0;
        g[start] = 0;
        opened[start] = generation;
        push(start, heuristic(start));

        let expanded = 0;
        while (heapSize > 0) {
            current = pop();
            if (closed[current] === generation) continue;
            if (current === goal) return reconstruct(start, goal);
            if (++expanded > maxExpanded) return null;
            closed[current] = generation;

            const x = current % width;
            const y = (current / width) | 0;
            const left = x > 0 && costs[current - 1] !== Infinity;
            const right = x < width - 1 && costs[current + 1] !== Infinity;
            const up = y > 0 && costs[current - width] !== Infinity;
            const down = y < height - 1 && costs[current + width] !== Infinity;

            if (left) visit(current - 1, 1);
            if (right) visit(current + 1, 1);
            if (up) visit(current - width, 1);
            if (down) visit(current + width, 1);
            if (up && left && costs[current - width - 1] !== Infinity) visit(current - width - 1, DIAGONAL);
            if (up && right && costs[current - width + 1] !== Infinity) visit(current - width + 1, DIAGONAL);
            if (down && left && costs[current + width - 1] !== Infinity) visit(current + width - 1, DIAGONAL);
            if (down && right && costs[current + width + 1] !== Infinity) visit(current + width + 1, DIAGONAL);
        }
        return null;
    }

    return { findPath };
}
