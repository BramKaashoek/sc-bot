import type { Grid2D, InfluenceGrid, Point2D } from '../../types.ts';

export type CostGrid = Pick<InfluenceGrid, 'width' | 'height' | 'data'>;

export type SpotterOverlord = { tag: string; position: Point2D; isMoving: boolean };

export const EDGE_TOWNHALL_CLEARANCE = 2.5;
export const EXPANSION_BLOCK_RADIUS = 5;
export const SPOTTER_MIN_SEPARATION = 18;
export const SPOTTER_ENEMY_CLEARANCE = 50;
export const SPOTTER_STAY_RADIUS = 9;

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
];

/** ares only filters HATCHERY, so a Lair or Hive never cleared its surroundings there; `ownTownhalls` takes the full list. */
export function creepEdges(creep: Grid2D, pathing: Grid2D, ownTownhalls: Point2D[] = []): Point2D[] {
    const edges: Point2D[] = [];
    const clearance2 = EDGE_TOWNHALL_CLEARANCE ** 2;
    const isCreep = (x: number, y: number) => !!creep[y]?.[x];
    // outside the map counts as pathable, as in ares' cval=1 convolution
    const isBlocked = (x: number, y: number) => !!pathing[y]?.[x];

    for (let y = 0; y < creep.length; y++) {
        for (let x = 0; x < creep[y].length; x++) {
            if (!creep[y][x]) continue;
            const bare = NEIGHBOURS.reduce((n, [dx, dy]) => n + (isCreep(x + dx, y + dy) ? 0 : 1), 0);
            if (bare < 2) continue;
            if (isBlocked(x, y) || NEIGHBOURS.some(([dx, dy]) => isBlocked(x + dx, y + dy))) continue;
            if (ownTownhalls.some((t) => (x - t.x) ** 2 + (y - t.y) ** 2 < clearance2)) continue;
            edges.push({ x, y });
        }
    }

    return edges;
}

export function creepCoverage(creep: Grid2D, ground: CostGrid): number {
    let pathable = 0;
    let covered = 0;
    for (let y = 0; y < ground.height; y++) {
        for (let x = 0; x < ground.width; x++) {
            if (ground.data[y * ground.width + x] === Infinity) continue;
            pathable++;
            if (creep[y]?.[x]) covered++;
        }
    }

    return pathable === 0 ? 0 : (covered / pathable) * 100;
}

export function expansionMask(width: number, height: number, townhalls: Point2D[]): Uint8Array {
    const mask = new Uint8Array(width * height);
    const radius2 = EXPANSION_BLOCK_RADIUS ** 2;
    for (const { x: tx, y: ty } of townhalls) {
        const y0 = Math.max(0, Math.floor(ty - EXPANSION_BLOCK_RADIUS));
        const y1 = Math.min(height - 1, Math.ceil(ty + EXPANSION_BLOCK_RADIUS));
        const x0 = Math.max(0, Math.floor(tx - EXPANSION_BLOCK_RADIUS));
        const x1 = Math.min(width - 1, Math.ceil(tx + EXPANSION_BLOCK_RADIUS));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                if ((x + 0.5 - tx) ** 2 + (y + 0.5 - ty) ** 2 < radius2) mask[y * width + x] = 1;
            }
        }
    }

    return mask;
}

export function isExpansionBlocked(mask: Uint8Array, width: number, point: Point2D): boolean {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    return x >= 0 && x < width && y >= 0 && y < mask.length / width && mask[y * width + x] === 1;
}

// ares bounds-checks with banker's round but looks up with truncation, so it rejects the outer half of the last cell on even map widths

export function isValidTumorSpot(
    point: Point2D,
    { creep, mask, ground, limit = 1 }: { creep: Grid2D; mask: Uint8Array; ground: CostGrid; limit?: number },
): boolean {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (x < 0 || y < 0 || x >= ground.width || y >= ground.height) return false;

    return (
        !!creep[y]?.[x] &&
        !isExpansionBlocked(mask, ground.width, point) &&
        // Infinity (unpathable) fails the limit too, so no separate pathable check
        ground.data[y * ground.width + x] <= limit
    );
}

export function nearestCreepTile(creep: Grid2D, near: Point2D): Point2D | undefined {
    let best: Point2D | undefined;
    let bestDistance2 = Infinity;
    for (let y = 0; y < creep.length; y++) {
        for (let x = 0; x < creep[y].length; x++) {
            if (!creep[y][x]) continue;
            const distance2 = (x - near.x) ** 2 + (y - near.y) ** 2;
            if (distance2 < bestDistance2) {
                bestDistance2 = distance2;
                best = { x, y };
            }
        }
    }

    return best;
}

/**
 * ares drops the furthest edge before spacing (`argpartition(num_to_keep = n - 1)`), which returns nothing for a
 * single edge; here every edge is a candidate.
 */
export function overlordSpotterPositions(
    edges: Point2D[],
    overlords: SpotterOverlord[],
    target: Point2D,
    { mapSize, enemyStart }: { mapSize: Point2D; enemyStart?: Point2D },
): Map<string, Point2D> {
    const result = new Map<string, Point2D>();
    if (overlords.length === 0) return result;

    const byDistance = edges
        .map((edge) => ({ edge, distance2: (edge.x - target.x) ** 2 + (edge.y - target.y) ** 2 }))
        .sort((a, b) => a.distance2 - b.distance2)
        .map(({ edge }) => edge);

    const spots: Point2D[] = [];
    for (const edge of byDistance) {
        if (enemyStart && (edge.x - enemyStart.x) ** 2 + (edge.y - enemyStart.y) ** 2 < SPOTTER_ENEMY_CLEARANCE ** 2) {
            continue;
        }
        if (spots.some((s) => Math.hypot(edge.x - s.x, edge.y - s.y) < SPOTTER_MIN_SEPARATION)) continue;
        spots.push(edge);
        if (spots.length >= overlords.length) break;
    }

    const available = [...overlords];
    for (const spot of spots) {
        let closest = 0;
        let closestDistance2 = Infinity;
        available.forEach((o, i) => {
            const distance2 = (o.position.x - spot.x) ** 2 + (o.position.y - spot.y) ** 2;
            if (distance2 < closestDistance2) {
                closestDistance2 = distance2;
                closest = i;
            }
        });
        const [overlord] = available.splice(closest, 1);
        const stay = !overlord.isMoving && closestDistance2 < SPOTTER_STAY_RADIUS ** 2;
        const final = stay ? overlord.position : spot;
        result.set(overlord.tag, {
            x: Math.max(1, Math.min(mapSize.x - 1, final.x)),
            y: Math.max(1, Math.min(mapSize.y - 1, final.y)),
        });
    }

    return result;
}
