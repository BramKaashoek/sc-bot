import { createAStar } from '../utils/pathing/astar.ts';
import type { InfluenceGrid, InfluenceLayer, Point2D, ResourceDefinition } from '../types.ts';

const RETARGET_RADIUS = 3;

type AStar = ReturnType<typeof createAStar>;

const cellCentre = (index: number, width: number): Point2D => ({
    x: (index % width) + 0.5,
    y: Math.floor(index / width) + 0.5,
});

function clampedIndex(grid: InfluenceGrid, point: Point2D): number {
    const x = Math.min(grid.width - 1, Math.max(0, Math.floor(point.x)));
    const y = Math.min(grid.height - 1, Math.max(0, Math.floor(point.y)));
    return y * grid.width + x;
}

function closestFinite(grid: InfluenceGrid, index: number, radius: number): number {
    const { width, height, data } = grid;
    const cx = index % width;
    const cy = Math.floor(index / width);
    let best = -1;
    let bestD2 = Infinity;
    for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y++) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++) {
            const d2 = (x - cx) ** 2 + (y - cy) ** 2;
            if (d2 <= radius * radius && d2 < bestD2 && data[y * width + x] !== Infinity) {
                best = y * width + x;
                bestD2 = d2;
            }
        }
    }
    return best;
}

export const pathingResource: ResourceDefinition<'pathing'> = {
    name: 'pathing',
    create(world) {
        let astar: AStar | undefined;
        let astarWidth = 0;
        let astarHeight = 0;

        const resolve = (layer: InfluenceLayer | InfluenceGrid = 'ground'): InfluenceGrid =>
            typeof layer === 'string' ? world.resources.get().influence.getGrid(layer) : layer;

        const astarFor = (grid: InfluenceGrid): AStar => {
            if (!astar || astarWidth !== grid.width || astarHeight !== grid.height) {
                astar = createAStar(grid.width, grid.height);
                astarWidth = grid.width;
                astarHeight = grid.height;
            }
            return astar;
        };

        const pathIndices = (grid: InfluenceGrid, start: Point2D, goal: Point2D, maxExpanded?: number) => {
            if (grid.width === 0 || grid.height === 0) return null;
            const startIndex = clampedIndex(grid, start);
            let goalIndex = clampedIndex(grid, goal);
            if (grid.data[goalIndex] === Infinity) {
                goalIndex = closestFinite(grid, goalIndex, RETARGET_RADIUS);
                if (goalIndex === -1) return null;
            }
            return astarFor(grid).findPath(grid.data, startIndex, goalIndex, maxExpanded);
        };

        return {
            findPath(start, goal, { layer, maxExpanded } = {}) {
                const grid = resolve(layer);
                const path = pathIndices(grid, start, goal, maxExpanded);
                return path ? Array.from(path, (index) => cellCentre(index, grid.width)) : [];
            },
            nextPoint(
                start,
                goal,
                {
                    layer,
                    maxExpanded,
                    sensitivity = 5,
                    senseDanger = true,
                    dangerDistance = 20,
                    dangerThreshold = 5,
                } = {},
            ) {
                const grid = resolve(layer);
                if (senseDanger && !hasDangerNear(grid, start, dangerDistance, dangerThreshold)) return goal;
                const path = pathIndices(grid, start, goal, maxExpanded);
                if (!path || path.length === 0) return goal;
                return cellCentre(path[Math.min(Math.max(1, sensitivity), path.length) - 1], grid.width);
            },
            closestSafeSpot(from, { layer, radius = 11 } = {}) {
                const grid = resolve(layer);
                const { width, height, data } = grid;
                const r2 = radius * radius;
                let best: Point2D | undefined;
                let bestCost = Infinity;
                let bestD2 = Infinity;
                for (
                    let y = Math.max(0, Math.floor(from.y - radius));
                    y <= Math.min(height - 1, from.y + radius);
                    y++
                ) {
                    for (
                        let x = Math.max(0, Math.floor(from.x - radius));
                        x <= Math.min(width - 1, from.x + radius);
                        x++
                    ) {
                        const centre = { x: x + 0.5, y: y + 0.5 };
                        const d2 = (centre.x - from.x) ** 2 + (centre.y - from.y) ** 2;
                        const cost = data[y * width + x];
                        if (d2 > r2 || cost === Infinity) continue;
                        if (cost < bestCost || (cost === bestCost && d2 < bestD2)) {
                            best = centre;
                            bestCost = cost;
                            bestD2 = d2;
                        }
                    }
                }
                return best;
            },
            isPositionSafe(point, { layer, limit = 1 } = {}) {
                return resolve(layer).get(point) <= limit;
            },
        };
    },
};

function hasDangerNear(grid: InfluenceGrid, start: Point2D, distance: number, threshold: number): boolean {
    const { width, height, data } = grid;
    const d2Max = distance * distance;
    for (let y = Math.max(0, Math.ceil(start.y - distance)); y <= Math.min(height - 1, start.y + distance); y++) {
        for (let x = Math.max(0, Math.ceil(start.x - distance)); x <= Math.min(width - 1, start.x + distance); x++) {
            const cost = data[y * width + x];
            if (cost >= threshold && cost !== Infinity && (x - start.x) ** 2 + (y - start.y) ** 2 < d2Max) return true;
        }
    }
    return false;
}
