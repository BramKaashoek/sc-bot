import { describe, expect, it } from 'bun:test';
import { gridsInCircle, randomCirclePoints, toDegrees, toRadians } from './angle.ts';

describe('angle conversion', () => {
    it('converts between degrees and radians', () => {
        expect(toRadians(180)).toBe(Math.PI);
        expect(toRadians(90)).toBe(Math.PI / 2);
        expect(toDegrees(Math.PI)).toBe(180);
    });
});

describe('randomCirclePoints', () => {
    it('returns n integer points within the radius (plus flooring slack), one by default', () => {
        const center = { x: 100, y: 100 };
        const points = randomCirclePoints(center, 10, 50);

        expect(points).toHaveLength(50);
        for (const point of points) {
            expect(Number.isInteger(point.x) && Number.isInteger(point.y)).toBe(true);
            expect(Math.hypot(point.x - center.x, point.y - center.y)).toBeLessThanOrEqual(10 + Math.SQRT2);
        }
        expect(randomCirclePoints(center, 10)).toHaveLength(1);
    });
});

describe('gridsInCircle', () => {
    it('returns every unit cell whose corners reach into the circle, x-major', () => {
        expect(gridsInCircle({ x: 5, y: 5 }, 1)).toEqual([
            { x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 },
            { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 },
            { x: 6, y: 4 }, { x: 6, y: 5 },
        ]);
    });

    it('floors the cells when normalize is set, using a custom step distance', () => {
        expect(gridsInCircle({ x: 5, y: 5 }, 0.5, { distance: 0.25, normalize: true })).toEqual([
            { x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 5 },
            { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 5 },
            { x: 5, y: 4 }, { x: 5, y: 5 },
        ]);
    });
});
