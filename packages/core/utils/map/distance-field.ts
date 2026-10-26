const DIAGONAL = Math.SQRT2;
const MAX_GENERATION = 0xffffffff;

export function createDistanceField(width: number, height: number) {
    const size = width * height;
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

    let walkable: Uint8Array = new Uint8Array(0);
    let distances: Float32Array = new Float32Array(0);
    let current = 0;

    const visit = (next: number, step: number) => {
        if (closed[next] === generation) return;
        const cost = distances[current] + step;
        if (cost >= distances[next]) return;
        distances[next] = cost;
        push(next, cost);
    };

    function compute(grid: Uint8Array, start: number, out: Float32Array): Float32Array {
        walkable = grid;
        distances = out;
        out.fill(Infinity);
        if (!Number.isInteger(start) || start < 0 || start >= size || grid[start] === 0) return out;

        if (generation === MAX_GENERATION) {
            closed.fill(0);
            generation = 0;
        }
        generation += 1;
        heapSize = 0;

        out[start] = 0;
        push(start, 0);

        while (heapSize > 0) {
            current = pop();
            if (closed[current] === generation) continue;
            closed[current] = generation;

            const x = current % width;
            const y = (current / width) | 0;
            const left = x > 0 && walkable[current - 1] !== 0;
            const right = x < width - 1 && walkable[current + 1] !== 0;
            const up = y > 0 && walkable[current - width] !== 0;
            const down = y < height - 1 && walkable[current + width] !== 0;

            if (left) visit(current - 1, 1);
            if (right) visit(current + 1, 1);
            if (up) visit(current - width, 1);
            if (down) visit(current + width, 1);
            if (up && left && walkable[current - width - 1] !== 0) visit(current - width - 1, DIAGONAL);
            if (up && right && walkable[current - width + 1] !== 0) visit(current - width + 1, DIAGONAL);
            if (down && left && walkable[current + width - 1] !== 0) visit(current + width - 1, DIAGONAL);
            if (down && right && walkable[current + width + 1] !== 0) visit(current + width + 1, DIAGONAL);
        }
        return out;
    }

    return { compute };
}
