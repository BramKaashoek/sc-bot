import type { AAShape, Footprint, Point2D } from '../../types.ts';

function circleCenterFromPoints(A: Point2D, B: Point2D, C: Point2D): Point2D {
    const yDelta_a = B.y - A.y;
    const xDelta_a = B.x - A.x;
    const yDelta_b = C.y - B.y;
    const xDelta_b = C.x - B.x;

    const aSlope = yDelta_a / xDelta_a;
    const bSlope = yDelta_b / xDelta_b;

    const center: Point2D = {
        y: 0,
        x: (aSlope * bSlope * (A.y - C.y) + bSlope * (A.x + B.x) - aSlope * (B.x + C.x)) / (2 * (bSlope - aSlope)),
    };

    center.y = -1 * (center.x - (A.x + B.x) / 2) / aSlope + (A.y + B.y) / 2;
    
    return center;
}

function distanceAAShapes(shapeA: AAShape, shapeB: AAShape) {
    const dx = Math.max(Math.abs(shapeA.pos.x - shapeB.pos.x) - ((shapeA.w / 2) + (shapeB.w / 2)), 0);
    const dy = Math.max(Math.abs(shapeA.pos.y - shapeB.pos.y) - ((shapeA.h / 2) + (shapeB.h / 2)), 0);
    return Math.sqrt(dx * dx + dy * dy);
}

function distanceAAShapeAndPoint(shape: AAShape, point: Point2D) {
    const dx = Math.max(Math.abs(shape.pos.x - point.x) - (shape.w / 2), 0);
    const dy = Math.max(Math.abs(shape.pos.y - point.y) - (shape.h / 2), 0);
    return Math.sqrt(dx * dx + dy * dy);
}

function cellsInFootprint(centerPoint: Point2D, footprint: Footprint, includeSelf = true): Point2D[] {
    return Array.from({ length: footprint.w + 1 }).reduce<Point2D[]>((cells, _, i) => {
        if (i === 1) {
            if (includeSelf) {
                cells.push(centerPoint); // center
            }
        } else if (i === 2) {
            cells.push({ x: centerPoint.x - 1, y: centerPoint.y }); // left
            if (footprint.h >= 2) {
                cells.push({ x: centerPoint.x, y: centerPoint.y - 1 }); // down
                cells.push({ x: centerPoint.x - 1, y: centerPoint.y - 1 }); // down left
            }
        } else if (i === 3) {
            cells.push({ x: centerPoint.x + 1, y: centerPoint.y }); // right
            if (footprint.h >= 2) {
                cells.push({ x: centerPoint.x + 1, y: centerPoint.y - 1 }); // down right
            }
            if (footprint.h >= 3) {
                cells.push({ x: centerPoint.x - 1, y: centerPoint.y + 1 }); // up left
                cells.push({ x: centerPoint.x, y: centerPoint.y + 1 }); // up
                cells.push({ x: centerPoint.x + 1, y: centerPoint.y + 1 }); // up right
            }
        } else if (i === 5) {
            cells.push({ x: centerPoint.x - 2, y: centerPoint.y }); // 2 left
            cells.push({ x: centerPoint.x + 2, y: centerPoint.y }); // 2 right
            if (footprint.h >= 5) {
                cells.push({ x: centerPoint.x - 2, y: centerPoint.y - 2 }); // 2 left 2 down
                cells.push({ x: centerPoint.x - 2, y: centerPoint.y - 1}); // 2 left 1 down

                cells.push({ x: centerPoint.x, y: centerPoint.y - 2}); // 2 down
                cells.push({ x: centerPoint.x - 1, y: centerPoint.y - 2}); // 2 down 1 left
                cells.push({ x: centerPoint.x + 1, y: centerPoint.y - 2}); // 2 down 1 right

                cells.push({ x: centerPoint.x + 2, y: centerPoint.y - 2 }); // 2 right 2 down
                cells.push({ x: centerPoint.x + 2, y: centerPoint.y - 1}); // 2 right 1 down

                cells.push({ x: centerPoint.x - 2, y: centerPoint.y + 2 }); // 2 left 2 up
                cells.push({ x: centerPoint.x - 2, y: centerPoint.y + 1}); // 2 left 1 up

                cells.push({ x: centerPoint.x, y: centerPoint.y + 2}); // 2 up
                cells.push({ x: centerPoint.x - 1, y: centerPoint.y + 2}); // 2 up 1 left
                cells.push({ x: centerPoint.x + 1, y: centerPoint.y + 2}); // 2 up 1 right

                cells.push({ x: centerPoint.x + 2, y: centerPoint.y + 2 }); // 2 right 2 up
                cells.push({ x: centerPoint.x + 2, y: centerPoint.y + 1}); // 2 right 1 up
            }
        }

        return cells;
    }, []);
}

export { cellsInFootprint, circleCenterFromPoints, distanceAAShapes, distanceAAShapeAndPoint };
