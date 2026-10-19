import type { Debugger, Point2D } from '../../types.ts';
import Color from '../../constants/color.ts';
import { createPoint2D } from './point.ts';

const DEG_TO_RAD = Math.PI / 180.0;
const TWO_PI = Math.PI * 2;

const toRadians = (deg: number) => deg * DEG_TO_RAD;
const toDegrees = (rad: number) => rad / DEG_TO_RAD;

const randomCircumferencePoint = (centerPoint: Point2D, radius: number): Point2D => {
    const theta = Math.random() * TWO_PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    return {
        x: Math.floor(centerPoint.x + radius * cosTheta),
        y: Math.floor(centerPoint.y + radius * sinTheta),
    };
};

const randomCirclePoints = (centerPoint: Point2D, radius: number, n = 1): Point2D[] => {
    return Array.from({ length: n }, () => {
        // http://mathworld.wolfram.com/DiskPointPicking.html
        return randomCircumferencePoint(centerPoint, Math.sqrt(Math.random()) * radius);
    });
};

const gridsInCircle = (
    c: Point2D,
    r: number,
    options: { distance?: number; normalize?: boolean } = {},
    debug?: Debugger,
): Point2D[] => {
    const opts = {
        distance: 0.5,
        ...options,
    };

    const center = createPoint2D(c);

    if (debug) debug.setDrawSpheres(`${r}`, [{ pos: center, color: Color.YELLOW, size: 5 }]);
    const transform = options.normalize ? createPoint2D : (point: Point2D) => point;

    const d = opts.distance * 2;
    const myPoints: Point2D[] = [];
    for (let x = center.x - r; x < center.x + d + r; x += d) {
        for (let y = center.y - r; y < center.y + d + r; y += d) {
            if (debug) {
                debug.setDrawCells(`xy-${x}${y}`, [{ pos: { x, y } }], { color: Color.WHITE, size: 1 });
            }
            if (
                Math.pow(x - c.x, 2) + Math.pow(y - c.y, 2) <= r * r ||
                Math.pow(x + d - c.x, 2) + Math.pow(y - c.y, 2) <= r * r ||
                Math.pow(x - c.x, 2) + Math.pow(y + d - c.y, 2) <= r * r ||
                Math.pow(x + d - c.x, 2) + Math.pow(y + d - c.y, 2) <= r * r
            ) {
                myPoints.push(transform({ x, y }));
            }
        }
    }

    return myPoints;
};

export { toRadians, toDegrees, gridsInCircle, randomCirclePoints };
