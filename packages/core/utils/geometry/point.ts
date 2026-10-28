import type { Point2D, Point3D, Unit } from '../../types.ts';

function dotProduct(a: Point2D, b: Point2D) {
    return a.x * b.x + a.y * b.y;
}

function distanceSquared(a: Point2D, b: Point2D) {
    const diff = {
        x: a.x - b.x,
        y: a.y - b.y,
    };

    return dotProduct(diff, diff);
}

function distance(a: Point2D, b: Point2D) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function distanceX(a: Point2D, b: Point2D) {
    return Math.abs(a.x - b.x);
}

function distanceY(a: Point2D, b: Point2D) {
    return Math.abs(a.y - b.y);
}

function add(point: Point2D, rhs: Point2D | number): Point2D {
    if (typeof rhs === 'number') {
        return {
            x: point.x + rhs,
            y: point.y + rhs,
        };
    } else {
        return {
            x: point.x + rhs.x,
            y: point.y + rhs.y,
        };
    }
}

function subtract(point: Point2D, rhs: Point2D | number): Point2D {
    if (typeof rhs === 'number') {
        return {
            x: point.x - rhs,
            y: point.y - rhs,
        };
    } else {
        return {
            x: point.x - rhs.x,
            y: point.y - rhs.y,
        };
    }
}

function multiply(point: Point2D, rhs: Point2D | number): Point2D {
    if (typeof rhs === 'number') {
        return {
            x: point.x * rhs,
            y: point.y * rhs,
        };
    } else {
        return {
            x: point.x * rhs.x,
            y: point.y * rhs.y,
        };
    }
}

function divide(point: Point2D, rhs: Point2D | number): Point2D {
    if (typeof rhs === 'number') {
        return {
            x: point.x / rhs,
            y: point.y / rhs,
        };
    } else {
        return {
            x: point.x / rhs.x,
            y: point.y / rhs.y,
        };
    }
}

function areEqual(a: Point2D, b: Point2D) {
    return a.x === b.x && a.y === b.y;
}

function closestPoint(pos: Point2D, points: Point2D[]): Point2D | undefined {
    return points
        .map((point) => ({ point, distance: distance(pos, point) }))
        .sort((a, b) => a.distance - b.distance)
        .map((p) => p.point)[0];
}

function nClosestPoint(pos: Point2D, points: Point2D[], n = 1): Point2D[] {
    return points
        .map((point) => ({ point, distance: distance(pos, point) }))
        .sort((a, b) => a.distance - b.distance)
        .map((p) => p.point)
        .slice(0, n);
}

function avgPoints(points: Point2D[]): Point2D {
    return {
        x: points.reduce((sum, n) => sum + n.x, 0) / points.length,
        y: points.reduce((sum, n) => sum + n.y, 0) / points.length,
    };
}

function normalize(vec: Point2D): Point2D {
    return {
        x: vec.x / Math.sqrt(vec.x * vec.x + vec.y * vec.y),
        y: vec.y / Math.sqrt(vec.x * vec.x + vec.y * vec.y),
    };
}

const createPoint2D = ({ x, y }: Point2D): Point2D => ({
    x: Math.floor(x),
    y: Math.floor(y),
});

const toPoint = (position: Unit | Point2D): Point2D => ('pos' in position ? position.pos : position);

const pointKey = ({ x, y }: Point2D): string => `${x},${y}`;

const createPoint = ({ x, y, z }: Point3D): Point3D => ({
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
});

const getAdjacents = ({ x, y }: Point2D): Point2D[] => [
    { y: y - 1, x },
    { y, x: x - 1 },
    { y, x: x + 1 },
    { y: y + 1, x },
];

const getDiagonals = ({ x, y }: Point2D): Point2D[] => [
    { y: y - 1, x: x - 1 },
    { y: y - 1, x: x + 1 },
    { y: y + 1, x: x - 1 },
    { y: y + 1, x: x + 1 },
];

function towards(from: Point2D, to: Point2D, step: number): Point2D {
    const length = distance(from, to);
    if (length === 0) return { x: from.x, y: from.y };
    return {
        x: from.x + ((to.x - from.x) / length) * step,
        y: from.y + ((to.y - from.y) / length) * step,
    };
}

function getNeighbors(point: Point2D, includeDiagonals = true, diagonalsOnly = false): Point2D[] {
    const normal = createPoint2D(point);

    let neighbors = getAdjacents(normal);

    if (includeDiagonals && diagonalsOnly) {
        return getDiagonals(normal);
    } else if (includeDiagonals) {
        return neighbors.concat(getDiagonals(normal));
    } else {
        return neighbors;
    }
}

export {
    createPoint,
    createPoint2D,
    toPoint,
    pointKey,
    getNeighbors,
    areEqual,
    avgPoints,
    dotProduct,
    distance,
    distanceX,
    distanceY,
    distanceSquared,
    add,
    subtract,
    multiply,
    divide,
    normalize,
    closestPoint,
    nClosestPoint,
    towards,
};
