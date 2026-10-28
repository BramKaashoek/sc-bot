import type { Grid2D, Point2D } from '../../types.ts';
import { distance } from '../geometry/point.ts';

function floodFill(
    mapData: Grid2D,
    x: number,
    y: number,
    oldVal: number | null | undefined,
    newVal: number,
    maxReach: number | boolean = false,
    filled: Point2D[] = [],
    startPos?: Point2D,
): Point2D[] {
    const mapHeight = mapData.length;
    const mapWidth = mapData[0].length;

    if (startPos == null) {
        startPos = { x, y };
    }

    if (oldVal == null) {
        oldVal = mapData[y][x];
    }

    if (maxReach && distance(startPos, { x, y }) > Number(maxReach)) {
        return filled;
    }

    if (mapData[y][x] !== oldVal || filled.some((pix) => pix.x === x && pix.y === y)) {
        return filled;
    }

    mapData[y][x] = newVal;
    filled.push({ y, x });

    if (x > 0) {
        floodFill(mapData, x - 1, y, oldVal, newVal, maxReach, filled, startPos);
    }
    if (y > 0) {
        floodFill(mapData, x, y - 1, oldVal, newVal, maxReach, filled, startPos);
    }
    if (x < mapWidth - 1) {
        floodFill(mapData, x + 1, y, oldVal, newVal, maxReach, filled, startPos);
    }
    if (y < mapHeight - 1) {
        floodFill(mapData, x, y + 1, oldVal, newVal, maxReach, filled, startPos);
    }

    return filled;
}

export default floodFill;
