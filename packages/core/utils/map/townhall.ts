import type { Expansion, Point2D, Unit, World } from '../../types.ts';
import { gridsInCircle } from '../geometry/angle.ts';
import {
    add,
    areEqual,
    avgPoints,
    createPoint2D,
    closestPoint,
    multiply,
    normalize,
    subtract,
    distance,
} from '../geometry/point.ts';
import { cellsInFootprint } from '../geometry/plane.ts';
import { getFootprint } from '../geometry/units.ts';
import * as UnitType from '../../constants/unit-type.ts';

const { COMMANDCENTER } = UnitType;

const MIN_RESOURCE_DISTANCE = 3;
const CELL_SIZE = 1;

// townhallPosition is the floored cell; the townhall center is +0.5
export const townhallCenter = ({ townhallPosition: { x, y } }: Expansion): Point2D => ({ x: x + 0.5, y: y + 0.5 });

function calculateTownhallPlacement(
    world: World,
    center: Point2D,
    mineralFields: Unit[],
    geysers: Unit[],
): Point2D | undefined {
    const { map, debug } = world.resources.get();

    // flat mineral lines (Automaton gold) leave the centroid ambiguous, so bias toward the geysers
    // @TODO: allow multiple placements sometimes... like for the gold on automaton :p
    const clusterUnits = [...mineralFields, ...geysers];
    const vectors = clusterUnits.map((field) => normalize(subtract(field.pos, center)));
    const avgVecPos = subtract(center, multiply(avgPoints(vectors), 15));

    const grids = gridsInCircle(createPoint2D(avgVecPos), 5, { normalize: true })
        .map((cell) => {
            const thCells = cellsInFootprint(cell, getFootprint(COMMANDCENTER)!);

            const cellBucket = thCells.map((thCell) => {
                const closestResource = clusterUnits.reduce<{ closestField: Unit | null; distance: number }>(
                    (closestField, field) => {
                        const mfCells = cellsInFootprint(createPoint2D(field.pos), getFootprint(field.unitType)!);
                        const closestMfCell = closestPoint(thCell, mfCells)!; // a footprint always has cells
                        const d = distance(thCell, closestMfCell);
                        if (d < closestField.distance) {
                            return { closestField: field, distance: d };
                        } else {
                            return closestField;
                        }
                    },
                    { closestField: null, distance: Infinity },
                );

                return { ...thCell, closest: closestResource };
            });

            return {
                ...cell,
                cellBucket,
            };
        })
        .filter((cell) => cell.cellBucket.every((cell) => cell.closest.distance >= MIN_RESOURCE_DISTANCE + CELL_SIZE))
        .map((grid) => ({ x: grid.x, y: grid.y }))
        .filter((placement) => {
            // don't check placeable if it matches the townhall starting position, because it's right
            const { self } = map.getLocations();
            if (self && areEqual(add(placement, 0.5), self)) return true;
            return map.isPlaceableAt(COMMANDCENTER, placement);
        });

    return closestPoint(center, grids);
}

export default calculateTownhallPlacement;
