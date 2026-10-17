import type { Cluster, Point2D, Unit } from '../../types.ts';
import { vespeneGeyserTypes } from '../../constants/groups.ts';
import { add, multiply, divide, areEqual, distanceSquared, getNeighbors } from '../geometry/point.ts';

// Right now only used for expansions.
function createClusters(units: Unit[], distanceApart = 15.0): Cluster[] {
    const squaredDistanceApart = distanceApart * distanceApart;

    return units.reduce((clusters, u) => {
        const isGeyser = vespeneGeyserTypes.includes(u.unitType);
        const { distance, target } = clusters.reduce<{ distance: number, target: Cluster | null }>((acc, b) => {
            const d = distanceSquared(u.pos, b.centroid!);

            if (d < acc.distance) {
                return { distance: d, target: b };
            } else {
                return acc;
            }
        }, { distance: Infinity, target: null });

        if (distance > squaredDistanceApart) {
            return clusters.concat([{
                centroid: u.pos,
                mineralFields: isGeyser ? [] : [u],
                vespeneGeysers: isGeyser ? [u] : [],
            }]);
        } else {
            // TODO(ts): distance <= squaredDistanceApart implies a target was found
            const found = target!;
            if (isGeyser) {
                found.vespeneGeysers = [...found.vespeneGeysers!, u];
            } else {
                found.mineralFields = [...found.mineralFields, u];
            }
            
            const size = found.mineralFields.length + found.vespeneGeysers!.length;
            found.centroid = divide(add(multiply(found.centroid!, (size - 1)), u.pos), size);
            return clusters;
        }
    }, [] as Cluster[]);
}

function clusterByNeighbor(points: Point2D[]): Point2D[][] {
    const sorted = points.slice().sort((a, b) => {
        if (a.y < b.y) {
            return -1;
        } else if (a.y > b.y) {
            return 1;
        } else {
            if (a.x < b.x) {
                return -1;
            } else if (a.x > b.x) {
                return 1;
            } else {
                return 0;
            }
        }
    });

    return sorted.reduce((sets, point) => {
        const connected = sets.filter(set => set.some((setPoint) => {
            return getNeighbors(setPoint).some(spn => areEqual(spn, point));
        }));

        if (connected.length <= 0) return [...sets, [point]];

        const merged = [...connected.flat(), point];
        const firstIndex = sets.indexOf(connected[0]);
        const rest = sets.filter(set => !connected.includes(set));
        return [...rest.slice(0, firstIndex), merged, ...rest.slice(firstIndex)];
    }, [] as Point2D[][]);
}

export { createClusters, clusterByNeighbor };
