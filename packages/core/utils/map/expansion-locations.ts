import { avgPoints, distance } from '../geometry/point.ts';
import { UnitType } from '../../constants/index.ts';
import { mineralFieldTypes, vespeneGeyserTypes } from '../../constants/groups.ts';
import type { PixelMap } from '../pixel-map.ts';
import type { Point2D, Unit } from '../../types.ts';

const RESOURCE_SPREAD_THRESHOLD = 10.5;
const MAX_RESOURCES_PER_BASE = 12;
const OFFSET_RANGE = 7;
const RESOURCE_TYPES = [
    ...mineralFieldTypes,
    UnitType.MINERALFIELDOPAQUE,
    UnitType.MINERALFIELDOPAQUE900,
    ...vespeneGeyserTypes,
];

const OFFSETS: Array<[number, number]> = [];
for (let x = -OFFSET_RANGE; x <= OFFSET_RANGE; x += 1) {
    for (let y = -OFFSET_RANGE; y <= OFFSET_RANGE; y += 1) {
        const length = Math.hypot(x, y);
        if (length > 4 && length <= 8) OFFSETS.push([x, y]);
    }
}

const isGeyser = (resource: Unit) => vespeneGeyserTypes.includes(resource.unitType);
const flooredCell = ({ x, y }: Point2D) => ({ x: Math.floor(x), y: Math.floor(y) });

function mergeResourceGroups(resources: Unit[], terrainHeight: PixelMap): Unit[][] {
    let groups = resources.map((resource) => [resource]);
    const sameLevel = (groupA: Unit[], groupB: Unit[]) =>
        groupA.every((resourceA) =>
            groupB.every(
                (resourceB) =>
                    Math.abs(
                        terrainHeight.get(flooredCell(resourceA.pos)) - terrainHeight.get(flooredCell(resourceB.pos)),
                    ) <= 10,
            ),
        );

    let merged = true;
    while (merged) {
        merged = false;
        search: for (let indexA = 0; indexA < groups.length; indexA += 1) {
            for (let indexB = indexA + 1; indexB < groups.length; indexB += 1) {
                const groupA = groups[indexA];
                const groupB = groups[indexB];
                if (
                    distance(avgPoints(groupA.map((r) => r.pos)), avgPoints(groupB.map((r) => r.pos))) <=
                        RESOURCE_SPREAD_THRESHOLD &&
                    sameLevel(groupA, groupB)
                ) {
                    groups = groups.filter((group) => group !== groupA && group !== groupB);
                    groups.push([...groupA, ...groupB]);
                    merged = true;
                    break search;
                }
            }
        }
    }
    return groups;
}

function findExpansionLocation(resources: Unit[], placementGrid: PixelMap): Point2D {
    const centerX = Math.trunc(resources.reduce((sum, resource) => sum + resource.pos.x, 0) / resources.length) + 0.5;
    const centerY = Math.trunc(resources.reduce((sum, resource) => sum + resource.pos.y, 0) / resources.length) + 0.5;
    const distanceSum = (point: Point2D) => resources.reduce((sum, resource) => sum + distance(point, resource.pos), 0);

    return OFFSETS.map(([offsetX, offsetY]) => ({ x: offsetX + centerX, y: offsetY + centerY }))
        .filter(({ x, y }) => x >= 0 && y >= 0 && x < placementGrid.width && y < placementGrid.height)
        .filter((point) => placementGrid.get(flooredCell(point)) === 1)
        .filter((point) => resources.every((resource) => distance(point, resource.pos) >= (isGeyser(resource) ? 7 : 6)))
        .reduce((best, point) => (distanceSum(point) < distanceSum(best) ? point : best));
}

function hasOppositeSideGeyserLayout(minerals: Unit[], geysers: Unit[]): boolean {
    if (geysers.length !== 2 || minerals.length < 6) return false;

    let maxDistance = 0;
    let [mineralA, mineralB] = minerals;
    minerals.forEach((first, index) => {
        minerals.slice(index + 1).forEach((second) => {
            const between = distance(first.pos, second.pos);
            if (between > maxDistance) {
                maxDistance = between;
                mineralA = first;
                mineralB = second;
            }
        });
    });
    if (maxDistance < 4) return false;

    const { x: x1, y: y1 } = mineralA.pos;
    const { x: x2, y: y2 } = mineralB.pos;
    const [geyserA, geyserB] = geysers;

    if (Math.abs(x2 - x1) < 0.1) {
        const lineX = (x1 + x2) / 2;
        const sideA = geyserA.pos.x - lineX;
        const sideB = geyserB.pos.x - lineX;
        return sideA * sideB < 0 && Math.abs(sideA) > 3 && Math.abs(sideB) > 3;
    }

    const slope = (y2 - y1) / (x2 - x1);
    const intercept = y1 - slope * x1;
    const sideOfLine = ({ x, y }: Point2D) => y - slope * x - intercept;
    return sideOfLine(geyserA.pos) * sideOfLine(geyserB.pos) < 0;
}

export function findExpansionLocations(
    neutralUnits: Unit[],
    terrainHeight: PixelMap,
    placementGrid: PixelMap,
): Point2D[] {
    const groups = mergeResourceGroups(
        neutralUnits.filter((unit) => RESOURCE_TYPES.includes(unit.unitType)),
        terrainHeight,
    );

    return groups
        .filter((group) => group.length <= MAX_RESOURCES_PER_BASE)
        .flatMap((group) => {
            const minerals = group.filter((resource) => !isGeyser(resource));
            const geysers = group.filter(isGeyser);
            if (hasOppositeSideGeyserLayout(minerals, geysers)) {
                return geysers.map((geyser) => findExpansionLocation([...minerals, geyser], placementGrid));
            }
            return [findExpansionLocation(group, placementGrid)];
        });
}
