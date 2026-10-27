import type { Cluster, Unit } from '../../types.ts';
import { vespeneGeyserTypes } from '../../constants/groups.ts';
import { add, multiply, divide, distanceSquared } from '../geometry/point.ts';

function createClusters(units: Unit[], distanceApart = 15.0): Cluster[] {
    const squaredDistanceApart = distanceApart * distanceApart;

    return units.reduce((clusters, u) => {
        const isGeyser = vespeneGeyserTypes.includes(u.unitType);
        const { distance, target } = clusters.reduce<{ distance: number; target: Cluster | null }>(
            (acc, b) => {
                const d = distanceSquared(u.pos, b.centroid!);

                if (d < acc.distance) {
                    return { distance: d, target: b };
                } else {
                    return acc;
                }
            },
            { distance: Infinity, target: null },
        );

        if (!target || distance > squaredDistanceApart) {
            return clusters.concat([
                {
                    centroid: u.pos,
                    mineralFields: isGeyser ? [] : [u],
                    vespeneGeysers: isGeyser ? [u] : [],
                },
            ]);
        } else {
            const found = target;
            if (isGeyser) {
                found.vespeneGeysers = [...found.vespeneGeysers!, u];
            } else {
                found.mineralFields = [...found.mineralFields, u];
            }

            const size = found.mineralFields.length + found.vespeneGeysers!.length;
            found.centroid = divide(add(multiply(found.centroid!, size - 1), u.pos), size);
            return clusters;
        }
    }, [] as Cluster[]);
}

export { createClusters };
