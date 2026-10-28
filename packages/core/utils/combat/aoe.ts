import { avgPoints, distance } from '../geometry/point.ts';
import type { Point2D, Unit } from '../../types.ts';

export function findAoePosition(
    radius: number,
    targets: Unit[],
    minTargets: number,
    bonusTags: ReadonlySet<string> = new Set(),
): Point2D | undefined {
    if (targets.length === 0) return undefined;

    const candidates: Point2D[] = targets.map(({ pos }) => ({ x: pos.x, y: pos.y }));
    for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
            const [a, b] = [targets[i].pos, targets[j].pos];
            if (distance(a, b) < 2 * radius) candidates.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
    }

    const centroid = avgPoints(targets.map(({ pos }) => pos));
    let best: { point: Point2D; score: number; fromCentroid: number } | undefined;
    for (const point of candidates) {
        const inside = targets.filter(({ pos }) => distance(pos, point) < radius);
        if (inside.length < minTargets) continue;
        const score = inside.length + inside.filter(({ tag }) => bonusTags.has(tag)).length;
        const fromCentroid = distance(point, centroid);
        if (!best || score > best.score || (score === best.score && fromCentroid < best.fromCentroid)) {
            best = { point, score, fromCentroid };
        }
    }
    return best?.point;
}
