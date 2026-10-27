import type { Point2D } from '../../types.ts';
import { closestPoint, distance, towards } from '../geometry/point.ts';

const TOWNHALL_RADIUS = 2.75;

export function circleIntersections(c0: Point2D, r0: number, c1: Point2D, r1: number): Point2D[] {
    const d = distance(c0, c1);
    if (d > r0 + r1 || d < Math.abs(r0 - r1) || d === 0) return [];
    const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
    const ux = (c1.x - c0.x) / d;
    const uy = (c1.y - c0.y) / d;
    const mx = c0.x + a * ux;
    const my = c0.y + a * uy;
    return [
        { x: mx + h * uy, y: my - h * ux },
        { x: mx - h * uy, y: my + h * ux },
    ];
}

export function mineralTargets(
    minerals: { tag: string; pos: Point2D }[],
    townhalls: Point2D[],
    radius = 1.35,
): Map<string, Point2D> {
    const targets = new Map<string, Point2D>();
    if (townhalls.length === 0) return targets;
    for (const mineral of minerals) {
        const centre = closestPoint(mineral.pos, townhalls);
        const start = towards(mineral.pos, centre, radius);
        let target = start;
        for (const other of minerals) {
            if (other.tag === mineral.tag || distance(other.pos, start) >= radius) continue;
            const points = circleIntersections(mineral.pos, radius, other.pos, radius);
            if (points.length === 2) target = closestPoint(centre, points);
        }
        targets.set(mineral.tag, target);
    }
    return targets;
}

export function townhallTarget(townhall: Point2D, from: Point2D, factor = 1.08): Point2D {
    return towards(townhall, from, TOWNHALL_RADIUS * factor);
}
