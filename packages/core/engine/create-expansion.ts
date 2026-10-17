import { Alliance } from '../constants/enums.ts';
import townhallPlacement from '../utils/map/townhall.ts';
import type { Cluster, Expansion, World } from '../types.ts';

function createExpansion(world: World, cluster: Cluster): Expansion {
    const { units } = world.resources.get();

    // TODO(ts): getWall/getBase/getAlliance can implicitly return undefined, which Expansion's signatures don't allow
    return {
        cluster,
        labels: new Map(),
        zPosition: cluster.mineralFields[0].pos!.z,
        townhallPosition: townhallPlacement(world, cluster.centroid!, cluster.mineralFields, cluster.vespeneGeysers!),
        getWall() {
            return this.areas!.wall!;
        },
        getBase() {
            if (this.base) {
                return units.getByTag(this.base);
            }
        },
        getAlliance() {
            if (this.base) {
                const base = units.getByTag(this.base);
                return base.labels.has('dead') ? Alliance.NEUTRAL : base.alliance!;
            } else {
                return Alliance.NEUTRAL;
            }
        },
    } as Expansion;
}

export default createExpansion;
