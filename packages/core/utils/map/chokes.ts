export type ChokeSettings = { maxChokeWidth: number; peakRatio: number; minRegionArea: number };

export type Choke = {
    cells: Int32Array;
    center: number;
    sides: [number, number];
    width: number;
    regions: [number, number];
};

export type ChokeAnalysis = {
    labels: Int32Array;
    clearance: Float32Array;
    regions: Array<{ area: number; peak: number }>;
    chokes: Choke[];
};

const FAR = 1e20;

function transform1d(f: Float64Array, length: number, d: Float64Array, v: Int32Array, z: Float64Array) {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < length; q++) {
        let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) {
            k -= 1;
            s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
        while (z[k + 1] < q) k += 1;
        d[q] = (q - v[k]) ** 2 + f[v[k]];
    }
}

function computeClearance(walkable: Uint8Array, width: number, height: number): Float32Array {
    const paddedWidth = width + 2;
    const paddedHeight = height + 2;
    const squared = new Float64Array(paddedWidth * paddedHeight);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (walkable[y * width + x] !== 0) squared[(y + 1) * paddedWidth + x + 1] = FAR;
        }
    }

    const longest = Math.max(paddedWidth, paddedHeight);
    const f = new Float64Array(longest);
    const d = new Float64Array(longest);
    const v = new Int32Array(longest);
    const z = new Float64Array(longest + 1);

    for (let x = 0; x < paddedWidth; x++) {
        for (let y = 0; y < paddedHeight; y++) f[y] = squared[y * paddedWidth + x];
        transform1d(f, paddedHeight, d, v, z);
        for (let y = 0; y < paddedHeight; y++) squared[y * paddedWidth + x] = d[y];
    }
    for (let y = 0; y < paddedHeight; y++) {
        const row = y * paddedWidth;
        for (let x = 0; x < paddedWidth; x++) f[x] = squared[row + x];
        transform1d(f, paddedWidth, d, v, z);
        for (let x = 0; x < paddedWidth; x++) squared[row + x] = d[x];
    }

    const clearance = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (walkable[y * width + x] !== 0)
                clearance[y * width + x] = Math.sqrt(squared[(y + 1) * paddedWidth + x + 1]);
        }
    }
    return clearance;
}

function forEachNeighbour4(cell: number, width: number, height: number, fn: (neighbour: number) => void) {
    const x = cell % width;
    const y = (cell / width) | 0;
    if (x > 0) fn(cell - 1);
    if (x < width - 1) fn(cell + 1);
    if (y > 0) fn(cell - width);
    if (y < height - 1) fn(cell + width);
}

export function analyzeChokes(
    walkable: Uint8Array,
    width: number,
    height: number,
    { maxChokeWidth, peakRatio, minRegionArea }: ChokeSettings,
): ChokeAnalysis {
    const size = width * height;
    const clearance = computeClearance(walkable, width, height);

    const order: number[] = [];
    for (let cell = 0; cell < size; cell++) if (walkable[cell] !== 0) order.push(cell);
    order.sort((a, b) => clearance[b] - clearance[a] || a - b);

    const parent = new Int32Array(size).fill(-1);
    const area = new Int32Array(size);
    const peak = new Int32Array(size);
    const find = (cell: number): number => {
        let root = cell;
        while (parent[root] !== root) root = parent[root];
        for (let node = cell; parent[node] !== root; ) {
            const next = parent[node];
            parent[node] = root;
            node = next;
        }
        return root;
    };
    const higherPeak = (a: number, b: number) =>
        clearance[peak[a]] > clearance[peak[b]] || (clearance[peak[a]] === clearance[peak[b]] && peak[a] < peak[b]);
    const join = (from: number, into: number) => {
        parent[from] = into;
        area[into] += area[from];
        if (higherPeak(from, into)) peak[into] = peak[from];
    };

    const roots: number[] = [];
    const flood = (cell: number) => {
        roots.length = 0;
        forEachNeighbour4(cell, width, height, (neighbour) => {
            if (parent[neighbour] === -1) return;
            const root = find(neighbour);
            if (!roots.includes(root)) roots.push(root);
        });

        if (roots.length === 0) {
            parent[cell] = cell;
            area[cell] = 1;
            peak[cell] = cell;
            return;
        }

        const basin = roots.reduce((best, root) => (higherPeak(root, best) ? root : best));
        parent[cell] = basin;
        area[basin] += 1;
        const level = clearance[cell];
        for (const other of roots) {
            if (other === basin) continue;
            const lowerPeak = Math.min(clearance[peak[basin]], clearance[peak[other]]);
            if (2 * level > maxChokeWidth || lowerPeak < level * peakRatio) join(other, basin);
        }
    };

    // equal-clearance cells flood outward from their labelled edge, so basins meet mid-plateau instead of at index order
    const plateau = new Int32Array(size).fill(-1);
    const queued = new Int32Array(size).fill(-1);
    const queue: number[] = [];
    for (let start = 0; start < order.length; ) {
        let end = start;
        while (end < order.length && clearance[order[end]] === clearance[order[start]]) plateau[order[end++]] = start;

        const enqueueNeighbours = (cell: number) =>
            forEachNeighbour4(cell, width, height, (neighbour) => {
                if (plateau[neighbour] !== start || queued[neighbour] === start) return;
                queued[neighbour] = start;
                queue.push(neighbour);
            });
        const drain = () => {
            for (let i = 0; i < queue.length; i++) {
                flood(queue[i]);
                enqueueNeighbours(queue[i]);
            }
            queue.length = 0;
        };

        for (let i = start; i < end; i++) {
            const cell = order[i];
            let touchesLabelled = false;
            forEachNeighbour4(cell, width, height, (neighbour) => {
                if (parent[neighbour] !== -1) touchesLabelled = true;
            });
            if (touchesLabelled) {
                queued[cell] = start;
                queue.push(cell);
            }
        }
        drain();
        for (let i = start; i < end; i++) {
            const cell = order[i];
            if (queued[cell] === start) continue;
            queued[cell] = start;
            queue.push(cell);
            drain();
        }
        start = end;
    }

    const neighbours = new Map<number, Map<number, number>>();
    for (const cell of order) {
        const own = find(cell);
        forEachNeighbour4(cell, width, height, (neighbour) => {
            if (parent[neighbour] === -1) return;
            const other = find(neighbour);
            if (other === own) return;
            const boundary = Math.min(clearance[cell], clearance[neighbour]);
            const adjacent = neighbours.get(own) ?? new Map<number, number>();
            neighbours.set(own, adjacent);
            adjacent.set(other, Math.max(adjacent.get(other) ?? 0, boundary));
        });
    }

    for (;;) {
        let smallest = -1;
        neighbours.forEach((adjacent, root) => {
            if (adjacent.size === 0 || area[root] >= minRegionArea) return;
            if (smallest === -1 || area[root] < area[smallest] || (area[root] === area[smallest] && root < smallest))
                smallest = root;
        });
        if (smallest === -1) break;

        const adjacent = neighbours.get(smallest)!;
        let target = -1;
        adjacent.forEach((boundary, root) => {
            const best = target === -1 ? -1 : adjacent.get(target)!;
            if (boundary > best || (boundary === best && root < target)) target = root;
        });

        join(smallest, target);
        const merged = neighbours.get(target)!;
        merged.delete(smallest);
        adjacent.forEach((boundary, root) => {
            if (root === target) return;
            const other = neighbours.get(root)!;
            other.delete(smallest);
            const best = Math.max(merged.get(root) ?? 0, boundary);
            merged.set(root, best);
            other.set(target, best);
        });
        neighbours.delete(smallest);
    }

    const labels = new Int32Array(size).fill(-1);
    const regionOf = new Map<number, number>();
    const regions: ChokeAnalysis['regions'] = [];
    for (let cell = 0; cell < size; cell++) {
        if (parent[cell] === -1) continue;
        const root = find(cell);
        let label = regionOf.get(root);
        if (label === undefined) {
            label = regions.length;
            regionOf.set(root, label);
            regions.push({ area: area[root], peak: peak[root] });
        }
        labels[cell] = label;
    }

    return { labels, clearance, regions, chokes: extractChokes(labels, clearance, width, height, maxChokeWidth) };
}

function extractChokes(
    labels: Int32Array,
    clearance: Float32Array,
    width: number,
    height: number,
    maxChokeWidth: number,
): Choke[] {
    const regionCount = labels.reduce((highest, label) => Math.max(highest, label + 1), 0);
    const byPair = new Map<number, number[]>();
    for (let cell = 0; cell < labels.length; cell++) {
        const own = labels[cell];
        if (own === -1) continue;
        const touched: number[] = [];
        forEachNeighbour4(cell, width, height, (neighbour) => {
            const other = labels[neighbour];
            if (other === -1 || other === own || touched.includes(other)) return;
            touched.push(other);
            const key = Math.min(own, other) * regionCount + Math.max(own, other);
            const cells = byPair.get(key) ?? [];
            byPair.set(key, cells);
            cells.push(cell);
        });
    }

    const member = new Int32Array(labels.length).fill(-1);
    const seen = new Int32Array(labels.length).fill(-1);
    const chokes: Choke[] = [];
    [...byPair.keys()]
        .sort((a, b) => a - b)
        .forEach((key) => {
            const cells = byPair.get(key)!;
            cells.forEach((cell) => (member[cell] = key));
            const pair: [number, number] = [Math.floor(key / regionCount), key % regionCount];

            for (const start of cells) {
                if (seen[start] === key) continue;
                seen[start] = key;
                const component = [start];
                for (let i = 0; i < component.length; i++) {
                    const cell = component[i];
                    const x = cell % width;
                    const y = (cell / width) | 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                            const next = ny * width + nx;
                            if (member[next] !== key || seen[next] === key) continue;
                            seen[next] = key;
                            component.push(next);
                        }
                    }
                }

                const sorted = Int32Array.from(component).sort();
                const center = sorted.reduce((best, cell) => (clearance[cell] > clearance[best] ? cell : best));
                const chokeWidth = 2 * clearance[center];
                if (chokeWidth > maxChokeWidth) continue;
                chokes.push({
                    cells: sorted,
                    center,
                    sides: farthestPair(sorted, width),
                    width: chokeWidth,
                    regions: pair,
                });
            }
        });

    return chokes.sort((a, b) => a.regions[0] - b.regions[0] || a.regions[1] - b.regions[1] || a.center - b.center);
}

function farthestPair(cells: Int32Array, width: number): [number, number] {
    let best: [number, number] = [cells[0], cells[0]];
    let bestDistance = -1;
    for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
            const dx = (cells[i] % width) - (cells[j] % width);
            const dy = ((cells[i] / width) | 0) - ((cells[j] / width) | 0);
            const distance = dx * dx + dy * dy;
            if (distance > bestDistance) {
                bestDistance = distance;
                best = [cells[i], cells[j]];
            }
        }
    }
    return best;
}
